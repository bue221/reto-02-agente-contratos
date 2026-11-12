import type { Clasificacion, Campo, Correo, Extraccion, Tipo } from "../types.ts";
import { heuristicLLM } from "./heuristic.ts";
import { anthropicLLM } from "./anthropic.ts";

/** El LLM solo hace lo que requiere entender texto desordenado: clasificar y extraer. */
export interface LLM {
  nombre: string;
  clasificar(correo: Correo): Promise<Clasificacion>;
  extraer(texto: string, tipo: Tipo): Promise<Extraccion>;
}

export function crearLLM(): LLM {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return heuristicLLM;
  const modelo = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5-5";
  return conFallback(anthropicLLM(key, modelo), heuristicLLM);
}

/** Si la API falla (red, cuota, JSON roto), cae al extractor heurístico en vez de romper el pipeline. */
function conFallback(primario: LLM, respaldo: LLM): LLM {
  return {
    nombre: `${primario.nombre} (fallback: ${respaldo.nombre})`,
    async clasificar(c) {
      try { return await primario.clasificar(c); }
      catch (e) { console.warn(`[llm] clasificar falló (${(e as Error).message}); uso heurístico`); return respaldo.clasificar(c); }
    },
    async extraer(t, tipo) {
      try { return await primario.extraer(t, tipo); }
      catch (e) { console.warn(`[llm] extraer falló (${(e as Error).message}); uso heurístico`); return respaldo.extraer(t, tipo); }
    },
  };
}

// ---------- Validación estricta de lo que devuelve un modelo (equivalente a un schema Zod) ----------
const TIPOS: Tipo[] = ["contrato", "otrosi", "actualizacion", "cotizacion", "otro"];

export function normalizarClasificacion(raw: any): Clasificacion {
  const tipo = TIPOS.includes(raw?.tipo) ? (raw.tipo as Tipo) : "otro";
  return { tipo, confianza: clamp(raw?.confianza), razon: String(raw?.razon ?? "") };
}

function clamp(n: unknown): number {
  const x = Number(n);
  return Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0;
}

function campo<T>(raw: any, conv: (v: unknown) => T | null): Campo<T> {
  const valor = raw && raw.valor !== undefined && raw.valor !== null ? conv(raw.valor) : null;
  return { valor, confianza: valor === null ? 0 : clamp(raw?.confianza), evidencia: raw?.evidencia ? String(raw.evidencia) : undefined };
}

const aTexto = (v: unknown) => (String(v).trim() ? String(v).trim() : null);
const aNumero = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : null);
const aFecha = (v: unknown) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? String(v) : null);

export function normalizarExtraccion(raw: any): Extraccion {
  return {
    idContrato: campo(raw?.idContrato, aTexto),
    cliente: campo(raw?.cliente, aTexto),
    nit: campo(raw?.nit, aTexto),
    valor: campo(raw?.valor, aNumero),
    fechaInicio: campo(raw?.fechaInicio, aFecha),
    fechaFin: campo(raw?.fechaFin, aFecha),
  };
}
