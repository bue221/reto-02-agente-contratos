import { rm } from "node:fs/promises";
import { listarIdsMensajes } from "../almacen/buzon.ts";
import { asegurarMaestro } from "../almacen/maestro.ts";
import type { Rutas } from "../almacen/rutas.ts";

/**
 * Deja la demo como recién desplegada: borra todo `out/` (procesados, análisis, decisiones, sesiones,
 * maestro de trabajo, log) y vuelve a copiar el maestro del fixture (RN6). Devuelve cuántos mensajes quedan pendientes.
 */
export async function reiniciarDemo(rutas: Rutas): Promise<number> {
  await rm(rutas.out, { recursive: true, force: true });
  await asegurarMaestro(rutas);
  return (await listarIdsMensajes(rutas)).length;
}
