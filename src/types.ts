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

/** Un dato extraído, con qué tan seguro está el extractor y de dónde lo sacó. */
export interface Campo<T> {
  valor: T | null;
  confianza: number; // 0..1
  evidencia?: string;
}

export interface Extraccion {
  idContrato: Campo<string>;
  cliente: Campo<string>;
  nit: Campo<string>;
  valor: Campo<number>;
  fechaInicio: Campo<string>; // ISO yyyy-mm-dd
  fechaFin: Campo<string>; // ISO yyyy-mm-dd
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
  /** bloqueante = rechaza; revision = pasa a humano; info = solo informativa */
  severidad: "bloqueante" | "revision" | "info";
  detalle: string;
}

export interface Ctx {
  msgId: string;
  correo?: Correo;
  clasificacion?: Clasificacion;
  documento?: string; // nombre del adjunto usado para extraer
  extraccion?: Extraccion;
  autor?: Comercial;
  existente?: Contrato;
  duplicadoDe?: string;
  validaciones: Validacion[];
  decision?: Decision;
  motivos: string[];
  contratoId?: string;
  cambios: Record<string, { antes: unknown; despues: unknown }>;
  archivos: string[];
  log: string[];
}
