import { mensajeDeError } from "../../core/domain/result.ts";
import { registrarLog } from "../../infrastructure/logs.ts";
import { rutasDelProyecto } from "../../infrastructure/paths.ts";

export type NombreGuarda = "guarda_entrada" | "guarda_salida" | "guarda_respaldo";

/** Cada intervención de una guarda queda en `out/log.jsonl` junto a las herramientas. Sin el texto del mensaje: puede traer datos personales. */
export async function auditarBloqueo(directorio: string, sessionId: string, guarda: NombreGuarda, detalle: string): Promise<void> {
  console.warn(`[guarda] sesión ${sessionId}: ${guarda} intervino (${detalle})`);
  try {
    await registrarLog(rutasDelProyecto(directorio), { herramienta: guarda, mensaje_id: null, ok: false, resumen: `sesión ${sessionId}: ${detalle}` });
  } catch (error) {
    console.error(`[guarda] no se pudo escribir out/log.jsonl: ${mensajeDeError(error)}`);
  }
}
