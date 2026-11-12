import { z } from "zod";
import type { Alertas } from "../application/use-cases/alerts.ts";
import { explicarMensaje, listarBuzon } from "../application/use-cases/mailbox-view.ts";
import { consultarMaestro } from "../application/use-cases/master-query.ts";
import type { ResultadoHitl } from "../application/use-cases/message-status.ts";
import { type Reanudacion, type Reanudado, reanudarRevision } from "../application/workflows/approval-tray.ts";
import type { ResultadoMensaje } from "../application/workflows/contract-graph.ts";
import { type Pasada, ejecutarPasada } from "../application/workflows/process-mailbox.ts";
import { CorreccionesSchema } from "../core/domain/contract.ts";
import { FechaIsoSchema } from "../core/domain/master.ts";
import { type Resultado, exito, fallo } from "../core/domain/result.ts";
import { MensajeIdSchema } from "./args.ts";
import { type ContextoHerramienta, type HerramientaGenerica, definirHerramienta, registroDeHerramientas } from "./tool.ts";

/**
 * Herramientas del chat (la recepcionista). Son las únicas que ve el modelo: tres de lectura y dos
 * que encienden o reanudan el motor determinista. Ninguna contiene reglas de negocio; el orden
 * extraer → validar → registrar y la pausa humana los fija el motor, no el modelo.
 */

export const PREFIJO = "recepcion";
const nombre = (exportado: string): string => `${PREFIJO}_${exportado}`;

export const HERRAMIENTA_PROCESAR = nombre("procesar_buzon");
export const HERRAMIENTA_RESPONDER = nombre("responder_revision");

const hitlAResultado = <T>(resultado: ResultadoHitl<T>): Resultado<T> => (resultado.ok ? resultado : fallo(resultado.mensaje));

const alertasVisibles = (alertas: Resultado<Alertas>): Alertas | { error: string } => (alertas.ok ? alertas.data : { error: alertas.error });

const resumirAlertas = (alertas: Alertas | { error: string }): string =>
  "error" in alertas
    ? `alertas con error: ${alertas.error}`
    : `alertas: ${alertas.vencen.length} vencen, ${alertas.polizas_pendientes.length} pólizas pendientes, ${alertas.registrados_desde_corte.length} desde el corte`;

export const consultar_estado = definirHerramienta({
  nombre: nombre("consultar_estado"),
  description: "Muestra, sin procesar nada, el estado de cada mensaje del buzón: pendiente, en revisión, registrado, actualizado, duplicado o rechazado.",
  args: {},
  ejecutar: async (_args, _ctx, rutas) => exito(await listarBuzon(rutas)),
  resumir: ({ contadores }) =>
    `${contadores.total} mensajes: ${contadores.pendientes} pendientes, ${contadores.requiere_revision} en revisión, ${contadores.procesados} procesados`,
});

export const consultar_maestro = definirHerramienta({
  nombre: nombre("consultar_maestro"),
  description: "Busca contratos en el maestro de trabajo por id de contrato, cliente o NIT y devuelve sus filas tal como están registradas.",
  args: {
    consulta: z.string().trim().max(100).optional().describe("Id de contrato, cliente o NIT (o parte de ellos); omítelo para listar todo el maestro"),
  },
  ejecutar: (args, _ctx, rutas) => consultarMaestro(rutas, args.consulta),
  resumir: (consulta) => `${consulta.total} filas${consulta.truncado ? ` (se muestran ${consulta.filas.length})` : ""}`,
});

export const explicar_validacion = definirHerramienta({
  nombre: nombre("explicar_validacion"),
  description: "Explica un mensaje ya analizado: campos extraídos con confianza y evidencia, clasificación, motivos de revisión, decisión humana y fila del maestro.",
  args: { mensaje_id: MensajeIdSchema },
  ejecutar: async (args, _ctx, rutas) => hitlAResultado(await explicarMensaje(rutas, args.mensaje_id)),
  resumir: ({ mensaje, validacion }) => `${mensaje.id}: ${mensaje.estado}${validacion ? ` (${validacion.clasificacion})` : ", sin analizar"}`,
});

export interface PasadaReportada extends Omit<Pasada, "mensajes" | "alertas"> {
  mensajes: Omit<ResultadoMensaje, "contrato">[];
  alertas: Alertas | { error: string };
}

const sinContrato = ({ contrato: _contrato, ...mensaje }: ResultadoMensaje): Omit<ResultadoMensaje, "contrato"> => mensaje;

function resumirPasada({ mensajes, en_revision, alertas }: PasadaReportada): string {
  const contar = (desenlace: ResultadoMensaje["desenlace"]): number => mensajes.filter((mensaje) => mensaje.desenlace === desenlace).length;
  const revision = en_revision.length > 0 ? ` (${en_revision.join(", ")})` : "";
  return `${mensajes.length} mensajes: ${contar("registrado")} registrados, ${en_revision.length} en revisión${revision}, ${contar("cerrado")} cerrados, ${contar("error")} con error; ${resumirAlertas(alertas)}`;
}

export const procesar_buzon = definirHerramienta({
  nombre: HERRAMIENTA_PROCESAR,
  description:
    "Enciende el motor determinista: por cada mensaje pendiente extrae, valida, registra lo limpio, pausa lo dudoso para revisión humana y al final regenera el reporte de alertas.",
  args: {
    hoy: FechaIsoSchema.describe("Fecha de referencia YYYY-MM-DD de las alertas, la que indique la analista"),
    mensaje_ids: z
      .array(MensajeIdSchema)
      .max(50)
      .optional()
      .describe("Solo estos mensajes; omítelo para procesar todo lo pendiente; [] solo regenera las alertas"),
  },
  ejecutar: async (args, ctx) => {
    const pasada = await ejecutarPasada(ctx, { hoy: args.hoy, ...(args.mensaje_ids ? { mensajeIds: args.mensaje_ids } : {}) });
    if (!pasada.ok) return pasada;
    return exito<PasadaReportada>({ ...pasada.data, mensajes: pasada.data.mensajes.map(sinContrato), alertas: alertasVisibles(pasada.data.alertas) });
  },
  resumir: resumirPasada,
});

export interface DecisionReportada {
  mensaje_id: string;
  decision: "aprobado" | "rechazado";
  estado: string;
  id_contrato: string | null;
  accion: string | null;
  correcciones: Record<string, unknown>;
  cambios: Reanudado["decision"]["cambios"];
  alertas: Alertas | { error: string } | null;
}

async function reanudar(ctx: ContextoHerramienta, reanudacion: Reanudacion): Promise<Resultado<DecisionReportada>> {
  const reanudado = hitlAResultado(await reanudarRevision(ctx, reanudacion));
  if (!reanudado.ok) return reanudado;
  const { mensaje, decision, alertas } = reanudado.data;
  return exito({
    mensaje_id: mensaje.id,
    decision: decision.decision,
    estado: mensaje.estado,
    id_contrato: decision.id_contrato,
    accion: decision.accion,
    correcciones: decision.correcciones,
    cambios: decision.cambios,
    alertas: alertas ? alertasVisibles(alertas) : null,
  });
}

export const responder_revision = definirHerramienta({
  nombre: HERRAMIENTA_RESPONDER,
  description:
    "Reanuda un mensaje pausado con la decisión que la analista tomó en su último mensaje: aprobar lo registra con sus correcciones; rechazar lo cierra sin tocar el maestro.",
  args: {
    mensaje_id: MensajeIdSchema,
    decision: z.enum(["aprobar", "rechazar"]).describe("aprobar si la analista confirmó o corrigió los valores; rechazar si lo descartó"),
    correcciones: CorreccionesSchema.default({}).describe("Solo los valores que la analista dictó o corrigió; los demás se registran como se extrajeron"),
    motivo: z.string().trim().min(1).max(500).optional().describe("Obligatorio al rechazar: el motivo que dio la analista"),
    hoy: FechaIsoSchema.optional().describe("Fecha YYYY-MM-DD de las alertas; si se indica, el reporte se regenera tras la decisión"),
  },
  ejecutar: (args, ctx) => {
    const comunes = { mensajeId: args.mensaje_id, aprobador: `chat ${ctx.sessionId}`, via: "chat", hoy: args.hoy ?? null } as const;
    if (args.decision === "aprobar") return reanudar(ctx, { ...comunes, decision: "aprobar", correcciones: args.correcciones });
    if (!args.motivo) return Promise.resolve(fallo("argumentos inválidos: motivo: el rechazo necesita el motivo que dio la analista"));
    return reanudar(ctx, { ...comunes, decision: "rechazar", motivo: args.motivo });
  },
  resumir: (decision) =>
    `${decision.decision} ${decision.mensaje_id}${decision.accion ? `: ${decision.accion} ${decision.id_contrato ?? ""}` : ""}`.trim(),
});

export const herramientas: Readonly<Record<string, HerramientaGenerica>> = {
  [nombre("consultar_estado")]: consultar_estado,
  [nombre("consultar_maestro")]: consultar_maestro,
  [nombre("explicar_validacion")]: explicar_validacion,
  [HERRAMIENTA_PROCESAR]: procesar_buzon,
  [HERRAMIENTA_RESPONDER]: responder_revision,
};

const registro = registroDeHerramientas(PREFIJO, herramientas);

/** Punto de entrada del ciclo del agente: fuera de estas cinco herramientas el modelo no puede ejecutar nada. */
export function ejecutarHerramienta(nombreHerramienta: string, args: unknown, ctx: ContextoHerramienta): Promise<string> {
  return registro.ejecutar(nombreHerramienta, args, ctx);
}

export function resumirEjecucion(nombreHerramienta: string, json: string): string {
  return registro.resumir(nombreHerramienta, json);
}
