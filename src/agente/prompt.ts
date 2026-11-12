import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Comportamiento (`agent/prompt.md`) y conocimiento (`src/knowledge/registro-contratos.md`) viven en Markdown.
 * Se leen en cada turno: cambiar una regla del proceso no requiere tocar ni reiniciar el servidor.
 */

export const RUTA_PROMPT = join("agent", "prompt.md");
export const RUTA_CONOCIMIENTO = join("src", "knowledge", "registro-contratos.md");

export interface PiezasDelAgente {
  prompt: string;
  conocimiento: string;
}

export async function leerPiezas(directorio: string): Promise<PiezasDelAgente> {
  const [prompt, conocimiento] = await Promise.all([
    readFile(join(directorio, RUTA_PROMPT), "utf8"),
    readFile(join(directorio, RUTA_CONOCIMIENTO), "utf8"),
  ]);
  return { prompt: prompt.trim(), conocimiento: conocimiento.trim() };
}

export async function leerPromptSistema(directorio: string): Promise<string> {
  const { prompt, conocimiento } = await leerPiezas(directorio);
  return `${prompt}\n\n---\n\n${conocimiento}\n`;
}
