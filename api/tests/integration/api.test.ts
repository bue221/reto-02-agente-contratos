import { beforeAll, describe, expect, test } from "bun:test";
import type { Hono } from "hono";
import { AgenteContratos } from "../../src/agent/loop.ts";
import { SesionesEnArchivo } from "../../src/agent/sessions.ts";
import { crearApp } from "../../src/http/app.ts";
import type { ErrorApi, RespuestaChat, Salud, SesionPublica } from "../../src/http/types.ts";
import { leerConfiguracion } from "../../src/config.ts";
import { crearProveedor } from "../../src/llm/factory.ts";
import { HOY, crearProyecto } from "../helpers.ts";

const CLAVE_FALSA = "AIza-clave-falsa-de-prueba";

async function appDePrueba(entorno: Record<string, string> = {}): Promise<Hono> {
  const ctx = await crearProyecto();
  const config = leerConfiguracion(entorno);
  const sesiones = new SesionesEnArchivo(ctx.directory);
  const agente = new AgenteContratos({
    proveedor: crearProveedor(config),
    sesiones,
    directorio: ctx.directory,
    limites: { maxIteraciones: 25, maxTokensSesion: 1000, maxTokensProceso: 10_000 },
    cargarSistema: async () => "sistema",
    hoy: HOY,
  });
  return crearApp({ agente, sesiones, directorio: ctx.directory, origenesCors: config.origenesCors });
}

const postChat = (app: Hono, cuerpo: unknown): Promise<Response> =>
  Promise.resolve(app.request("/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(cuerpo) }));

describe("API del chat", () => {
  let app: Hono;

  beforeAll(async () => {
    app = await appDePrueba();
  });

  test("GET /api/health informa proveedor y modelo sin clave", async () => {
    const respuesta = await app.request("/api/health");
    expect(respuesta.status).toBe(200);
    expect((await respuesta.json()) as Salud).toEqual({ ok: true, provider: "offline", model: "guion-determinista" });
  });

  test("GET /api/health nunca expone la clave de Gemini", async () => {
    const conClave = await appDePrueba({ GOOGLE_API_KEY: CLAVE_FALSA });
    const texto = await (await conClave.request("/api/health")).text();
    expect(JSON.parse(texto)).toEqual({ ok: true, provider: "gemini", model: "gemini-2.5-flash" });
    expect(texto).not.toContain(CLAVE_FALSA);
  });

  test("POST /api/chat valida el cuerpo con errores tipados", async () => {
    const respuesta = await postChat(app, { sessionId: "../etc", message: "" });
    expect(respuesta.status).toBe(400);
    const error = (await respuesta.json()) as ErrorApi;
    expect(error.ok).toBe(false);
    expect(error.error.codigo).toBe("peticion_invalida");
    expect(error.error.mensaje).toContain("sessionId");
    expect(error.error.mensaje).toContain("message");
  });

  test("POST /api/chat con JSON roto es 400, no 500", async () => {
    const respuesta = await app.request("/api/chat", { method: "POST", body: "{no es json" });
    expect(respuesta.status).toBe(400);
  });

  test("POST /api/chat devuelve reply, toolCalls y needsConfirmation", async () => {
    const respuesta = await postChat(app, { sessionId: "api-1", message: "Procesa el buzón con fecha de hoy 2026-09-03" });
    expect(respuesta.status).toBe(200);
    const chat = (await respuesta.json()) as RespuestaChat;
    expect(chat.needsConfirmation).toBe(true);
    expect(chat.reply).toContain("msg-006");
    expect(chat.toolCalls[0]).toEqual({ nombre: "contratos_leer_buzon", args: {}, ok: true, resumen: "6 pendientes: msg-001, msg-002, msg-003, msg-004, msg-005, msg-006" });
  });

  test("GET /api/sessions/:id devuelve el historial y 404 si no existe", async () => {
    const sesion = (await (await app.request("/api/sessions/api-1")).json()) as SesionPublica;
    expect(sesion.turnos).toHaveLength(1);
    expect(sesion.pendientesConfirmacion).toEqual(["msg-006"]);
    const inexistente = await app.request("/api/sessions/no-existe");
    expect(inexistente.status).toBe(404);
    expect(((await inexistente.json()) as ErrorApi).error.codigo).toBe("sesion_no_encontrada");
  });

  test("GET /api/maestro lista las filas del maestro de trabajo", async () => {
    const { filas } = (await (await app.request("/api/maestro")).json()) as { filas: { id_contrato: string }[] };
    expect(filas.map((fila) => fila.id_contrato)).toContain("CT-2026-015");
  });

  test("rutas desconocidas de la API responden 404 JSON", async () => {
    const respuesta = await app.request("/api/nada");
    expect(respuesta.status).toBe(404);
    expect(((await respuesta.json()) as ErrorApi).error.codigo).toBe("ruta_no_encontrada");
  });

  test("CORS solo autoriza los orígenes configurados", async () => {
    const conCors = await appDePrueba({ CORS_ORIGINS: "https://front.example.com" });
    const permitido = await conCors.request("/api/health", { headers: { origin: "https://front.example.com" } });
    const ajeno = await conCors.request("/api/health", { headers: { origin: "https://otro.example.com" } });
    expect(permitido.headers.get("access-control-allow-origin")).toBe("https://front.example.com");
    expect(ajeno.headers.get("access-control-allow-origin")).toBeNull();
    expect((await app.request("/api/health", { headers: { origin: "https://front.example.com" } })).headers.get("access-control-allow-origin")).toBeNull();
  });
});
