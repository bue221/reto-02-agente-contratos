import readline from "node:readline/promises";
import { loadConfig } from "./config.ts";
import { MasterRepository } from "./adapters/master-repo.ts";
import { cargarComerciales } from "./adapters/comerciales.ts";
import { crearLLM } from "./llm/index.ts";
import { crearChat } from "./agent/chat.ts";
import { crearHerramientas } from "./agent/tools.ts";
import type { Deps } from "./pipeline/index.ts";

const cfg = loadConfig();
const repo = new MasterRepository(cfg);
const llm = crearLLM();
const deps: Deps = { cfg, repo, llm, comerciales: cargarComerciales(cfg) };
const tools = crearHerramientas(deps);
const run = (n: string, input: unknown = {}) => tools.find((t) => t.name === n)!.run(input);

const arg = process.argv[2];

if (arg === "--reset") {
  console.log(await run("reiniciar_demo"));
} else if (arg === "--process-all") {
  await run("reiniciar_demo");
  console.log(`Modelo: ${llm.nombre} · Fecha de referencia: ${cfg.hoy}\n`);
  console.log(await run("procesar_buzon"));
  console.log("\n" + "─".repeat(60) + "\n");
  console.log(await run("reporte_vencimientos"));
  console.log(`\nSalidas en: ${cfg.outDir}`);
} else if (arg === "--report") {
  console.log(await run("reporte_vencimientos"));
} else {
  const responder = crearChat(deps);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log(`Agente de contratos · modelo: ${llm.nombre} · referencia: ${cfg.hoy}`);
  console.log('Escribe "ayuda" para ver qué puedo hacer, o "salir".\n');
  rl.setPrompt("tú › ");
  rl.prompt();
  for await (const entrada of rl) {
    const linea = entrada.trim();
    if (/^(salir|exit|quit)$/i.test(linea)) break;
    if (linea) {
      try { console.log("\n" + (await responder(linea)) + "\n"); }
      catch (e) { console.log(`\nError: ${(e as Error).message}\n`); }
    }
    rl.prompt();
  }
  rl.close();
}
