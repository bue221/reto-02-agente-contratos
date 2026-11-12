import type { Hono } from "hono";
import { z } from "zod";
import { type AlmacenSesiones, CerrojoPorSesion } from "../agent/sessions.ts";
import type { AccesoOut } from "../infrastructure/out-lock.ts";
import { leerMaestroCsv } from "../infrastructure/master-store.ts";
import { rutasDelProyecto } from "../infrastructure/paths.ts";
import { reiniciarDemo } from "../application/use-cases/reset-demo.ts";
import { detalleMensaje, listarBandeja, listarBuzon } from "../application/use-cases/mailbox-view.ts";
import { CorreccionesSchema } from "../core/domain/contract.ts";
import { aprobar, procesarDesdeBuzon, rechazar } from "../application/workflows/approval-tray.ts";
import type { ContextoHerramienta } from "../tools/tool.ts";
import { leerCuerpo, responder } from "./helpers.ts";
import type { PeticionAprobar, PeticionRechazar, RespuestaBandeja, RespuestaBuzon, RespuestaReinicio } from "./types.ts";

/** Rutas human-in-the-loop: buzón, bandeja de aprobación, descarga del maestro y reinicio de la demo. */

export interface DependenciasHitl {
  directorio: string;
  sesiones: AlmacenSesiones;
  acceso: AccesoOut;
  /** Fecha de registro fija para tests deterministas. */
  hoy?: string;
}

const AprobadorSchema = z.string({ error: "indica quién decide" }).trim().min(1, "indica quién decide").max(80, "máx. 80 caracteres");

const PeticionAprobarSchema = z.object({
  aprobador: AprobadorSchema,
  correcciones: CorreccionesSchema.default({}),
}) satisfies z.ZodType<Required<PeticionAprobar>>;

const PeticionRechazarSchema = z.object({
  aprobador: AprobadorSchema,
  motivo: z.string({ error: "el rechazo necesita un motivo" }).trim().min(1, "el rechazo necesita un motivo").max(500, "máx. 500 caracteres"),
}) satisfies z.ZodType<PeticionRechazar>;

const SESION_BANDEJA = "bandeja";

export function rutasHitl(app: Hono, deps: DependenciasHitl): void {
  const rutas = rutasDelProyecto(deps.directorio);
  const ctx: ContextoHerramienta = { directory: deps.directorio, sessionId: SESION_BANDEJA, ...(deps.hoy ? { hoy: deps.hoy } : {}) };
  const cerrojo = new CerrojoPorSesion();
  const leer = <T>(tarea: () => Promise<T>): Promise<T> => deps.acceso.compartido(tarea);
  // Las acciones de la bandeja leen y reescriben los mismos JSON de out/: se aplican de a una.
  const decidir = <T>(tarea: () => Promise<T>): Promise<T> => deps.acceso.compartido(() => cerrojo.ejecutar(SESION_BANDEJA, tarea));

  app.get("/api/buzon", async (c) => c.json<RespuestaBuzon>(await leer(() => listarBuzon(rutas))));
  app.get("/api/buzon/:id", async (c) => responder(c, await leer(() => detalleMensaje(rutas, c.req.param("id")))));
  app.post("/api/buzon/:id/procesar", async (c) => responder(c, await decidir(() => procesarDesdeBuzon(ctx, c.req.param("id")))));

  app.get("/api/bandeja", async (c) => c.json<RespuestaBandeja>(await leer(() => listarBandeja(rutas))));
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
    const csv = await leer(() => leerMaestroCsv(rutas));
    return c.body(csv, 200, { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="maestro-contratos.csv"' });
  });

  app.post("/api/demo/reset", async (c) => {
    const mensajes = await deps.acceso.exclusivo(async () => {
      deps.sesiones.vaciar();
      return reiniciarDemo(rutas);
    });
    console.info(`[demo] out/ reiniciado: ${mensajes} mensajes pendientes`);
    return c.json<RespuestaReinicio>({ ok: true, mensajes });
  });
}
