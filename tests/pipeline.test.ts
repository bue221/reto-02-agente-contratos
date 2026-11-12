import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../src/config.ts";
import { MasterRepository } from "../src/adapters/master-repo.ts";
import { cargarComerciales } from "../src/adapters/comerciales.ts";
import { heuristicLLM } from "../src/llm/heuristic.ts";
import { procesarMensaje } from "../src/pipeline/index.ts";
import type { Deps } from "../src/pipeline/index.ts";
import { reporteVencimientos } from "../src/report.ts";
import { parseFecha, parseValor } from "../src/util.ts";

let deps: Deps;

before(() => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "reto02-"));
  const cfg = loadConfig({ outDir, hoy: "2026-05-30" });
  deps = { cfg, repo: new MasterRepository(cfg), llm: heuristicLLM, comerciales: cargarComerciales(cfg) };
});

// Los tests corren en orden y comparten el maestro, igual que el buzón real.

test("msg-001: contrato nuevo → se registra como C-006 con la autoría resuelta", async () => {
  const ctx = await procesarMensaje("msg-001", deps);
  assert.equal(ctx.decision, "REGISTRAR_NUEVO");
  assert.equal(ctx.contratoId, "C-006");
  const c = deps.repo.findById("C-006")!;
  assert.equal(c.cliente, "Comercializadora Pacífico S.A.S.");
  assert.equal(c.valor, 120_000_000);
  assert.equal(c.comercial_email, "marta.rios@empresa.com");
  assert.equal(c.estado, "ACTIVO");
  assert.equal(deps.repo.all().length, 6);
});

test("msg-002: otrosí → actualiza solo la fecha fin de C-001", async () => {
  const ctx = await procesarMensaje("msg-002", deps);
  assert.equal(ctx.decision, "ACTUALIZAR");
  assert.deepEqual(Object.keys(ctx.cambios), ["fecha_fin"]);
  assert.equal(deps.repo.findById("C-001")!.fecha_fin, "2027-06-30");
  assert.equal(deps.repo.findById("C-001")!.valor, 80_000_000); // no tocó el valor
});

test("msg-003: reenvío de un contrato ya registrado → DUPLICADO y no modifica el maestro", async () => {
  const antes = JSON.stringify(deps.repo.all());
  const ctx = await procesarMensaje("msg-003", deps);
  assert.equal(ctx.decision, "DUPLICADO");
  assert.equal(ctx.duplicadoDe, "C-002");
  assert.equal(JSON.stringify(deps.repo.all()), antes);
});

test("msg-004: nueva versión de C-004 → actualiza el valor", async () => {
  const ctx = await procesarMensaje("msg-004", deps);
  assert.equal(ctx.decision, "ACTUALIZAR");
  assert.equal(ctx.contratoId, "C-004");
  assert.equal(deps.repo.findById("C-004")!.valor, 52_000_000);
});

test("msg-005: cotización → RECHAZAR (no es contrato)", async () => {
  const antes = deps.repo.all().length;
  const ctx = await procesarMensaje("msg-005", deps);
  assert.equal(ctx.decision, "RECHAZAR");
  assert.equal(ctx.clasificacion?.tipo, "cotizacion");
  assert.equal(deps.repo.all().length, antes);
});

test("msg-006: fecha fin ambigua → REVISION_HUMANA y NO se escribe", async () => {
  const antes = deps.repo.all().length;
  const ctx = await procesarMensaje("msg-006", deps);
  assert.equal(ctx.decision, "REVISION_HUMANA");
  assert.ok(ctx.extraccion!.fechaFin.confianza < 0.8);
  assert.equal(deps.repo.all().length, antes);
});

test("procesar dos veces el mismo mensaje es idempotente (la 2ª vez es duplicado)", async () => {
  const ctx = await procesarMensaje("msg-001", deps);
  assert.equal(ctx.decision, "DUPLICADO");
  assert.equal(deps.repo.all().length, 6);
});

test("reporte de vencimientos con fecha de referencia 2026-05-30", () => {
  const r = reporteVencimientos(deps.repo.all(), deps.cfg.hoy);
  assert.deepEqual(r.vencidos.map((f) => f.contrato.id_contrato), ["C-005"]);
  assert.deepEqual(r.hasta30.map((f) => f.contrato.id_contrato), ["C-002"]);
  assert.deepEqual(r.hasta90.map((f) => f.contrato.id_contrato), ["C-004"]);
});

test("parsers: fechas y valores", () => {
  assert.equal(parseFecha("1 de junio de 2026").valor, "2026-06-01");
  assert.equal(parseFecha("a finales de diciembre de 2026").valor, "2026-12-31");
  assert.ok(parseFecha("a finales de diciembre de 2026").confianza < 0.5);
  assert.equal(parseValor("COP $120.000.000").valor, 120_000_000);
  assert.equal(parseValor("50 millones").valor, 50_000_000);
});
