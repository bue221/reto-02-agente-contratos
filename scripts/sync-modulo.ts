/**
 * Regenera `modulo/agent.md` y `modulo/skill/registro-contratos/SKILL.md` desde `agent/prompt.md` y el conocimiento.
 * Uso: `bun run sync:modulo` (escribe) o `bun run sync:modulo --check` (falla si están desactualizados).
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { archivosDelModulo } from "../src/agente/modulo.ts";

const raiz = join(import.meta.dir, "..");
const soloVerificar = process.argv.includes("--check");

const desactualizados: string[] = [];
for (const [ruta, contenido] of Object.entries(await archivosDelModulo(raiz))) {
  const destino = join(raiz, ruta);
  const actual = await readFile(destino, "utf8").catch(() => null);
  if (actual === contenido) continue;
  desactualizados.push(ruta);
  if (soloVerificar) continue;
  await mkdir(dirname(destino), { recursive: true });
  await writeFile(destino, contenido);
}

if (soloVerificar && desactualizados.length > 0) {
  console.error(`modulo/ desactualizado: ${desactualizados.join(", ")}. Ejecuta bun run sync:modulo`);
  process.exit(1);
}
console.info(desactualizados.length > 0 ? `actualizado: ${desactualizados.join(", ")}` : "modulo/ ya está sincronizado");
