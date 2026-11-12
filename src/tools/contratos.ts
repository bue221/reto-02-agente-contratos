import { z } from "zod";
import { generarAlertas } from "../casos/alertas.ts";
import { leerBuzon } from "../casos/leer-buzon.ts";
import { cargarMensaje, extraerDeMensaje } from "../casos/mensaje.ts";
import { registrarMensaje } from "../casos/registrar.ts";
import { validarMensaje } from "../casos/validar.ts";
import { ContratoSchema } from "../dominio/contrato.ts";
import { fechaDeHoy } from "../dominio/fechas.ts";
import { FechaIsoSchema } from "../dominio/maestro.ts";
import { UMBRAL_CONFIANZA } from "../dominio/parametros.ts";
import { type ContextoHerramienta, type HerramientaGenerica, definirHerramienta, herramientaDesconocida, resumirResultado } from "./herramienta.ts";

/** El modelo ve cada export como `contratos_<export>` (PRD 6.2). */
export const PREFIJO = "contratos";
const nombre = (exportado: string): string => `${PREFIJO}_${exportado}`;

const MensajeIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, "solo letras, números, '-' y '_'")
  .describe("Id del mensaje del buzón, p. ej. msg-001");

const ContratoArgSchema = ContratoSchema.describe(
  "Contrato tal como lo devolvió contratos_extraer; si el usuario corrige un campo, cambia solo su valor",
);

export const leer_buzon = definirHerramienta({
  nombre: nombre("leer_buzon"),
  description: "Lista los mensajes pendientes del buzón de contratos con remitente, asunto, adjuntos y si traen contrato.",
  args: {},
  ejecutar: (_args, _ctx, rutas) => leerBuzon(rutas),
  resumir: (data) => `${data.mensajes.length} pendientes: ${data.mensajes.map((mensaje) => mensaje.id).join(", ") || "ninguno"}`,
});

export const extraer = definirHerramienta({
  nombre: nombre("extraer"),
  description: "Extrae del adjunto de un mensaje los datos del contrato con confianza por campo, sin inventar los ausentes.",
  args: { mensaje_id: MensajeIdSchema },
  ejecutar: async (args, _ctx, rutas) => extraerDeMensaje(await cargarMensaje(rutas, args.mensaje_id)),
  resumir: (contrato) => {
    const dudosos = Object.entries(contrato).filter(
      ([, campo]) => typeof campo === "object" && campo !== null && "confianza" in campo && campo.confianza < UMBRAL_CONFIANZA,
    );
    return `${contrato.tipo_documento} ${contrato.id_contrato.valor ?? "sin id"}, ${dudosos.length} campos con confianza < ${UMBRAL_CONFIANZA}`;
  },
});

export const validar = definirHerramienta({
  nombre: nombre("validar"),
  description: "Clasifica un contrato extraído como nuevo, actualizacion, duplicado o rechazado y lista los campos que requieren revisión humana.",
  args: { mensaje_id: MensajeIdSchema, contrato: ContratoArgSchema },
  ejecutar: (args, _ctx, rutas) => validarMensaje(rutas, args.mensaje_id, args.contrato),
  resumir: (validacion) => `${validacion.clasificacion}; revisión: ${validacion.requiere_revision.join(", ") || "ninguna"}`,
});

export const registrar = definirHerramienta({
  nombre: nombre("registrar"),
  description: "Escribe el contrato en el maestro y lo archiva; si hay campos en revisión solo procede con confirmado = true tras la confirmación explícita del usuario.",
  args: {
    mensaje_id: MensajeIdSchema,
    contrato: ContratoArgSchema,
    confirmado: z.boolean().default(false).describe("true solo si el usuario confirmó explícitamente los campos en revisión"),
  },
  ejecutar: (args, ctx, rutas) =>
    registrarMensaje(rutas, {
      mensajeId: args.mensaje_id,
      contrato: args.contrato,
      confirmado: args.confirmado,
      fechaRegistro: ctx.hoy ?? fechaDeHoy(),
    }),
  resumir: (registro) => `${registro.accion} ${registro.id_contrato ?? ""}`.trim(),
});

export const alertas = definirHerramienta({
  nombre: nombre("alertas"),
  description: "Genera out/alertas.md con contratos que vencen en ≤ 60 días, pólizas requeridas no vigentes y registros desde el corte del maestro.",
  args: { hoy: FechaIsoSchema.describe("Fecha de referencia YYYY-MM-DD") },
  ejecutar: (args, ctx, rutas) => generarAlertas(rutas, args.hoy, ctx.directory),
  resumir: (reporte) =>
    `${reporte.vencen.length} vencen, ${reporte.polizas_pendientes.length} pólizas pendientes, ${reporte.registrados_desde_corte.length} registrados desde el corte`,
});

export const herramientas: Readonly<Record<string, HerramientaGenerica>> = {
  [nombre("leer_buzon")]: leer_buzon,
  [nombre("extraer")]: extraer,
  [nombre("validar")]: validar,
  [nombre("registrar")]: registrar,
  [nombre("alertas")]: alertas,
};

const buscarHerramienta = (nombreHerramienta: string): HerramientaGenerica | undefined =>
  herramientas[nombreHerramienta] ?? herramientas[nombre(nombreHerramienta)];

/**
 * Punto de entrada del ciclo del agente: acepta `contratos_<export>` o `<export>` y argumentos crudos del modelo.
 * Los argumentos se validan con zod dentro de cada herramienta y el error vuelve como `{ ok: false, error }`.
 */
export function ejecutarHerramienta(nombreHerramienta: string, args: unknown, ctx: ContextoHerramienta): Promise<string> {
  const herramienta = buscarHerramienta(nombreHerramienta);
  if (!herramienta) return herramientaDesconocida(nombreHerramienta, ctx, Object.keys(herramientas));
  return herramienta.execute(args, ctx);
}

/** Resumen de una ejecución para el historial del chat; si la herramienta no existe, el propio error. */
export function resumirEjecucion(nombreHerramienta: string, json: string): string {
  const herramienta = buscarHerramienta(nombreHerramienta);
  return herramienta ? resumirResultado(herramienta, json) : (JSON.parse(json) as { error?: string }).error ?? json;
}
