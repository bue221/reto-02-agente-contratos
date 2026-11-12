import { copyFile, mkdir } from "node:fs/promises";
import { COLUMNAS_MAESTRO, type FilaMaestro, FilaMaestroSchema } from "../dominio/maestro.ts";
import { escribirTexto, leerTextoOpcional } from "./archivos.ts";
import { parsearCsv, serializarCsv } from "./csv.ts";
import type { Rutas } from "./rutas.ts";

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

export async function leerMaestro(rutas: Rutas): Promise<FilaMaestro[]> {
  await asegurarMaestro(rutas);
  return parsearMaestro((await leerTextoOpcional(rutas.maestro)) ?? "");
}

/** Inserta o reemplaza por `id_contrato`, conservando el orden de las filas existentes. */
export async function guardarFila(rutas: Rutas, fila: FilaMaestro, idAnterior: string | null): Promise<void> {
  const maestro = await leerMaestro(rutas);
  const clave = idAnterior ?? fila.id_contrato;
  const existe = maestro.some((actual) => actual.id_contrato === clave);
  const actualizado = existe ? maestro.map((actual) => (actual.id_contrato === clave ? fila : actual)) : [...maestro, fila];
  await escribirTexto(rutas.maestro, serializarMaestro(actualizado));
}
