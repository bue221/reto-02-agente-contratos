/**
 * Backend consumible por frontend: Bun + Hono.
 * Studio (`bun run studio`) sigue siendo solo debug del grafo.
 */
import { getLlm } from "../adapters/llm/index.ts";
import { loadConfig } from "../config.ts";
import { createApp } from "./routes.ts";

const cfg = loadConfig();
const port = Number(process.env.API_PORT ?? "8787");
const llm = getLlm();
await llm.documents.probe();

const app = createApp();

console.log(
  `[api] agente-contratos · llm=${llm.providerId} · ref ${cfg.hoy} · http://127.0.0.1:${port}`,
);
console.log(`[api] outDir: ${cfg.outDir}`);

export default {
  port,
  // procesar-todo encadena una llamada a Gemini por correo; el default de Bun (10 s) corta la respuesta.
  idleTimeout: 120,
  fetch: app.fetch,
};
