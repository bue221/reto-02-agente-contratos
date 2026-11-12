/** Resultado tipado sin excepciones: mismo sobre que devuelven las herramientas. */
export type Resultado<T> = { ok: true; data: T } | { ok: false; error: string };

export const exito = <T>(data: T): Resultado<T> => ({ ok: true, data });
export const fallo = <T = never>(error: string): Resultado<T> => ({ ok: false, error });

export function mensajeDeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
