/**
 * Punto único de recepción (CLI conversacional con memoria por thread).
 */
import readline from "node:readline/promises";
import { getLlm } from "./adapters/llm/index.ts";
import { chatTurn } from "./agent/chat-graph.ts";
import { loadConfig } from "./config.ts";
import { resetDeps } from "./deps.ts";
import { crearHerramientas } from "./tools-cli.ts";

const cfg = loadConfig();
const arg = process.argv[2];

const llm = getLlm();
await llm.documents.probe();
const motor = llm.documents.isActive()
  ? `${llm.providerId} (${cfg.geminiModel})`
  : "agentico-local (agent↔tools)";

if (arg === "--reset") {
  resetDeps();
  console.log("Maestro y salidas restablecidos.");
  process.exit(0);
}

if (arg === "--process-all") {
  resetDeps();
  const tools = crearHerramientas();
  console.log(`Modelo: ${motor} · Fecha de referencia: ${cfg.hoy}\n`);
  console.log(await tools.procesarBuzon());
  console.log("\n--- Aprobación simulada (REVISION_HUMANA queda pendiente) ---\n");
  console.log(await tools.aprobarDemo());
  console.log("\n" + "─".repeat(60) + "\n");
  console.log(await tools.reporte());
  console.log(`\nSalidas en: ${cfg.outDir}`);
  process.exit(0);
}

if (arg === "--report") {
  const tools = crearHerramientas();
  console.log(await tools.reporte());
  process.exit(0);
}

const threadId = `cli-${Date.now()}`;

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
console.log(`Agente de contratos · ${motor} · referencia: ${cfg.hoy}`);
console.log(`Memoria activa (thread ${threadId}). Ej: "cuántos faltan" → "procesa msg-001".`);
console.log('"salir" para terminar.\n');
rl.setPrompt("tú › ");
rl.prompt();

for await (const entrada of rl) {
  const linea = entrada.trim();
  if (/^(salir|exit|quit)$/i.test(linea)) break;
  if (!linea) {
    rl.prompt();
    continue;
  }
  try {
    const { reply } = await chatTurn(threadId, linea);
    console.log("\n" + reply + "\n");
  } catch (e) {
    console.log(`\nError: ${(e as Error).message}\n`);
  }
  rl.prompt();
}
rl.close();
