export type Tipo = "contrato" | "otrosi" | "actualizacion" | "cotizacion" | "otro";

export type Decision =
  | "REGISTRAR_NUEVO"
  | "ACTUALIZAR"
  | "DUPLICADO"
  | "RECHAZAR"
  | "REVISION_HUMANA";

export interface Adjunto {
  nombre: string;
  texto: string;
}

export interface Correo {
  id: string;
  de: string;
  fecha: string;
  asunto: string;
  cuerpo: string;
  adjuntos: Adjunto[];
}

export interface Campo<T> {
  valor: T | null;
  confianza: number;
  evidencia?: string;
}

export interface Extraccion {
  idContrato: Campo<string>;
  cliente: Campo<string>;
  nit: Campo<string>;
  valor: Campo<number>;
  fechaInicio: Campo<string>;
  fechaFin: Campo<string>;
}

export interface Clasificacion {
  tipo: Tipo;
  confianza: number;
  razon: string;
}

export interface Contrato {
  id_contrato: string;
  cliente: string;
  nit: string;
  valor: number;
  moneda: string;
  fecha_inicio: string;
  fecha_fin: string;
  comercial_email: string;
  estado: "ACTIVO" | "VENCIDO";
  archivo: string;
  actualizado_en: string;
}

export interface Comercial {
  email: string;
  nombre: string;
  region: string;
}

export interface Validacion {
  regla: string;
  ok: boolean;
  severidad: "bloqueante" | "revision" | "info";
  detalle: string;
}

/** Campos de la extracción que un humano puede corregir en la tarjeta. */
export type CampoEditable = keyof Extraccion;

export type EstadoPropuesta = "PENDIENTE" | "APROBADA" | "RECHAZADA";

export type AccionHumana = "aprobar" | "rechazar";

export interface ResolucionHumana {
  accion: AccionHumana;
  decisionFinal: Decision;
  aprobador: string;
  comentario: string | null;
  correcciones: Partial<Record<CampoEditable, string>>;
  contratoId: string | null;
  cambios: Record<string, { antes: unknown; despues: unknown }>;
  archivos: string[];
  resueltaEn: string;
}

/**
 * Recomendación del agente. Nada se escribe en el maestro hasta que
 * un humano la resuelva (ver hitl/).
 */
export interface Propuesta {
  msgId: string;
  creadaEn: string;
  estado: EstadoPropuesta;
  recomendacion: Decision;
  motivos: string[];
  motor: string;
  clasificacion: Clasificacion;
  documento: string | null;
  extraccion: Extraccion | null;
  autorEmail: string | null;
  existenteId: string | null;
  duplicadoDe: string | null;
  validaciones: Validacion[];
  correo: { de: string; fecha: string; asunto: string };
  resolucion: ResolucionHumana | null;
}
