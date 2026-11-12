import { z } from "zod";
import { esFechaIso } from "./fechas.ts";
import { MAX_LONGITUD_OBJETO } from "./parametros.ts";

export const PAISES = ["CO", "EC", "PE", "PA", "HN"] as const;
export const MONEDAS = ["COP", "USD", "PEN", "PAB", "HNL"] as const;
export const ESTADOS_POLIZA = ["vigente", "pendiente", "vencida", "no_aplica"] as const;
export const FUENTES = ["buzon", "manual", "migracion"] as const;

export const PaisSchema = z.enum(PAISES);
export const MonedaSchema = z.enum(MONEDAS);
export const EstadoPolizaSchema = z.enum(ESTADOS_POLIZA);
export const FuenteSchema = z.enum(FUENTES);

export const FechaIsoSchema = z
  .string()
  .refine(esFechaIso, { message: "fecha inválida: se espera una fecha real en formato YYYY-MM-DD" });

export type Pais = z.infer<typeof PaisSchema>;
export type Moneda = z.infer<typeof MonedaSchema>;
export type EstadoPoliza = z.infer<typeof EstadoPolizaSchema>;

/** Una fila del maestro (PRD 7.2). `tipo_poliza` es una lista separada por `;`. */
export const FilaMaestroSchema = z.object({
  id_contrato: z.string().min(1),
  cliente: z.string().min(1),
  nit_cliente: z.string().regex(/^\d+$/, "identificador tributario sin puntos ni dígito de verificación"),
  pais: PaisSchema,
  objeto: z.string().min(1).max(MAX_LONGITUD_OBJETO),
  valor: z.number().nonnegative(),
  moneda: MonedaSchema,
  fecha_inicio: FechaIsoSchema,
  fecha_fin: FechaIsoSchema,
  requiere_poliza: z.boolean(),
  tipo_poliza: z.string(),
  estado_poliza: EstadoPolizaSchema,
  comercial: z.string(),
  ruta_sharepoint: z.string(),
  fecha_registro: FechaIsoSchema,
  fuente: FuenteSchema,
});

export type FilaMaestro = z.infer<typeof FilaMaestroSchema>;

/** Orden de columnas del CSV: el mismo del fixture. */
export const COLUMNAS_MAESTRO = Object.keys(FilaMaestroSchema.shape) as (keyof FilaMaestro)[];
