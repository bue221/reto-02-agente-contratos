import { join } from "node:path";
import { crearClasificador } from "./agent/guardrails/scope-classifier.ts";
import { AgenteContratos } from "./agent/loop.ts";
import { SesionesEnArchivo } from "./agent/sessions.ts";
import { crearApp } from "./http/app.ts";
import { type Configuracion, leerConfiguracion } from "./config.ts";
import { mensajeDeError } from "./core/domain/result.ts";
import { crearProveedor } from "./llm/factory.ts";

/** Arranque del backend: compone dependencias y sirve API + front compilado en un solo proceso. */

/** Bun corta conexiones inactivas a los 10 s por defecto; un turno con varias llamadas al modelo tarda más. */
const IDLE_TIMEOUT_SEGUNDOS = 255;

function iniciar(config: Configuracion): void {
  const proveedor = crearProveedor(config);
  const sesiones = new SesionesEnArchivo(config.directorio);
  const agente = new AgenteContratos({
    proveedor,
    clasificador: crearClasificador(config.proveedor, proveedor),
    sesiones,
    directorio: config.directorio,
    limites: { maxIteraciones: config.maxIteraciones, maxTokensSesion: config.maxTokensSesion, maxTokensProceso: config.maxTokensProceso },
  });
  const app = crearApp({
    agente,
    sesiones,
    directorio: config.directorio,
    webDist: join(config.directorio, "web", "dist"),
    origenesCors: config.origenesCors,
    urlLangGraph: config.urlLangGraph,
  });
  const servidor = Bun.serve({ port: config.puerto, fetch: app.fetch, idleTimeout: IDLE_TIMEOUT_SEGUNDOS });
  console.info(`[server] http://localhost:${servidor.port} · proveedor ${proveedor.nombre} (${proveedor.modelo}) · tope ${config.maxIteraciones} iteraciones/turno`);
  if (config.urlLangGraph) console.info(`[server] LangGraph Studio publicado en /langgraph → ${config.urlLangGraph}`);
}

try {
  iniciar(leerConfiguracion());
} catch (error) {
  console.error(`[server] no se pudo iniciar: ${mensajeDeError(error)}`);
  process.exit(1);
}
