import { join } from "node:path";
import { z } from "zod";

/** Configuración del backend leída de variables de entorno (ver `.env.example`). La clave nunca sale de aquí hacia el front ni los logs. */

const entero = (porDefecto: number) => z.coerce.number().int().positive().default(porDefecto);
const textoOpcional = z
  .string()
  .optional()
  .transform((valor) => valor?.trim() || undefined);

const EntornoSchema = z.object({
  LLM_PROVIDER: z.enum(["auto", "gemini", "offline"]).default("auto"),
  GOOGLE_API_KEY: textoOpcional,
  GEMINI_MODEL: z.string().min(1).default("gemini-2.5-flash"),
  LLM_TIMEOUT_MS: entero(60_000),
  MAX_ITERACIONES: entero(25),
  MAX_TOKENS_SESION: entero(300_000),
  MAX_TOKENS_PROCESO: entero(3_000_000),
  PORT: entero(3000),
});

export interface Configuracion {
  proveedor: "gemini" | "offline";
  googleApiKey: string | undefined;
  modeloGemini: string;
  timeoutMs: number;
  maxIteraciones: number;
  maxTokensSesion: number;
  maxTokensProceso: number;
  puerto: number;
  /** Raíz del proyecto: `ctx.directory` de las herramientas. */
  directorio: string;
}

/** `auto` elige Gemini si hay clave y offline si no, para que la app arranque siempre. */
export function leerConfiguracion(entorno: Record<string, string | undefined> = process.env): Configuracion {
  // Una variable vacía (copiada tal cual de `.env.example`) cuenta como no definida.
  const definidas = Object.fromEntries(Object.entries(entorno).filter(([, valor]) => valor !== undefined && valor.trim() !== ""));
  const leido = EntornoSchema.safeParse(definidas);
  if (!leido.success) {
    const detalle = leido.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
    throw new Error(`configuración inválida: ${detalle}`);
  }
  const e = leido.data;
  const proveedor = e.LLM_PROVIDER === "auto" ? (e.GOOGLE_API_KEY ? "gemini" : "offline") : e.LLM_PROVIDER;
  if (proveedor === "gemini" && !e.GOOGLE_API_KEY) throw new Error("LLM_PROVIDER=gemini requiere GOOGLE_API_KEY");
  return {
    proveedor,
    googleApiKey: e.GOOGLE_API_KEY,
    modeloGemini: e.GEMINI_MODEL,
    timeoutMs: e.LLM_TIMEOUT_MS,
    maxIteraciones: e.MAX_ITERACIONES,
    maxTokensSesion: e.MAX_TOKENS_SESION,
    maxTokensProceso: e.MAX_TOKENS_PROCESO,
    puerto: e.PORT,
    directorio: join(import.meta.dir, ".."),
  };
}
