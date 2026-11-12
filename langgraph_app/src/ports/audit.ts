import type { Decision, Extraccion, Tipo } from "../types.ts";

export interface AuditRecord {
  ts: string;
  msgId: string;
  /** "propuesta" = recomendación del agente; "resolucion" = decisión humana. */
  fase?: "propuesta" | "resolucion";
  accion?: "aprobar" | "rechazar";
  aprobador?: string;
  comentario?: string | null;
  correcciones?: Record<string, string>;
  modelo?: string;
  tipo?: Tipo | string;
  decision?: Decision | string;
  contratoId?: string | null;
  motivos?: string[];
  cambios?: Record<string, unknown>;
  validaciones?: Array<{ regla: string; ok: boolean }>;
  extraccion?: Extraccion | null;
  archivos?: string[];
  log?: string[];
}

export interface AuditConfidenceSummary {
  msgId: string;
  ts: string;
  fase: string | null;
  decision: string | null;
  tipo: string | null;
  contratoId: string | null;
  modelo: string | null;
  confianzaMin: number | null;
  confianzaMedia: number | null;
  campos: Array<{ campo: string; valor: unknown; confianza: number }>;
  motivos: string[];
}

export interface AuditStore {
  append(record: AuditRecord): void;
  list(limit?: number): AuditRecord[];
  /** Todos los eventos de un correo, en orden cronológico. */
  forMsg(msgId: string): AuditRecord[];
  last(msgId?: string): AuditRecord | null;
  summarize(record: AuditRecord): AuditConfidenceSummary;
}
