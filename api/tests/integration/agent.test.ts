import { beforeAll, describe, expect, test } from "bun:test";
import { AgenteContratos, type LimitesCiclo } from "../../src/agent/loop.ts";
import { SesionesEnArchivo } from "../../src/agent/sessions.ts";
import type { LlamadaVisible, RespuestaChat } from "../../src/http/types.ts";
import type { ValidacionReportada } from "../../src/application/use-cases/validate.ts";
import { llamarHerramienta } from "../../src/application/workflows/tool-call.ts";
import { type Resultado, exito, fallo } from "../../src/core/domain/result.ts";
import type { DefinicionHerramienta, LlamadaHerramienta, ProveedorLlm, RespuestaLlm } from "../../src/llm/adapter.ts";
import { ProveedorOffline } from "../../src/llm/offline.ts";
import type { ContextoHerramienta } from "../../src/tools/tool.ts";
import { HOY, REVISION_006, crearProyecto, extraerOk, leerSalida, lineasJson } from "../helpers.ts";

const PROMPT_DEMO =
  "Procesa el buzón de contratos con fecha de hoy 2026-09-03. Registra lo que esté limpio, muéstrame lo que requiere revisión campo por campo y termina con el reporte de alertas. No registres nada dudoso sin preguntarme.";
const CONFIRMACION = "confirmo el valor 0 y la fecha fin 2027-08-31";
const LIMITES: LimitesCiclo = { maxIteraciones: 25, maxTokensSesion: 100_000, maxTokensProceso: 1_000_000 };
const PROCESAR = "recepcion_procesar_buzon";
const RESPONDER = "recepcion_responder_revision";

function crearAgente(ctx: ContextoHerramienta, proveedor: ProveedorLlm, limites: Partial<LimitesCiclo> = {}): AgenteContratos {
  return new AgenteContratos({
    proveedor,
    sesiones: new SesionesEnArchivo(ctx.directory),
    directorio: ctx.directory,
    limites: { ...LIMITES, ...limites },
    cargarSistema: async () => "sistema de prueba",
    hoy: HOY,
  });
}

/** Proveedor de prueba que responde siempre lo mismo (o lo que diga la función) y guarda las herramientas que vio. */
function proveedorFijo(responder: (llamada: number) => Resultado<RespuestaLlm>): ProveedorLlm & { llamadas: number; vistas: string[] } {
  return {
    nombre: "prueba",
    modelo: "fijo",
    llamadas: 0,
    vistas: [],
    async enviar(_mensajes, herramientas: readonly DefinicionHerramienta[]) {
      this.llamadas += 1;
      this.vistas = herramientas.map((herramienta) => herramienta.nombre);
      return responder(this.llamadas);
    },
  };
}

const texto = (contenido: string, uso = { entrada: 0, salida: 0 }): Resultado<RespuestaLlm> => exito({ texto: contenido, llamadas: [], uso });
const pedir = (...llamadas: LlamadaHerramienta[]): Resultado<RespuestaLlm> => exito({ texto: "", llamadas, uso: { entrada: 0, salida: 0 } });
const nombres = (llamadas: readonly LlamadaVisible[]): string[] => [...new Set(llamadas.map((llamada) => llamada.nombre))];
const pasos = (respuesta: RespuestaChat): LlamadaVisible[] => respuesta.toolCalls.flatMap((llamada) => llamada.pasos ?? []);
const procesar006 = (id = "1"): LlamadaHerramienta => ({ id, nombre: PROCESAR, args: { hoy: HOY, mensaje_ids: ["msg-006"] } });
const aprobar006 = (id = "2"): LlamadaHerramienta => ({ id, nombre: RESPONDER, args: { mensaje_id: "msg-006", decision: "aprobar", correcciones: { valor: 0 } } });

describe("flujo de la demo con el proveedor offline (PRD 11)", () => {
  let ctx: ContextoHerramienta;
  let primera: RespuestaChat;
  let segunda: RespuestaChat;

  beforeAll(async () => {
    ctx = await crearProyecto();
    const agente = crearAgente(ctx, new ProveedorOffline());
    primera = await agente.conversar("demo", PROMPT_DEMO);
    segunda = await agente.conversar("demo", CONFIRMACION);
  });

  test("la recepcionista enciende el motor una vez y el motor recorre las cinco herramientas del PRD", () => {
    expect(nombres(primera.toolCalls)).toEqual([PROCESAR]);
    expect(nombres(pasos(primera))).toEqual(["contratos_leer_buzon", "contratos_extraer", "contratos_validar", "contratos_registrar", "contratos_alertas"]);
    expect(primera.needsConfirmation).toBe(true);
    expect(primera.reply.trim().endsWith("?")).toBe(true);
    expect(primera.reply).toContain(`| msg-006 | nuevo | ${REVISION_006.join(", ")} |`);
    expect(primera.reply).toContain("CT-2026-009 (27 d)");
  });

  test("msg-006 se pausa en el motor: ni siquiera se intenta registrar en la primera pasada", () => {
    expect(pasos(primera).some((paso) => paso.nombre === "contratos_registrar" && paso.args.mensaje_id === "msg-006")).toBe(false);
    expect(primera.reply).toContain("### msg-006 (CM-2026-03) requiere revisión");
  });

  test("tras «confirmo …» el motor se reanuda y registra msg-006 con los valores dictados", async () => {
    expect(segunda.needsConfirmation).toBe(false);
    expect(segunda.toolCalls).toHaveLength(1);
    const [decision] = segunda.toolCalls;
    expect(decision).toMatchObject({
      nombre: RESPONDER,
      ok: true,
      resumen: "aprobado msg-006: insertado CM-2026-03",
      args: { mensaje_id: "msg-006", decision: "aprobar", correcciones: { valor: 0, fecha_fin: "2027-08-31" }, hoy: HOY },
    });
    expect(decision?.pasos?.map((paso) => paso.nombre)).toEqual(["contratos_registrar", "contratos_alertas"]);
    expect(decision?.pasos?.[0]).toMatchObject({ ok: true, resumen: "insertado CM-2026-03", args: { confirmado: true } });
    const procesados = JSON.parse(await leerSalida(ctx, "procesados.json")) as Record<string, { estado: string }>;
    expect(procesados["msg-006"]?.estado).toBe("registrado");
    expect(await leerSalida(ctx, "sharepoint", "maestro-contratos.csv")).toContain("CM-2026-03");
  });

  test("cada llamada, de la recepcionista y del motor, queda en out/log.jsonl y en la sesión (CA4)", async () => {
    const visibles = [...primera.toolCalls, ...segunda.toolCalls, ...pasos(primera), ...pasos(segunda)];
    const log = lineasJson(await leerSalida(ctx, "log.jsonl")).filter((entrada) => entrada.herramienta !== "chat_aprobar");
    expect(log).toHaveLength(visibles.length);
    const sesion = await new SesionesEnArchivo(ctx.directory).obtener("demo");
    expect(sesion?.turnos.map((turno) => turno.usuario)).toEqual([PROMPT_DEMO, CONFIRMACION]);
    expect(sesion?.pendientesConfirmacion).toEqual([]);
  });
});

describe("rechazo desde el chat con el proveedor offline", () => {
  test("«rechaza msg-006 porque …» cierra el mensaje sin tocar el maestro y anota la decisión", async () => {
    const ctx = await crearProyecto();
    const agente = crearAgente(ctx, new ProveedorOffline());
    await agente.conversar("r", PROMPT_DEMO);
    const respuesta = await agente.conversar("r", "rechaza msg-006 porque falta la firma del cliente");
    expect(respuesta.toolCalls[0]).toMatchObject({ nombre: RESPONDER, ok: true, args: { decision: "rechazar", motivo: "falta la firma del cliente" } });
    expect(respuesta.needsConfirmation).toBe(false);
    expect(await leerSalida(ctx, "sharepoint", "maestro-contratos.csv")).not.toContain("CM-2026-03");
    const [decision] = lineasJson(await leerSalida(ctx, "decisiones.jsonl"));
    expect(decision).toMatchObject({ mensaje_id: "msg-006", decision: "rechazado", via: "chat", aprobador: "chat r", motivo: "falta la firma del cliente" });
  });
});

describe("contrato reenviado a las herramientas del motor", () => {
  test("acepta evidencias null y campos null omitidos, como los reenvía Gemini", async () => {
    const ctx = await crearProyecto();
    const { numero_otrosi: _otrosi, notas: _notas, ...contrato } = await extraerOk(ctx, "msg-003");
    const conNulls = { ...contrato, objeto: { confianza: contrato.objeto.confianza, evidencia: null }, id_contrato: { ...contrato.id_contrato, evidencia: null } };
    const validacion = await llamarHerramienta<ValidacionReportada>("contratos_validar", { mensaje_id: "msg-003", contrato: conNulls }, ctx);
    expect(validacion.ok && validacion.data.clasificacion).toBe("actualizacion");
  });
});

describe("reglas del ciclo", () => {
  test("el modelo solo ve las cinco herramientas de la recepcionista", async () => {
    const ctx = await crearProyecto();
    const proveedor = proveedorFijo(() => texto("hola"));
    await crearAgente(ctx, proveedor).conversar("s0", "hola");
    expect(proveedor.vistas).toEqual([
      "recepcion_consultar_estado",
      "recepcion_consultar_maestro",
      "recepcion_explicar_validacion",
      PROCESAR,
      RESPONDER,
    ]);
  });

  test("CA1: al llegar al tope de iteraciones responde con lo hecho y lo que falta", async () => {
    const ctx = await crearProyecto();
    const proveedor = proveedorFijo(() => pedir({ id: "x", nombre: "recepcion_consultar_estado", args: {} }));
    const agente = crearAgente(ctx, proveedor, { maxIteraciones: 3 });
    const respuesta = await agente.conversar("s1", "procesa");
    expect(proveedor.llamadas).toBe(3);
    expect(respuesta.toolCalls).toHaveLength(3);
    expect(respuesta.reply).toContain("tope de 3 iteraciones");
    expect(respuesta.reply).toContain("Lo que falta");
  });

  test("tope de tokens por sesión: corta sin llamar al modelo y la sesión sigue respondiendo", async () => {
    const ctx = await crearProyecto();
    const proveedor = proveedorFijo(() => texto("hola", { entrada: 80, salida: 30 }));
    const agente = crearAgente(ctx, proveedor, { maxTokensSesion: 100 });
    expect((await agente.conversar("s2", "hola")).reply).toBe("hola");
    const cortada = await agente.conversar("s2", "otra vez");
    expect(cortada.reply).toContain("tope de 100 tokens");
    expect(proveedor.llamadas).toBe(1);
    expect((await agente.conversar("s3", "sesión nueva")).reply).toBe("hola");
  });

  test("tope de tokens del proceso: abrir sesiones nuevas no lo evade", async () => {
    const ctx = await crearProyecto();
    const agente = crearAgente(ctx, proveedorFijo(() => texto("hola", { entrada: 60, salida: 0 })), { maxTokensProceso: 100 });
    await agente.conversar("a", "1");
    await agente.conversar("b", "2");
    expect((await agente.conversar("c", "3")).reply).toContain("tope de consumo");
  });

  test("CA5: un error del proveedor se explica en el chat y la sesión no muere", async () => {
    const ctx = await crearProyecto();
    const proveedor = proveedorFijo((llamada) => (llamada === 1 ? fallo("Gemini no respondió en 10 ms (tiempo de espera agotado)") : texto("de vuelta")));
    const agente = crearAgente(ctx, proveedor);
    const conError = await agente.conversar("s4", "hola");
    expect(conError.reply).toContain("tiempo de espera agotado");
    expect(conError.reply).toContain("La sesión sigue activa");
    expect((await agente.conversar("s4", "¿sigues?")).reply).toBe("de vuelta");
  });

  test("CA5: argumentos inválidos y herramientas fuera de la recepcionista vuelven al modelo como error", async () => {
    const ctx = await crearProyecto();
    const contrato = await extraerOk(ctx, "msg-001");
    const proveedor = proveedorFijo((llamada) =>
      llamada === 1
        ? pedir(
            { id: "1", nombre: "recepcion_explicar_validacion", args: { mensaje_id: "../x" } },
            { id: "2", nombre: "contratos_registrar", args: { mensaje_id: "msg-001", contrato } },
          )
        : texto("listo"),
    );
    const respuesta = await crearAgente(ctx, proveedor).conversar("s5", "registra msg-001");
    expect(respuesta.toolCalls.map((llamada) => llamada.ok)).toEqual([false, false]);
    expect(respuesta.toolCalls[0]?.resumen).toContain("argumentos inválidos");
    expect(respuesta.toolCalls[1]?.resumen).toContain("herramienta desconocida");
    expect(respuesta.reply).toBe("listo");
    expect(await leerSalida(ctx, "procesados.json")).toBe("");
  });

  test("CA3: el modelo no puede aprobar en el mismo turno en que el motor pausó el mensaje", async () => {
    const ctx = await crearProyecto();
    const autoaprueba = proveedorFijo((llamada) => (llamada === 1 ? pedir(procesar006()) : llamada === 2 ? pedir(aprobar006()) : texto("Registrado.")));
    const respuesta = await crearAgente(ctx, autoaprueba).conversar("s6", "procesa msg-006");
    expect(respuesta.toolCalls[1]?.ok).toBe(false);
    expect(respuesta.toolCalls[1]?.resumen).toContain("decisión no autorizada");
    expect(await leerSalida(ctx, "procesados.json")).not.toContain("msg-006");
    expect(respuesta.needsConfirmation).toBe(true);
    expect(respuesta.reply).toStartWith("Registrado.");
    expect(respuesta.reply).toContain("¿Confirmas los campos en revisión de msg-006?");
  });

  test("CA3: tampoco puede decidir sobre un mensaje por el que nunca preguntó", async () => {
    const ctx = await crearProyecto();
    const proveedor = proveedorFijo((llamada) => (llamada === 1 ? pedir(aprobar006("1")) : texto("Hecho.")));
    const respuesta = await crearAgente(ctx, proveedor).conversar("s7", "aprueba msg-006");
    expect(respuesta.toolCalls[0]?.resumen).toContain("decisión no autorizada");
    expect(respuesta.toolCalls[0]?.pasos).toBeUndefined();
  });

  test("CA3: la pausa del motor basta para pedir confirmación y el turno siguiente puede reanudarlo", async () => {
    const ctx = await crearProyecto();
    const proveedor = proveedorFijo((llamada) =>
      llamada === 1 ? pedir(procesar006()) : llamada === 2 ? texto("¿Confirmas los valores de msg-006?") : llamada === 3 ? pedir(aprobar006()) : texto("Registrado."),
    );
    const agente = crearAgente(ctx, proveedor);
    const pregunta = await agente.conversar("s8", "procesa msg-006");
    expect(pregunta.needsConfirmation).toBe(true);
    expect(pregunta.reply).toBe("¿Confirmas los valores de msg-006?");
    expect((await new SesionesEnArchivo(ctx.directory).obtener("s8"))?.pendientesConfirmacion).toEqual(["msg-006"]);
    const confirmada = await agente.conversar("s8", "sí, valor 0");
    expect(confirmada.toolCalls[0]).toMatchObject({ nombre: RESPONDER, ok: true, resumen: "aprobado msg-006: insertado CM-2026-03" });
    expect((await new SesionesEnArchivo(ctx.directory).obtener("s8"))?.pendientesConfirmacion).toEqual([]);
  });
});
