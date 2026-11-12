import { z } from "zod";
import { generarAlertas } from "../application/use-cases/alerts.ts";
import { leerBuzon } from "../application/use-cases/read-mailbox.ts";
import { cargarMensaje, extraerDeMensaje } from "../application/use-cases/message.ts";
import { registrarMensaje } from "../application/use-cases/register.ts";
import { validarMensaje } from "../application/use-cases/validate.ts";
import { ContratoSchema } from "../core/domain/contract.ts";
import { fechaDeHoy } from "../core/domain/dates.ts";
import { FechaIsoSchema } from "../core/domain/master.ts";
import { UMBRAL_CONFIANZA } from "../core/domain/parameters.ts";
import { MensajeIdSchema } from "./args.ts";
import { type ContextoHerramienta, type HerramientaGenerica, definirHerramienta, registroDeHerramientas } from "./tool.ts";

/** El modelo ve cada export como `contratos_<export>` (PRD 6.2). */
export const PREFIJO = "contratos";
const nombre = (exportado: string): string => `${PREFIJO}_${exportado}`;

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

const registro = registroDeHerramientas(PREFIJO, herramientas);

/** Punto de entrada del motor determinista, `demo.ts` y el módulo: el modelo del chat no llama estas herramientas directamente. */
export function ejecutarHerramienta(nombreHerramienta: string, args: unknown, ctx: ContextoHerramienta): Promise<string> {
  return registro.ejecutar(nombreHerramienta, args, ctx);
}

export function resumirEjecucion(nombreHerramienta: string, json: string): string {
  return registro.resumir(nombreHerramienta, json);
}
