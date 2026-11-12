import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fechaDeHoy } from "../core/domain/dates.ts";

/**
 * Comportamiento (`agent/prompt.md`) y conocimiento (`api/src/knowledge/registro-contratos.md`) viven en Markdown.
 * Se leen en cada turno: cambiar una regla del proceso no requiere tocar ni reiniciar el servidor.
 */

export const RUTA_PROMPT = join("agent", "prompt.md");
export const RUTA_CONOCIMIENTO = join("api", "src", "knowledge", "registro-contratos.md");

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

/** La fecha va fuera de `agent/prompt.md` porque cambia cada día y `modulo/` se genera desde ese archivo. */
export async function leerPromptSistema(directorio: string, hoy: string = fechaDeHoy()): Promise<string> {
  const { prompt, conocimiento } = await leerPiezas(directorio);
  return `${prompt}\n\nFecha de hoy: ${hoy}.\n\n---\n\n${conocimiento}\n`;
}
