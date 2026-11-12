import { type AnalisisGuardado, type Analisis, leerAnalisis } from "../almacen/analisis.ts";
import { type Procesados, leerProcesados } from "../almacen/bitacoras.ts";
import { listarIdsMensajes } from "../almacen/buzon.ts";
import { type DecisionHumana, leerDecisiones } from "../almacen/decisiones.ts";
import type { Rutas } from "../almacen/rutas.ts";
import type { EstadoMensaje } from "../api/tipos.ts";
import { requiereConfirmacion } from "./validar.ts";

/**
 * Estado de cada mensaje derivado solo de `out/`: lo leen igual el buzón, la bandeja y el chat,
 * así una decisión tomada en un canal se ve en todos.
 */

export interface EstadoOut {
  procesados: Procesados;
  analisis: Analisis;
  decisiones: DecisionHumana[];
}

export async function leerEstadoOut(rutas: Rutas): Promise<EstadoOut> {
  const [procesados, analisis, decisiones] = await Promise.all([leerProcesados(rutas), leerAnalisis(rutas), leerDecisiones(rutas)]);
  return { procesados, analisis, decisiones };
}

/** Analizado, con campos en revisión y aún sin cerrar: espera una confirmación humana. */
export function esperaConfirmacion(out: EstadoOut, id: string): AnalisisGuardado | null {
  const analisis = out.analisis[id];
  return !out.procesados[id] && analisis && requiereConfirmacion(analisis.validacion) ? analisis : null;
}

export function estadoDe(out: EstadoOut, id: string): EstadoMensaje {
  const procesado = out.procesados[id];
  if (procesado) return procesado.estado;
  return esperaConfirmacion(out, id) ? "requiere_revision" : "pendiente";
}

export const decisionDe = (out: EstadoOut, id: string): DecisionHumana | null => out.decisiones.findLast((decision) => decision.mensaje_id === id) ?? null;

export type CodigoFallo = "mensaje_no_encontrado" | "ya_procesado" | "no_pendiente" | "registro_fallido";

/** Resultado de los casos de uso del buzón y la bandeja: el código decide el estado HTTP. */
export type ResultadoHitl<T> = { ok: true; data: T } | { ok: false; codigo: CodigoFallo; mensaje: string };

export const falloHitl = <T = never>(codigo: CodigoFallo, mensaje: string): ResultadoHitl<T> => ({ ok: false, codigo, mensaje });

/** Solo ids presentes en el buzón: así un id malicioso (`../`) nunca llega al sistema de archivos. */
export async function existeMensaje(rutas: Rutas, id: string): Promise<boolean> {
  return (await listarIdsMensajes(rutas)).includes(id);
}

export function describirProcesado(out: EstadoOut, id: string): string | null {
  const procesado = out.procesados[id];
  if (!procesado) return null;
  return `el mensaje ${id} ya fue procesado (${procesado.estado}${procesado.id_contrato ? ` ${procesado.id_contrato}` : ""})`;
}
