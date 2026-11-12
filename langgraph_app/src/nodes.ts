/**
 * Nodos del pipeline de análisis (el agente RECOMIENDA) y de ejecución
 * (solo los invoca el grafo `resolucion`, tras una decisión humana).
 */
import { leerMensaje } from "./adapters/mailbox.ts";
import { cargarComerciales, resolverAutor } from "./adapters/comerciales.ts";
import { archivar } from "./adapters/archive.ts";
import { getCfg, getPropuestas, getRepo } from "./deps.ts";
import { clasificarDocumento, extraerDocumento } from "./adapters/llm/index.ts";
import { buscarDuplicado, decidirDesdeValidaciones, evaluarReglas } from "./rules.ts";
import type { PipelineState, PipelineUpdate } from "./state.ts";
import type { Contrato } from "./types.ts";

export async function cargar(state: PipelineState): Promise<PipelineUpdate> {
  const msgId = String(state.msgId ?? "").trim().toLowerCase();
  if (!msgId) {
    throw new Error(
      'Falta msgId. En Studio (grafo pipeline) envía: { "msgId": "msg-001" }. Para chat usa el grafo "chat".',
    );
  }
  const previa = getPropuestas().get(msgId);
  if (previa && previa.estado !== "PENDIENTE") {
    throw new Error(
      `${msgId} ya fue ${previa.estado.toLowerCase()} por un humano. Reinicia la demo para volver a analizarlo.`,
    );
  }
  const correo = leerMensaje(getCfg(), msgId);
  return {
    msgId,
    correo,
    validaciones: [],
    motivos: [],
    cambios: {},
    archivos: [],
    log: [
      `Correo de ${correo.de}: "${correo.asunto}" (${correo.adjuntos.length} adjunto/s)`,
    ],
  };
}

export async function clasificar(state: PipelineState): Promise<PipelineUpdate> {
  if (!state.correo) {
    throw new Error("Estado incompleto: falta correo. Corre el grafo desde el inicio con msgId.");
  }
  const { clasificacion, motor } = await clasificarDocumento(state.correo);
  return {
    clasificacion,
    log: [
      `Clasificado (${motor}) como ${clasificacion.tipo} (${clasificacion.confianza.toFixed(2)}): ${clasificacion.razon}`,
    ],
  };
}

export function rutaTrasClasificar(state: PipelineState): "extraer" | "resolver_autoria" {
  const tipo = state.clasificacion?.tipo;
  return tipo === "contrato" || tipo === "otrosi" || tipo === "actualizacion"
    ? "extraer"
    : "resolver_autoria";
}

export async function extraer(state: PipelineState): Promise<PipelineUpdate> {
  const tipo = state.clasificacion!.tipo;
  const correo = state.correo!;
  const patron = tipo === "otrosi" ? /otros[ií]/i : /contrato/i;
  const adj = correo.adjuntos.find((a) => patron.test(a.nombre)) ?? correo.adjuntos[0];
  if (!adj) return { log: ["Sin adjunto para extraer"] };
  const { extraccion, motor } = await extraerDocumento(adj.texto, tipo);
  return {
    documento: adj.nombre,
    extraccion,
    log: [`Datos extraídos de ${adj.nombre} (${motor})`],
  };
}

export async function resolverAutoria(state: PipelineState): Promise<PipelineUpdate> {
  const autor = resolverAutor(cargarComerciales(getCfg()), state.correo!.de);
  return {
    autor,
    log: [
      autor
        ? `Autoría: ${autor.nombre} · ${autor.region}`
        : `Autoría no resuelta para ${state.correo!.de}`,
    ],
  };
}

export async function buscarExistente(state: PipelineState): Promise<PipelineUpdate> {
  const tipo = state.clasificacion?.tipo;
  if (tipo !== "otrosi" && tipo !== "actualizacion") return {};
  const repo = getRepo();
  const c = state.correo!;
  const id =
    state.extraccion?.idContrato.valor ??
    `${c.asunto} ${c.cuerpo}`.match(/\bC-\d{3}\b/i)?.[0]?.toUpperCase();
  let existente = id ? repo.findById(id) : undefined;
  if (!existente && state.extraccion?.nit.valor) {
    const porNit = repo.findByNit(state.extraccion.nit.valor);
    if (porNit.length === 1) existente = porNit[0];
  }
  if (!existente) return {};
  return {
    existente,
    log: [`Contrato referenciado: ${existente.id_contrato}`],
  };
}

export async function validar(state: PipelineState): Promise<PipelineUpdate> {
  const validaciones = evaluarReglas(state, getRepo(), getCfg());
  const duplicadoDe = buscarDuplicado(state, getRepo());
  return { validaciones, duplicadoDe };
}

/** Calcula la decisión según rules.ts. En el pipeline es solo una RECOMENDACIÓN. */
export async function decidir(state: PipelineState): Promise<PipelineUpdate> {
  const { decision, motivos } = decidirDesdeValidaciones(state);
  return { decision, motivos, log: [`Decisión según reglas: ${decision}`] };
}

const estadoPara = (fin: string): Contrato["estado"] =>
  fin >= getCfg().hoy ? "ACTIVO" : "VENCIDO";

export async function ejecutarRegistrar(state: PipelineState): Promise<PipelineUpdate> {
  const cfg = getCfg();
  const repo = getRepo();
  const ex = state.extraccion!;
  const correo = state.correo!;
  const id = repo.nextId();
  const archivos = archivar(cfg, correo, `archivo/${id}`);
  repo.insert({
    id_contrato: id,
    cliente: ex.cliente.valor!,
    nit: ex.nit.valor!,
    valor: ex.valor.valor!,
    moneda: "COP",
    fecha_inicio: ex.fechaInicio.valor!,
    fecha_fin: ex.fechaFin.valor!,
    comercial_email: state.autor!.email,
    estado: estadoPara(ex.fechaFin.valor!),
    archivo: archivos[0] ?? "",
    actualizado_en: cfg.hoy,
  });
  return { contratoId: id, archivos, log: [`Registrado ${id} en el maestro`] };
}

export async function ejecutarActualizar(state: PipelineState): Promise<PipelineUpdate> {
  const cfg = getCfg();
  const repo = getRepo();
  const ex = state.extraccion!;
  const e = state.existente!;
  const nuevos: Partial<Contrato> = {};
  const cambios: Record<string, { antes: unknown; despues: unknown }> = {};
  const candidatos: [keyof Contrato, unknown][] = [
    ["valor", ex.valor.valor],
    ["fecha_inicio", ex.fechaInicio.valor],
    ["fecha_fin", ex.fechaFin.valor],
  ];
  for (const [k, nuevo] of candidatos) {
    if (nuevo !== null && nuevo !== e[k]) {
      cambios[k] = { antes: e[k], despues: nuevo };
      (nuevos as Record<string, unknown>)[k] = nuevo;
    }
  }
  const finEfectivo = (nuevos.fecha_fin as string | undefined) ?? e.fecha_fin;
  const archivos = archivar(cfg, state.correo!, `archivo/${e.id_contrato}`);
  repo.update(e.id_contrato, {
    ...nuevos,
    estado: estadoPara(finEfectivo),
    actualizado_en: cfg.hoy,
  });
  return {
    contratoId: e.id_contrato,
    cambios,
    archivos,
    log: [`Actualizado ${e.id_contrato}: ${Object.keys(cambios).join(", ") || "sin cambios"}`],
  };
}

export async function ejecutarDuplicado(state: PipelineState): Promise<PipelineUpdate> {
  const archivos = archivar(getCfg(), state.correo!, "duplicados");
  return {
    archivos,
    contratoId: state.duplicadoDe,
    log: ["Duplicado: no se modificó el maestro"],
  };
}

export async function ejecutarRechazar(state: PipelineState): Promise<PipelineUpdate> {
  const archivos = archivar(getCfg(), state.correo!, "rechazados");
  return {
    archivos,
    log: ["Rechazado: no se modificó el maestro"],
  };
}
