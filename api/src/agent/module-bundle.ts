import { join } from "node:path";
import { leerPiezas } from "./prompt.ts";

/**
 * Bonus PRD 9.4: `modulo/` se genera desde las mismas piezas que usa la app (no son copias a mano).
 * `api/scripts/sync-module.ts` lo escribe y un test verifica que no diverja.
 */

export const RUTA_AGENTE_MODULO = join("modulo", "agent.md");
export const RUTA_SKILL_MODULO = join("modulo", "skill", "registro-contratos", "SKILL.md");

const AVISO = "# Generado por api/scripts/sync-module.ts: no editar a mano.";

export const agenteMd = (prompt: string, origen: string): string =>
  [
    "---",
    `${AVISO} Fuente: ${origen}`,
    "description: Recepcionista del buzón único de contratos; consulta estado y maestro, enciende el motor determinista que extrae, valida, registra y alerta, y pide confirmación de lo dudoso.",
    "mode: primary",
    "permission:",
    "  edit: deny",
    "  bash: deny",
    "---",
    "",
    prompt,
    "",
  ].join("\n");

export const skillMd = (conocimiento: string, origen: string): string =>
  [
    "---",
    `${AVISO} Fuente: ${origen}`,
    "name: registro-contratos",
    "description: Conocimiento del proceso de registro de contratos vigentes (reglas RN1–RN7, esquema del maestro, umbral de confianza, alertas y regla de gobierno). Úsalo al procesar el buzón de contratos.",
    "---",
    "",
    conocimiento,
    "",
  ].join("\n");

/** Contenido esperado de cada archivo generado de `modulo/`, por ruta relativa a la raíz. */
export async function archivosDelModulo(directorio: string): Promise<Record<string, string>> {
  const { prompt, conocimiento } = await leerPiezas(directorio);
  return {
    [RUTA_AGENTE_MODULO]: agenteMd(prompt, "agent/prompt.md"),
    [RUTA_SKILL_MODULO]: skillMd(conocimiento, "api/src/knowledge/registro-contratos.md"),
  };
}
