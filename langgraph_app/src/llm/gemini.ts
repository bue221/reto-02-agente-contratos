/**
 * Compat: adapter Gemini en adapters/llm/gemini.ts
 * Preferir getLlm() / clasificarDocumento / extraerDocumento.
 */
import { getLlm, resetLlm } from "../adapters/llm/index.ts";
import type { Clasificacion, Correo, Extraccion, Tipo } from "../domain/types.ts";

export async function probeGemini(): Promise<boolean> {
  const llm = getLlm();
  if (llm.documents.id !== "gemini") return false;
  return llm.documents.probe();
}

export function geminiActivo(): boolean {
  const llm = getLlm();
  return llm.documents.id === "gemini" && llm.documents.isActive();
}

export async function clasificarConGemini(correo: Correo): Promise<Clasificacion | null> {
  const llm = getLlm();
  if (llm.documents.id !== "gemini") return null;
  return llm.documents.clasificar(correo);
}

export async function extraerConGemini(texto: string, tipo: Tipo): Promise<Extraccion | null> {
  const llm = getLlm();
  if (llm.documents.id !== "gemini") return null;
  return llm.documents.extraer(texto, tipo);
}

export function resetGeminiAdapter(): void {
  resetLlm();
}
