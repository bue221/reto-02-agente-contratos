import { z } from "zod";
import { leerTextoOpcional } from "./files.ts";
import type { Rutas } from "./paths.ts";

const ComercialSchema = z.object({ email: z.string(), nombre: z.string(), region: z.string() });
export type Comercial = z.infer<typeof ComercialSchema>;

export interface Remitente {
  email: string;
  comercial: Comercial | null;
}

export async function leerComerciales(rutas: Rutas): Promise<Comercial[]> {
  const texto = await leerTextoOpcional(rutas.comerciales);
  if (texto === null) return [];
  return z.array(ComercialSchema).parse(JSON.parse(texto));
}

export async function resolverRemitente(rutas: Rutas, email: string): Promise<Remitente> {
  const comerciales = await leerComerciales(rutas);
  const comercial = comerciales.find((candidato) => candidato.email.toLowerCase() === email.toLowerCase()) ?? null;
  return { email, comercial };
}

/** HU-3: un remitente desconocido se reporta pero no bloquea el registro. */
export const avisoDeRemitente = (remitente: Remitente): string[] =>
  remitente.comercial
    ? []
    : [`remitente ${remitente.email} no está en comerciales.json: se registra con su correo como comercial y debe asignarse un responsable`];

export const nombreComercial = (remitente: Remitente): string => remitente.comercial?.nombre ?? remitente.email;
