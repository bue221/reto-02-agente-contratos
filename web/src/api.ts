import type {
  CorreccionesVisibles,
  DetalleMensaje,
  ErrorApi,
  RespuestaBandeja,
  RespuestaBuzon,
  RespuestaChat,
  RespuestaDecision,
  RespuestaMaestro,
  RespuestaProcesar,
  RespuestaReinicio,
  Salud,
  SesionPublica,
} from "../../src/api/tipos";

/** Cliente único de la API. Los tipos vienen del mismo archivo que usa el servidor: backend y front no divergen. */

export type * from "../../src/api/tipos";

/** Vacío en local y en la imagen única (mismo origen); en Vercel apunta al backend en AWS. */
const BASE_API = (import.meta.env.VITE_API_URL ?? "").replace(/\/+$/, "");

export const URL_MAESTRO_CSV = `${BASE_API}/api/maestro.csv`;

/** Error legible para la UI con el código tipado del backend (p. ej. `no_pendiente`). */
export class ErrorDeApi extends Error {
  constructor(
    mensaje: string,
    readonly codigo: string,
  ) {
    super(mensaje);
  }
}

const esErrorApi = (cuerpo: unknown): cuerpo is ErrorApi =>
  typeof cuerpo === "object" && cuerpo !== null && "ok" in cuerpo && cuerpo.ok === false && "error" in cuerpo;

/** Red caída, error tipado de la API o respuesta inesperada: siempre un mensaje en español para la usuaria. */
async function pedir<T>(ruta: string, cuerpo?: unknown): Promise<T> {
  const init: RequestInit = cuerpo === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(cuerpo) };
  let respuesta: Response;
  try {
    respuesta = await fetch(`${BASE_API}${ruta}`, init);
  } catch {
    throw new ErrorDeApi("No se pudo contactar al backend. ¿Está corriendo?", "sin_conexion");
  }
  const json: unknown = await respuesta.json().catch(() => null);
  if (esErrorApi(json)) throw new ErrorDeApi(json.error.mensaje, json.error.codigo);
  if (!respuesta.ok) throw new ErrorDeApi(`El backend respondió HTTP ${respuesta.status}`, "http");
  return json as T;
}

const id = (valor: string): string => encodeURIComponent(valor);

export const obtenerSalud = (): Promise<Salud> => pedir<Salud>("/api/health");

export const enviarMensaje = (sessionId: string, message: string): Promise<RespuestaChat> => pedir<RespuestaChat>("/api/chat", { sessionId, message });

/** Una sesión que aún no existe (o se borró al reiniciar la demo) es simplemente un chat vacío. */
export async function obtenerSesion(sessionId: string): Promise<SesionPublica | null> {
  try {
    return await pedir<SesionPublica>(`/api/sessions/${id(sessionId)}`);
  } catch (error) {
    if (error instanceof ErrorDeApi && error.codigo === "sesion_no_encontrada") return null;
    throw error;
  }
}

export const api = {
  maestro: () => pedir<RespuestaMaestro>("/api/maestro"),
  buzon: () => pedir<RespuestaBuzon>("/api/buzon"),
  detalle: (mensajeId: string) => pedir<DetalleMensaje>(`/api/buzon/${id(mensajeId)}`),
  procesar: (mensajeId: string) => pedir<RespuestaProcesar>(`/api/buzon/${id(mensajeId)}/procesar`, {}),
  bandeja: () => pedir<RespuestaBandeja>("/api/bandeja"),
  aprobar: (mensajeId: string, aprobador: string, correcciones: CorreccionesVisibles) =>
    pedir<RespuestaDecision>(`/api/bandeja/${id(mensajeId)}/aprobar`, { aprobador, correcciones }),
  rechazar: (mensajeId: string, aprobador: string, motivo: string) => pedir<RespuestaDecision>(`/api/bandeja/${id(mensajeId)}/rechazar`, { aprobador, motivo }),
  reiniciarDemo: () => pedir<RespuestaReinicio>("/api/demo/reset", {}),
};
