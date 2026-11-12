/**
 * Smoke del backend Hono in-process: contrato HTTP + flujo human-in-the-loop.
 */
process.env.GEMINI_FORCE_OFFLINE = "1";
process.env.LLM_PROVIDER = "offline";

const { createApp } = await import("./api/routes.ts");
const { resetDeps } = await import("./deps.ts");

resetDeps();
const app = createApp();

async function req(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: any }> {
  const init: RequestInit = { method, headers: { "Content-Type": "application/json" } };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await app.request(path, init);
  return { status: res.status, json: await res.json() };
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const health = await req("GET", "/health");
assert(health.status === 200 && health.json.ok, "health");

const b0 = await req("GET", "/v1/buzon");
assert(b0.json.total === 6 && b0.json.pendientes === 6, `buzon inicial ${JSON.stringify(b0.json)}`);
assert(
  b0.json.correos.length === 6 &&
    b0.json.correos.every((c: any) => c.estado === "SIN_ANALIZAR" && c.asunto && c.de),
  "listado de correos con asunto/remitente y estado SIN_ANALIZAR",
);
const maestroInicial = (await req("GET", "/v1/contratos")).json.contratos.length;

// Detalle de correo (solo lectura) + validación de id.
const d0 = await req("GET", "/v1/buzon/msg-006");
assert(d0.status === 200, "detalle msg-006");
assert(d0.json.correo.cuerpo && d0.json.correo.adjuntos[0]?.texto, "cuerpo + texto de adjunto");
assert(d0.json.timeline.length === 7 && d0.json.propuesta === null, "timeline vacío sin analizar");
assert((await req("GET", "/v1/buzon/msg-999")).status === 404, "correo inexistente → 404");
assert((await req("GET", "/v1/buzon/abc")).status === 400, "id inválido → 400");

// Descarga del maestro CSV.
const csvRes = await app.request("/v1/contratos.csv");
const csvTexto = await csvRes.text();
assert(csvRes.status === 200, "csv 200");
assert(csvRes.headers.get("content-type")?.startsWith("text/csv"), "content-type text/csv");
assert(csvTexto.startsWith("id_contrato,cliente,nit"), "csv con cabecera del maestro");

// 1. El agente analiza: crea propuesta, NO toca el maestro.
const proc = await req("POST", "/v1/buzon/msg-001/procesar");
assert(proc.status === 200, "procesar msg-001");
assert(proc.json.propuesta?.estado === "PENDIENTE", "propuesta pendiente");
assert(proc.json.propuesta?.recomendacion === "REGISTRAR_NUEVO", "recomienda registrar");
assert(
  (await req("GET", "/v1/contratos")).json.contratos.length === maestroInicial,
  "el maestro no cambia sin aprobación",
);

// 2. El chat no puede aprobar.
const chatAprobar = await req("POST", "/v1/chat/sync", {
  threadId: "smoke",
  message: "aprueba msg-001",
});
assert(/no puedo aprobar/i.test(chatAprobar.json.reply), `chat aprueba: ${chatAprobar.json.reply}`);
const chatBandeja = await req("POST", "/v1/chat/sync", {
  threadId: "smoke",
  message: "qué tengo por aprobar",
});
assert(/msg-001/.test(chatBandeja.json.reply), `chat bandeja: ${chatBandeja.json.reply}`);

// 3. El humano aprueba → se registra.
const ok1 = await req("POST", "/v1/propuestas/msg-001/aprobar", { aprobador: "smoke" });
assert(ok1.status === 200, `aprobar msg-001: ${JSON.stringify(ok1.json)}`);
assert(ok1.json.propuesta.estado === "APROBADA", "estado APROBADA");
assert(ok1.json.propuesta.resolucion.contratoId, "contrato registrado");
assert(
  (await req("GET", "/v1/contratos")).json.contratos.length === maestroInicial + 1,
  "maestro +1 tras aprobar",
);

const dobleAprobar = await req("POST", "/v1/propuestas/msg-001/aprobar", {});
assert(dobleAprobar.status === 409, "no se puede aprobar dos veces");

// 4. Baja confianza (msg-006): aprobar con correcciones inválidas → 400; válidas → registra.
await req("POST", "/v1/buzon/msg-006/procesar");
const p6 = (await req("GET", "/v1/propuestas/msg-006")).json.propuesta;
assert(p6.recomendacion === "REVISION_HUMANA", `msg-006 recomienda revisión: ${p6.recomendacion}`);

const malFecha = await req("POST", "/v1/propuestas/msg-006/aprobar", {
  correcciones: { fechaFin: "finales de diciembre" },
});
assert(malFecha.status === 400 && malFecha.json.code === "VALIDATION", "fecha inválida → 400");

const bloqueada = await req("POST", "/v1/propuestas/msg-006/aprobar", {
  correcciones: { nit: "12345", fechaFin: "2026-12-31" },
});
assert(
  bloqueada.status === 422 && bloqueada.json.code === "BLOQUEADO_POR_REGLAS",
  `NIT inválido debe bloquear: ${JSON.stringify(bloqueada.json)}`,
);
assert(
  (await req("GET", "/v1/propuestas/msg-006")).json.propuesta.estado === "PENDIENTE",
  "tras bloqueo la propuesta sigue pendiente",
);

const ok6 = await req("POST", "/v1/propuestas/msg-006/aprobar", {
  aprobador: "smoke",
  correcciones: { fechaFin: "2026-12-31" },
  comentario: "Fecha confirmada con el cliente",
});
assert(ok6.status === 200, `aprobar msg-006: ${JSON.stringify(ok6.json)}`);
assert(ok6.json.propuesta.extraccion.fechaFin.confianza === 1, "fecha corregida con confianza 1");

const d6 = await req("GET", "/v1/buzon/msg-006");
const paso = (id: string) => d6.json.timeline.find((t: any) => t.id === id);
assert(d6.json.estado === "APROBADA", "detalle refleja aprobación");
assert(paso("extraido").estado === "alerta", "timeline conserva la confianza baja original");
assert(paso("decision_humana").estado === "hecho" && paso("ejecutado").estado === "hecho", "timeline completo");
assert(
  d6.json.extraccionOriginal.fechaFin.confianza < 0.8,
  "extracción original del agente disponible",
);
const csvTras = await (await app.request("/v1/contratos.csv")).text();
assert(
  csvTras.includes(ok6.json.propuesta.resolucion.contratoId),
  "el CSV descargado incluye el contrato aprobado",
);

// 5. Rechazo humano: archiva sin tocar el maestro.
await req("POST", "/v1/buzon/msg-005/procesar");
const antesRechazo = (await req("GET", "/v1/contratos")).json.contratos.length;
const rech = await req("POST", "/v1/propuestas/msg-005/rechazar", { comentario: "Es cotización" });
assert(rech.status === 200 && rech.json.propuesta.estado === "RECHAZADA", "rechazar msg-005");
assert(
  (await req("GET", "/v1/contratos")).json.contratos.length === antesRechazo,
  "rechazo no toca el maestro",
);

const listado = await req("GET", "/v1/propuestas?estado=todas");
assert(listado.json.propuestas.length === 3, `3 propuestas: ${listado.json.propuestas.length}`);

const aud = await req("GET", "/v1/auditoria?msgId=msg-006");
assert(aud.json.item?.fase === "resolucion", "auditoría registra la resolución humana");

const report = await req("GET", "/v1/reportes/vencimientos");
assert(report.json.hoy && report.json.texto, "reporte");

const reset = await req("POST", "/v1/demo/reset");
assert(reset.json.buzon.pendientes === 6 && reset.json.buzon.porAprobar === 0, "reset");

console.log("smoke-api OK (HITL: propuesta → aprobación/rechazo humano → ejecución)");
