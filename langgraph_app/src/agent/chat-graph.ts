/**
 * Modo A — Agente conversacional (ReAct: recepcionista ↔ herramientas).
 *
 * Studio Chat tab: requiere MessagesZodState (marca langgraph_type: "messages").
 * Sin eso la pestaña Chat queda gris.
 *
 * Memoria: array `messages` + checkpointer del thread (Studio o MemorySaver).
 * En Chat Mode escribes solo el turno nuevo; el historial se acumula solo.
 */
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import {
  END,
  MemorySaver,
  MessagesZodState,
  START,
  StateGraph,
} from "@langchain/langgraph";
import { ToolNode, toolsCondition } from "@langchain/langgraph/prebuilt";
import { getLlm } from "../adapters/llm/index.ts";
import { getPropuestas } from "../deps.ts";
import type { ChatState } from "../state.ts";
import { TOOLS } from "../tools/index.ts";
import { AGENT_HELP, AGENT_SYSTEM_PROMPT } from "./prompt.ts";

/** Checkpointer solo para API/CLI en proceso. Studio no lo usa. */
export const agentCheckpointer = new MemorySaver();

function ultimoHumano(messages: BaseMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (HumanMessage.isInstance(m) || m.getType?.() === "human") {
      return typeof m.content === "string" ? m.content : String(m.content);
    }
  }
  return "";
}

/**
 * Planificador local: emite tool_calls (mismo bucle agentico que Gemini).
 * Solo elige entre el catálogo TOOLS; nunca inventa "registrar_raw".
 */
function planificarTools(texto: string): AIMessage {
  const s = texto.toLowerCase();
  const msg = s.match(/msg-?(\d{1,3})/);
  const contrato = texto.match(/\bC-?(\d{1,3})\b/i);

  let name: string;
  let args: Record<string, unknown> = {};
  const msgArg = msg ? { id: `msg-${msg[1]!.padStart(3, "0")}` } : {};

  const preguntaPorBandeja = /por\s+aprobar|pendientes?\s+de\s+aprob/.test(s);
  // Pedidos de aprobar/rechazar: el agente no tiene esa tool a propósito.
  if (
    !preguntaPorBandeja &&
    /\b(aprueba|apru[eé]bal[oa]|aprobar|apruebo|rechaza|rech[aá]zal[oa]|rechazar)\b/.test(s)
  ) {
    return new AIMessage(
      "No puedo aprobar ni rechazar: esa decisión es tuya. " +
        "Usa los botones Aprobar / Rechazar de la tarjeta en la bandeja de aprobación.",
    );
  }

  if (/reinici|reset|restablec/.test(s)) name = "reiniciar_demo";
  else if (/propuesta|recomendaci|bandeja|por\s+aprobar|aprobaci[oó]n/.test(s)) {
    name = msg ? "ver_propuesta" : "listar_propuestas";
    args = msgArg;
  } else if (
    /auditor[ií]a|confianza|extracci[oó]n|qu[eé]\s+pas[oó]|[uú]ltim[oa].*(proces|msg|auditor)/.test(
      s,
    )
  ) {
    name = "ultima_auditoria";
    if (msg) args = { id: `msg-${msg[1]!.padStart(3, "0")}` };
  } else if (
    /pendient|faltan|sin\s+proces|cu[aá]ntos?\s+(falt|qued|hay)|estado\s*(del\s*)?buz/.test(s)
  ) {
    name = /list|cu[aá]les|qu[eé]\s+falt/.test(s) ? "listar_pendientes" : "estado_buzon";
  } else if (msg && /proces/.test(s)) {
    name = "procesar_mensaje";
    args = { id: `msg-${msg[1]!.padStart(3, "0")}` };
  } else if (msg && !/auditor|confianza/.test(s)) {
    name = "procesar_mensaje";
    args = { id: `msg-${msg[1]!.padStart(3, "0")}` };
  } else if (/proces\w*.*(buz|todo)|buz[oó]n.*proces/.test(s)) name = "procesar_buzon";
  else if (/venc|alerta|reporte/.test(s)) name = "reporte_vencimientos";
  else if (
    /qu[eé]\s+contratos|contratos\s+tengo|list(a|ar)?\s+(los\s+)?contratos|maestro|todos\s+los\s+contratos|mostr(ar|ame).*contratos/.test(
      s,
    )
  ) {
    name = "listar_contratos";
  } else if (contrato) {
    name = "consultar_contrato";
    args = { id: `C-${contrato[1]!.padStart(3, "0")}` };
  } else if (/list.*mensaj|mensajes|buz[oó]n/.test(s)) name = "listar_mensajes";
  else return new AIMessage(AGENT_HELP);

  return new AIMessage({
    content: "",
    tool_calls: [
      {
        name,
        args,
        id: `call_${name}_${Date.now()}`,
        type: "tool_call",
      },
    ],
  });
}

function resumenTrasTools(state: ChatState): AIMessage {
  const toolsOut: string[] = [];
  for (let i = state.messages.length - 1; i >= 0; i--) {
    const m = state.messages[i]!;
    if (ToolMessage.isInstance(m) || m.getType?.() === "tool") {
      toolsOut.unshift(typeof m.content === "string" ? m.content : String(m.content));
      continue;
    }
    break;
  }
  if (!toolsOut.length) {
    return new AIMessage("Listo. ¿Procesamos otro mensaje o generamos el reporte?");
  }
  return new AIMessage(
    `${toolsOut.join("\n\n")}\n\n(Yo solo recomiendo: tú apruebas o rechazas en la bandeja.)`,
  );
}

function yaHuboToolResult(state: ChatState): boolean {
  for (let i = state.messages.length - 1; i >= 0; i--) {
    const m = state.messages[i]!;
    if (ToolMessage.isInstance(m) || m.getType?.() === "tool") return true;
    if (HumanMessage.isInstance(m) || m.getType?.() === "human") break;
  }
  return false;
}

export function buildAgentGraph(options?: { checkpointer?: MemorySaver | boolean }) {
  const bundle = getLlm();
  const base = bundle.chat.createChatModel();
  // bindTools existe en chat models con function-calling (Gemini/OpenAI/…).
  type ToolBound = { invoke: (msgs: BaseMessage[]) => Promise<BaseMessage> };
  let llm: ToolBound | null = null;
  let llmRoto = false;

  const maybeBind = base as { bindTools?: (tools: unknown[]) => ToolBound } | null;
  if (maybeBind?.bindTools) {
    llm = maybeBind.bindTools([...TOOLS]);
    void bundle.documents.probe().then((ok) => {
      if (!ok && bundle.providerId === "gemini") llmRoto = true;
    });
  }

  const recepcionista = async (state: ChatState) => {
    if (yaHuboToolResult(state)) {
      return { messages: [resumenTrasTools(state)] };
    }

    const texto = ultimoHumano(state.messages);
    if (!texto.trim()) {
      return {
        messages: [
          new AIMessage(
            'Escribe en la pestaña Chat. Ej: "cuántos faltan", "procesa msg-001".',
          ),
        ],
      };
    }

    if (llm && !llmRoto) {
      try {
        const response = await llm.invoke([
          new SystemMessage(AGENT_SYSTEM_PROMPT),
          ...state.messages,
        ]);
        return { messages: [response] };
      } catch (err) {
        const msg = (err as Error).message ?? "";
        llmRoto = true;
        if (/RESOURCE_EXHAUSTED|depleted|blocked|PERMISSION_DENIED|403|402/i.test(msg)) {
          console.warn(
            `[agente] ${bundle.chat.id} no disponible → planificador local (mismas tools)`,
          );
        } else {
          console.warn(`[agente] ${bundle.chat.id} error: ${msg.slice(0, 160)}`);
        }
      }
    }

    return { messages: [planificarTools(texto)] };
  };

  // MessagesZodState = marca langgraph_type:"messages" → Studio habilita Chat.
  const builder = new StateGraph(MessagesZodState)
    .addNode("recepcionista", recepcionista)
    .addNode("herramientas", new ToolNode([...TOOLS]))
    .addEdge(START, "recepcionista")
    .addConditionalEdges("recepcionista", toolsCondition, {
      tools: "herramientas",
      [END]: END,
    })
    .addEdge("herramientas", "recepcionista");

  if (options?.checkpointer === true || options?.checkpointer instanceof MemorySaver) {
    const cp =
      options.checkpointer instanceof MemorySaver ? options.checkpointer : agentCheckpointer;
    return builder.compile({ checkpointer: cp });
  }

  return builder.compile();
}

/** Export Studio (langgraph.json → "chat"). */
export const graph = buildAgentGraph();

/** API/CLI: misma lógica + memoria por thread_id. */
export const graphWithMemory = buildAgentGraph({ checkpointer: true });

const TOOLS_DE_UNA_PROPUESTA = new Set(["procesar_mensaje", "ver_propuesta"]);
const TOOLS_DE_BANDEJA = new Set(["procesar_buzon", "listar_propuestas"]);

/**
 * Ids de propuestas que tocó el turno actual (tool_calls tras el último humano),
 * para que el frontend pinte las tarjetas de aprobación junto a la respuesta.
 */
function propuestasDelTurno(messages: BaseMessage[]): string[] {
  const ids = new Set<string>();
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (HumanMessage.isInstance(m) || m.getType?.() === "human") break;
    if (!AIMessage.isInstance(m)) continue;
    for (const call of m.tool_calls ?? []) {
      if (TOOLS_DE_UNA_PROPUESTA.has(call.name) && typeof call.args?.id === "string") {
        ids.add(call.args.id.trim().toLowerCase());
      } else if (TOOLS_DE_BANDEJA.has(call.name)) {
        for (const p of getPropuestas().list("PENDIENTE")) ids.add(p.msgId);
      }
    }
  }
  return [...ids].filter((id) => getPropuestas().get(id));
}

/** Helper API/CLI: un turno con memoria por threadId. */
export async function chatTurn(threadId: string, message: string) {
  const tid = String(threadId || "").trim() || "default";
  const result = await graphWithMemory.invoke(
    { messages: [new HumanMessage(message)] },
    { configurable: { thread_id: tid } },
  );
  const messages = result.messages as BaseMessage[];
  const last = messages[messages.length - 1];
  const content =
    last && typeof last.content === "string"
      ? last.content
      : last
        ? String(last.content)
        : "";
  return { threadId: tid, reply: content, propuestaIds: propuestasDelTurno(messages), messages };
}
