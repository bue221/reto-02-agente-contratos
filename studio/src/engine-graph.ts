import { type BaseCheckpointSaver, END, type LangGraphRunnableConfig, START, StateGraph, interrupt } from "@langchain/langgraph";
import { z } from "zod";
import { withLangGraph } from "@langchain/langgraph/zod";
import { z as z3 } from "zod/v3";
import type { Alertas } from "../../api/src/application/use-cases/alerts.ts";
import { reanudarRevision } from "../../api/src/application/workflows/approval-tray.ts";
import {
  ARISTAS,
  type EstadoMensaje,
  NODOS,
  NODO_INICIAL,
  type NodoMensaje,
  type ResultadoMensaje,
  estadoInicial,
  mensajeConError,
} from "../../api/src/application/workflows/contract-graph.ts";
import { type EjecutorPasada, type Omitido, ingestar } from "../../api/src/application/workflows/process-mailbox.ts";
import { llamarHerramienta } from "../../api/src/application/workflows/tool-call.ts";
import { CorreccionesSchema } from "../../api/src/core/domain/contract.ts";
import { exito, fallo } from "../../api/src/core/domain/result.ts";
import type { ContextoHerramienta } from "../../api/src/tools/tool.ts";
import { type DependenciasStudio, dependenciasPorEntorno } from "./project.ts";

/**
 * El motor determinista como grafo de LangGraph, para verlo en Studio. Los nodos de cada mensaje son los
 * mismos `NODOS` de `contract-graph.ts`, con la misma topología (`ARISTAS`); la pasada y la reanudación usan
 * las mismas funciones que la app. Solo cambia quién recorre el grafo. La recepcionista invoca la misma
 * pasada, sin `revision_humana`, como subgrafo de su nodo `herramientas` (`pasadaComoSubgrafo`):
 *
 *   ingestar ─▶ siguiente_mensaje ─┬─▶ extraer ─▶ validar ─▶ decidir ─┬─▶ registrar ──────┐
 *                    ▲             │                                 ├─▶ esperar_revision ┤
 *                    └─────────────┼─────────────────────────────────┴─▶ cerrar ──────────┘
 *                                  └─▶ alertas ─┬─▶ revision_humana (interrupt) ─▶ alertas
 *                                               └─▶ __end__
 */

interface DecisionStudio {
  mensaje_id: string;
  resuelto: boolean;
  resumen: string;
}

/** Canal de último valor con su valor inicial: lo que antes era `Annotation<T>({ reducer: (_, nuevo) => nuevo, default })`. */
const ultimoValor = <T extends z3.ZodTypeAny>(esquema: T, porDefecto: () => z3.infer<T>) =>
  withLangGraph(esquema, { default: porDefecto, reducer: { fn: (_previo: z3.infer<T>, nuevo: z3.infer<T>) => nuevo } });

/**
 * Estado en zod (v3, el que publica LangGraph) y no con `Annotation`: así el servidor saca los esquemas en tiempo de
 * ejecución. Con `Annotation` los infiere compilando el proyecto con TypeScript, una vez por petición de Studio, y
 * eso no cabe en un contenedor de 512 MB.
 */
const DESCRIPCION_HOY = "Fecha de referencia de las alertas (YYYY-MM-DD)";
const DESCRIPCION_IDS = "Solo estos mensajes; sin lista, todo lo pendiente";

export const EstadoMotor = z3.object({
  hoy: z3.string().describe(DESCRIPCION_HOY),
  mensaje_ids: ultimoValor(z3.array(z3.string()).nullable().describe(DESCRIPCION_IDS), () => null),
  cola: ultimoValor(z3.array(z3.string()), () => []),
  actual: ultimoValor(z3.custom<EstadoMensaje>().nullable().describe("Mensaje que está recorriendo el grafo, con su recorrido"), () => null),
  siguiente: ultimoValor(z3.custom<NodoMensaje>().nullable().describe("Nodo al que va el mensaje en curso"), () => null),
  mensajes: ultimoValor(z3.array(z3.custom<ResultadoMensaje>()), () => []),
  omitidos: ultimoValor(z3.array(z3.custom<Omitido>()), () => []),
  en_revision: ultimoValor(z3.array(z3.string()), () => []),
  decisiones: ultimoValor(z3.array(z3.custom<DecisionStudio>()), () => []),
  reporte: ultimoValor(
    z3.custom<Alertas | { error: string }>().nullable().describe("Último reporte de alertas (out/alertas.md); se llama así porque `alertas` es el nombre del nodo"),
    () => null,
  ),
  error: ultimoValor(z3.string().nullable(), () => null),
});

export const EntradaMotor = z3.object({
  hoy: z3.string().describe(DESCRIPCION_HOY),
  mensaje_ids: z3.array(z3.string()).nullable().optional().describe(DESCRIPCION_IDS),
});

type Estado = z3.infer<typeof EstadoMotor>;
type Actualizacion = Partial<Estado>;

/** Lo que la persona escribe en Studio para reanudar la pausa. */
const RespuestaRevisionSchema = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("aprobar"), correcciones: CorreccionesSchema.default({}), aprobador: z.string().trim().min(1).default("studio") }),
  z.object({ decision: z.literal("rechazar"), motivo: z.string().trim().min(1, "el rechazo necesita un motivo"), aprobador: z.string().trim().min(1).default("studio") }),
]);

const INSTRUCCIONES =
  'Reanuda con {"decision":"aprobar","correcciones":{"valor":0,"fecha_fin":"2027-08-31"}} o {"decision":"rechazar","motivo":"…"}. Las correcciones son opcionales.';

const sinDecidir = (estado: Estado): string[] => {
  const resueltos = new Set(estado.decisiones.filter((decision) => decision.resuelto).map((decision) => decision.mensaje_id));
  return estado.en_revision.filter((id) => !resueltos.has(id));
};

/** Un fallo de forma o de registro deja el mensaje pausado; si ya se cerró en otro canal, se da por resuelto. */
const CODIGOS_YA_RESUELTOS = new Set(["ya_procesado", "no_pendiente"]);

const contextoStudio = (directorio: string): ContextoHerramienta => ({ directory: directorio, sessionId: "studio" });

/** Ingesta, grafo de cada mensaje y alertas: lo que recorre una pasada, sin la pausa humana. */
function crearPasada(ctx: ContextoHerramienta) {
  async function nodoIngestar(estado: Estado): Promise<Actualizacion> {
    const ingesta = await ingestar(ctx, estado.mensaje_ids ?? undefined);
    if (!ingesta.ok) return { error: ingesta.error, cola: [] };
    const { ids, omitidos, ilegibles } = ingesta.data;
    return { cola: ids, omitidos, mensajes: ilegibles.map(({ id, error }) => mensajeConError(id, error)), en_revision: [], decisiones: [], error: null };
  }

  function siguienteMensaje(estado: Estado): Actualizacion {
    const [id, ...resto] = estado.cola;
    return id ? { cola: resto, actual: estadoInicial(id), siguiente: NODO_INICIAL } : { actual: null, siguiente: null };
  }

  /** Envuelve un nodo de `NODOS`: al llegar a un final, el resultado del mensaje pasa a la lista y se sigue con el próximo. */
  const nodoDeMensaje = (nodo: NodoMensaje) =>
    async function (estado: Estado): Promise<Actualizacion> {
      if (!estado.actual) return { siguiente: null };
      const { estado: mensaje, siguiente } = await NODOS[nodo](estado.actual, ctx);
      if (siguiente || !mensaje.resultado) return { actual: mensaje, siguiente };
      const { resultado } = mensaje;
      const en_revision = resultado.desenlace === "en_revision" ? [...estado.en_revision, resultado.mensaje_id] : estado.en_revision;
      return { actual: null, siguiente: null, mensajes: [...estado.mensajes, resultado], en_revision };
    };

  async function nodoAlertas(estado: Estado): Promise<Actualizacion> {
    const alertas = await llamarHerramienta<Alertas>("contratos_alertas", { hoy: estado.hoy }, ctx);
    return { reporte: alertas.ok ? alertas.data : { error: alertas.error } };
  }

  const grafo = new StateGraph({ state: EstadoMotor, input: EntradaMotor })
    .addNode("ingestar", nodoIngestar)
    .addNode("siguiente_mensaje", siguienteMensaje)
    .addNode("extraer", nodoDeMensaje("extraer"))
    .addNode("validar", nodoDeMensaje("validar"))
    .addNode("decidir", nodoDeMensaje("decidir"))
    .addNode("registrar", nodoDeMensaje("registrar"))
    .addNode("esperar_revision", nodoDeMensaje("esperar_revision"))
    .addNode("cerrar", nodoDeMensaje("cerrar"))
    .addNode("alertas", nodoAlertas)
    .addEdge(START, "ingestar")
    .addEdge("ingestar", "siguiente_mensaje")
    .addConditionalEdges("siguiente_mensaje", (estado: Estado) => estado.siguiente ?? "alertas", [NODO_INICIAL, "alertas"]);

  for (const [nodo, destinos] of Object.entries(ARISTAS) as [NodoMensaje, readonly (NodoMensaje | null)[]][]) {
    const posibles = destinos.map((destino) => destino ?? "siguiente_mensaje");
    grafo.addConditionalEdges(nodo, (estado: Estado) => estado.siguiente ?? "siguiente_mensaje", posibles);
  }
  return grafo;
}

export function crearGrafoMotor(deps: Pick<DependenciasStudio, "directorio">) {
  const ctx = contextoStudio(deps.directorio);

  /** La pausa humana: el grafo se detiene aquí hasta que alguien responda desde Studio. */
  async function revisionHumana(estado: Estado): Promise<Actualizacion> {
    const [id] = sinDecidir(estado);
    if (!id) return {};
    const mensaje = estado.mensajes.find((resultado) => resultado.mensaje_id === id);
    const respuesta = interrupt({ mensaje_id: id, revision: mensaje?.revision ?? [], avisos: mensaje?.avisos ?? [], instrucciones: INSTRUCCIONES });
    const leida = RespuestaRevisionSchema.safeParse(respuesta);
    if (!leida.success) {
      const error = leida.error.issues.map((issue) => `${issue.path.join(".") || "(raíz)"}: ${issue.message}`).join("; ");
      return { decisiones: [...estado.decisiones, { mensaje_id: id, resuelto: false, resumen: `respuesta inválida: ${error}` }] };
    }
    const decision = leida.data;
    const comunes = { mensajeId: id, aprobador: `studio ${decision.aprobador}`, via: "studio", hoy: null } as const;
    const reanudado = await reanudarRevision(
      ctx,
      decision.decision === "aprobar" ? { ...comunes, decision: "aprobar", correcciones: decision.correcciones } : { ...comunes, decision: "rechazar", motivo: decision.motivo },
    );
    const anotada: DecisionStudio = reanudado.ok
      ? { mensaje_id: id, resuelto: true, resumen: `${reanudado.data.decision.decision}: ${reanudado.data.decision.accion ?? "sin escritura"} ${reanudado.data.decision.id_contrato ?? ""}`.trim() }
      : { mensaje_id: id, resuelto: CODIGOS_YA_RESUELTOS.has(reanudado.codigo), resumen: reanudado.mensaje };
    return { decisiones: [...estado.decisiones, anotada] };
  }

  return crearPasada(ctx)
    .addNode("revision_humana", revisionHumana)
    .addConditionalEdges("alertas", (estado: Estado) => (sinDecidir(estado).length > 0 ? "revision_humana" : END), ["revision_humana", END])
    .addEdge("revision_humana", "alertas");
}

/** Cada mensaje cuesta hasta 7 pasos (siguiente_mensaje + 6 nodos): el tope por defecto de LangGraph (25) no alcanza para un buzón. */
export const LIMITE_PASOS = 500;

export const compilarMotor = (deps: Pick<DependenciasStudio, "directorio">, checkpointer?: BaseCheckpointSaver) =>
  crearGrafoMotor(deps)
    .compile(checkpointer ? { checkpointer } : {})
    .withConfig({ recursionLimit: LIMITE_PASOS });

/**
 * Subgrafo de `recepcion_procesar_buzon` en la recepcionista. Sin `revision_humana`: ahí la pausa la cierra
 * el turno del chat (CA3) y la decisión llega por `recepcion_responder_revision`. Se compila sin checkpointer
 * para heredar el del grafo padre y quedar guardado como subgrafo del hilo.
 */
export const compilarPasada = (ctx: ContextoHerramienta) =>
  crearPasada(ctx).addEdge("alertas", END).compile({ name: "motor" }).withConfig({ recursionLimit: LIMITE_PASOS });

/** Mismo resultado que el bucle de `ejecutarPasada`, recorrido por LangGraph dentro del nodo que lo invoca. */
export const pasadaComoSubgrafo =
  (config: LangGraphRunnableConfig): EjecutorPasada =>
  async (ctx, solicitud) => {
    const entrada = { hoy: solicitud.hoy, mensaje_ids: solicitud.mensajeIds ? [...solicitud.mensajeIds] : null };
    const final = await compilarPasada(ctx).invoke(entrada, { ...config, recursionLimit: LIMITE_PASOS });
    if (final.error) return fallo(final.error);
    const { reporte } = final;
    const alertas = reporte === null ? fallo<Alertas>("la pasada terminó sin reporte de alertas") : "error" in reporte ? fallo<Alertas>(reporte.error) : exito(reporte);
    return exito({ mensajes: final.mensajes, omitidos: final.omitidos, en_revision: final.en_revision, alertas });
  };

export const graph = compilarMotor(dependenciasPorEntorno());
