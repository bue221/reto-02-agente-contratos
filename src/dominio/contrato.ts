import { z } from "zod";
import { FechaIsoSchema, MonedaSchema, PaisSchema } from "./maestro.ts";
import { MAX_LONGITUD_OBJETO } from "./parametros.ts";

const ConfianzaSchema = z.number().min(0).max(1).describe("Confianza de la extracción en [0, 1]");

const campoSchema = <T extends z.ZodType>(valor: T, descripcion: string) =>
  z.object({
    valor: valor.nullable().describe(`${descripcion}. null si no aparece en el documento`),
    confianza: ConfianzaSchema,
    evidencia: z.string().optional().describe("Fragmento del documento que respalda el valor"),
  });

export const TIPOS_DOCUMENTO = ["contrato", "otrosi", "otro"] as const;

/** Esquema de extracción (PRD 7.2 + HU-2): cada campo del maestro con su confianza. */
export const ContratoSchema = z.object({
  tipo_documento: z.enum(TIPOS_DOCUMENTO).describe("contrato, otrosi (modifica uno existente) u otro (no es contrato)"),
  numero_otrosi: z.number().int().positive().nullable().describe("Número del otrosí, null si no es otrosí"),
  campos_modificados: z.array(z.string()).describe("Campos que el otrosí modifica; vacío si no es otrosí"),
  valor_indeterminado: z.boolean().describe("true si el contrato es por demanda y no tiene valor total"),
  id_contrato: campoSchema(z.string().min(1), "Número del contrato tal como aparece en el documento"),
  cliente: campoSchema(z.string().min(1), "Razón social del CONTRATANTE (nunca Periferia)"),
  nit_cliente: campoSchema(
    z.string().regex(/^\d+$/, "identificador tributario sin puntos ni dígito de verificación"),
    "NIT/RUC/RTN del cliente sin puntos ni dígito de verificación",
  ),
  pais: campoSchema(PaisSchema, "País del cliente"),
  objeto: campoSchema(z.string().min(1).max(MAX_LONGITUD_OBJETO), "Objeto del contrato, máx. 200 caracteres"),
  valor: campoSchema(z.number().nonnegative(), "Valor total sin separadores; 0 si es por demanda"),
  moneda: campoSchema(MonedaSchema, "Moneda del valor"),
  fecha_inicio: campoSchema(FechaIsoSchema, "Fecha de inicio YYYY-MM-DD"),
  fecha_fin: campoSchema(FechaIsoSchema, "Fecha de fin YYYY-MM-DD"),
  requiere_poliza: campoSchema(z.boolean(), "Si el contrato exige constituir póliza"),
  tipo_poliza: campoSchema(z.string(), "Tipos de póliza separados por ';', vacío si no requiere"),
  notas: z.array(z.string()).describe("Heurísticas y supuestos aplicados en la extracción"),
});

export type Contrato = z.infer<typeof ContratoSchema>;

export const CAMPOS_CONTRATO = [
  "id_contrato",
  "cliente",
  "nit_cliente",
  "pais",
  "objeto",
  "valor",
  "moneda",
  "fecha_inicio",
  "fecha_fin",
  "requiere_poliza",
  "tipo_poliza",
] as const;

export type CampoContrato = (typeof CAMPOS_CONTRATO)[number];

export interface Campo<T> {
  valor: T | null;
  confianza: number;
  evidencia?: string;
}

export const ausente = <T>(): Campo<T> => ({ valor: null, confianza: 0 });

export const encontrado = <T>(valor: T, confianza: number, evidencia?: string): Campo<T> =>
  evidencia === undefined ? { valor, confianza } : { valor, confianza, evidencia: evidencia.trim() };

export function contratoVacio(tipo: Contrato["tipo_documento"], notas: string[]): Contrato {
  return {
    tipo_documento: tipo,
    numero_otrosi: null,
    campos_modificados: [],
    valor_indeterminado: false,
    id_contrato: ausente(),
    cliente: ausente(),
    nit_cliente: ausente(),
    pais: ausente(),
    objeto: ausente(),
    valor: ausente(),
    moneda: ausente(),
    fecha_inicio: ausente(),
    fecha_fin: ausente(),
    requiere_poliza: ausente(),
    tipo_poliza: ausente(),
    notas,
  };
}
