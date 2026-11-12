import fs from "node:fs";
import type { Config } from "../config.ts";
import type { Comercial } from "../types.ts";

export function cargarComerciales(cfg: Config): Comercial[] {
  return JSON.parse(fs.readFileSync(cfg.comercialesPath, "utf8")) as Comercial[];
}

export function resolverAutor(comerciales: Comercial[], remitente: string): Comercial | undefined {
  // Acepta "Ana Pérez <ana.perez@empresa.com>" o el correo solo.
  const email = (remitente.match(/<([^>]+)>/)?.[1] ?? remitente).trim().toLowerCase();
  return comerciales.find((c) => c.email.toLowerCase() === email);
}
