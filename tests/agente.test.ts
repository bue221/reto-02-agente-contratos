import { beforeAll, describe, expect, test } from "bun:test";
import { AgenteContratos, type LimitesCiclo } from "../src/agente/ciclo.ts";
import { SesionesEnArchivo } from "../src/agente/sesiones.ts";
import type { RespuestaChat } from "../src/api/tipos.ts";
import { type Resultado, exito, fallo } from "../src/dominio/resultado.ts";
import type { LlamadaHerramienta, ProveedorLlm, RespuestaLlm } from "../src/llm/adapter.ts";
import { ProveedorOffline } from "../src/llm/offline.ts";
import type { ContextoHerramienta } from "../src/tools/herramienta.ts";
import { HOY, crearProyecto, extraerOk, leerSalida, lineasJson } from "./apoyo.ts";

const PROMPT_DEMO =
  "Procesa el buzón de contratos con fecha de hoy 2026-09-03. Registra lo que esté limpio, muéstrame lo que requiere revisión campo por campo y termina con el reporte de alertas. No registres nada dudoso sin preguntarme.";
const CONFIRMACION = "confirmo el valor 0 y la fecha fin 2027-08-31";
const LIMITES: LimitesCiclo = { maxIteraciones: 25, maxTokensSesion: 100_000, maxTokensProceso: 1_000_000 };

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

/** Proveedor de prueba que responde siempre lo mismo (o lo que diga la función). */
function proveedorFijo(responder: (llamada: number) => Resultado<RespuestaLlm>): ProveedorLlm & { llamadas: number } {
  return {
    nombre: "prueba",
    modelo: "fijo",
    llamadas: 0,
    async enviar() {
      this.llamadas += 1;
      return responder(this.llamadas);
    },
  };
}

const texto = (contenido: string, uso = { entrada: 0, salida: 0 }): Resultado<RespuestaLlm> => exito({ texto: contenido, llamadas: [], uso });
const pedir = (...llamadas: LlamadaHerramienta[]): Resultado<RespuestaLlm> => exito({ texto: "", llamadas, uso: { entrada: 0, salida: 0 } });
const nombres = (respuesta: RespuestaChat): string[] => [...new Set(respuesta.toolCalls.map((llamada) => llamada.nombre))];

describe("flujo de la demo con el proveedor offline (PRD 11)", () => {
  let ctx: ContextoHerramienta;
  let agente: AgenteContratos;
  let primera: RespuestaChat;
  let segunda: RespuestaChat;

  beforeAll(async () => {
    ctx = await crearProyecto();
    agente = crearAgente(ctx, new ProveedorOffline());
    primera = await agente.conversar("demo", PROMPT_DEMO);
    segunda = await agente.conversar("demo", CONFIRMACION);
  });

  test("el primer turno llama a las cinco herramientas y termina pidiendo confirmación", () => {
    expect(nombres(primera)).toEqual(["contratos_leer_buzon", "contratos_extraer", "contratos_validar", "contratos_registrar", "contratos_alertas"]);
    expect(primera.needsConfirmation).toBe(true);
    expect(primera.reply.trim().endsWith("?")).toBe(true);
    expect(primera.reply).toContain("| msg-006 | nuevo | valor, fecha_inicio, fecha_fin |");
    expect(primera.reply).toContain("CT-2026-009 (27 d)");
  });

  test("msg-006 no se registra en la primera pasada", () => {
    const registro006 = primera.toolCalls.find((llamada) => llamada.nombre === "contratos_registrar" && llamada.args.mensaje_id === "msg-006");
    expect(registro006?.ok).toBe(false);
    expect(registro006?.resumen).toStartWith("requiere revisión");
  });

  test("tras «confirmo …» msg-006 queda registrado con los valores confirmados", async () => {
    expect(segunda.needsConfirmation).toBe(false);
    expect(segunda.toolCalls).toHaveLength(1);
    const [registro] = segunda.toolCalls;
    expect(registro).toMatchObject({ nombre: "contratos_registrar", ok: true, resumen: "insertado CM-2026-03", args: { mensaje_id: "msg-006", confirmado: true } });
    const procesados = JSON.parse(await leerSalida(ctx, "procesados.json")) as Record<string, { estado: string }>;
    expect(procesados["msg-006"]?.estado).toBe("registrado");
    expect(await leerSalida(ctx, "sharepoint", "maestro-contratos.csv")).toContain("CM-2026-03");
  });

  test("cada llamada queda en out/log.jsonl y en el historial de la sesión (CA4)", async () => {
    const log = lineasJson(await leerSalida(ctx, "log.jsonl"));
    expect(log).toHaveLength(primera.toolCalls.length + segunda.toolCalls.length);
    const sesion = await new SesionesEnArchivo(ctx.directory).obtener("demo");
    expect(sesion?.turnos.map((turno) => turno.usuario)).toEqual([PROMPT_DEMO, CONFIRMACION]);
    expect(sesion?.pendientesConfirmacion).toEqual([]);
  });
});

describe("reglas del ciclo", () => {
  test("CA1: al llegar al tope de iteraciones responde con lo hecho y lo que falta", async () => {
    const ctx = await crearProyecto();
    const proveedor = proveedorFijo(() => pedir({ id: "x", nombre: "contratos_leer_buzon", args: {} }));
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

  test("CA5: argumentos inválidos y herramientas inexistentes vuelven al modelo como error", async () => {
    const ctx = await crearProyecto();
    const proveedor = proveedorFijo((llamada) =>
      llamada === 1 ? pedir({ id: "1", nombre: "contratos_extraer", args: { mensaje_id: "../x" } }, { id: "2", nombre: "borrar_todo", args: {} }) : texto("listo"),
    );
    const respuesta = await crearAgente(ctx, proveedor).conversar("s5", "extrae");
    expect(respuesta.toolCalls.map((llamada) => llamada.ok)).toEqual([false, false]);
    expect(respuesta.toolCalls[0]?.resumen).toContain("argumentos inválidos");
    expect(respuesta.toolCalls[1]?.resumen).toContain("herramienta desconocida");
    expect(respuesta.reply).toBe("listo");
  });

  test("CA3: el modelo no puede autoconfirmar en el mismo turno en que surge la duda", async () => {
    const ctx = await crearProyecto();
    const contrato = await extraerOk(ctx, "msg-006");
    const autoconfirma = proveedorFijo((llamada) =>
      llamada === 1 ? pedir({ id: "1", nombre: "contratos_registrar", args: { mensaje_id: "msg-006", contrato, confirmado: true } }) : texto("Registrado."),
    );
    const respuesta = await crearAgente(ctx, autoconfirma).conversar("s6", "registra msg-006");
    expect(respuesta.toolCalls[0]?.ok).toBe(false);
    expect(respuesta.toolCalls[0]?.resumen).toContain("confirmación no autorizada");
    expect(await leerSalida(ctx, "procesados.json")).toBe("");
  });

  test("CA3: validar con campos en revisión basta para pedir confirmación aunque el modelo no intente registrar", async () => {
    const ctx = await crearProyecto();
    const contrato = await extraerOk(ctx, "msg-006");
    const cauto = proveedorFijo((llamada) =>
      llamada === 1 ? pedir({ id: "1", nombre: "contratos_validar", args: { mensaje_id: "msg-006", contrato } }) : texto("¿Confirmas los valores de msg-006?"),
    );
    const agente = crearAgente(ctx, cauto);
    const respuesta = await agente.conversar("s8", "valida msg-006");
    expect(respuesta.needsConfirmation).toBe(true);
    expect(respuesta.reply).toBe("¿Confirmas los valores de msg-006?");
    expect((await new SesionesEnArchivo(ctx.directory).obtener("s8"))?.pendientesConfirmacion).toEqual(["msg-006"]);
  });

  test("CA3: si el modelo olvida preguntar, el ciclo agrega la pregunta explícita", async () => {
    const ctx = await crearProyecto();
    const contrato = await extraerOk(ctx, "msg-006");
    const callado = proveedorFijo((llamada) =>
      llamada === 1 ? pedir({ id: "1", nombre: "contratos_registrar", args: { mensaje_id: "msg-006", contrato } }) : texto("Listo."),
    );
    const respuesta = await crearAgente(ctx, callado).conversar("s7", "registra msg-006");
    expect(respuesta.needsConfirmation).toBe(true);
    expect(respuesta.reply).toStartWith("Listo.");
    expect(respuesta.reply).toContain("¿Confirmas los campos en revisión de msg-006?");
  });
});
