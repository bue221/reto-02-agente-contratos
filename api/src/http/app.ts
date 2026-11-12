import { existsSync } from "node:fs";
import { join, relative } from "node:path";
import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { cors } from "hono/cors";
import { z } from "zod";
import type { AgenteContratos } from "../agent/loop.ts";
import { type AlmacenSesiones, ID_SESION, type Sesion } from "../agent/sessions.ts";
import { AccesoOut } from "../infrastructure/out-lock.ts";
import { leerMaestro } from "../infrastructure/master-store.ts";
import { rutasDelProyecto } from "../infrastructure/paths.ts";
import { mensajeDeError } from "../core/domain/result.ts";
import { type DependenciasHitl, rutasHitl } from "./hitl.ts";
import { errorApi, leerCuerpo } from "./helpers.ts";
import type { PeticionChat, RespuestaChat, RespuestaMaestro, Salud } from "./types.ts";

/** API HTTP (PRD 6.4): chat, buzón y bandeja. Sin estado propio: delega en el agente, los casos de uso y el almacén. */

export interface DependenciasApi {
  agente: Pick<AgenteContratos, "conversar" | "proveedor">;
  sesiones: AlmacenSesiones;
  directorio: string;
  /** Carpeta del front compilado; si no existe, solo se expone la API. */
  webDist?: string;
  origenesCors?: string[];
  /** Coordina el acceso a `out/` entre turnos, bandeja y reinicio; por defecto uno por app. */
  acceso?: AccesoOut;
  /** Fecha de registro fija para tests deterministas. */
  hoy?: string;
}

const MAX_LONGITUD_MENSAJE = 4000;

const PeticionChatSchema = z.object({
  sessionId: z.string().regex(ID_SESION, "solo letras, números, '-' y '_' (máx. 64)"),
  message: z.string().trim().min(1, "el mensaje no puede estar vacío").max(MAX_LONGITUD_MENSAJE, `máx. ${MAX_LONGITUD_MENSAJE} caracteres`),
}) satisfies z.ZodType<PeticionChat>;

function rutasDelChat(app: Hono, deps: DependenciasApi, acceso: AccesoOut): void {
  app.get("/api/health", (c) => c.json<Salud>({ ok: true, provider: deps.agente.proveedor.nombre, model: deps.agente.proveedor.modelo }));

  app.post("/api/chat", async (c) => {
    const peticion = await leerCuerpo(c, PeticionChatSchema);
    if (!peticion.ok) return peticion.respuesta;
    const { sessionId, message } = peticion.data;
    return c.json<RespuestaChat>(await acceso.compartido(() => deps.agente.conversar(sessionId, message)));
  });

  app.get("/api/sessions/:id", async (c) => {
    const sesion = await deps.sesiones.obtener(c.req.param("id"));
    return sesion ? c.json<Sesion>(sesion) : c.json(errorApi("sesion_no_encontrada", `no existe la sesión ${c.req.param("id")}`), 404);
  });

  app.get("/api/maestro", async (c) => c.json<RespuestaMaestro>({ filas: await acceso.compartido(() => leerMaestro(rutasDelProyecto(deps.directorio))) }));
}

/** En producción el mismo proceso sirve el front compilado (un solo despliegue); rutas desconocidas → SPA. */
function frontEstatico(app: Hono, webDist: string): void {
  if (!existsSync(join(webDist, "index.html"))) return;
  const raiz = relative(process.cwd(), webDist) || ".";
  app.use("/*", serveStatic({ root: raiz }));
  app.get("*", serveStatic({ path: join(raiz, "index.html") }));
}

export function crearApp(deps: DependenciasApi): Hono {
  const app = new Hono();
  const acceso = deps.acceso ?? new AccesoOut();
  app.onError((error, c) => {
    console.error(`[api] ${c.req.method} ${c.req.path}: ${mensajeDeError(error)}`);
    return c.json(errorApi("error_interno", "Error interno del servidor. Revisa los logs del backend."), 500);
  });
  if (deps.origenesCors?.length) app.use("/api/*", cors({ origin: deps.origenesCors }));
  rutasDelChat(app, deps, acceso);
  const hitl: DependenciasHitl = { directorio: deps.directorio, sesiones: deps.sesiones, acceso, ...(deps.hoy ? { hoy: deps.hoy } : {}) };
  rutasHitl(app, hitl);
  app.all("/api/*", (c) => c.json(errorApi("ruta_no_encontrada", `${c.req.method} ${c.req.path} no existe`), 404));
  if (deps.webDist) frontEstatico(app, deps.webDist);
  return app;
}
