import { beforeAll, describe, expect, test } from "bun:test";
import type { ExplicacionMensaje } from "../../src/application/use-cases/mailbox-view.ts";
import type { ConsultaMaestro } from "../../src/application/use-cases/master-query.ts";
import { rutaTrasValidar } from "../../src/application/workflows/contract-graph.ts";
import type { Resultado } from "../../src/core/domain/result.ts";
import type { LlamadaVisible, RespuestaBuzon } from "../../src/http/types.ts";
import { type DecisionReportada, type PasadaReportada, ejecutarHerramienta } from "../../src/tools/recepcion.ts";
import type { ContextoHerramienta } from "../../src/tools/tool.ts";
import { HOY, REVISION_006, crearProyecto } from "../helpers.ts";

/** Llama a una herramienta de la recepcionista como lo hace el ciclo: con traza para ver lo que hizo el motor. */
async function recepcion<T>(ctx: ContextoHerramienta, nombre: string, args: Record<string, unknown>): Promise<{ resultado: Resultado<T>; pasos: LlamadaVisible[] }> {
  const pasos: LlamadaVisible[] = [];
  const resultado = JSON.parse(await ejecutarHerramienta(nombre, args, { ...ctx, traza: pasos })) as Resultado<T>;
  return { resultado, pasos };
}

function datos<T>(resultado: Resultado<T>): T {
  if (!resultado.ok) throw new Error(resultado.error);
  return resultado.data;
}

describe("arista condicional del nodo decidir", () => {
  test("cierra lo terminal, pausa lo dudoso y registra lo limpio", () => {
    expect(rutaTrasValidar({ clasificacion: "duplicado", requiere_revision: [] })).toBe("cerrar");
    expect(rutaTrasValidar({ clasificacion: "rechazado", requiere_revision: ["cliente"] })).toBe("cerrar");
    expect(rutaTrasValidar({ clasificacion: "nuevo", requiere_revision: ["valor"] })).toBe("esperar_revision");
    expect(rutaTrasValidar({ clasificacion: "actualizacion", requiere_revision: [] })).toBe("registrar");
  });
});

describe("recepcion_procesar_buzon: el motor determinista", () => {
  let ctx: ContextoHerramienta;
  let pasada: PasadaReportada;
  let pasos: LlamadaVisible[];

  beforeAll(async () => {
    ctx = await crearProyecto();
    const llamada = await recepcion<PasadaReportada>(ctx, "recepcion_procesar_buzon", { hoy: HOY });
    pasada = datos(llamada.resultado);
    pasos = llamada.pasos;
  });

  test("cada mensaje sigue el camino que fijan sus resultados, no el modelo", () => {
    const recorridos = Object.fromEntries(pasada.mensajes.map((mensaje) => [mensaje.mensaje_id, mensaje.recorrido.at(-1)]));
    expect(recorridos).toEqual({
      "msg-001": "registrar",
      "msg-002": "registrar",
      "msg-003": "registrar",
      "msg-004": "cerrar",
      "msg-005": "cerrar",
      "msg-006": "esperar_revision",
    });
    expect(pasada.mensajes[0]?.recorrido).toEqual(["extraer", "validar", "decidir", "registrar"]);
    expect(pasada.en_revision).toEqual(["msg-006"]);
  });

  test("lo pausado trae el detalle campo por campo con evidencia y el reporte de alertas sale al final", () => {
    const revision = pasada.mensajes.find((mensaje) => mensaje.mensaje_id === "msg-006")?.revision ?? [];
    expect(revision.map((campo) => campo.campo)).toEqual(REVISION_006);
    expect(revision.every((campo) => campo.confianza < 0.8)).toBe(true);
    expect(pasos[0]?.nombre).toBe("contratos_leer_buzon");
    expect(pasos.at(-1)?.nombre).toBe("contratos_alertas");
    expect("error" in pasada.alertas).toBe(false);
  });

  test("al modelo no le llega el contrato completo, solo lo que necesita para responder", () => {
    expect(pasada.mensajes.every((mensaje) => !("contrato" in mensaje))).toBe(true);
  });

  test("cada mensaje extraído trae valor y confianza por campo, sin la evidencia", () => {
    const campos = pasada.mensajes.find((mensaje) => mensaje.mensaje_id === "msg-006")?.campos;
    expect(Object.keys(campos?.valor ?? {}).sort()).toEqual(["confianza", "valor"]);
    expect(campos?.valor.confianza).toBeLessThan(0.8);
    expect(Object.values(campos ?? {}).every((campo) => !("evidencia" in campo))).toBe(true);
    expect(pasada.mensajes.every((mensaje) => mensaje.campos !== null)).toBe(true);
  });

  test("con mensaje_ids solo procesa esos y reporta los que no están pendientes", async () => {
    const otro = await crearProyecto();
    const { resultado } = await recepcion<PasadaReportada>(otro, "recepcion_procesar_buzon", { hoy: HOY, mensaje_ids: ["msg-001", "msg-001", "msg-999"] });
    const parcial = datos(resultado);
    expect(parcial.mensajes.map((mensaje) => mensaje.mensaje_id)).toEqual(["msg-001"]);
    expect(parcial.omitidos).toEqual([{ mensaje_id: "msg-999", motivo: "no está pendiente en el buzón (ya procesado o inexistente)" }]);
  });

  test("con mensaje_ids vacío solo regenera las alertas", async () => {
    const otro = await crearProyecto();
    const { resultado, pasos: soloAlertas } = await recepcion<PasadaReportada>(otro, "recepcion_procesar_buzon", { hoy: HOY, mensaje_ids: [] });
    expect(datos(resultado).mensajes).toEqual([]);
    expect(soloAlertas.map((paso) => paso.nombre)).toEqual(["contratos_leer_buzon", "contratos_alertas"]);
  });
});

describe("herramientas de lectura de la recepcionista", () => {
  let ctx: ContextoHerramienta;

  beforeAll(async () => {
    ctx = await crearProyecto();
    await recepcion(ctx, "recepcion_procesar_buzon", { hoy: HOY });
  });

  test("consultar_estado refleja lo que dejó el motor, sin ejecutar herramientas del motor", async () => {
    const { resultado, pasos } = await recepcion<RespuestaBuzon>(ctx, "recepcion_consultar_estado", {});
    expect(datos(resultado).contadores).toEqual({ total: 6, pendientes: 0, requiere_revision: 1, procesados: 5 });
    expect(pasos).toEqual([]);
  });

  test("consultar_maestro busca por id, cliente o NIT sin distinguir tildes ni mayúsculas", async () => {
    const porId = datos((await recepcion<ConsultaMaestro>(ctx, "recepcion_consultar_maestro", { consulta: "ct-2026-015" })).resultado);
    expect(porId.filas.map((fila) => fila.id_contrato)).toEqual(["CT-2026-015"]);
    const porCliente = datos((await recepcion<ConsultaMaestro>(ctx, "recepcion_consultar_maestro", { consulta: "industrias delta" })).resultado);
    expect(porCliente.filas.some((fila) => fila.id_contrato === "CT-2026-015")).toBe(true);
    const todo = datos((await recepcion<ConsultaMaestro>(ctx, "recepcion_consultar_maestro", {})).resultado);
    expect(todo.total).toBeGreaterThan(porId.total);
  });

  test("explicar_validacion da los motivos de revisión de un mensaje analizado", async () => {
    const explicado = datos((await recepcion<ExplicacionMensaje>(ctx, "recepcion_explicar_validacion", { mensaje_id: "msg-006" })).resultado);
    expect(explicado.mensaje.estado).toBe("requiere_revision");
    expect(explicado.validacion?.requiere_revision).toEqual(REVISION_006);
    expect(explicado.extraccion?.valor.confianza).toBeLessThan(0.8);
    expect(explicado).not.toHaveProperty("adjuntos");
  });

  test("explicar_validacion de un mensaje inexistente es un error legible", async () => {
    const { resultado } = await recepcion(ctx, "recepcion_explicar_validacion", { mensaje_id: "msg-999" });
    expect(resultado).toEqual({ ok: false, error: "no existe el mensaje msg-999 en el buzón" });
  });
});

describe("recepcion_responder_revision: reanudar el motor", () => {
  test("rechazar sin motivo es un argumento inválido y no cierra el mensaje", async () => {
    const ctx = await crearProyecto();
    await recepcion(ctx, "recepcion_procesar_buzon", { hoy: HOY, mensaje_ids: ["msg-006"] });
    const { resultado, pasos } = await recepcion(ctx, "recepcion_responder_revision", { mensaje_id: "msg-006", decision: "rechazar" });
    expect(resultado.ok).toBe(false);
    expect(!resultado.ok && resultado.error).toContain("argumentos inválidos: motivo");
    expect(pasos).toEqual([]);
  });

  test("aprobar con hoy registra con confirmación y regenera las alertas con el contrato nuevo", async () => {
    const ctx = await crearProyecto();
    await recepcion(ctx, "recepcion_procesar_buzon", { hoy: HOY, mensaje_ids: ["msg-006"] });
    const { resultado, pasos } = await recepcion<DecisionReportada>(ctx, "recepcion_responder_revision", {
      mensaje_id: "msg-006",
      decision: "aprobar",
      correcciones: { valor: 0, fecha_fin: "2027-08-31" },
      hoy: HOY,
    });
    const decision = datos(resultado);
    expect(decision).toMatchObject({ decision: "aprobado", estado: "registrado", id_contrato: "CM-2026-03", accion: "insertado" });
    expect(pasos.map((paso) => paso.nombre)).toEqual(["contratos_registrar", "contratos_alertas"]);
    const alertas = decision.alertas;
    expect(alertas && !("error" in alertas) && alertas.registrados_desde_corte.map((registro) => registro.id_contrato)).toContain("CM-2026-03");
  });

  test("un mensaje que no está pausado no se puede aprobar", async () => {
    const ctx = await crearProyecto();
    const { resultado } = await recepcion(ctx, "recepcion_responder_revision", { mensaje_id: "msg-002", decision: "aprobar" });
    expect(!resultado.ok && resultado.error).toContain("no está esperando aprobación");
  });
});
