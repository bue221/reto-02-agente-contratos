/**
 * Demo determinista con human-in-the-loop simulado.
 *
 * 1. El pipeline analiza los 6 correos y deja RECOMENDACIONES (no ejecuta).
 * 2. Un "humano" de demo aprueba las que no piden revisión de datos.
 * 3. Las REVISION_HUMANA (p.ej. msg-006) quedan pendientes para la UI.
 *
 * Uso: bun run demo            (analiza + aprobación simulada)
 *      bun run demo --sin-aprobar   (solo recomendaciones)
 */
import { getLlm } from "./adapters/llm/index.ts";
import { getCfg, getPropuestas, getRepo, resetDeps } from "./deps.ts";
import { formatearReporte, reporteVencimientos } from "./report.ts";
import { crearHerramientas } from "./tools-cli.ts";

const sinAprobar = process.argv.includes("--sin-aprobar");
const llm = getLlm();
await llm.documents.probe();

resetDeps();
const cfg = getCfg();
const tools = crearHerramientas();

console.log("=== DEMO HUMAN-IN-THE-LOOP (6 mensajes) ===");
console.log(`LLM documentos: ${llm.documents.isActive() ? llm.documents.id : "offline"} · decidir: rules.ts`);
console.log(`Referencia vencimientos: ${cfg.hoy}\n`);

console.log("--- 1. Recomendaciones del agente (nada escrito en el maestro) ---\n");
console.log(await tools.procesarBuzon());

if (!sinAprobar) {
  console.log("\n--- 2. Aprobación simulada (demo-script) ---\n");
  console.log((await tools.aprobarDemo()) || "(nada que aprobar automáticamente)");
}

const pendientes = getPropuestas().list("PENDIENTE").map((p) => p.msgId);
console.log(
  `\nEsperando decisión humana: ${pendientes.length ? pendientes.join(", ") : "(ninguna)"}` +
    " → resuélvelas en el frontend (bandeja) o con POST /v1/propuestas/:id/aprobar",
);
console.log("\n" + "─".repeat(60) + "\n");
console.log(formatearReporte(reporteVencimientos(getRepo().all(), cfg.hoy)));
console.log(`\nSalidas: ${cfg.outDir}`);
