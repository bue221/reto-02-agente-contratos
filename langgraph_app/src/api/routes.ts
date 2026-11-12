/**
 * REST + chat: entrada HTTP al mismo núcleo (tools / pipeline / HITL).
 * El frontend consume esto; no importa LangGraph.
 *
 * Human-in-the-loop: el agente solo crea propuestas. Las rutas
 * /v1/propuestas/:id/aprobar|rechazar son la única vía para ejecutar cambios.
 */
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import type { ZodType } from "zod";
import { getLlm } from "../adapters/llm/index.ts";
import { chatTurn } from "../agent/chat-graph.ts";
import { detalleCorreo, listarCorreos } from "../buzon/vista.ts";
import {
  AprobarRequestSchema,
  ChatRequestSchema,
  EstadoPropuestaSchema,
  MsgIdSchema,
  RechazarRequestSchema,
} from "../domain/schemas.ts";
import { getAudit, getCfg, getMailbox, getPropuestas, getRepo, resetDeps } from "../deps.ts";
import { resolverPropuesta } from "../hitl/service.ts";
import { formatearReporte, reporteVencimientos } from "../report.ts";
import {
  ejecutarPipelineBuzon,
  ejecutarPipelineMensaje,
  formatearEstadoBuzon,
  formatearUltimaAuditoria,
} from "../tools/contratos.ts";
import { ApiError, toErrorBody } from "./errors.ts";

async function leerBody<T>(c: Context, schema: ZodType<T>): Promise<T> {
  const texto = await c.req.text();
  let raw: unknown = {};
  if (texto.trim()) {
    try {
      raw = JSON.parse(texto);
    } catch {
      throw new ApiError("BAD_JSON", "Body JSON inválido");
    }
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const detalle = parsed.error.issues
      .map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message))
      .join("; ");
    throw new ApiError("VALIDATION", detalle || "Body inválido");
  }
  return parsed.data;
}

function leerMsgId(c: Context): string {
  const parsed = MsgIdSchema.safeParse(c.req.param("id"));
  if (!parsed.success) throw new ApiError("VALIDATION", "Id inválido: usa msg-001");
  return parsed.data.toLowerCase();
}

function estadoBuzonJson() {
  const mb = getMailbox();
  const stats = mb.stats();
  return {
    total: stats.total,
    procesados: stats.procesados,
    pendientes: stats.pendientes,
    porAprobar: getPropuestas().list("PENDIENTE").length,
    ids: mb.listIds(),
    idsPendientes: mb.listPending(),
    idsProcesados: mb.listProcessed(),
    correos: listarCorreos(),
    resumen: formatearEstadoBuzon(),
  };
}

export function createApp() {
  const app = new Hono();

  app.use(
    "*",
    cors({
      origin: "*",
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: ["Content-Type"],
    }),
  );

  app.onError((err, c) => {
    const body = toErrorBody(err);
    return c.json(
      { error: body.error, code: body.code, ...(body.details ? { details: body.details } : {}) },
      body.status as 400,
    );
  });

  app.get("/health", (c) => {
    const llm = getLlm();
    return c.json({
      ok: true,
      service: "agente-contratos",
      hoy: getCfg().hoy,
      llm: { provider: llm.providerId, documents: llm.documents.id, chat: llm.chat.id },
    });
  });

  /** Chat agentico con memoria por threadId. Respuesta SSE + evento final. */
  app.post("/v1/chat", async (c) => {
    const body = await leerBody(c, ChatRequestSchema);
    const threadId = (body.threadId ?? crypto.randomUUID()).trim();
    return streamSSE(c, async (stream) => {
      await stream.writeSSE({ event: "start", data: JSON.stringify({ threadId }) });
      try {
        const result = await chatTurn(threadId, body.message.trim());
        await stream.writeSSE({ event: "token", data: JSON.stringify({ text: result.reply }) });
        await stream.writeSSE({
          event: "done",
          data: JSON.stringify({
            threadId: result.threadId,
            reply: result.reply,
            propuestaIds: result.propuestaIds,
          }),
        });
      } catch (err) {
        const e = toErrorBody(err);
        await stream.writeSSE({
          event: "error",
          data: JSON.stringify({ error: e.error, code: e.code }),
        });
      }
    });
  });

  /** Variante JSON (sin SSE) para clientes simples / smoke. */
  app.post("/v1/chat/sync", async (c) => {
    const body = await leerBody(c, ChatRequestSchema);
    const threadId = (body.threadId ?? crypto.randomUUID()).trim();
    const result = await chatTurn(threadId, body.message.trim());
    return c.json({
      threadId: result.threadId,
      reply: result.reply,
      propuestaIds: result.propuestaIds,
    });
  });

  app.get("/v1/buzon", (c) => c.json(estadoBuzonJson()));

  /** Correo completo (cuerpo + texto de adjuntos) + propuesta + timeline. Solo lectura. */
  app.get("/v1/buzon/:id", (c) => c.json(detalleCorreo(leerMsgId(c))));

  /** Analiza un correo: crea (o devuelve) su propuesta. No ejecuta. */
  app.post("/v1/buzon/:id/procesar", async (c) => {
    const id = leerMsgId(c);
    const resultado = await ejecutarPipelineMensaje(id);
    return c.json({
      msgId: id,
      resultado,
      propuesta: getPropuestas().get(id),
      buzon: estadoBuzonJson(),
    });
  });

  app.post("/v1/buzon/procesar-todo", async (c) => {
    const resultado = await ejecutarPipelineBuzon();
    return c.json({
      resultado,
      propuestas: getPropuestas().list("PENDIENTE"),
      buzon: estadoBuzonJson(),
    });
  });

  app.get("/v1/propuestas", (c) => {
    const raw = c.req.query("estado");
    let estado: ReturnType<typeof EstadoPropuestaSchema.parse> | undefined;
    if (raw && raw.toUpperCase() !== "TODAS") {
      const parsed = EstadoPropuestaSchema.safeParse(raw.toUpperCase());
      if (!parsed.success) {
        throw new ApiError("VALIDATION", "estado debe ser PENDIENTE, APROBADA, RECHAZADA o TODAS");
      }
      estado = parsed.data;
    }
    return c.json({ propuestas: getPropuestas().list(estado) });
  });

  app.get("/v1/propuestas/:id", (c) => {
    const id = leerMsgId(c);
    const propuesta = getPropuestas().get(id);
    if (!propuesta) throw new ApiError("NOT_FOUND", `No hay propuesta para ${id}`, 404);
    return c.json({ propuesta });
  });

  /** Decisión humana: aprobar (con correcciones opcionales). Rules.ts revalida. */
  app.post("/v1/propuestas/:id/aprobar", async (c) => {
    const id = leerMsgId(c);
    const body = await leerBody(c, AprobarRequestSchema);
    const { propuesta, texto } = await resolverPropuesta(id, { accion: "aprobar", ...body });
    return c.json({ propuesta, texto, buzon: estadoBuzonJson() });
  });

  /** Decisión humana: rechazar. Archiva sin tocar el maestro. */
  app.post("/v1/propuestas/:id/rechazar", async (c) => {
    const id = leerMsgId(c);
    const body = await leerBody(c, RechazarRequestSchema);
    const { propuesta, texto } = await resolverPropuesta(id, { accion: "rechazar", ...body });
    return c.json({ propuesta, texto, buzon: estadoBuzonJson() });
  });

  app.get("/v1/contratos", (c) => c.json({ contratos: getRepo().all() }));

  /** Descarga del maestro de trabajo (no el seed). */
  app.get("/v1/contratos.csv", (c) => {
    c.header("Content-Type", "text/csv; charset=utf-8");
    c.header("Content-Disposition", 'attachment; filename="maestro-contratos.csv"');
    return c.body(getRepo().rawCsv());
  });

  app.get("/v1/contratos/:id", (c) => {
    const id = c.req.param("id");
    const contrato = getRepo().findById(id);
    if (!contrato) throw new ApiError("NOT_FOUND", `No existe ${id}`, 404);
    return c.json({ contrato });
  });

  app.get("/v1/reportes/vencimientos", (c) => {
    const cfg = getCfg();
    const reporte = reporteVencimientos(getRepo().all(), cfg.hoy);
    return c.json({ hoy: cfg.hoy, reporte, texto: formatearReporte(reporte) });
  });

  app.get("/v1/auditoria", (c) => {
    const limit = Number(c.req.query("limit") ?? "20");
    const msgId = c.req.query("msgId") ?? undefined;
    if (msgId) {
      const last = getAudit().last(msgId);
      return c.json({
        item: last ? getAudit().summarize(last) : null,
        texto: formatearUltimaAuditoria(msgId),
      });
    }
    const items = getAudit()
      .list(Number.isFinite(limit) ? limit : 20)
      .map((r) => getAudit().summarize(r));
    return c.json({ items, texto: formatearUltimaAuditoria() });
  });

  app.post("/v1/demo/reset", (c) => {
    resetDeps();
    return c.json({
      ok: true,
      message: "Maestro, auditoría, propuestas y buzón restablecidos",
      buzon: estadoBuzonJson(),
    });
  });

  return app;
}
