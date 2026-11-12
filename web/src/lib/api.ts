import type {
  CorreccionesVisibles,
  DetalleMensaje,
  ErrorApi,
  EventoChat,
  EventoTurno,
  RespuestaBandeja,
  RespuestaBuzon,
  RespuestaChat,
  RespuestaDecision,
  RespuestaMaestro,
  RespuestaProcesar,
  RespuestaReinicio,
  Salud,
  SesionPublica,
} from "../../../api/src/http/types";
import { datosSse } from "./sse";

/** Cliente único de la API. Los tipos vienen del mismo archivo que usa el servidor: backend y front no divergen. */

export type * from "../../../api/src/http/types";

/** Vacío en local y en la imagen única (mismo origen); en Vercel apunta al backend en AWS. */
const BASE_API = (import.meta.env.VITE_API_URL ?? "").replace(/\/+$/, "");

export const URL_MAESTRO_CSV = `${BASE_API}/api/maestro.csv`;

/** Studio vive en smith.langchain.com y llama desde el navegador al servidor de LangGraph que el backend publica en `/langgraph`. */
export const URL_STUDIO = `https://smith.langchain.com/studio/?baseUrl=${encodeURIComponent(`${BASE_API || window.location.origin}/langgraph`)}`;

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

/**
 * El mismo turno que `enviarMensaje`, con sus eventos en vivo. Front y backend se despliegan por separado:
 * si el backend aún no tiene la ruta (404), el turno no se ejecutó y se reenvía por `/api/chat`.
 */
export async function enviarMensajeEnVivo(sessionId: string, message: string, alEvento: (evento: EventoTurno) => void): Promise<RespuestaChat> {
  let respuesta: Response;
  try {
    respuesta = await fetch(`${BASE_API}/api/chat/stream`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId, message }) });
  } catch {
    throw new ErrorDeApi("No se pudo contactar al backend. ¿Está corriendo?", "sin_conexion");
  }
  if (respuesta.status === 404) return enviarMensaje(sessionId, message);
  if (!respuesta.ok || !respuesta.body) {
    const json: unknown = await respuesta.json().catch(() => null);
    if (esErrorApi(json)) throw new ErrorDeApi(json.error.mensaje, json.error.codigo);
    throw new ErrorDeApi(`El backend respondió HTTP ${respuesta.status}`, "http");
  }
  for await (const datos of datosSse(respuesta.body)) {
    // El backend serializa `EventoChat` (tipo compartido en api/src/http/types.ts).
    const evento = JSON.parse(datos) as EventoChat;
    if (evento.tipo === "fin") return evento.respuesta;
    alEvento(evento);
  }
  throw new ErrorDeApi("La conexión se cortó antes de terminar el turno. El agente pudo haberlo completado: abre de nuevo la sesión para ver el resultado.", "turno_cortado");
}

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
