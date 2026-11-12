import type { Hono } from "hono";
import { z } from "zod";
import { CerrojoPorSesion } from "../agente/sesiones.ts";
import { leerMaestroCsv } from "../almacen/maestro.ts";
import { rutasDelProyecto } from "../almacen/rutas.ts";
import { detalleMensaje, listarBandeja, listarBuzon } from "../casos/vista-buzon.ts";
import { CorreccionesSchema } from "../dominio/contrato.ts";
import { aprobar, procesarDesdeBuzon, rechazar } from "../flujo/bandeja.ts";
import type { ContextoHerramienta } from "../tools/herramienta.ts";
import { leerCuerpo, responder } from "./http.ts";
import type { PeticionAprobar, PeticionRechazar, RespuestaBandeja, RespuestaBuzon } from "./tipos.ts";

/** Rutas human-in-the-loop: buzón, bandeja de aprobación y descarga del maestro. */

export interface DependenciasHitl {
  directorio: string;
  /** Fecha de registro fija para tests deterministas. */
  hoy?: string;
}

const AprobadorSchema = z.string().trim().min(1, "indica quién decide").max(80, "máx. 80 caracteres");

const PeticionAprobarSchema = z.object({
  aprobador: AprobadorSchema,
  correcciones: CorreccionesSchema.default({}),
}) satisfies z.ZodType<Required<PeticionAprobar>>;

const PeticionRechazarSchema = z.object({
  aprobador: AprobadorSchema,
  motivo: z.string().trim().min(1, "el rechazo necesita un motivo").max(500, "máx. 500 caracteres"),
}) satisfies z.ZodType<PeticionRechazar>;

const SESION_BANDEJA = "bandeja";

export function rutasHitl(app: Hono, deps: DependenciasHitl): void {
  const rutas = rutasDelProyecto(deps.directorio);
  const ctx: ContextoHerramienta = { directory: deps.directorio, sessionId: SESION_BANDEJA, ...(deps.hoy ? { hoy: deps.hoy } : {}) };
  const cerrojo = new CerrojoPorSesion();
  // Las acciones de la bandeja leen y reescriben los mismos JSON de out/: se aplican de a una.
  const decidir = <T>(tarea: () => Promise<T>): Promise<T> => cerrojo.ejecutar(SESION_BANDEJA, tarea);

  app.get("/api/buzon", async (c) => c.json<RespuestaBuzon>(await listarBuzon(rutas)));
  app.get("/api/buzon/:id", async (c) => responder(c, await detalleMensaje(rutas, c.req.param("id"))));
  app.post("/api/buzon/:id/procesar", async (c) => responder(c, await decidir(() => procesarDesdeBuzon(ctx, c.req.param("id")))));

  app.get("/api/bandeja", async (c) => c.json<RespuestaBandeja>(await listarBandeja(rutas)));
  app.post("/api/bandeja/:id/aprobar", async (c) => {
    const cuerpo = await leerCuerpo(c, PeticionAprobarSchema);
    if (!cuerpo.ok) return cuerpo.respuesta;
    return responder(c, await decidir(() => aprobar(ctx, c.req.param("id"), cuerpo.data)));
  });
  app.post("/api/bandeja/:id/rechazar", async (c) => {
    const cuerpo = await leerCuerpo(c, PeticionRechazarSchema);
    if (!cuerpo.ok) return cuerpo.respuesta;
    return responder(c, await decidir(() => rechazar(ctx, c.req.param("id"), cuerpo.data)));
  });

  app.get("/api/maestro.csv", async (c) => {
    const csv = await leerMaestroCsv(rutas);
    return c.body(csv, 200, { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="maestro-contratos.csv"' });
  });
}
