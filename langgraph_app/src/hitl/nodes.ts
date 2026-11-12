/**
 * Human-in-the-loop.
 *
 * - `proponer` cierra el pipeline del agente: guarda una RECOMENDACIÓN (tarjeta).
 * - El resto de nodos forman el grafo `resolucion`, que solo corre cuando un humano
 *   aprueba o rechaza. Las reglas se vuelven a evaluar: aprobar no salta rules.ts.
 */
import { archivar } from "../adapters/archive.ts";
import { cargarComerciales, resolverAutor } from "../adapters/comerciales.ts";
import { getLlm } from "../adapters/llm/index.ts";
import { getAudit, getCfg, getMailbox, getPropuestas } from "../deps.ts";
import type {
  Campo,
  CampoEditable,
  Extraccion,
  Propuesta,
  ResolucionHumana,
} from "../domain/types.ts";
import type {
  PipelineState,
  PipelineUpdate,
  ResolucionState,
  ResolucionUpdate,
} from "../state.ts";

export const CAMPOS_EDITABLES: readonly CampoEditable[] = [
  "idContrato",
  "cliente",
  "nit",
  "valor",
  "fechaInicio",
  "fechaFin",
];

function motorActivo(): string {
  const llm = getLlm();
  return llm.documents.isActive() ? llm.documents.id : llm.documentsFallback.id;
}

/** Último nodo del pipeline: el agente propone, no ejecuta. */
export async function proponer(state: PipelineState): Promise<PipelineUpdate> {
  const correo = state.correo!;
  const motor = motorActivo();
  const propuesta: Propuesta = {
    msgId: state.msgId,
    creadaEn: new Date().toISOString(),
    estado: "PENDIENTE",
    recomendacion: state.decision!,
    motivos: state.motivos ?? [],
    motor,
    clasificacion: state.clasificacion!,
    documento: state.documento ?? null,
    extraccion: state.extraccion ?? null,
    autorEmail: state.autor?.email ?? null,
    existenteId: state.existente?.id_contrato ?? null,
    duplicadoDe: state.duplicadoDe ?? null,
    validaciones: state.validaciones ?? [],
    correo: { de: correo.de, fecha: correo.fecha, asunto: correo.asunto },
    resolucion: null,
  };
  getPropuestas().upsert(propuesta);
  getAudit().append({
    ts: propuesta.creadaEn,
    msgId: state.msgId,
    fase: "propuesta",
    modelo: motor,
    tipo: state.clasificacion?.tipo,
    decision: state.decision,
    contratoId: propuesta.existenteId ?? propuesta.duplicadoDe,
    motivos: propuesta.motivos,
    validaciones: propuesta.validaciones.map((x) => ({ regla: x.regla, ok: x.ok })),
    extraccion: propuesta.extraccion,
    archivos: [],
    log: state.log,
  });
  getMailbox().markProcessed(state.msgId);
  return {
    log: [`Recomendación ${state.decision} guardada: pendiente de aprobación humana`],
  };
}

export async function cargarPropuesta(state: ResolucionState): Promise<ResolucionUpdate> {
  const msgId = String(state.msgId ?? "").trim().toLowerCase();
  if (!msgId) throw new Error('Falta msgId. Ej: { "msgId": "msg-006", "accion": "aprobar" }');
  if (state.accion !== "aprobar" && state.accion !== "rechazar") {
    throw new Error('accion debe ser "aprobar" o "rechazar"');
  }
  const propuesta = getPropuestas().get(msgId);
  if (!propuesta) throw new Error(`No hay propuesta para ${msgId}. Analízalo primero con el pipeline.`);
  if (propuesta.estado !== "PENDIENTE") {
    throw new Error(`La propuesta ${msgId} ya fue ${propuesta.estado.toLowerCase()}`);
  }

  const cfg = getCfg();
  const autor = propuesta.autorEmail
    ? resolverAutor(cargarComerciales(cfg), propuesta.autorEmail)
    : undefined;

  // `existente` y `duplicadoDe` se recalculan en buscar_existente/validar:
  // el maestro pudo cambiar desde que se creó la propuesta.
  return {
    msgId,
    correo: getMailbox().getMessage(msgId),
    clasificacion: propuesta.clasificacion,
    documento: propuesta.documento ?? undefined,
    extraccion: propuesta.extraccion ?? undefined,
    autor,
    recomendacion: propuesta.recomendacion,
    validaciones: [],
    motivos: [],
    cambios: {},
    archivos: [],
    log: [
      `Propuesta ${msgId} cargada (recomendación: ${propuesta.recomendacion})`,
      `Acción humana: ${state.accion}${state.aprobador ? ` por ${state.aprobador}` : ""}`,
    ],
  };
}

export function rutaTrasCargar(state: ResolucionState): "aplicar_correcciones" | "ejecutar_rechazo_humano" {
  return state.accion === "rechazar" ? "ejecutar_rechazo_humano" : "aplicar_correcciones";
}

function parseValorHumano(raw: string): number | null {
  const digitos = raw.replace(/[^\d]/g, "");
  return digitos ? Number(digitos) : null;
}

/**
 * El humano confirma los datos de la tarjeta (con o sin correcciones).
 * Lo confirmado pasa a confianza 1.0; NIT, duplicados, fechas y autoría se validan igual.
 */
export async function aplicarCorrecciones(state: ResolucionState): Promise<ResolucionUpdate> {
  const ex = state.extraccion;
  if (!ex) return { log: ["Sin datos extraídos: se evalúa la recomendación tal cual"] };

  const correcciones = state.correcciones ?? {};
  const nueva = structuredClone(ex) as Extraccion;
  const campos = nueva as unknown as Record<CampoEditable, Campo<unknown>>;
  const aplicadas: string[] = [];

  for (const campo of CAMPOS_EDITABLES) {
    const raw = correcciones[campo]?.trim();
    if (raw) {
      if ((campo === "fechaInicio" || campo === "fechaFin") && !/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
        throw new Error(`${campo} debe tener formato YYYY-MM-DD (recibido "${raw}")`);
      }
      const valor = campo === "valor" ? parseValorHumano(raw) : raw;
      campos[campo] = {
        valor,
        confianza: 1,
        evidencia: `Corregido por humano (antes: ${String(ex[campo].valor ?? "vacío")})`,
      };
      aplicadas.push(campo);
    } else if (campos[campo].valor !== null) {
      campos[campo] = { ...campos[campo], confianza: 1, evidencia: "Confirmado por humano" };
    }
  }

  return {
    extraccion: nueva,
    log: [
      aplicadas.length
        ? `Correcciones humanas: ${aplicadas.join(", ")}`
        : "Datos confirmados por humano sin correcciones",
    ],
  };
}

/**
 * Tras revalidar: solo se ejecuta lo que las reglas permiten.
 * Aprobar un rechazo recomendado lo archiva; aprobar algo que ahora las reglas
 * bloquean (p.ej. una corrección dejó el NIT inválido) se detiene sin tocar nada.
 */
export function rutaResolucion(
  state: ResolucionState,
):
  | "ejecutar_registrar"
  | "ejecutar_actualizar"
  | "ejecutar_duplicado"
  | "ejecutar_rechazar"
  | "bloquear" {
  switch (state.decision) {
    case "REGISTRAR_NUEVO":
      return "ejecutar_registrar";
    case "ACTUALIZAR":
      return "ejecutar_actualizar";
    case "DUPLICADO":
      return "ejecutar_duplicado";
    case "RECHAZAR":
      return state.recomendacion === "RECHAZAR" ? "ejecutar_rechazar" : "bloquear";
    default:
      return "bloquear";
  }
}

export async function ejecutarRechazoHumano(state: ResolucionState): Promise<ResolucionUpdate> {
  const archivos = archivar(getCfg(), state.correo!, "rechazados");
  return {
    decision: "RECHAZAR",
    motivos: [state.comentario?.trim() || "Rechazado por decisión humana"],
    archivos,
    log: ["Rechazado por humano: no se modificó el maestro"],
  };
}

export async function bloquear(state: ResolucionState): Promise<ResolucionUpdate> {
  getAudit().append({
    ts: new Date().toISOString(),
    msgId: state.msgId,
    fase: "resolucion",
    accion: state.accion,
    aprobador: state.aprobador?.trim() || "humano",
    comentario: state.comentario ?? null,
    correcciones: state.correcciones ?? {},
    decision: "BLOQUEADO_POR_REGLAS",
    motivos: state.motivos,
    extraccion: state.extraccion ?? null,
    log: state.log,
  });
  return {
    bloqueado: true,
    log: [`Aprobación bloqueada por reglas (${state.decision}): la propuesta sigue pendiente`],
  };
}

export async function auditarResolucion(state: ResolucionState): Promise<ResolucionUpdate> {
  const store = getPropuestas();
  const propuesta = store.get(state.msgId);
  if (!propuesta) throw new Error(`Propuesta ${state.msgId} desapareció durante la resolución`);

  const resolucion: ResolucionHumana = {
    accion: state.accion,
    decisionFinal: state.decision!,
    aprobador: state.aprobador?.trim() || "humano",
    comentario: state.comentario?.trim() || null,
    correcciones: state.correcciones ?? {},
    contratoId: state.contratoId ?? null,
    cambios: state.cambios ?? {},
    archivos: state.archivos ?? [],
    resueltaEn: new Date().toISOString(),
  };

  store.upsert({
    ...propuesta,
    estado: state.accion === "aprobar" ? "APROBADA" : "RECHAZADA",
    extraccion: state.extraccion ?? propuesta.extraccion,
    resolucion,
  });

  getAudit().append({
    ts: resolucion.resueltaEn,
    msgId: state.msgId,
    fase: "resolucion",
    accion: resolucion.accion,
    aprobador: resolucion.aprobador,
    comentario: resolucion.comentario,
    correcciones: resolucion.correcciones as Record<string, string>,
    tipo: state.clasificacion?.tipo,
    decision: resolucion.decisionFinal,
    contratoId: resolucion.contratoId,
    motivos: state.motivos,
    cambios: resolucion.cambios,
    validaciones: (state.validaciones ?? []).map((x) => ({ regla: x.regla, ok: x.ok })),
    extraccion: state.extraccion ?? null,
    archivos: resolucion.archivos,
    log: state.log,
  });

  return { log: [`Resolución humana registrada: ${resolucion.decisionFinal}`] };
}
