import type { LlamadaVisible } from "../http/types.ts";
import { leerProcesados, registrarLog } from "../infrastructure/logs.ts";
import { rutasDelProyecto } from "../infrastructure/paths.ts";
import { type Resultado, fallo, mensajeDeError } from "../core/domain/result.ts";
import type { LlamadaHerramienta } from "../llm/adapter.ts";
import { HERRAMIENTA_PROCESAR, HERRAMIENTA_RESPONDER, PREFIJO, type PasadaReportada, ejecutarHerramienta, resumirEjecucion } from "../tools/recepcion.ts";
import type { ContextoHerramienta } from "../tools/tool.ts";

/** Ejecución de una llamada del modelo con la guarda de confirmación humana (CA3). */

export interface LlamadaEjecutada {
  json: string;
  visible: LlamadaVisible;
  /** Mensajes que el motor dejó pausados esperando una decisión humana y los que una decisión cerró. */
  efecto: { enRevision: string[]; resueltos: string[] };
}

const es = (nombre: string, herramienta: string): boolean => nombre === herramienta || `${PREFIJO}_${nombre}` === herramienta;
const mensajeIdDe = (args: Record<string, unknown>): string | null => (typeof args.mensaje_id === "string" ? args.mensaje_id : null);

/** Un mensaje ya cerrado (p. ej. aprobado en la bandeja) pasa al motor, que explica que ya fue procesado. */
async function yaProcesado(ctx: ContextoHerramienta, mensajeId: string | null): Promise<boolean> {
  return mensajeId !== null && mensajeId in (await leerProcesados(rutasDelProyecto(ctx.directory)).catch(() => ({})));
}

/**
 * Una decisión humana solo vale para un mensaje por el que el agente preguntó en un turno anterior:
 * el modelo no puede aprobar ni rechazar en el mismo turno en que el motor pausó el mensaje.
 */
async function decisionNoAutorizada(llamada: LlamadaHerramienta, ctx: ContextoHerramienta, pendientes: ReadonlySet<string>): Promise<string | null> {
  const mensajeId = mensajeIdDe(llamada.args);
  if (!es(llamada.nombre, HERRAMIENTA_RESPONDER) || (mensajeId && pendientes.has(mensajeId))) return null;
  if (await yaProcesado(ctx, mensajeId)) return null;
  const error = `decisión no autorizada para ${mensajeId ?? "(sin mensaje_id)"}: la analista aún no ha respondido. Muéstrale los campos en revisión, pregúntale y termina el turno.`;
  await registrarLog(rutasDelProyecto(ctx.directory), { herramienta: HERRAMIENTA_RESPONDER, mensaje_id: mensajeId, ok: false, resumen: error }).catch((falla: unknown) =>
    console.error(`[log] no se pudo escribir out/log.jsonl: ${mensajeDeError(falla)}`),
  );
  return JSON.stringify(fallo(error));
}

function efectoDe(llamada: LlamadaHerramienta, resultado: Resultado<unknown>): LlamadaEjecutada["efecto"] {
  if (!resultado.ok) return { enRevision: [], resueltos: [] };
  // Forma de `PasadaReportada`, devuelta por `recepcion_procesar_buzon`.
  if (es(llamada.nombre, HERRAMIENTA_PROCESAR)) return { enRevision: (resultado.data as PasadaReportada).en_revision, resueltos: [] };
  const mensajeId = mensajeIdDe(llamada.args);
  if (es(llamada.nombre, HERRAMIENTA_RESPONDER) && mensajeId) return { enRevision: [], resueltos: [mensajeId] };
  return { enRevision: [], resueltos: [] };
}

export async function ejecutarLlamada(llamada: LlamadaHerramienta, ctx: ContextoHerramienta, pendientes: ReadonlySet<string>): Promise<LlamadaEjecutada> {
  const pasos: LlamadaVisible[] = [];
  const json = (await decisionNoAutorizada(llamada, ctx, pendientes)) ?? (await ejecutarHerramienta(llamada.nombre, llamada.args, { ...ctx, traza: pasos }));
  // Todas las herramientas (y la guarda) devuelven `Resultado` serializado.
  const resultado = JSON.parse(json) as Resultado<unknown>;
  const resumen = resultado.ok ? resumirEjecucion(llamada.nombre, json) : resultado.error;
  return {
    json,
    visible: { nombre: llamada.nombre, args: llamada.args, ok: resultado.ok, resumen, ...(pasos.length > 0 ? { pasos } : {}) },
    efecto: efectoDe(llamada, resultado),
  };
}
