/**
 * Contrato de la API (chat, buzón, bandeja y maestro). Sin imports a propósito: el front lo importa como `import type`
 * y así backend y front no pueden divergir.
 */

export interface LlamadaVisible {
  nombre: string;
  args: Record<string, unknown>;
  ok: boolean;
  resumen: string;
  /** Llamadas `contratos_*` que hizo el motor determinista por debajo de esta herramienta del chat. */
  pasos?: LlamadaVisible[];
}

export interface RespuestaChat {
  reply: string;
  toolCalls: LlamadaVisible[];
  needsConfirmation: boolean;
}

export interface PeticionChat {
  sessionId: string;
  message: string;
}

/** Lo que pasa mientras corre un turno: llamada al modelo, herramienta iniciada, paso del motor y herramienta terminada. */
export type EventoTurno =
  | { tipo: "modelo"; iteracion: number }
  | { tipo: "herramienta"; nombre: string; args: Record<string, unknown> }
  | { tipo: "paso"; paso: LlamadaVisible }
  | { tipo: "resultado"; llamada: LlamadaVisible };

/** Eventos de `POST /api/chat/stream` (SSE), en orden. El último es siempre `fin`, con la misma respuesta que `/api/chat`. */
export type EventoChat = EventoTurno | { tipo: "fin"; respuesta: RespuestaChat };

export interface TurnoSesion {
  ts: string;
  usuario: string;
  respuesta: RespuestaChat;
}

export interface SesionPublica {
  id: string;
  creada: string;
  actualizada: string;
  tokens: { entrada: number; salida: number };
  /** Mensajes cuyo registro espera una confirmación explícita del usuario (CA3). */
  pendientesConfirmacion: string[];
  turnos: TurnoSesion[];
}

export interface Salud {
  ok: true;
  provider: string;
  model: string;
  /** El backend publica el servidor de LangGraph en `/langgraph` para abrirlo en LangGraph Studio. */
  studio: boolean;
}

export interface ErrorApi {
  ok: false;
  error: { codigo: string; mensaje: string };
}

/* ---------- Buzón, bandeja de aprobación y maestro (human-in-the-loop) ---------- */

export type CampoContratoVisible =
  | "id_contrato"
  | "cliente"
  | "nit_cliente"
  | "pais"
  | "objeto"
  | "valor"
  | "moneda"
  | "fecha_inicio"
  | "fecha_fin"
  | "requiere_poliza"
  | "tipo_poliza";

export type ValorCampoVisible = string | number | boolean | null;

export interface CampoVisible {
  valor: ValorCampoVisible;
  confianza: number;
  evidencia?: string;
}

export type ContratoVisible = Record<CampoContratoVisible, CampoVisible> & {
  tipo_documento: "contrato" | "otrosi" | "otro";
  numero_otrosi: number | null;
  campos_modificados: string[];
  valor_indeterminado: boolean;
  notas: string[];
};

export type ClasificacionVisible = "nuevo" | "actualizacion" | "duplicado" | "rechazado";

export interface ValidacionVisible {
  clasificacion: ClasificacionVisible;
  motivo: string | null;
  id_contrato_existente: string | null;
  requiere_revision: CampoContratoVisible[];
  revisiones: { campo: CampoContratoVisible; motivo: string }[];
  diferencias: { campo: CampoContratoVisible; maestro: ValorCampoVisible; documento: ValorCampoVisible }[];
  avisos: string[];
}

export type EstadoMensaje = "pendiente" | "requiere_revision" | "registrado" | "actualizado" | "duplicado" | "rechazado";

export interface MensajeBuzon {
  id: string;
  de: string;
  asunto: string;
  fecha: string;
  adjuntos: string[];
  tiene_contrato: boolean;
  estado: EstadoMensaje;
  clasificacion: ClasificacionVisible | null;
  id_contrato: string | null;
  /** Quién lo aprobó o rechazó, si pasó por una decisión humana. */
  decidido_por: string | null;
}

export interface RespuestaBuzon {
  contadores: { total: number; pendientes: number; requiere_revision: number; procesados: number };
  mensajes: MensajeBuzon[];
  /** Correos ilegibles: se reportan sin impedir listar los demás (HU-6). */
  errores: { id: string; error: string }[];
}

export type EstadoPaso = "hecho" | "actual" | "pendiente" | "omitido" | "alerta";

export interface PasoLineaTiempo {
  id: string;
  titulo: string;
  estado: EstadoPaso;
  detalle: string | null;
  ts: string | null;
}

export type CambiosVisibles = Record<string, { antes: ValorCampoVisible; despues: string | number | boolean }>;

export type CorreccionesVisibles = Partial<Record<CampoContratoVisible, string | number | boolean>>;

export interface DecisionVisible {
  ts: string;
  mensaje_id: string;
  decision: "aprobado" | "rechazado";
  via: "bandeja" | "chat" | "studio";
  aprobador: string;
  correcciones: CorreccionesVisibles;
  motivo: string | null;
  id_contrato: string | null;
  accion: string | null;
  cambios: CambiosVisibles;
}

export interface FilaMaestroVisible {
  id_contrato: string;
  cliente: string;
  nit_cliente: string;
  pais: string;
  objeto: string;
  valor: number;
  moneda: string;
  fecha_inicio: string;
  fecha_fin: string;
  requiere_poliza: boolean;
  tipo_poliza: string;
  estado_poliza: string;
  comercial: string;
  ruta_sharepoint: string;
  fecha_registro: string;
  fuente: string;
}

export interface RespuestaMaestro {
  filas: FilaMaestroVisible[];
}

export interface DetalleMensaje {
  mensaje: MensajeBuzon;
  para: string;
  cuerpo: string;
  adjuntos: { nombre: string; texto: string | null; es_contrato: boolean }[];
  /** Solo tras analizar el mensaje (estado distinto de `pendiente`). */
  extraccion: ContratoVisible | null;
  error_extraccion: string | null;
  validacion: ValidacionVisible | null;
  decision: DecisionVisible | null;
  /** Fila del maestro escrita por este mensaje, si se registró. */
  fila: FilaMaestroVisible | null;
  linea_tiempo: PasoLineaTiempo[];
  historial: { ts: string; id_contrato: string; accion: string; cambios: CambiosVisibles; ruta_archivo: string }[];
  log: { ts: string; herramienta: string; ok: boolean; resumen: string }[];
}

export interface ItemBandeja {
  mensaje: MensajeBuzon;
  validacion: ValidacionVisible;
  contrato: ContratoVisible;
  /** Momento del análisis que lo dejó en espera. */
  desde: string;
}

export interface RespuestaBandeja {
  pendientes: ItemBandeja[];
  resueltas: DecisionVisible[];
}

export interface RespuestaProcesar {
  mensaje: MensajeBuzon;
  accion: string;
  requiere_revision: string[];
  avisos: string[];
}

export interface PeticionAprobar {
  aprobador: string;
  correcciones?: CorreccionesVisibles;
}

export interface PeticionRechazar {
  aprobador: string;
  motivo: string;
}

export interface RespuestaDecision {
  mensaje: MensajeBuzon;
  decision: DecisionVisible;
}

export interface RespuestaReinicio {
  ok: true;
  mensajes: number;
}
