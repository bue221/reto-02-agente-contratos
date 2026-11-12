import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import type { Cambios } from "../reglas/fila.ts";
import { agregarLineaJson, escribirTexto, leerTextoOpcional } from "./archivos.ts";
import type { Rutas } from "./rutas.ts";

export type EstadoProcesado = "registrado" | "actualizado" | "duplicado" | "rechazado";

const ProcesadosSchema = z.record(
  z.string(),
  z.object({ estado: z.string(), id_contrato: z.string().nullable(), ts: z.string() }),
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

/** Copia el documento a `out/sharepoint/<rutaRelativa>`. */
export async function archivarDocumento(rutas: Rutas, origen: string, rutaRelativa: string): Promise<void> {
  const destino = join(rutas.sharepoint, rutaRelativa);
  await mkdir(dirname(destino), { recursive: true });
  await copyFile(origen, destino);
}
