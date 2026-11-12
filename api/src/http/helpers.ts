import type { Context } from "hono";
import type { z } from "zod";
import type { CodigoFallo, ResultadoHitl } from "../application/use-cases/message-status.ts";
import { describirErroresZod } from "../tools/tool.ts";
import type { ErrorApi } from "./types.ts";

/** Utilidades HTTP compartidas por las rutas: errores tipados `{ ok: false, error: { codigo, mensaje } }`. */

export const errorApi = (codigo: string, mensaje: string): ErrorApi => ({ ok: false, error: { codigo, mensaje } });

const ESTADO_HTTP: Record<CodigoFallo, 404 | 409 | 422> = {
  mensaje_no_encontrado: 404,
  ya_procesado: 409,
  no_pendiente: 409,
  registro_fallido: 422,
};

/** JSON roto o cuerpo que no cumple el esquema → 400 con el detalle de zod. */
export async function leerCuerpo<T>(c: Context, esquema: z.ZodType<T>): Promise<{ ok: true; data: T } | { ok: false; respuesta: Response }> {
  const cuerpo: unknown = await c.req.json().catch(() => null);
  const validado = esquema.safeParse(cuerpo);
  if (validado.success) return { ok: true, data: validado.data };
  return { ok: false, respuesta: c.json(errorApi("peticion_invalida", describirErroresZod(validado.error)), 400) };
}

export function responder<T>(c: Context, resultado: ResultadoHitl<T>): Response {
  if (resultado.ok) return c.json(resultado.data);
  return c.json(errorApi(resultado.codigo, resultado.mensaje), ESTADO_HTTP[resultado.codigo]);
}
