import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const esNoEncontrado = (error: unknown): boolean =>
  error instanceof Error && "code" in error && error.code === "ENOENT";

export async function leerTextoOpcional(ruta: string): Promise<string | null> {
  try {
    return await readFile(ruta, "utf8");
  } catch (error) {
    if (esNoEncontrado(error)) return null;
    throw error;
  }
}

/** Escritura atómica (archivo temporal + rename) para no dejar el maestro a medio escribir. */
export async function escribirTexto(ruta: string, contenido: string): Promise<void> {
  await mkdir(dirname(ruta), { recursive: true });
  const temporal = `${ruta}.tmp`;
  await writeFile(temporal, contenido, "utf8");
  await rename(temporal, ruta);
}

export async function agregarLineaJson(ruta: string, registro: object): Promise<void> {
  await mkdir(dirname(ruta), { recursive: true });
  await appendFile(ruta, `${JSON.stringify(registro)}\n`, "utf8");
}
