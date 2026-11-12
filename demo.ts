/**
 * Verificación sin modelo (PRD 6.6): procesa el buzón llamando directamente a las herramientas.
 * Uso: bun install && bun run demo.ts
 */
import { rm } from "node:fs/promises";
import { join } from "node:path";
import type { Alertas } from "./api/src/application/use-cases/alerts.ts";
import type { Registro } from "./api/src/application/use-cases/register.ts";
import type { Contrato } from "./api/src/core/domain/contract.ts";
import { type ResultadoMensaje, procesarBuzon } from "./api/src/application/workflows/process-mailbox.ts";
import { llamarHerramienta } from "./api/src/application/workflows/tool-call.ts";
import type { ContextoHerramienta } from "./api/src/tools/tool.ts";

const HOY = "2026-09-03";
const MENSAJE_A_CONFIRMAR = "msg-006";
/** Lo que la analista confirma en el chat: "confirmo el valor 0 y la fecha fin 2027-08-31". */
const VALORES_CONFIRMADOS = { valor: 0, fecha_fin: "2027-08-31" } as const;

const ctx: ContextoHerramienta = { directory: import.meta.dir, sessionId: "demo", hoy: HOY };

const columna = (texto: string, ancho: number): string => texto.padEnd(ancho);

function imprimirPrimeraPasada(resultados: readonly ResultadoMensaje[]): void {
  console.log("\n== Primera pasada (sin confirmaciones) ==\n");
  for (const resultado of resultados) {
    const revision = resultado.requiere_revision.join(", ") || "—";
    console.log(`${columna(resultado.mensaje_id, 8)} ${columna(resultado.clasificacion ?? "error", 14)} revisión: ${columna(revision, 32)} acción: ${resultado.accion}`);
    for (const aviso of resultado.avisos) console.log(`${" ".repeat(9)}aviso: ${aviso}`);
  }
}

function conValoresConfirmados(contrato: Contrato): Contrato {
  return {
    ...contrato,
    valor: { ...contrato.valor, valor: VALORES_CONFIRMADOS.valor },
    fecha_fin: { ...contrato.fecha_fin, valor: VALORES_CONFIRMADOS.fecha_fin },
  };
}

async function confirmar(resultados: readonly ResultadoMensaje[]): Promise<void> {
  console.log(`\n== Segunda pasada: la analista confirma ${MENSAJE_A_CONFIRMAR} (valor 0, fecha_fin ${VALORES_CONFIRMADOS.fecha_fin}) ==\n`);
  const pendiente = resultados.find((resultado) => resultado.mensaje_id === MENSAJE_A_CONFIRMAR);
  if (!pendiente?.contrato) return console.log(`${MENSAJE_A_CONFIRMAR}: no hay contrato pendiente de confirmar`);
  const args = { mensaje_id: MENSAJE_A_CONFIRMAR, contrato: conValoresConfirmados(pendiente.contrato), confirmado: true };
  const registro = await llamarHerramienta<Registro>("contratos_registrar", args, ctx);
  console.log(registro.ok ? `${MENSAJE_A_CONFIRMAR}: ${registro.data.accion} ${registro.data.id_contrato} → ${registro.data.ruta_archivo}` : `${MENSAJE_A_CONFIRMAR}: ${registro.error}`);
}

async function imprimirAlertas(): Promise<void> {
  console.log(`\n== Alertas al ${HOY} ==\n`);
  const alertas = await llamarHerramienta<Alertas>("contratos_alertas", { hoy: HOY }, ctx);
  if (!alertas.ok) return console.log(`error: ${alertas.error}`);
  const { ruta, vencen, polizas_pendientes, registrados_desde_corte } = alertas.data;
  console.log(`Vencen en ≤ 60 días:        ${vencen.map((v) => `${v.id_contrato} (${v.dias_restantes} d)`).join(", ") || "ninguno"}`);
  console.log(`Pólizas no vigentes:        ${polizas_pendientes.map((p) => `${p.id_contrato} (${p.estado_poliza})`).join(", ") || "ninguna"}`);
  console.log(`Registrados desde el corte: ${registrados_desde_corte.map((r) => r.id_contrato).join(", ") || "ninguno"}`);
  console.log(`Reporte: ${ruta}`);
}

async function main(): Promise<void> {
  await rm(join(ctx.directory, "out"), { recursive: true, force: true });
  console.log(`Demo de registro de contratos (sin modelo), hoy = ${HOY}`);
  const resultados = await procesarBuzon(ctx);
  if (!resultados.ok) {
    console.error(`No se pudo leer el buzón: ${resultados.error}`);
    process.exitCode = 1;
    return;
  }
  imprimirPrimeraPasada(resultados.data);
  await confirmar(resultados.data);
  await imprimirAlertas();
  console.log("\nSalidas en out/: sharepoint/maestro-contratos.csv, sharepoint/historial.jsonl, sharepoint/Contratos/, procesados.json, log.jsonl, alertas.md");
}

await main();
