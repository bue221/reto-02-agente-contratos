import type { ErrorApi, RespuestaChat, Salud, SesionPublica } from "../../../src/api/tipos";

/** Cliente de la API del backend. Los tipos vienen del mismo archivo que usa el servidor. */

export type { LlamadaVisible, RespuestaChat, Salud, SesionPublica, TurnoSesion } from "../../../src/api/tipos";

export interface FilaMaestro {
  id_contrato: string;
  cliente: string;
  valor: number;
  moneda: string;
  fecha_inicio: string;
  fecha_fin: string;
  estado_poliza: string;
  fecha_registro: string;
  fuente: string;
}

/** Vacío en local y en la imagen única (mismo origen); en Vercel apunta al backend en AWS. */
const BASE_API = (import.meta.env.VITE_API_URL ?? "").replace(/\/+$/, "");

const esErrorApi = (cuerpo: unknown): cuerpo is ErrorApi =>
  typeof cuerpo === "object" && cuerpo !== null && "ok" in cuerpo && cuerpo.ok === false && "error" in cuerpo;

/** Errores legibles para la usuaria: red caída, error tipado de la API o respuesta inesperada. */
async function pedir<T>(ruta: string, init?: RequestInit): Promise<T> {
  let respuesta: Response;
  try {
    respuesta = await fetch(`${BASE_API}${ruta}`, init);
  } catch {
    throw new Error("No se pudo contactar al backend. ¿Está corriendo?");
  }
  const cuerpo: unknown = await respuesta.json().catch(() => null);
  if (esErrorApi(cuerpo)) throw new Error(cuerpo.error.mensaje);
  if (!respuesta.ok) throw new Error(`El backend respondió HTTP ${respuesta.status}`);
  return cuerpo as T;
}

export const obtenerSalud = (): Promise<Salud> => pedir<Salud>("/api/health");

export const enviarMensaje = (sessionId: string, message: string): Promise<RespuestaChat> =>
  pedir<RespuestaChat>("/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId, message }) });

export async function obtenerSesion(id: string): Promise<SesionPublica | null> {
  try {
    return await pedir<SesionPublica>(`/api/sessions/${encodeURIComponent(id)}`);
  } catch {
    return null;
  }
}

export const obtenerMaestro = (): Promise<{ filas: FilaMaestro[] }> => pedir<{ filas: FilaMaestro[] }>("/api/maestro");
