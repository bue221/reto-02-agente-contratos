/**
 * Tools expuestas al agente conversacional.
 *
 * Diseño deliberado (human-in-the-loop):
 * - El agente puede ELEGIR qué tool llamar.
 * - procesar_* solo ANALIZA y deja una recomendación pendiente; no escribe el maestro.
 * - NO existe tool para aprobar/rechazar: esa decisión es exclusiva del humano (API/UI).
 */
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { getAudit, getCfg, getMailbox, getPropuestas, getRepo, resetDeps } from "../deps.ts";
import type { EstadoPropuesta } from "../domain/types.ts";
import { graph as pipelineDeterministico } from "../graph.ts";
import { formatearPropuesta } from "../hitl/format.ts";
import { formatoCOP } from "../parse.ts";
import { formatearReporte, reporteVencimientos } from "../report.ts";

// Evita analizar el mismo correo dos veces en paralelo (doble clic / chat + botón).
const enAnalisis = new Set<string>();

/** Un mensaje → pipeline fijo → recomendación pendiente (nunca ejecuta). */
export async function ejecutarPipelineMensaje(msgId: string): Promise<string> {
  const id = String(msgId).trim().toLowerCase();
  if (!/^msg-\d+$/.test(id)) {
    return `Id inválido "${msgId}". Usa formato msg-001.`;
  }
  const previa = getPropuestas().get(id);
  if (previa) {
    const prefijo =
      previa.estado === "PENDIENTE"
        ? `${id} ya tiene una recomendación esperando tu aprobación:`
        : `${id} ya fue resuelto por un humano:`;
    return `${prefijo}\n\n${formatearPropuesta(previa)}`;
  }
  if (enAnalisis.has(id)) return `${id} se está analizando en este momento.`;

  enAnalisis.add(id);
  try {
    await pipelineDeterministico.invoke({ msgId: id });
    const propuesta = getPropuestas().get(id);
    return propuesta
      ? formatearPropuesta(propuesta)
      : `El pipeline terminó sin generar recomendación para ${id}.`;
  } catch (e) {
    console.error(`[tools] pipeline ${id} falló:`, e);
    return `Error en pipeline: ${(e as Error).message}`;
  } finally {
    enAnalisis.delete(id);
  }
}

export async function ejecutarPipelineBuzon(): Promise<string> {
  const salidas: string[] = [];
  for (const id of getMailbox().listIds()) {
    salidas.push(await ejecutarPipelineMensaje(id));
  }
  return salidas.join("\n\n");
}

export function formatearEstadoBuzon(): string {
  const mb = getMailbox();
  const s = mb.stats();
  const pendientes = mb.listPending();
  const procesados = mb.listProcessed();
  const porAprobar = getPropuestas().list("PENDIENTE").map((p) => p.msgId);
  return [
    `**Buzón:** ${s.total} total · ${s.procesados} analizados · ${s.pendientes} sin analizar.`,
    "",
    pendientes.length ? `- Sin analizar: ${pendientes.join(", ")}` : "- Sin analizar: (ninguno)",
    procesados.length ? `- Analizados: ${procesados.join(", ")}` : "- Analizados: (ninguno)",
    porAprobar.length
      ? `- Esperando tu aprobación (${porAprobar.length}): ${porAprobar.join(", ")}`
      : "- Esperando tu aprobación: (ninguna)",
  ].join("\n");
}

export function formatearUltimaAuditoria(msgId?: string): string {
  const store = getAudit();
  const record = store.last(msgId);
  if (!record) {
    return msgId ? `No hay auditoría para ${msgId}.` : "No hay registros de auditoría todavía.";
  }
  const s = store.summarize(record);
  const campos =
    s.campos.length === 0
      ? "(sin extracción de campos)"
      : s.campos
          .map((c) => `  - ${c.campo}: ${JSON.stringify(c.valor)} (conf=${c.confianza.toFixed(2)})`)
          .join("\n");
  return [
    `**Auditoría ${s.msgId}** · ${s.ts} · fase: ${s.fase ?? "n/a"}`,
    "",
    `- Decisión: ${s.decision ?? "n/a"} · tipo: ${s.tipo ?? "n/a"} · contrato: ${s.contratoId ?? "—"} · motor: ${s.modelo ?? "n/a"}`,
    `- Confianza media: ${s.confianzaMedia ?? "n/a"} · mínima: ${s.confianzaMin ?? "n/a"}`,
    "- Campos:",
    campos,
    s.motivos.length ? `- Motivos: ${s.motivos.join("; ")}` : "- Motivos: (ninguno)",
  ].join("\n");
}

export function formatearListaContratos(): string {
  const todos = getRepo().all();
  if (!todos.length) return "El maestro está vacío.";
  const lineas = todos.map(
    (c) =>
      `- **${c.id_contrato}** · ${c.cliente} · NIT ${c.nit} · ${formatoCOP(c.valor)} ${c.moneda} · ${c.fecha_inicio} → ${c.fecha_fin} · ${c.estado}`,
  );
  return `**Maestro** (${todos.length} contratos):\n\n${lineas.join("\n")}`;
}

export function formatearListaPropuestas(estado?: EstadoPropuesta): string {
  const items = getPropuestas().list(estado);
  if (!items.length) {
    return estado === "PENDIENTE"
      ? "No hay recomendaciones esperando aprobación."
      : "No hay propuestas registradas.";
  }
  return items
    .map(
      (p) =>
        `- **${p.msgId}** · ${p.estado} · recomendación ${p.recomendacion}` +
        (p.resolucion
          ? ` → resuelta por ${p.resolucion.aprobador}: ${p.resolucion.decisionFinal}`
          : ""),
    )
    .join("\n");
}

export const listarMensajesBuzon = tool(
  async () => getMailbox().listIds().join(", "),
  {
    name: "listar_mensajes",
    description: "Lista TODOS los ids del buzón (msg-001…). Solo lectura.",
    schema: z.object({}),
  },
);

export const estadoBuzon = tool(
  async () => formatearEstadoBuzon(),
  {
    name: "estado_buzon",
    description:
      "Resumen del buzón: total, analizados, sin analizar y recomendaciones esperando aprobación. " +
      "Úsala para 'cuántos faltan' o 'cuántos sin procesar'.",
    schema: z.object({}),
  },
);

export const listarPendientes = tool(
  async () => {
    const pendientes = getMailbox().listPending();
    return pendientes.length
      ? `Sin analizar (${pendientes.length}): ${pendientes.join(", ")}`
      : "No hay mensajes sin analizar.";
  },
  {
    name: "listar_pendientes",
    description: "Lista solo los correos que el agente aún no ha analizado.",
    schema: z.object({}),
  },
);

export const ultimaAuditoria = tool(
  async ({ id }) => formatearUltimaAuditoria(id || undefined),
  {
    name: "ultima_auditoria",
    description:
      "Devuelve la última auditoría (o la de un msgId): fase, decisión, confianzas por campo, motivos. " +
      "Úsala para 'confianza del último' o 'qué pasó con msg-006'.",
    schema: z.object({
      id: z.string().optional().describe("Opcional: msg-001. Si se omite, usa la última."),
    }),
  },
);

export const procesarMensaje = tool(
  async ({ id }) => ejecutarPipelineMensaje(id),
  {
    name: "procesar_mensaje",
    description:
      "Analiza UN correo con el pipeline determinístico y genera una RECOMENDACIÓN " +
      "pendiente de aprobación humana. NO escribe en el maestro. " +
      "La recomendación la calculan las reglas TypeScript, no tú.",
    schema: z.object({ id: z.string().describe("Ej: msg-003") }),
  },
);

export const procesarBuzon = tool(
  async () => ejecutarPipelineBuzon(),
  {
    name: "procesar_buzon",
    description:
      "Analiza TODOS los correos y deja una recomendación pendiente por cada uno. " +
      "NO ejecuta nada: el humano aprueba o rechaza cada tarjeta.",
    schema: z.object({}),
  },
);

export const listarPropuestas = tool(
  async ({ estado }) =>
    formatearListaPropuestas(estado === "TODAS" ? undefined : (estado ?? "PENDIENTE")),
  {
    name: "listar_propuestas",
    description:
      "Lista las recomendaciones (tarjetas). Por defecto las PENDIENTES de aprobación humana. " +
      "Úsala para 'qué tengo por aprobar', 'bandeja', 'recomendaciones'.",
    schema: z.object({
      estado: z.enum(["PENDIENTE", "APROBADA", "RECHAZADA", "TODAS"]).optional(),
    }),
  },
);

export const verPropuesta = tool(
  async ({ id }) => {
    const p = getPropuestas().get(String(id));
    return p ? formatearPropuesta(p) : `No hay propuesta para ${id}.`;
  },
  {
    name: "ver_propuesta",
    description: "Muestra el detalle de la recomendación de un correo (msg-006). Solo lectura.",
    schema: z.object({ id: z.string() }),
  },
);

export const reporteVencimientosTool = tool(
  async () => formatearReporte(reporteVencimientos(getRepo().all(), getCfg().hoy)),
  {
    name: "reporte_vencimientos",
    description:
      "Reporte de alertas (vencidos, ≤30, 31-60, 61-90 días) con fecha de referencia fija. Solo lectura.",
    schema: z.object({}),
  },
);

export const listarContratos = tool(
  async () => formatearListaContratos(),
  {
    name: "listar_contratos",
    description:
      "Lista TODOS los contratos del maestro. Úsala para 'qué contratos tengo' o 'lista el maestro'.",
    schema: z.object({}),
  },
);

export const consultarContrato = tool(
  async ({ id }) => {
    const c = getRepo().findById(String(id));
    if (!c) return `No existe el contrato ${id} en el maestro.`;
    return `${c.id_contrato} · ${c.cliente} · NIT ${c.nit} · ${formatoCOP(c.valor)} ${c.moneda} · ${c.fecha_inicio} → ${c.fecha_fin} · ${c.estado} · ${c.comercial_email}`;
  },
  {
    name: "consultar_contrato",
    description: "Consulta UN contrato del maestro por id (C-001). Solo lectura.",
    schema: z.object({ id: z.string() }),
  },
);

export const reiniciarDemo = tool(
  async () => {
    resetDeps();
    return "Maestro, auditoría, propuestas y buzón restablecidos al estado original (seed).";
  },
  {
    name: "reiniciar_demo",
    description: "Resetea el maestro al seed y limpia propuestas/auditoría.",
    schema: z.object({}),
  },
);

/**
 * Catálogo del agente.
 * Intencionalmente AUSENTES: aprobar_propuesta, rechazar_propuesta, registrar_contrato, update_raw.
 */
export const TOOLS = [
  listarMensajesBuzon,
  estadoBuzon,
  listarPendientes,
  ultimaAuditoria,
  procesarMensaje,
  procesarBuzon,
  listarPropuestas,
  verPropuesta,
  listarContratos,
  consultarContrato,
  reporteVencimientosTool,
  reiniciarDemo,
] as const;

export type ToolName = (typeof TOOLS)[number]["name"];
