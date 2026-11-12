/**
 * Factory de proveedores LLM (Dependency Inversion).
 *
 * LLM_PROVIDER=gemini|offline|openai|anthropic
 * Documentos: Gemini con fallback heurístico. Chat: modelo LangChain o planificador local.
 */
import { hasGeminiKey, loadConfig } from "../../config.ts";
import type { ChatLlmPort, DocumentLlmPort, LlmProviderId } from "../../ports/llm.ts";
import { GeminiChatLlm, GeminiDocumentLlm } from "./gemini.ts";
import { HeuristicDocumentLlm } from "./heuristic.ts";
import { AnthropicChatStub, OpenAiChatStub } from "./stubs.ts";

export interface LlmBundle {
  providerId: LlmProviderId;
  documents: DocumentLlmPort;
  /** Fallback siempre disponible. */
  documentsFallback: DocumentLlmPort;
  chat: ChatLlmPort;
}

let bundle: LlmBundle | null = null;

export function resolveProviderId(): LlmProviderId {
  const raw = (process.env.LLM_PROVIDER ?? "").trim().toLowerCase();
  if (raw === "offline" || process.env.GEMINI_FORCE_OFFLINE === "1") return "offline";
  if (raw === "openai") return "openai";
  if (raw === "anthropic") return "anthropic";
  if (raw === "gemini") return "gemini";
  // Auto: Gemini si hay key, si no offline.
  return hasGeminiKey() ? "gemini" : "offline";
}

export function createLlmBundle(force?: LlmProviderId): LlmBundle {
  const providerId = force ?? resolveProviderId();
  const fallback = new HeuristicDocumentLlm();
  const cfg = loadConfig();

  if (providerId === "offline") {
    console.info(`[llm] provider=offline · ref=${cfg.hoy}`);
    return {
      providerId,
      documents: fallback,
      documentsFallback: fallback,
      chat: { id: "offline", createChatModel: () => null },
    };
  }

  if (providerId === "openai") {
    return {
      providerId,
      documents: fallback,
      documentsFallback: fallback,
      chat: new OpenAiChatStub(),
    };
  }

  if (providerId === "anthropic") {
    return {
      providerId,
      documents: fallback,
      documentsFallback: fallback,
      chat: new AnthropicChatStub(),
    };
  }

  // gemini
  const geminiDocs = new GeminiDocumentLlm();
  const geminiChat = new GeminiChatLlm();
  console.info(`[llm] provider=gemini model=${cfg.geminiModel}`);
  return {
    providerId: "gemini",
    documents: geminiDocs,
    documentsFallback: fallback,
    chat: geminiChat,
  };
}

export function getLlm(): LlmBundle {
  if (!bundle) bundle = createLlmBundle();
  return bundle;
}

export function resetLlm(force?: LlmProviderId): LlmBundle {
  bundle = createLlmBundle(force);
  return bundle;
}

/** Clasificar con proveedor primario; si null → fallback heurístico. */
export async function clasificarDocumento(
  correo: Parameters<DocumentLlmPort["clasificar"]>[0],
) {
  const llm = getLlm();
  const primary = await llm.documents.clasificar(correo);
  if (primary) return { clasificacion: primary, motor: llm.documents.id };
  const fb = await llm.documentsFallback.clasificar(correo);
  return { clasificacion: fb!, motor: llm.documentsFallback.id };
}

export async function extraerDocumento(
  texto: string,
  tipo: Parameters<DocumentLlmPort["extraer"]>[1],
) {
  const llm = getLlm();
  const primary = await llm.documents.extraer(texto, tipo);
  if (primary) return { extraccion: primary, motor: llm.documents.id };
  const fb = await llm.documentsFallback.extraer(texto, tipo);
  return { extraccion: fb!, motor: llm.documentsFallback.id };
}
