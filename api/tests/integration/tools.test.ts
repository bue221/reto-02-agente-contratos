import { beforeAll, describe, expect, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parsearMaestro } from "../../src/infrastructure/master-store.ts";
import type { Alertas } from "../../src/application/use-cases/alerts.ts";
import type { Buzon } from "../../src/application/use-cases/read-mailbox.ts";
import type { Registro } from "../../src/application/use-cases/register.ts";
import type { ValidacionReportada } from "../../src/application/use-cases/validate.ts";
import type { Contrato } from "../../src/core/domain/contract.ts";
import type { FilaMaestro } from "../../src/core/domain/master.ts";
import { type ResultadoMensaje, procesarBuzon } from "../../src/application/workflows/process-mailbox.ts";
import { llamarHerramienta } from "../../src/application/workflows/tool-call.ts";
import { ejecutarHerramienta, extraer, herramientas } from "../../src/tools/contratos.ts";
import type { ContextoHerramienta } from "../../src/tools/tool.ts";
import { HOY, agregarMensaje, contratoModificado, crearProyecto, extraerOk, leerFixture, leerSalida, lineasJson } from "../helpers.ts";

async function procesar(ctx: ContextoHerramienta): Promise<Map<string, ResultadoMensaje>> {
  const resultado = await procesarBuzon(ctx);
  if (!resultado.ok) throw new Error(resultado.error);
  return new Map(resultado.data.map((mensaje) => [mensaje.mensaje_id, mensaje]));
}

const leerMaestroSalida = async (ctx: ContextoHerramienta): Promise<FilaMaestro[]> =>
  parsearMaestro(await leerSalida(ctx, "sharepoint", "maestro-contratos.csv"));

const fila = (maestro: readonly FilaMaestro[], id: string): FilaMaestro | undefined => maestro.find((actual) => actual.id_contrato === id);

function confirmados(contrato: Contrato): Contrato {
  return { ...contrato, valor: { ...contrato.valor, valor: 0 }, fecha_fin: { ...contrato.fecha_fin, valor: "2027-08-31" } };
}

describe("primera pasada por el buzón (PRD 7.4)", () => {
  let ctx: ContextoHerramienta;
  let resultados: Map<string, ResultadoMensaje>;

  beforeAll(async () => {
    ctx = await crearProyecto();
    resultados = await procesar(ctx);
  });

  test("clasifica los seis mensajes", () => {
    const clasificaciones = Object.fromEntries([...resultados].map(([id, resultado]) => [id, resultado.clasificacion]));
    expect(clasificaciones).toEqual({
      "msg-001": "nuevo",
      "msg-002": "nuevo",
      "msg-003": "actualizacion",
      "msg-004": "duplicado",
      "msg-005": "rechazado",
      "msg-006": "nuevo",
    });
  });

  test("msg-001 queda registrado con póliza pendiente, comercial resuelto y archivo en SharePoint", async () => {
    expect(fila(await leerMaestroSalida(ctx), "CT-2026-015")).toEqual({
      id_contrato: "CT-2026-015",
      cliente: "Industrias Delta S.A.S.",
      nit_cliente: "890900111",
      pais: "CO",
      objeto: expect.stringContaining("plataforma CRM"),
      valor: 265000000,
      moneda: "COP",
      fecha_inicio: "2026-08-01",
      fecha_fin: "2027-07-31",
      requiere_poliza: true,
      tipo_poliza: "cumplimiento",
      estado_poliza: "pendiente",
      comercial: "Laura Gómez Restrepo",
      ruta_sharepoint: "Contratos/2026/industrias-delta/CT-2026-015.txt",
      fecha_registro: HOY,
      fuente: "buzon",
    });
    expect(await leerSalida(ctx, "sharepoint", "Contratos", "2026", "industrias-delta", "CT-2026-015.txt")).toContain("CT-2026-015");
  });

  test("msg-002 es nuevo sin póliza aunque el NIT ya tenga otro contrato (objeto distinto)", async () => {
    const maestro = await leerMaestroSalida(ctx);
    expect(fila(maestro, "CT-2026-016")).toMatchObject({ pais: "EC", moneda: "USD", valor: 120000, requiere_poliza: false, estado_poliza: "no_aplica" });
    expect(fila(maestro, "CT-2026-007")?.valor).toBe(95000);
  });

  test("msg-003 actualiza la fila existente y deja historial con los cambios", async () => {
    expect(fila(await leerMaestroSalida(ctx), "CT-2026-011")).toMatchObject({ valor: 520000, fecha_fin: "2027-11-01", fecha_inicio: "2026-05-02", estado_poliza: "pendiente" });
    const historial = lineasJson(await leerSalida(ctx, "sharepoint", "historial.jsonl"));
    const entrada = historial.find((linea) => linea.mensaje_id === "msg-003");
    expect(entrada).toMatchObject({
      id_contrato: "CT-2026-011",
      accion: "actualizado",
      cambios: { valor: { antes: 350000, despues: 520000 }, fecha_fin: { antes: "2027-05-01", despues: "2027-11-01" } },
    });
    expect(typeof entrada?.ts).toBe("string");
  });

  test("msg-004 duplicado no escribe nada", async () => {
    const maestro = await leerMaestroSalida(ctx);
    const original = parsearMaestro(await leerFixture("maestro-contratos.csv"));
    expect(fila(maestro, "CT-2026-012")).toEqual(fila(original, "CT-2026-012"));
    expect(maestro.filter((actual) => actual.id_contrato === "CT-2026-012")).toHaveLength(1);
    expect(lineasJson(await leerSalida(ctx, "sharepoint", "historial.jsonl")).some((linea) => linea.mensaje_id === "msg-004")).toBe(false);
    expect(await leerSalida(ctx, "sharepoint", "Contratos", "2026", "clinica-san-rafael", "CT-2026-012.txt")).toBe("");
  });

  test("msg-005 se rechaza con motivo", () => {
    expect(resultados.get("msg-005")?.accion).toContain("no trae adjunto de contrato");
  });

  test("msg-006 queda sin registrar, con revisión de valor y fecha_fin y aviso de remitente desconocido", async () => {
    const marco = resultados.get("msg-006");
    expect(marco?.requiere_revision).toEqual(expect.arrayContaining(["valor", "fecha_fin"]));
    expect(marco?.desenlace).toBe("en_revision");
    expect(marco?.accion).toContain("en espera de confirmación humana");
    expect(marco?.avisos.join(" ")).toContain("jperez@periferia-ficticia.com");
    expect(fila(await leerMaestroSalida(ctx), "CM-2026-03")).toBeUndefined();
  });

  test("RN6: el fixture no se toca y el maestro de salida no tiene ids repetidos", async () => {
    const maestro = await leerMaestroSalida(ctx);
    expect(new Set(maestro.map((actual) => actual.id_contrato)).size).toBe(maestro.length);
    expect(maestro).toHaveLength(10);
    expect(await leerFixture("maestro-contratos.csv")).toBe(await Bun.file(join(ctx.directory, "fixtures", "reto-02", "maestro-contratos.csv")).text());
  });

  test("leer_buzon solo lista lo no procesado", async () => {
    const buzon = await llamarHerramienta<Buzon>("contratos_leer_buzon", {}, ctx);
    expect(buzon.ok && buzon.data.mensajes.map((mensaje) => mensaje.id)).toEqual(["msg-006"]);
  });

  test("RN7: cada llamada queda en out/log.jsonl", async () => {
    const log = lineasJson(await leerSalida(ctx, "log.jsonl"));
    expect(log.length).toBeGreaterThanOrEqual(1 + 6 * 2 + 4);
    expect(log[0]).toMatchObject({ herramienta: "contratos_leer_buzon", mensaje_id: null, ok: true });
    expect(Object.keys(log[1] ?? {})).toEqual(["ts", "herramienta", "mensaje_id", "ok", "resumen"]);
  });
});

describe("confirmación humana (RN5 / CA3)", () => {
  test("msg-006 solo se registra con confirmado = true y los valores confirmados", async () => {
    const ctx = await crearProyecto();
    const contrato = await extraerOk(ctx, "msg-006");
    const sinConfirmar = await llamarHerramienta<Registro>("contratos_registrar", { mensaje_id: "msg-006", contrato }, ctx);
    expect(sinConfirmar.ok).toBe(false);
    if (!sinConfirmar.ok) expect(sinConfirmar.error).toStartWith("requiere revisión: valor");

    const confirmado = await llamarHerramienta<Registro>("contratos_registrar", { mensaje_id: "msg-006", contrato: confirmados(contrato), confirmado: true }, ctx);
    expect(confirmado).toMatchObject({ ok: true, data: { id_contrato: "CM-2026-03", accion: "insertado" } });
    expect(fila(await leerMaestroSalida(ctx), "CM-2026-03")).toMatchObject({
      valor: 0,
      fecha_fin: "2027-08-31",
      requiere_poliza: false,
      estado_poliza: "no_aplica",
      comercial: "jperez@periferia-ficticia.com",
    });

    const repetido = await llamarHerramienta<Registro>("contratos_registrar", { mensaje_id: "msg-006", contrato: confirmados(contrato), confirmado: true }, ctx);
    expect(repetido).toEqual({ ok: false, error: "el mensaje msg-006 ya fue procesado (registrado CM-2026-03)" });
  });

  test("registrar no confía en el llamador: un valor alterado con confianza 1 exige confirmación", async () => {
    const ctx = await crearProyecto();
    const contrato = await extraerOk(ctx, "msg-001");
    const alterado: Contrato = { ...contrato, valor: { valor: 999, confianza: 1 } };
    const resultado = await llamarHerramienta<Registro>("contratos_registrar", { mensaje_id: "msg-001", contrato: alterado }, ctx);
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.error).toContain("valor (difiere de lo extraído del documento (265000000))");
    expect(fila(await leerMaestroSalida(ctx), "CT-2026-015")).toBeUndefined();
  });

  test("validar reporta la confianza del servidor, no la del llamador", async () => {
    const ctx = await crearProyecto();
    const contrato = await extraerOk(ctx, "msg-006");
    const inflado: Contrato = { ...contrato, valor: { ...contrato.valor, confianza: 1 }, fecha_fin: { ...contrato.fecha_fin, confianza: 1 } };
    const validacion = await llamarHerramienta<ValidacionReportada>("contratos_validar", { mensaje_id: "msg-006", contrato: inflado }, ctx);
    expect(validacion.ok && validacion.data.requiere_revision).toEqual(expect.arrayContaining(["valor", "fecha_fin"]));
  });
});

describe("alertas (HU-5)", () => {
  test("genera las tres secciones con hoy = 2026-09-03", async () => {
    const ctx = await crearProyecto();
    const pasada = await procesar(ctx);
    const pendiente = pasada.get("msg-006")?.contrato;
    if (!pendiente) throw new Error("msg-006 sin contrato extraído");
    await llamarHerramienta<Registro>("contratos_registrar", { mensaje_id: "msg-006", contrato: confirmados(pendiente), confirmado: true }, ctx);

    const alertas = await llamarHerramienta<Alertas>("contratos_alertas", { hoy: HOY }, ctx);
    if (!alertas.ok) throw new Error(alertas.error);
    expect(alertas.data.ruta).toBe("out/alertas.md");
    expect(alertas.data.vencen.map((v) => [v.id_contrato, v.dias_restantes])).toEqual([["CT-2026-009", 27], ["CT-2026-004", 42]]);
    expect(alertas.data.polizas_pendientes.map((p) => p.id_contrato)).toEqual(["CT-2026-004", "CT-2026-011", "CT-2026-015"]);
    expect(alertas.data.registrados_desde_corte.map((r) => r.id_contrato)).toEqual(["CT-2026-015", "CT-2026-016", "CM-2026-03"]);

    const markdown = await leerSalida(ctx, "alertas.md");
    expect(markdown).toContain("## Vencen en ≤ 60 días");
    expect(markdown).toContain("## Pólizas requeridas no vigentes");
    expect(markdown).toContain("## Registrados desde el 2026-05-30 (gap cubierto)");
  });
});

describe("HU-6: un mensaje malo no aborta el lote", () => {
  test("texto vacío, fecha inválida, moneda desconocida y correo ilegible se reportan y el resto se procesa", async () => {
    const ctx = await crearProyecto();
    await agregarMensaje(ctx, "msg-901", { "contrato.txt": "" });
    await agregarMensaje(ctx, "msg-902", { "contrato.txt": await contratoModificado({ "primero (1) de agosto de 2026": "treinta (30) de febrero de 2026" }) });
    await agregarMensaje(ctx, "msg-903", { "contrato.txt": await contratoModificado({ "COP $265.000.000": "EUR 265.000" }) });
    await agregarMensaje(ctx, "msg-904", {});
    await writeFile(join(ctx.directory, "fixtures", "reto-02", "buzon", "msg-904", "correo.json"), "{ no es json");

    const resultados = await procesar(ctx);
    expect(resultados.get("msg-901")?.accion).toBe("error: contrato.txt: el texto del contrato está vacío");
    expect(resultados.get("msg-902")?.accion).toContain("fecha inválida");
    expect(resultados.get("msg-903")?.accion).toContain('moneda desconocida en el documento: "EUR"');
    expect(resultados.get("msg-904")?.accion).toStartWith("error:");
    expect(resultados.get("msg-006")?.clasificacion).toBe("nuevo");
    expect(fila(await leerMaestroSalida(ctx), "CT-2026-016")).toBeDefined();
  });
});

describe("validación de argumentos con zod", () => {
  let ctx: ContextoHerramienta;
  beforeAll(async () => {
    ctx = await crearProyecto();
  });

  const ejecutar = async (nombre: string, args: unknown) => JSON.parse(await ejecutarHerramienta(nombre, args, ctx)) as { ok: boolean; error?: string };

  test("argumento obligatorio ausente", async () => {
    expect(await ejecutar("contratos_validar", { mensaje_id: "msg-001" })).toEqual({
      ok: false,
      error: "argumentos inválidos: contrato: Invalid input: expected object, received undefined",
    });
  });

  test("moneda fuera del enum en un contrato corregido por el modelo", async () => {
    const contrato = await extraerOk(ctx, "msg-001");
    const resultado = await ejecutar("contratos_registrar", { mensaje_id: "msg-001", contrato: { ...contrato, moneda: { valor: "EUR", confianza: 1 } } });
    expect(resultado.ok).toBe(false);
    expect(resultado.error).toStartWith("argumentos inválidos: contrato.moneda.valor");
  });

  test("fecha inválida en alertas", async () => {
    expect((await ejecutar("contratos_alertas", { hoy: "2026-13-01" })).error).toContain("hoy: fecha inválida");
  });

  test("mensaje_id con intento de salir de la carpeta", async () => {
    expect((await ejecutar("contratos_extraer", { mensaje_id: "../secreto" })).error).toContain("mensaje_id");
  });

  test("mensaje inexistente y herramienta desconocida", async () => {
    expect(await ejecutar("extraer", { mensaje_id: "msg-999" })).toEqual({ ok: false, error: "no existe el mensaje msg-999 en el buzón" });
    expect((await ejecutar("contratos_borrar", {})).error).toContain("herramienta desconocida");
  });

  test("cada herramienta expone description y args con .describe() y se puede llamar sin el servidor", async () => {
    for (const herramienta of Object.values(herramientas)) {
      expect(herramienta.description.length).toBeGreaterThan(10);
      for (const esquema of Object.values(herramienta.args)) expect(esquema.description).toBeTruthy();
    }
    expect(JSON.parse(await extraer.execute({ mensaje_id: "msg-002" }, ctx))).toMatchObject({ ok: true, data: { id_contrato: { valor: "CT-2026-016" } } });
  });
});
