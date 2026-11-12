import { copyFile, mkdir } from "node:fs/promises";
import { COLUMNAS_MAESTRO, type FilaMaestro, FilaMaestroSchema } from "../core/domain/master.ts";
import { escribirTexto, leerTextoOpcional } from "./files.ts";
import { parsearCsv, serializarCsv } from "./csv.ts";
import type { Rutas } from "./paths.ts";

const aTipos = (celdas: Record<string, string>): Record<string, unknown> => ({
  ...celdas,
  valor: Number(celdas.valor),
  requiere_poliza: celdas.requiere_poliza === "true",
});

function filaDesdeCsv(encabezados: readonly string[], celdas: readonly string[], linea: number): FilaMaestro {
  const registro = Object.fromEntries(encabezados.map((encabezado, i) => [encabezado, celdas[i] ?? ""]));
  const validada = FilaMaestroSchema.safeParse(aTipos(registro));
  if (!validada.success) {
    const detalle = validada.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
    throw new Error(`maestro inválido en la línea ${linea}: ${detalle}`);
  }
  return validada.data;
}

export function parsearMaestro(texto: string): FilaMaestro[] {
  const [encabezados, ...filas] = parsearCsv(texto);
  if (!encabezados) return [];
  const faltantes = COLUMNAS_MAESTRO.filter((columna) => !encabezados.includes(columna));
  if (faltantes.length > 0) throw new Error(`al maestro le faltan columnas: ${faltantes.join(", ")}`);
  return filas.map((celdas, i) => filaDesdeCsv(encabezados, celdas, i + 2));
}

export const serializarMaestro = (filas: readonly FilaMaestro[]): string =>
  serializarCsv([COLUMNAS_MAESTRO, ...filas.map((fila) => COLUMNAS_MAESTRO.map((columna) => String(fila[columna])))]);

/** RN6: el fixture es de solo lectura; la primera ejecución lo copia a `out/sharepoint/`. */
export async function asegurarMaestro(rutas: Rutas): Promise<void> {
  if ((await leerTextoOpcional(rutas.maestro)) !== null) return;
  await mkdir(rutas.sharepoint, { recursive: true });
  await copyFile(rutas.maestroFixture, rutas.maestro);
}

/** El CSV tal cual está en `out/sharepoint/` (para descargarlo). */
export async function leerMaestroCsv(rutas: Rutas): Promise<string> {
  await asegurarMaestro(rutas);
  return (await leerTextoOpcional(rutas.maestro)) ?? "";
}

export const leerMaestro = async (rutas: Rutas): Promise<FilaMaestro[]> => parsearMaestro(await leerMaestroCsv(rutas));

/** Inserta o reemplaza por `id_contrato`, conservando el orden de las filas existentes. */
export async function guardarFila(rutas: Rutas, fila: FilaMaestro, idAnterior: string | null): Promise<void> {
  const maestro = await leerMaestro(rutas);
  const clave = idAnterior ?? fila.id_contrato;
  const existe = maestro.some((actual) => actual.id_contrato === clave);
  const actualizado = existe ? maestro.map((actual) => (actual.id_contrato === clave ? fila : actual)) : [...maestro, fila];
  await escribirTexto(rutas.maestro, serializarMaestro(actualizado));
}
