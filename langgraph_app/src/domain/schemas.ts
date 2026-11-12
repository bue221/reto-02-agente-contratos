/**
 * Contratos Zod compartidos (LLM structured output + validación de dominio).
 * Sin z.union en campos Gemini (el API no los soporta bien en JSON schema).
 */
import { z } from "zod";

export const TipoSchema = z.enum([
  "contrato",
  "otrosi",
  "actualizacion",
  "cotizacion",
  "otro",
]);

export const DecisionSchema = z.enum([
  "REGISTRAR_NUEVO",
  "ACTUALIZAR",
  "DUPLICADO",
  "RECHAZAR",
  "REVISION_HUMANA",
]);

/** valor siempre string|""; vacío = ausente. */
export const CampoLlmSchema = z.object({
  valor: z.string().describe("Valor como texto; string vacío si no aparece"),
  confianza: z.number().describe("0..1"),
  evidencia: z.string().describe("Fragmento del documento o vacío"),
});

export const ClasificacionLlmSchema = z.object({
  tipo: TipoSchema,
  confianza: z.number(),
  razon: z.string(),
});

export const ExtraccionLlmSchema = z.object({
  idContrato: CampoLlmSchema,
  cliente: CampoLlmSchema,
  nit: CampoLlmSchema,
  valor: CampoLlmSchema,
  fechaInicio: CampoLlmSchema,
  fechaFin: CampoLlmSchema,
});

export const ChatRequestSchema = z.object({
  threadId: z.string().min(1).optional(),
  message: z.string().min(1),
});

export const MsgIdSchema = z
  .string()
  .regex(/^msg-\d+$/i, "Formato esperado: msg-001");

const FechaIso = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha en formato YYYY-MM-DD");

/** Campos que el humano puede corregir en la tarjeta antes de aprobar. */
export const CorreccionesSchema = z
  .object({
    idContrato: z.string().trim().regex(/^C-\d{3}$/i, "ID con formato C-001"),
    cliente: z.string().trim().min(2).max(200),
    nit: z.string().trim().min(5).max(20),
    valor: z.string().trim().max(30).regex(/\d/, "El valor debe contener números"),
    fechaInicio: FechaIso,
    fechaFin: FechaIso,
  })
  .partial()
  .strict();

const AprobadorSchema = z.string().trim().min(1).max(100);

export const AprobarRequestSchema = z.object({
  correcciones: CorreccionesSchema.optional(),
  comentario: z.string().trim().max(500).optional(),
  aprobador: AprobadorSchema.optional(),
});

export const RechazarRequestSchema = z.object({
  comentario: z.string().trim().max(500).optional(),
  aprobador: AprobadorSchema.optional(),
});

export const EstadoPropuestaSchema = z.enum(["PENDIENTE", "APROBADA", "RECHAZADA"]);

export type CampoLlm = z.infer<typeof CampoLlmSchema>;
export type ClasificacionLlm = z.infer<typeof ClasificacionLlmSchema>;
export type ExtraccionLlm = z.infer<typeof ExtraccionLlmSchema>;
export type ChatRequest = z.infer<typeof ChatRequestSchema>;
export type AprobarRequest = z.infer<typeof AprobarRequestSchema>;
export type RechazarRequest = z.infer<typeof RechazarRequestSchema>;
