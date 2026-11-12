import type { Configuracion } from "../config.ts";
import type { ProveedorLlm } from "./adapter.ts";
import { ProveedorGemini } from "./gemini.ts";
import { ProveedorOffline } from "./offline.ts";

/** Único punto que conoce las implementaciones concretas (inversión de dependencias para el ciclo). */
export function crearProveedor(config: Configuracion): ProveedorLlm {
  if (config.proveedor === "offline" || !config.googleApiKey) return new ProveedorOffline();
  return new ProveedorGemini({ apiKey: config.googleApiKey, modelo: config.modeloGemini, timeoutMs: config.timeoutMs });
}
