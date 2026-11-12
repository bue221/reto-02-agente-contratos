import { AIMessage, type BaseMessage, ToolMessage, isAIMessage, isHumanMessage, isToolMessage } from "@langchain/core/messages";
import { type BaseCheckpointSaver, END, type LangGraphRunnableConfig, MessagesZodState, START, StateGraph } from "@langchain/langgraph";
import { z } from "zod/v3";
import { ejecutarLlamada } from "../../api/src/agent/execution.ts";
import { auditarBloqueo } from "../../api/src/agent/guardrails/audit.ts";
import { revisarRespaldo } from "../../api/src/agent/guardrails/grounding.ts";
import { respuestaDeBloqueo, revisarEntrada } from "../../api/src/agent/guardrails/input-guard.ts";
import { conCanario, nuevoCanario, revisarSalida } from "../../api/src/agent/guardrails/output-guard.ts";
import { definicionesParaModelo } from "../../api/src/agent/model-tools.ts";
import { leerPromptSistema } from "../../api/src/agent/prompt.ts";
import { cerrarPendientes, conPreguntaExplicita, errorDeProveedor, mensajeDeTope, pendientesVigentes } from "../../api/src/agent/turn.ts";
import type { ContextoMotor } from "../../api/src/application/workflows/process-mailbox.ts";
import type { LlamadaVisible } from "../../api/src/http/types.ts";
import { compilarPasada, pasadaComoSubgrafo } from "./engine-graph.ts";
import { CLAVE_BLOQUEO, CLAVE_FIRMAS, aMensajesLlm, esBloqueo, firmasDeLlamadas, textoDe } from "./messages.ts";
import { type DependenciasStudio, dependenciasPorEntorno } from "./project.ts";

/**
 * La recepcionista como grafo de LangGraph, para verla en Studio: el mismo ReAct que `api/src/agent/loop.ts`,
 * con el mismo prompt, el mismo `ProveedorLlm`, las mismas cinco herramientas `recepcion_*`, las mismas guardas
 * de entrada, salida y respaldo (CA2) y la misma guarda CA3.
 * Cuando el modelo llama a `recepcion_procesar_buzon`, la pasada del motor corre como subgrafo `motor` de `herramientas`.
 *
 *   __start__ ─▶ guarda_entrada ─▶ recepcionista ⇄ herramientas ─(recepcion_procesar_buzon)─▶ [motor]
 *                     └─(bloqueado)─────┴──────────▶ __end__
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

const hiloDe = (config: LangGraphRunnableConfig): string => (typeof config.configurable?.thread_id === "string" ? config.configurable.thread_id : "local");

export function crearGrafoRecepcion(deps: DependenciasStudio) {
  const definiciones = definicionesParaModelo();
  const canario = nuevoCanario();
  const cargarSistema = deps.cargarSistema ?? (() => leerPromptSistema(deps.directorio));
  const ctxDe = (hilo: string) => ({ directory: deps.directorio, sessionId: `studio-${hilo}` });

  /** Antes que el modelo: lo bloqueado recibe una respuesta fija y el turno termina sin llamarlo. */
  async function guardaEntrada(crudo: z.input<typeof EstadoRecepcion>, config: LangGraphRunnableConfig): Promise<Actualizacion> {
    const estado = leerEstado(crudo);
    const ultimo = ultimoMensaje(estado.messages);
    if (!ultimo || !isHumanMessage(ultimo)) return {};
    const anterior = estado.messages.slice(0, -1).findLast((mensaje) => isAIMessage(mensaje) && (mensaje.tool_calls?.length ?? 0) === 0);
    const { bloqueo } = await revisarEntrada(textoDe(ultimo.content), { clasificador: deps.clasificador, ultimaRespuesta: anterior ? textoDe(anterior.content) : "" });
    if (!bloqueo) return {};
    await auditarBloqueo(deps.directorio, ctxDe(hiloDe(config)).sessionId, "guarda_entrada", `${bloqueo.motivo}: ${bloqueo.detalle}`);
    const pendientes = await pendientesVigentes(deps.directorio, estado.pendientes);
    const respuesta = new AIMessage({ content: respuestaDeBloqueo(bloqueo, pendientes), additional_kwargs: { [CLAVE_BLOQUEO]: true, necesita_confirmacion: false } });
    return { pendientes, messages: [respuesta] };
  }

  /** Al empezar un turno se descartan los pendientes cerrados en otro canal y se reinician los contadores. */
  async function turnoEnCurso(estado: Estado): Promise<Turno> {
    const ultimo = ultimoMensaje(estado.messages);
    if (!ultimo || !isHumanMessage(ultimo)) {
      const { pendientes_al_inicio, en_revision, resueltos, iteraciones } = estado;
      return { pendientes_al_inicio, en_revision, resueltos, iteraciones };
    }
    return { pendientes_al_inicio: await pendientesVigentes(deps.directorio, estado.pendientes), en_revision: [], resueltos: [], iteraciones: 0 };
  }

  /** Cierre del turno: guarda de salida y CA3 (si el motor pausó algo, la respuesta termina con una pregunta explícita). */
  async function responder(turno: Turno, texto: string, hilo: string): Promise<Actualizacion> {
    const salida = revisarSalida(texto, canario);
    if (salida.filtrada) await auditarBloqueo(deps.directorio, ctxDe(hilo).sessionId, "guarda_salida", "la respuesta contenía el canario del prompt de sistema");
    const { pendientes, nuevas } = cerrarPendientes(turno.pendientes_al_inicio, turno.en_revision, new Set(turno.resueltos));
    const respuesta = new AIMessage({ content: conPreguntaExplicita(salida.texto, nuevas), additional_kwargs: { necesita_confirmacion: nuevas.length > 0 } });
    return { ...turno, pendientes, messages: [respuesta] };
  }

  /** CA2, igual que el ciclo propio: fuentes = prompt, mensajes de la analista y resultados de herramientas. */
  async function conRespaldo(mensajes: readonly BaseMessage[], sistema: string, texto: string, hilo: string): Promise<string> {
    const fuentes = [sistema, ...mensajes.filter((mensaje) => isHumanMessage(mensaje) || isToolMessage(mensaje)).map((mensaje) => textoDe(mensaje.content))];
    const revisado = revisarRespaldo(texto, fuentes);
    if (revisado.sinRespaldo.length > 0) await auditarBloqueo(deps.directorio, ctxDe(hilo).sessionId, "guarda_respaldo", `datos sin respaldo: ${revisado.sinRespaldo.join(", ")}`);
    return revisado.texto;
  }

  async function recepcionista(crudo: z.input<typeof EstadoRecepcion>, config: LangGraphRunnableConfig): Promise<Actualizacion> {
    const estado = leerEstado(crudo);
    const hilo = hiloDe(config);
    const turno = await turnoEnCurso(estado);
    if (turno.iteraciones >= deps.maxIteraciones) return responder(turno, mensajeDeTope(deps.maxIteraciones, llamadasDelTurno(estado.messages), ""), hilo);
    const sistema = conCanario(await cargarSistema(), canario);
    const respuesta = await deps.proveedor.enviar([{ rol: "sistema", texto: sistema }, ...aMensajesLlm(estado.messages)], definiciones);
    if (!respuesta.ok) return responder(turno, errorDeProveedor(deps.proveedor, respuesta.error), hilo);
    const { texto, llamadas } = respuesta.data;
    if (llamadas.length === 0) return responder(turno, await conRespaldo(estado.messages, sistema, texto.trim() || "(el modelo no devolvió texto)", hilo), hilo);
    const pide = new AIMessage({
      content: texto,
      tool_calls: llamadas.map((llamada) => ({ id: llamada.id, name: llamada.nombre, args: llamada.args, type: "tool_call" as const })),
      additional_kwargs: { [CLAVE_FIRMAS]: firmasDeLlamadas(llamadas) },
    });
    return { ...turno, iteraciones: turno.iteraciones + 1, messages: [pide] };
  }

  async function herramientas(crudo: z.input<typeof EstadoRecepcion>, config: LangGraphRunnableConfig): Promise<Actualizacion> {
    const estado = leerEstado(crudo);
    const pide = ultimoMensaje(estado.messages);
    if (!pide || !isAIMessage(pide)) return {};
    const ctx: ContextoMotor = { ...ctxDe(hiloDe(config)), ejecutarPasada: pasadaComoSubgrafo(config) };
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

  const trasGuarda = (estado: z.input<typeof EstadoRecepcion>): "recepcionista" | typeof END => (esBloqueo(ultimoMensaje(estado.messages)) ? END : "recepcionista");

  return new StateGraph({ state: EstadoRecepcion, input: EntradaRecepcion })
    .addNode("guarda_entrada", guardaEntrada)
    .addNode("recepcionista", recepcionista)
    // Declarado para que Studio dibuje el motor dentro de `herramientas`; cada llamada compila el suyo con su contexto.
    .addNode("herramientas", herramientas, { subgraphs: [compilarPasada(ctxDe("motor"))] })
    .addEdge(START, "guarda_entrada")
    .addConditionalEdges("guarda_entrada", trasGuarda, ["recepcionista", END])
    .addConditionalEdges("recepcionista", tieneLlamadas, ["herramientas", END])
    .addEdge("herramientas", "recepcionista");
}

/** Cada iteración del ciclo son dos pasos (recepcionista + herramientas); el tope propio (CA1) debe cortar antes que el de LangGraph. */
export const compilarRecepcion = (deps: DependenciasStudio, checkpointer?: BaseCheckpointSaver) =>
  crearGrafoRecepcion(deps)
    .compile(checkpointer ? { checkpointer } : {})
    .withConfig({ recursionLimit: 2 * deps.maxIteraciones + 5 });

export const graph = compilarRecepcion(dependenciasPorEntorno());
