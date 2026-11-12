import type { Validacion } from "../reglas/clasificar.ts";
import { escribirTexto, leerTextoOpcional } from "./archivos.ts";
import type { Rutas } from "./rutas.ts";

export interface AnalisisGuardado {
  ts: string;
  validacion: Validacion;
}

export type Analisis = Record<string, AnalisisGuardado>;

export async function leerAnalisis(rutas: Rutas): Promise<Analisis> {
  const texto = await leerTextoOpcional(rutas.analisis);
  // Archivo escrito solo por `guardarAnalisis`.
  return texto === null ? {} : (JSON.parse(texto) as Analisis);
}

export async function guardarAnalisis(rutas: Rutas, mensajeId: string, validacion: Validacion): Promise<void> {
  const analisis = await leerAnalisis(rutas);
  analisis[mensajeId] = { ts: new Date().toISOString(), validacion };
  await escribirTexto(rutas.analisis, `${JSON.stringify(analisis, null, 2)}\n`);
}
