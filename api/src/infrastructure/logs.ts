import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import type { Cambios } from "../core/rules/master-row.ts";
import { agregarLineaJson, escribirTexto, leerLineasJson, leerTextoOpcional } from "./files.ts";
import type { Rutas } from "./paths.ts";

const ESTADOS_PROCESADO = ["registrado", "actualizado", "duplicado", "rechazado"] as const;
export type EstadoProcesado = (typeof ESTADOS_PROCESADO)[number];

const ProcesadosSchema = z.record(
  z.string(),
  z.object({ estado: z.enum(ESTADOS_PROCESADO), id_contrato: z.string().nullable(), ts: z.string() }),
);
export type Procesados = z.infer<typeof ProcesadosSchema>;

export async function leerProcesados(rutas: Rutas): Promise<Procesados> {
  const texto = await leerTextoOpcional(rutas.procesados);
  return texto === null ? {} : ProcesadosSchema.parse(JSON.parse(texto));
}

export async function marcarProcesado(rutas: Rutas, mensajeId: string, estado: EstadoProcesado, idContrato: string | null): Promise<void> {
  const procesados = await leerProcesados(rutas);
  procesados[mensajeId] = { estado, id_contrato: idContrato, ts: new Date().toISOString() };
  await escribirTexto(rutas.procesados, `${JSON.stringify(procesados, null, 2)}\n`);
}

export interface EntradaHistorial {
  id_contrato: string;
  accion: "insertado" | "actualizado";
  cambios: Cambios;
  mensaje_id: string;
  ruta_archivo: string;
}

export const registrarHistorial = (rutas: Rutas, entrada: EntradaHistorial): Promise<void> =>
  agregarLineaJson(rutas.historial, { ts: new Date().toISOString(), ...entrada });

export interface EntradaLog {
  herramienta: string;
  mensaje_id: string | null;
  ok: boolean;
  resumen: string;
}

export const registrarLog = (rutas: Rutas, entrada: EntradaLog): Promise<void> =>
  agregarLineaJson(rutas.log, { ts: new Date().toISOString(), ...entrada });

type ConFecha<T> = T & { ts: string };

// Ambos archivos los escribe solo este módulo con las formas de arriba.
export const leerHistorial = async (rutas: Rutas): Promise<ConFecha<EntradaHistorial>[]> =>
  (await leerLineasJson(rutas.historial)) as ConFecha<EntradaHistorial>[];

export const leerLog = async (rutas: Rutas): Promise<ConFecha<EntradaLog>[]> => (await leerLineasJson(rutas.log)) as ConFecha<EntradaLog>[];

/** Copia el documento a `out/sharepoint/<rutaRelativa>`. */
export async function archivarDocumento(rutas: Rutas, origen: string, rutaRelativa: string): Promise<void> {
  const destino = join(rutas.sharepoint, rutaRelativa);
  await mkdir(dirname(destino), { recursive: true });
  await copyFile(origen, destino);
}
