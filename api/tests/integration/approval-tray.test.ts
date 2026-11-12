import { describe, expect, test } from "bun:test";
import type { Hono } from "hono";
import { AgenteContratos } from "../../src/agent/loop.ts";
import { SesionesEnArchivo } from "../../src/agent/sessions.ts";
import { crearApp } from "../../src/http/app.ts";
import type {
  DetalleMensaje,
  ErrorApi,
  RespuestaBandeja,
  RespuestaBuzon,
  RespuestaChat,
  RespuestaDecision,
  RespuestaMaestro,
  RespuestaProcesar,
  RespuestaReinicio,
  SesionPublica,
} from "../../src/http/types.ts";
import type { ProveedorLlm } from "../../src/llm/adapter.ts";
import { ProveedorOffline } from "../../src/llm/offline.ts";
import { HOY, crearProyecto, leerSalida, lineasJson } from "../helpers.ts";

const PROMPT_DEMO = "Procesa el buzón de contratos con fecha de hoy 2026-09-03. No registres nada dudoso sin preguntarme.";
const CONFIRMACION = "confirmo el valor 0 y la fecha fin 2027-08-31";
const CORRECCIONES_006 = { valor: 0, fecha_fin: "2027-08-31" };

interface Prueba {
  app: Hono;
  directorio: string;
}

async function crearPrueba(proveedor: ProveedorLlm = new ProveedorOffline()): Promise<Prueba> {
  const ctx = await crearProyecto();
  const sesiones = new SesionesEnArchivo(ctx.directory);
  const agente = new AgenteContratos({
    proveedor,
    sesiones,
    directorio: ctx.directory,
    limites: { maxIteraciones: 25, maxTokensSesion: 1_000_000, maxTokensProceso: 10_000_000 },
    cargarSistema: async () => "sistema",
    hoy: HOY,
  });
  return { app: crearApp({ agente, sesiones, directorio: ctx.directory, hoy: HOY }), directorio: ctx.directory };
}

async function pedir<T>(app: Hono, ruta: string, cuerpo?: unknown): Promise<{ status: number; json: T }> {
  const init = cuerpo === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(cuerpo) };
  const respuesta = await app.request(ruta, init);
  return { status: respuesta.status, json: (await respuesta.json()) as T };
}

const post = <T>(app: Hono, ruta: string, cuerpo: unknown = {}) => pedir<T>(app, ruta, cuerpo);
const estados = (buzon: RespuestaBuzon): Record<string, string> => Object.fromEntries(buzon.mensajes.map((mensaje) => [mensaje.id, mensaje.estado]));
const chat = (app: Hono, sessionId: string, message: string) => post<RespuestaChat>(app, "/api/chat", { sessionId, message });

describe("buzón (HITL)", () => {
  test("GET /api/buzon lista los 6 mensajes pendientes con contadores", async () => {
    const { app } = await crearPrueba();
    const { status, json } = await pedir<RespuestaBuzon>(app, "/api/buzon");
    expect(status).toBe(200);
    expect(json.contadores).toEqual({ total: 6, pendientes: 6, requiere_revision: 0, procesados: 0 });
    expect(new Set(Object.values(estados(json)))).toEqual(new Set(["pendiente"]));
    expect(json.mensajes.find((mensaje) => mensaje.id === "msg-005")?.tiene_contrato).toBe(false);
  });

  test("GET /api/buzon/:id sin analizar muestra correo y adjuntos, sin extracción, y 7 pasos", async () => {
    const { app } = await crearPrueba();
    const { json } = await pedir<DetalleMensaje>(app, "/api/buzon/msg-001");
    expect(json.mensaje.estado).toBe("pendiente");
    expect(json.extraccion).toBeNull();
    expect(json.adjuntos.find((adjunto) => adjunto.es_contrato)?.texto).toContain("CONTRATO");
    expect(json.linea_tiempo).toHaveLength(7);
    expect(json.linea_tiempo.find((paso) => paso.id === "registro")?.estado).toBe("pendiente");
  });

  test("GET /api/buzon/:id desconocido o malicioso responde 404 tipado", async () => {
    const { app } = await crearPrueba();
    for (const id of ["msg-999", "..%2F..%2Fetc"]) {
      const { status, json } = await pedir<ErrorApi>(app, `/api/buzon/${id}`);
      expect(status).toBe(404);
      expect(json.error.codigo).toBe("mensaje_no_encontrado");
    }
  });

  test("POST /api/buzon/:id/procesar registra un caso limpio y no lo reprocesa", async () => {
    const { app } = await crearPrueba();
    const { status, json } = await post<RespuestaProcesar>(app, "/api/buzon/msg-001/procesar");
    expect(status).toBe(200);
    expect(json.mensaje).toMatchObject({ estado: "registrado", id_contrato: "CT-2026-015", clasificacion: "nuevo" });
    const otraVez = await post<ErrorApi>(app, "/api/buzon/msg-001/procesar");
    expect(otraVez.status).toBe(409);
    expect(otraVez.json.error.codigo).toBe("ya_procesado");
  });

  test("el detalle de un mensaje registrado trae extracción con confianza, validación, fila, historial y log", async () => {
    const { app } = await crearPrueba();
    await post(app, "/api/buzon/msg-001/procesar");
    const { json } = await pedir<DetalleMensaje>(app, "/api/buzon/msg-001");
    expect(json.extraccion?.id_contrato).toMatchObject({ valor: "CT-2026-015" });
    expect(json.extraccion?.valor.confianza).toBeGreaterThanOrEqual(0.8);
    expect(json.validacion).toMatchObject({ clasificacion: "nuevo", requiere_revision: [] });
    expect(json.fila?.estado_poliza).toBe("pendiente");
    expect(json.historial[0]?.accion).toBe("insertado");
    expect(json.log.map((entrada) => entrada.herramienta)).toEqual(["contratos_extraer", "contratos_validar", "contratos_registrar"]);
    expect(json.linea_tiempo.map((paso) => paso.estado)).toEqual(["hecho", "hecho", "hecho", "hecho", "omitido", "hecho", "hecho"]);
  });

  test("duplicado y rechazado se cierran sin escribir el maestro", async () => {
    const { app } = await crearPrueba();
    await post(app, "/api/buzon/msg-004/procesar");
    await post(app, "/api/buzon/msg-005/procesar");
    const { json } = await pedir<RespuestaBuzon>(app, "/api/buzon");
    expect(estados(json)).toMatchObject({ "msg-004": "duplicado", "msg-005": "rechazado" });
    expect(json.contadores.procesados).toBe(2);
  });
});

describe("bandeja de aprobación (HITL)", () => {
  test("msg-006 procesado desde el buzón queda en la bandeja con sus campos en revisión", async () => {
    const { app } = await crearPrueba();
    const procesado = await post<RespuestaProcesar>(app, "/api/buzon/msg-006/procesar");
    expect(procesado.json.mensaje.estado).toBe("requiere_revision");
    const { json } = await pedir<RespuestaBandeja>(app, "/api/bandeja");
    expect(json.pendientes.map((item) => item.mensaje.id)).toEqual(["msg-006"]);
    expect(json.pendientes[0]?.validacion.requiere_revision).toEqual(["valor", "fecha_inicio", "fecha_fin"]);
    expect(json.pendientes[0]?.contrato.valor.confianza).toBeLessThan(0.8);
  });

  test("aprobar con correcciones registra msg-006 con valor 0 y fecha_fin 2027-08-31", async () => {
    const { app, directorio } = await crearPrueba();
    await post(app, "/api/buzon/msg-006/procesar");
    const { status, json } = await post<RespuestaDecision>(app, "/api/bandeja/msg-006/aprobar", { aprobador: "Ana", correcciones: CORRECCIONES_006 });
    expect(status).toBe(200);
    expect(json.mensaje.estado).toBe("registrado");
    expect(json.decision).toMatchObject({ decision: "aprobado", via: "bandeja", aprobador: "Ana", correcciones: CORRECCIONES_006, id_contrato: "CM-2026-03", accion: "insertado" });
    const { json: maestro } = await pedir<RespuestaMaestro>(app, "/api/maestro");
    expect(maestro.filas.find((fila) => fila.id_contrato === "CM-2026-03")).toMatchObject({ valor: 0, fecha_fin: "2027-08-31" });
    const bandeja = (await pedir<RespuestaBandeja>(app, "/api/bandeja")).json;
    expect(bandeja.pendientes).toEqual([]);
    expect(bandeja.resueltas[0]?.mensaje_id).toBe("msg-006");
    const log = lineasJson(await leerSalida({ directory: directorio, sessionId: "t" }, "log.jsonl")).filter((entrada) => entrada.mensaje_id === "msg-006");
    expect(log.map((entrada) => entrada.herramienta)).toContain("bandeja_aprobar");
    expect(log.find((entrada) => entrada.herramienta === "contratos_registrar" && entrada.ok)?.resumen).toBe("insertado CM-2026-03");
  });

  test("aprobar un mensaje que no espera confirmación es 409", async () => {
    const { app } = await crearPrueba();
    const sinAnalizar = await post<ErrorApi>(app, "/api/bandeja/msg-002/aprobar", { aprobador: "Ana" });
    expect(sinAnalizar.status).toBe(409);
    expect(sinAnalizar.json.error.codigo).toBe("no_pendiente");
    const inexistente = await post<ErrorApi>(app, "/api/bandeja/msg-999/aprobar", { aprobador: "Ana" });
    expect(inexistente.status).toBe(404);
  });

  test("rechazar cierra el mensaje con motivo, sin tocar el maestro, y queda trazado", async () => {
    const { app, directorio } = await crearPrueba();
    await post(app, "/api/buzon/msg-006/procesar");
    const { status, json } = await post<RespuestaDecision>(app, "/api/bandeja/msg-006/rechazar", { aprobador: "Luis", motivo: "Falta la firma del cliente" });
    expect(status).toBe(200);
    expect(json.mensaje).toMatchObject({ estado: "rechazado", decidido_por: "Luis" });
    expect(json.decision).toMatchObject({ decision: "rechazado", motivo: "Falta la firma del cliente" });
    const { json: maestro } = await pedir<RespuestaMaestro>(app, "/api/maestro");
    expect(maestro.filas.some((fila) => fila.id_contrato === "CM-2026-03")).toBe(false);
    const log = await leerSalida({ directory: directorio, sessionId: "t" }, "log.jsonl");
    expect(log).toContain('"herramienta":"bandeja_rechazar"');
    const detalle = (await pedir<DetalleMensaje>(app, "/api/buzon/msg-006")).json;
    expect(detalle.linea_tiempo.find((paso) => paso.id === "revision")?.detalle).toContain("Luis (bandeja): rechazado");
  });

  test("cuerpos inválidos responden 400 con errores de zod legibles", async () => {
    const { app } = await crearPrueba();
    await post(app, "/api/buzon/msg-006/procesar");
    const aprobar = await post<ErrorApi>(app, "/api/bandeja/msg-006/aprobar", { aprobador: " ", correcciones: { valor: "cero", inventado: 1 } });
    expect(aprobar.status).toBe(400);
    expect(aprobar.json.error.codigo).toBe("peticion_invalida");
    expect(aprobar.json.error.mensaje).toContain("aprobador");
    expect(aprobar.json.error.mensaje).toContain("correcciones.valor");
    expect(aprobar.json.error.mensaje).toContain("inventado");
    const rechazar = await post<ErrorApi>(app, "/api/bandeja/msg-006/rechazar", {});
    expect(rechazar.json.error.mensaje).toBe("aprobador: indica quién decide; motivo: el rechazo necesita un motivo");
    const roto = await app.request("/api/bandeja/msg-006/aprobar", { method: "POST", body: "{no es json" });
    expect(roto.status).toBe(400);
    expect((await pedir<RespuestaBandeja>(app, "/api/bandeja")).json.pendientes).toHaveLength(1);
  });
});

describe("chat y bandeja comparten la misma verdad", () => {
  test("lo que el chat deja en revisión aparece en la bandeja y su confirmación lo saca", async () => {
    const { app } = await crearPrueba();
    expect((await chat(app, "c1", PROMPT_DEMO)).json.needsConfirmation).toBe(true);
    expect((await pedir<RespuestaBandeja>(app, "/api/bandeja")).json.pendientes.map((item) => item.mensaje.id)).toEqual(["msg-006"]);
    expect((await chat(app, "c1", CONFIRMACION)).json.toolCalls[0]?.ok).toBe(true);
    const bandeja = (await pedir<RespuestaBandeja>(app, "/api/bandeja")).json;
    expect(bandeja.pendientes).toEqual([]);
    expect(bandeja.resueltas[0]).toMatchObject({ mensaje_id: "msg-006", via: "chat", aprobador: "chat c1", id_contrato: "CM-2026-03" });
    expect(estados((await pedir<RespuestaBuzon>(app, "/api/buzon")).json)["msg-006"]).toBe("registrado");
  });

  test("lo aprobado en la bandeja deja de esperar confirmación en el chat y no se registra dos veces", async () => {
    const { app } = await crearPrueba();
    await chat(app, "c2", PROMPT_DEMO);
    await post(app, "/api/bandeja/msg-006/aprobar", { aprobador: "Ana", correcciones: CORRECCIONES_006 });
    const respuesta = (await chat(app, "c2", CONFIRMACION)).json;
    expect(respuesta.toolCalls[0]).toMatchObject({ nombre: "contratos_registrar", ok: false });
    expect(respuesta.toolCalls[0]?.resumen).toContain("ya fue procesado (registrado CM-2026-03)");
    expect((await pedir<SesionPublica>(app, "/api/sessions/c2")).json.pendientesConfirmacion).toEqual([]);
    const { json: maestro } = await pedir<RespuestaMaestro>(app, "/api/maestro");
    expect(maestro.filas.filter((fila) => fila.id_contrato === "CM-2026-03")).toHaveLength(1);
  });
});

describe("reinicio de la demo", () => {
  test("POST /api/demo/reset vacía out/, sesiones y bandeja y deja el buzón limpio", async () => {
    const { app } = await crearPrueba();
    await chat(app, "c3", PROMPT_DEMO);
    const { status, json } = await post<RespuestaReinicio>(app, "/api/demo/reset");
    expect(status).toBe(200);
    expect(json).toEqual({ ok: true, mensajes: 6 });
    expect((await pedir<RespuestaBuzon>(app, "/api/buzon")).json.contadores).toEqual({ total: 6, pendientes: 6, requiere_revision: 0, procesados: 0 });
    expect((await pedir<RespuestaBandeja>(app, "/api/bandeja")).json).toEqual({ pendientes: [], resueltas: [] });
    expect((await app.request("/api/sessions/c3")).status).toBe(404);
    const { json: maestro } = await pedir<RespuestaMaestro>(app, "/api/maestro");
    expect(maestro.filas.some((fila) => fila.id_contrato === "CT-2026-015")).toBe(false);
  });

  test("el reinicio espera a que termine el turno de chat en curso", async () => {
    const offline = new ProveedorOffline();
    const iniciado = Promise.withResolvers<void>();
    const liberar = Promise.withResolvers<void>();
    const lento: ProveedorLlm = {
      nombre: offline.nombre,
      modelo: offline.modelo,
      async enviar(mensajes, herramientas) {
        iniciado.resolve();
        await liberar.promise;
        return offline.enviar(mensajes, herramientas);
      },
    };
    const { app } = await crearPrueba(lento);
    const turno = chat(app, "c4", PROMPT_DEMO);
    await iniciado.promise;
    let reiniciado = false;
    const reinicio = post<RespuestaReinicio>(app, "/api/demo/reset").then(() => (reiniciado = true));
    await Bun.sleep(20);
    expect(reiniciado).toBe(false);
    liberar.resolve();
    expect((await turno).json.needsConfirmation).toBe(true);
    await reinicio;
    expect((await pedir<RespuestaBuzon>(app, "/api/buzon")).json.contadores.pendientes).toBe(6);
  });

  test("GET /api/maestro.csv descarga el maestro de trabajo", async () => {
    const { app } = await crearPrueba();
    const respuesta = await app.request("/api/maestro.csv");
    expect(respuesta.headers.get("content-type")).toContain("text/csv");
    expect(respuesta.headers.get("content-disposition")).toContain("maestro-contratos.csv");
    expect((await respuesta.text()).split("\n")[0]).toStartWith("id_contrato,cliente,nit_cliente");
  });
});
