import { existsSync } from "node:fs";
import { join, relative } from "node:path";
import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { cors } from "hono/cors";
import { z } from "zod";
import type { AgenteContratos } from "../agente/ciclo.ts";
import { type AlmacenSesiones, ID_SESION, type Sesion } from "../agente/sesiones.ts";
import { leerMaestro } from "../almacen/maestro.ts";
import { rutasDelProyecto } from "../almacen/rutas.ts";
import { mensajeDeError } from "../dominio/resultado.ts";
import type { FilaMaestro } from "../dominio/maestro.ts";
import { describirErroresZod } from "../tools/herramienta.ts";
import type { ErrorApi, PeticionChat, RespuestaChat, Salud } from "./tipos.ts";

/** API HTTP del chat (PRD 6.4). Sin estado propio: delega en el agente y el almacén de sesiones. */

export interface DependenciasApi {
  agente: Pick<AgenteContratos, "conversar" | "proveedor">;
  sesiones: AlmacenSesiones;
  directorio: string;
  /** Carpeta del front compilado; si no existe, solo se expone la API. */
  webDist?: string;
  origenesCors?: string[];
}

const MAX_LONGITUD_MENSAJE = 4000;

const PeticionChatSchema = z.object({
  sessionId: z.string().regex(ID_SESION, "solo letras, números, '-' y '_' (máx. 64)"),
  message: z.string().trim().min(1, "el mensaje no puede estar vacío").max(MAX_LONGITUD_MENSAJE, `máx. ${MAX_LONGITUD_MENSAJE} caracteres`),
}) satisfies z.ZodType<PeticionChat>;

const errorApi = (codigo: string, mensaje: string): ErrorApi => ({ ok: false, error: { codigo, mensaje } });

function rutasDeApi(app: Hono, deps: DependenciasApi): void {
  app.get("/api/health", (c) => c.json<Salud>({ ok: true, provider: deps.agente.proveedor.nombre, model: deps.agente.proveedor.modelo }));

  app.post("/api/chat", async (c) => {
    const cuerpo: unknown = await c.req.json().catch(() => null);
    const peticion = PeticionChatSchema.safeParse(cuerpo);
    if (!peticion.success) return c.json(errorApi("peticion_invalida", describirErroresZod(peticion.error)), 400);
    return c.json<RespuestaChat>(await deps.agente.conversar(peticion.data.sessionId, peticion.data.message));
  });

  app.get("/api/sessions/:id", async (c) => {
    const sesion = await deps.sesiones.obtener(c.req.param("id"));
    return sesion ? c.json<Sesion>(sesion) : c.json(errorApi("sesion_no_encontrada", `no existe la sesión ${c.req.param("id")}`), 404);
  });

  app.get("/api/maestro", async (c) => c.json<{ filas: FilaMaestro[] }>({ filas: await leerMaestro(rutasDelProyecto(deps.directorio)) }));

  app.all("/api/*", (c) => c.json(errorApi("ruta_no_encontrada", `${c.req.method} ${c.req.path} no existe`), 404));
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
  app.onError((error, c) => {
    console.error(`[api] ${c.req.method} ${c.req.path}: ${mensajeDeError(error)}`);
    return c.json(errorApi("error_interno", "Error interno del servidor. Revisa los logs del backend."), 500);
  });
  if (deps.origenesCors?.length) app.use("/api/*", cors({ origin: deps.origenesCors }));
  rutasDeApi(app, deps);
  if (deps.webDist) frontEstatico(app, deps.webDist);
  return app;
}
