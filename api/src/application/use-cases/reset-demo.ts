import { mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { listarIdsMensajes } from "../../infrastructure/mailbox.ts";
import { asegurarMaestro } from "../../infrastructure/master-store.ts";
import type { Rutas } from "../../infrastructure/paths.ts";

/**
 * Deja la demo como recién desplegada: vacía el contenido de `out/` (sin borrar `out/` en sí, para que
 * funcione aunque el directorio padre sea de solo lectura como `/app` en Docker o un volumen montado)
 * y vuelve a copiar el maestro del fixture (RN6). Devuelve cuántos mensajes quedan pendientes.
 */
export async function reiniciarDemo(rutas: Rutas): Promise<number> {
  await mkdir(rutas.out, { recursive: true });
  const entradas = await readdir(rutas.out);
  await Promise.all(entradas.map((entrada) => rm(join(rutas.out, entrada), { recursive: true, force: true })));
  await asegurarMaestro(rutas);
  return (await listarIdsMensajes(rutas)).length;
}
