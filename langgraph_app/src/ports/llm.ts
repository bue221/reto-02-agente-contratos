/**
 * Puerto LLM: clasificar/extraer documentos + chat agentico.
 * Adapters: Gemini, heurístico offline, (futuro OpenAI/Anthropic).
 */
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { Clasificacion, Correo, Extraccion, Tipo } from "../domain/types.ts";

export interface DocumentLlmPort {
  readonly id: string;
  probe(): Promise<boolean>;
  isActive(): boolean;
  clasificar(correo: Correo): Promise<Clasificacion | null>;
  extraer(texto: string, tipo: Tipo): Promise<Extraccion | null>;
}

export interface ChatLlmPort {
  readonly id: string;
  /** null = modo offline (planificador local de tools). */
  createChatModel(): BaseChatModel | null;
}

export type LlmProviderId = "gemini" | "offline" | "openai" | "anthropic";
