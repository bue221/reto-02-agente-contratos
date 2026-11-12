import { describe, expect, test } from "bun:test";
import { AIMessage, HumanMessage, isToolMessage } from "@langchain/core/messages";
import { Command, MemorySaver } from "@langchain/langgraph";
import { ARISTAS, type NodoMensaje } from "../../api/src/application/workflows/contract-graph.ts";
import { ProveedorOffline } from "../../api/src/llm/offline.ts";
import { HOY, crearProyecto, leerSalida, lineasJson } from "../../api/tests/helpers.ts";
import { compilarMotor } from "../src/engine-graph.ts";
import { compilarRecepcion } from "../src/receptionist-graph.ts";
import { crearGrafoReinicio } from "../src/reset-graph.ts";

const hilo = (id: string) => ({ configurable: { thread_id: id } });

function recorridoValido(recorrido: readonly NodoMensaje[]): boolean {
  return recorrido.every((nodo, i) => {
    const siguiente = recorrido[i + 1] ?? null;
    return ARISTAS[nodo].includes(siguiente);
  });
}

describe("grafo del motor en LangGraph", () => {
  test("recorre los seis mensajes, se detiene en la revisión humana de msg-006 y reanuda con la decisión", async () => {
    const ctx = await crearProyecto();
    const grafo = compilarMotor({ directorio: ctx.directory }, new MemorySaver());

    await grafo.invoke({ hoy: HOY }, hilo("m1"));
    const pausado = await grafo.getState(hilo("m1"));
    expect(pausado.next).toEqual(["revision_humana"]);
    expect(pausado.values.en_revision).toEqual(["msg-006"]);
    expect(pausado.values.mensajes.map((mensaje: { mensaje_id: string }) => mensaje.mensaje_id)).toEqual(["msg-001", "msg-002", "msg-003", "msg-004", "msg-005", "msg-006"]);
    expect(pausado.values.mensajes.every((mensaje: { recorrido: NodoMensaje[] }) => recorridoValido(mensaje.recorrido))).toBe(true);
    expect(await leerSalida(ctx, "sharepoint", "maestro-contratos.csv")).not.toContain("CM-2026-03");

    const final = await grafo.invoke(new Command({ resume: { decision: "aprobar", correcciones: { valor: 0, fecha_fin: "2027-08-31" }, aprobador: "Ana" } }), hilo("m1"));
    expect(final.decisiones).toEqual([{ mensaje_id: "msg-006", resuelto: true, resumen: "aprobado: insertado CM-2026-03" }]);
    expect(final.reporte && "registrados_desde_corte" in final.reporte && final.reporte.registrados_desde_corte.map((r) => r.id_contrato)).toContain("CM-2026-03");
    expect((await grafo.getState(hilo("m1"))).next).toEqual([]);
    expect(lineasJson(await leerSalida(ctx, "decisiones.jsonl"))[0]).toMatchObject({ via: "studio", aprobador: "studio Ana", id_contrato: "CM-2026-03" });
  });

  test("una respuesta inválida no decide nada: el grafo vuelve a pausar en el mismo mensaje", async () => {
    const ctx = await crearProyecto();
    const grafo = compilarMotor({ directorio: ctx.directory }, new MemorySaver());
    await grafo.invoke({ hoy: HOY, mensaje_ids: ["msg-006"] }, hilo("m2"));
    const tras = await grafo.invoke(new Command({ resume: { decision: "rechazar" } }), hilo("m2"));
    expect(tras.decisiones[0]).toMatchObject({ mensaje_id: "msg-006", resuelto: false });
    expect((await grafo.getState(hilo("m2"))).next).toEqual(["revision_humana"]);
  });
});

describe("grafo de reinicio de la demo", () => {
  test("deja out/ como recién desplegado: maestro del fixture y los seis mensajes pendientes", async () => {
    const ctx = await crearProyecto();
    await compilarMotor({ directorio: ctx.directory }, new MemorySaver()).invoke({ hoy: HOY }, hilo("x1"));
    expect(await leerSalida(ctx, "sharepoint", "maestro-contratos.csv")).toContain("CT-2026-015");

    const final = await crearGrafoReinicio({ directorio: ctx.directory }).compile().invoke({});
    expect(final).toEqual({ mensajes: 6, error: null });
    expect(await leerSalida(ctx, "sharepoint", "maestro-contratos.csv")).not.toContain("CT-2026-015");
    expect(await leerSalida(ctx, "procesados.json")).toBe("");
  });
});

describe("grafo de la recepcionista en LangGraph", () => {
  test("mismo flujo del PRD §11 con el proveedor offline: pregunta, y en el turno siguiente registra", async () => {
    const ctx = await crearProyecto();
    const deps = { directorio: ctx.directory, proveedor: new ProveedorOffline(), maxIteraciones: 25, cargarSistema: async () => "sistema" };
    const grafo = compilarRecepcion(deps, new MemorySaver());

    const primero = await grafo.invoke({ messages: [new HumanMessage("Procesa el buzón de contratos con fecha de hoy 2026-09-03")] }, hilo("r1"));
    const herramientas = primero.messages.filter(isToolMessage).map((mensaje) => mensaje.name);
    expect(herramientas).toEqual(["recepcion_procesar_buzon"]);
    const respuesta = primero.messages.at(-1);
    expect(respuesta instanceof AIMessage && String(respuesta.content).trim().endsWith("?")).toBe(true);
    expect(primero.pendientes).toEqual(["msg-006"]);

    const segundo = await grafo.invoke({ messages: [new HumanMessage("confirmo el valor 0 y la fecha fin 2027-08-31")] }, hilo("r1"));
    expect(segundo.pendientes).toEqual([]);
    expect(await leerSalida(ctx, "sharepoint", "maestro-contratos.csv")).toContain("CM-2026-03");
  });

  test("recepcion_procesar_buzon recorre el motor como subgrafo visible de herramientas, con el mismo resultado", async () => {
    const ctx = await crearProyecto();
    const deps = { directorio: ctx.directory, proveedor: new ProveedorOffline(), maxIteraciones: 25, cargarSistema: async () => "sistema" };
    const grafo = compilarRecepcion(deps, new MemorySaver());

    const dibujo = await grafo.getGraphAsync({ xray: true });
    expect(Object.keys(dibujo.nodes)).toEqual(expect.arrayContaining(["herramientas:extraer", "herramientas:decidir", "herramientas:esperar_revision", "herramientas:alertas"]));

    const nodosDelMotor = new Set<string>();
    let final: Record<string, unknown> = {};
    const eventos = await grafo.stream(
      { messages: [new HumanMessage("Procesa el buzón de contratos con fecha de hoy 2026-09-03")] },
      { ...hilo("r3"), streamMode: "updates", subgraphs: true },
    );
    for await (const [espacio, actualizacion] of eventos) {
      if (espacio.some((parte) => parte.startsWith("herramientas"))) for (const nodo of Object.keys(actualizacion)) nodosDelMotor.add(nodo);
      final = actualizacion;
    }
    expect([...nodosDelMotor]).toEqual(expect.arrayContaining(["ingestar", "extraer", "validar", "decidir", "registrar", "esperar_revision", "cerrar", "alertas"]));
    expect(final).toHaveProperty("recepcionista");

    const estado = await grafo.getState(hilo("r3"));
    expect(estado.values.pendientes).toEqual(["msg-006"]);
    const resultado = estado.values.messages.find(isToolMessage);
    const visible = resultado?.artifact as { pasos?: { nombre: string }[] } | undefined;
    expect(visible?.pasos?.filter((paso) => paso.nombre === "contratos_extraer")).toHaveLength(6);
    expect(lineasJson(await leerSalida(ctx, "log.jsonl")).some((entrada) => entrada.herramienta === "recepcion_procesar_buzon" && entrada.ok)).toBe(true);
  });

  test("la guarda CA3 también rige en Studio: no se decide sobre un mensaje por el que no se preguntó", async () => {
    const ctx = await crearProyecto();
    const autoaprueba = {
      nombre: "prueba",
      modelo: "fijo",
      llamadas: 0,
      async enviar() {
        this.llamadas += 1;
        const llamadas = this.llamadas === 1 ? [{ id: "1", nombre: "recepcion_responder_revision", args: { mensaje_id: "msg-006", decision: "aprobar" } }] : [];
        return { ok: true as const, data: { texto: this.llamadas === 1 ? "" : "Hecho.", llamadas, uso: { entrada: 0, salida: 0 } } };
      },
    };
    const grafo = compilarRecepcion({ directorio: ctx.directory, proveedor: autoaprueba, maxIteraciones: 25, cargarSistema: async () => "sistema" });
    const estado = await grafo.invoke({ messages: [new HumanMessage("aprueba msg-006")] });
    const resultado = estado.messages.find(isToolMessage);
    expect(String(resultado?.content)).toContain("decisión no autorizada");
  });
});
