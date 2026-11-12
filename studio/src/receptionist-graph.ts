import { AIMessage, type BaseMessage, ToolMessage, isAIMessage, isHumanMessage, isToolMessage } from "@langchain/core/messages";
import { type BaseCheckpointSaver, END, MessagesZodState, START, StateGraph } from "@langchain/langgraph";
import { z } from "zod/v3";
import { ejecutarLlamada } from "../../api/src/agent/execution.ts";
import { definicionesParaModelo } from "../../api/src/agent/model-tools.ts";
import { leerPromptSistema } from "../../api/src/agent/prompt.ts";
import { cerrarPendientes, conPreguntaExplicita, errorDeProveedor, mensajeDeTope, pendientesVigentes } from "../../api/src/agent/turn.ts";
import type { LlamadaVisible } from "../../api/src/http/types.ts";
import { CLAVE_FIRMAS, aMensajesLlm, firmasDeLlamadas } from "./messages.ts";
import { type DependenciasStudio, dependenciasPorEntorno } from "./project.ts";

/**
 * La recepcionista como grafo de LangGraph, para verla en Studio: el mismo ReAct que `api/src/agent/loop.ts`,
 * con el mismo prompt, el mismo `ProveedorLlm`, las mismas cinco herramientas `recepcion_*` y la misma guarda CA3.
 *
 *   __start__ ─▶ recepcionista ⇄ herramientas
 *                     └──────────▶ __end__
 */

/**
 * Estado sobre `MessagesZodState` (zod v3, el que publica LangGraph) para que el servidor anuncie `messages`
 * con `langgraph_type: "messages"`: es lo que Studio necesita para habilitar la pestaña Chat. La entrada es solo `messages`.
 */
const Ids = () => z.array(z.string()).default([]);

export const EntradaRecepcion = MessagesZodState;

export const EstadoRecepcion = MessagesZodState.extend({
  pendientes: Ids().describe("Mensajes por los que la recepcionista preguntó en turnos anteriores de este hilo (CA3)"),
  pendientes_al_inicio: Ids().describe("Copia de pendientes al empezar el turno: lo único que la guarda deja decidir"),
  en_revision: Ids().describe("Lo que el motor pausó en este turno"),
  resueltos: Ids().describe("Lo que una decisión humana cerró en este turno"),
  iteraciones: z.number().int().nonnegative().default(0).describe("Llamadas al modelo en este turno (tope CA1)"),
});

type Estado = z.infer<typeof EstadoRecepcion>;

/** Como la entrada es solo `messages`, el primer turno llega sin los demás campos: el esquema les pone sus valores por defecto. */
const leerEstado = (crudo: z.input<typeof EstadoRecepcion>): Estado => EstadoRecepcion.parse(crudo);
type Actualizacion = Partial<Omit<Estado, "messages">> & { messages?: BaseMessage[] };
type Turno = Pick<Estado, "pendientes_al_inicio" | "en_revision" | "resueltos" | "iteraciones">;

const ultimoMensaje = (mensajes: readonly BaseMessage[]): BaseMessage | undefined => mensajes.at(-1);

/** Llamadas visibles del turno en curso, desde el último mensaje del usuario (para el mensaje de tope CA1). */
function llamadasDelTurno(mensajes: readonly BaseMessage[]): LlamadaVisible[] {
  const inicio = mensajes.findLastIndex((mensaje) => isHumanMessage(mensaje));
  // `artifact` lo escribe el nodo `herramientas` con la `LlamadaVisible` de cada ejecución.
  return mensajes.slice(inicio + 1).flatMap((mensaje) => (isToolMessage(mensaje) && mensaje.artifact ? [mensaje.artifact as LlamadaVisible] : []));
}

export function crearGrafoRecepcion(deps: DependenciasStudio) {
  const definiciones = definicionesParaModelo();
  const cargarSistema = deps.cargarSistema ?? (() => leerPromptSistema(deps.directorio));
  const ctxDe = (hilo: string) => ({ directory: deps.directorio, sessionId: `studio-${hilo}` });

  /** Al empezar un turno se descartan los pendientes cerrados en otro canal y se reinician los contadores. */
  async function turnoEnCurso(estado: Estado): Promise<Turno> {
    const ultimo = ultimoMensaje(estado.messages);
    if (!ultimo || !isHumanMessage(ultimo)) {
      const { pendientes_al_inicio, en_revision, resueltos, iteraciones } = estado;
      return { pendientes_al_inicio, en_revision, resueltos, iteraciones };
    }
    return { pendientes_al_inicio: await pendientesVigentes(deps.directorio, estado.pendientes), en_revision: [], resueltos: [], iteraciones: 0 };
  }

  /** Cierre del turno (CA3): si el motor pausó algo, la respuesta termina con una pregunta explícita. */
  function responder(turno: Turno, texto: string): Actualizacion {
    const { pendientes, nuevas } = cerrarPendientes(turno.pendientes_al_inicio, turno.en_revision, new Set(turno.resueltos));
    const respuesta = new AIMessage({ content: conPreguntaExplicita(texto, nuevas), additional_kwargs: { necesita_confirmacion: nuevas.length > 0 } });
    return { ...turno, pendientes, messages: [respuesta] };
  }

  async function recepcionista(crudo: z.input<typeof EstadoRecepcion>): Promise<Actualizacion> {
    const estado = leerEstado(crudo);
    const turno = await turnoEnCurso(estado);
    if (turno.iteraciones >= deps.maxIteraciones) return responder(turno, mensajeDeTope(deps.maxIteraciones, llamadasDelTurno(estado.messages), ""));
    const respuesta = await deps.proveedor.enviar([{ rol: "sistema", texto: await cargarSistema() }, ...aMensajesLlm(estado.messages)], definiciones);
    if (!respuesta.ok) return responder(turno, errorDeProveedor(deps.proveedor, respuesta.error));
    const { texto, llamadas } = respuesta.data;
    if (llamadas.length === 0) return responder(turno, texto.trim() || "(el modelo no devolvió texto)");
    const pide = new AIMessage({
      content: texto,
      tool_calls: llamadas.map((llamada) => ({ id: llamada.id, name: llamada.nombre, args: llamada.args, type: "tool_call" as const })),
      additional_kwargs: { [CLAVE_FIRMAS]: firmasDeLlamadas(llamadas) },
    });
    return { ...turno, iteraciones: turno.iteraciones + 1, messages: [pide] };
  }

  async function herramientas(crudo: z.input<typeof EstadoRecepcion>, config: { configurable?: { thread_id?: string } }): Promise<Actualizacion> {
    const estado = leerEstado(crudo);
    const pide = ultimoMensaje(estado.messages);
    if (!pide || !isAIMessage(pide)) return {};
    const ctx = ctxDe(config.configurable?.thread_id ?? "local");
    const permitidos = new Set(estado.pendientes_al_inicio);
    const resultados: ToolMessage[] = [];
    const enRevision = [...estado.en_revision];
    const resueltos = [...estado.resueltos];
    for (const llamada of pide.tool_calls ?? []) {
      const ejecutada = await ejecutarLlamada({ id: llamada.id ?? "", nombre: llamada.name, args: llamada.args }, ctx, permitidos);
      // `content` es lo que vuelve al modelo; `artifact` guarda la llamada visible con los pasos del motor para Studio.
      resultados.push(new ToolMessage({ tool_call_id: llamada.id ?? "", name: llamada.name, content: ejecutada.json, artifact: ejecutada.visible }));
      enRevision.push(...ejecutada.efecto.enRevision);
      resueltos.push(...ejecutada.efecto.resueltos);
    }
    return { messages: resultados, en_revision: enRevision, resueltos };
  }

  const tieneLlamadas = (estado: z.input<typeof EstadoRecepcion>): "herramientas" | typeof END => {
    const ultimo = ultimoMensaje(estado.messages);
    return ultimo && isAIMessage(ultimo) && (ultimo.tool_calls?.length ?? 0) > 0 ? "herramientas" : END;
  };

  return new StateGraph({ state: EstadoRecepcion, input: EntradaRecepcion })
    .addNode("recepcionista", recepcionista)
    .addNode("herramientas", herramientas)
    .addEdge(START, "recepcionista")
    .addConditionalEdges("recepcionista", tieneLlamadas, ["herramientas", END])
    .addEdge("herramientas", "recepcionista");
}

/** Cada iteración del ciclo son dos pasos (recepcionista + herramientas); el tope propio (CA1) debe cortar antes que el de LangGraph. */
export const compilarRecepcion = (deps: DependenciasStudio, checkpointer?: BaseCheckpointSaver) =>
  crearGrafoRecepcion(deps)
    .compile(checkpointer ? { checkpointer } : {})
    .withConfig({ recursionLimit: 2 * deps.maxIteraciones + 5 });

export const graph = compilarRecepcion(dependenciasPorEntorno());
