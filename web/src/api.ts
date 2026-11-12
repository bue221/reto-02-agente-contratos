const API = import.meta.env.VITE_API_URL ?? "";

export type Decision =
  | "REGISTRAR_NUEVO"
  | "ACTUALIZAR"
  | "DUPLICADO"
  | "RECHAZAR"
  | "REVISION_HUMANA";

export type CampoEditable = "idContrato" | "cliente" | "nit" | "valor" | "fechaInicio" | "fechaFin";

export type Campo = { valor: string | number | null; confianza: number; evidencia?: string };

export type Validacion = {
  regla: string;
  ok: boolean;
  severidad: "bloqueante" | "revision" | "info";
  detalle: string;
};

export type Propuesta = {
  msgId: string;
  creadaEn: string;
  estado: "PENDIENTE" | "APROBADA" | "RECHAZADA";
  recomendacion: Decision;
  motivos: string[];
  motor: string;
  clasificacion: { tipo: string; confianza: number; razon: string };
  documento: string | null;
  validaciones: Validacion[];
  extraccion: Record<CampoEditable, Campo> | null;
  existenteId: string | null;
  duplicadoDe: string | null;
  correo: { de: string; fecha: string; asunto: string };
  resolucion: {
    accion: "aprobar" | "rechazar";
    decisionFinal: Decision;
    aprobador: string;
    comentario: string | null;
    correcciones: Partial<Record<CampoEditable, string>>;
    contratoId: string | null;
    cambios: Record<string, { antes: unknown; despues: unknown }>;
    resueltaEn: string;
  } | null;
};

export type EstadoCorreo = "SIN_ANALIZAR" | "PENDIENTE" | "APROBADA" | "RECHAZADA";

export type CorreoResumen = {
  id: string;
  de: string;
  fecha: string;
  asunto: string;
  adjuntos: string[];
  estado: EstadoCorreo;
  recomendacion: Decision | null;
  decisionFinal: Decision | null;
  contratoId: string | null;
};

export type BuzonState = {
  total: number;
  procesados: number;
  pendientes: number;
  porAprobar: number;
  ids: string[];
  idsPendientes: string[];
  idsProcesados: string[];
  correos: CorreoResumen[];
  resumen: string;
};

export type EstadoPaso = "hecho" | "actual" | "pendiente" | "omitido" | "alerta";

export type PasoTimeline = {
  id: string;
  titulo: string;
  estado: EstadoPaso;
  detalle: string | null;
  ts: string | null;
};

export type Correo = {
  id: string;
  de: string;
  fecha: string;
  asunto: string;
  cuerpo: string;
  adjuntos: { nombre: string; texto: string }[];
};

export type CorreoDetalle = {
  correo: Correo;
  estado: EstadoCorreo;
  propuesta: Propuesta | null;
  extraccionOriginal: Record<CampoEditable, Campo> | null;
  timeline: PasoTimeline[];
  eventos: { ts: string; fase: string | null; decision: string | null; aprobador: string | null; log: string[] }[];
};

export type Contrato = {
  id_contrato: string;
  cliente: string;
  nit: string;
  valor: number;
  moneda: string;
  fecha_inicio: string;
  fecha_fin: string;
  comercial_email: string;
  estado: string;
  archivo: string;
  actualizado_en: string;
};

/** Error de API con el código y los motivos que manda el backend (p.ej. bloqueo por reglas). */
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly motivos: string[] = [],
  ) {
    super(message);
  }
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
  } catch {
    throw new ApiError("No hay conexión con el backend (¿está corriendo bun run api?)", "NETWORK");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(
      body?.error ?? `HTTP ${res.status}`,
      body?.code ?? "HTTP",
      body?.details?.motivos ?? [],
    );
  }
  return body as T;
}

export function getOrCreateThreadId(): string {
  const key = "contratos.threadId";
  let id = localStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(key, id);
  }
  return id;
}

export function resetThreadId(): string {
  const id = crypto.randomUUID();
  localStorage.setItem("contratos.threadId", id);
  return id;
}

export const CSV_URL = `${API}/v1/contratos.csv`;

export const api = {
  health: () => json<{ ok: boolean; llm?: { provider: string } }>("/health"),
  buzon: () => json<BuzonState>("/v1/buzon"),
  correo: (id: string) => json<CorreoDetalle>(`/v1/buzon/${id}`),
  contratos: () => json<{ contratos: Contrato[] }>("/v1/contratos"),
  propuestas: () => json<{ propuestas: Propuesta[] }>("/v1/propuestas?estado=todas"),
  chatSync: (threadId: string, message: string) =>
    json<{ threadId: string; reply: string; propuestaIds?: string[] }>("/v1/chat/sync", {
      method: "POST",
      body: JSON.stringify({ threadId, message }),
    }),
  analizar: (id: string) =>
    json<{ resultado: string; propuesta: Propuesta | null }>(`/v1/buzon/${id}/procesar`, {
      method: "POST",
    }),
  aprobar: (
    id: string,
    body: { correcciones?: Partial<Record<CampoEditable, string>>; comentario?: string; aprobador?: string },
  ) =>
    json<{ propuesta: Propuesta; texto: string }>(`/v1/propuestas/${id}/aprobar`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  rechazar: (id: string, body: { comentario?: string; aprobador?: string }) =>
    json<{ propuesta: Propuesta; texto: string }>(`/v1/propuestas/${id}/rechazar`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  reset: () => json<{ ok: boolean; buzon: BuzonState }>("/v1/demo/reset", { method: "POST" }),
};
