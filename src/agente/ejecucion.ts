import type { LlamadaVisible } from "../api/tipos.ts";
import { registrarLog } from "../almacen/bitacoras.ts";
import { registrarDecision } from "../almacen/decisiones.ts";
import { rutasDelProyecto } from "../almacen/rutas.ts";
import { PREFIJO_REQUIERE_REVISION, type Registro } from "../casos/registrar.ts";
import { type ValidacionReportada, requiereConfirmacion } from "../casos/validar.ts";
import { type Resultado, fallo, mensajeDeError } from "../dominio/resultado.ts";
import type { LlamadaHerramienta } from "../llm/adapter.ts";
import { ejecutarHerramienta, resumirEjecucion } from "../tools/contratos.ts";
import type { ContextoHerramienta } from "../tools/herramienta.ts";

/** Ejecución de una llamada del modelo con la guarda de confirmación humana (CA3). */

const REGISTRAR = "contratos_registrar";

export interface LlamadaEjecutada {
  json: string;
  visible: LlamadaVisible;
  /** Efecto de `registrar` sobre la confirmación pendiente de un mensaje. */
  revision: { mensajeId: string; estado: "pendiente" | "registrado" } | null;
}

const esRegistrar = (nombre: string): boolean => nombre === REGISTRAR || nombre === "registrar";
const esValidar = (nombre: string): boolean => nombre === "contratos_validar" || nombre === "validar";
const mensajeIdDe = (args: Record<string, unknown>): string | null => (typeof args.mensaje_id === "string" ? args.mensaje_id : null);

/**
 * `confirmado = true` solo vale para un mensaje por el que el agente preguntó en un turno anterior:
 * el modelo no puede autoconfirmar en el mismo turno en que detecta la duda.
 */
async function confirmacionNoAutorizada(llamada: LlamadaHerramienta, ctx: ContextoHerramienta, pendientes: ReadonlySet<string>): Promise<string | null> {
  const mensajeId = mensajeIdDe(llamada.args);
  if (!esRegistrar(llamada.nombre) || llamada.args.confirmado !== true || (mensajeId && pendientes.has(mensajeId))) return null;
  const error = `confirmación no autorizada para ${mensajeId ?? "(sin mensaje_id)"}: el usuario aún no ha confirmado. Muéstrale los campos en revisión, pregúntale y termina el turno.`;
  await registrarLog(rutasDelProyecto(ctx.directory), { herramienta: REGISTRAR, mensaje_id: mensajeId, ok: false, resumen: error }).catch((falla: unknown) =>
    console.error(`[log] no se pudo escribir out/log.jsonl: ${mensajeDeError(falla)}`),
  );
  return JSON.stringify(fallo(error));
}

/** `validar` con campos en revisión cuenta como pendiente aunque el modelo no llegue a intentar `registrar`. */
function validacionPendiente(nombre: string, resultado: Resultado<unknown>): boolean {
  if (!esValidar(nombre) || !resultado.ok) return false;
  // Forma de `ValidacionReportada`, devuelta por `contratos_validar`.
  return requiereConfirmacion(resultado.data as Pick<ValidacionReportada, "clasificacion" | "requiere_revision">);
}

/** Una confirmación aceptada en el chat es una decisión humana más: la bandeja la lista junto a las suyas. */
async function anotarConfirmacionDelChat(llamada: LlamadaHerramienta, ctx: ContextoHerramienta, resultado: Resultado<unknown>): Promise<void> {
  const mensajeId = mensajeIdDe(llamada.args);
  if (!esRegistrar(llamada.nombre) || llamada.args.confirmado !== true || !resultado.ok || !mensajeId) return;
  // Forma de `Registro`, devuelta por `contratos_registrar`.
  const registro = resultado.data as Registro;
  const decision = { mensaje_id: mensajeId, decision: "aprobado", via: "chat", aprobador: `chat ${ctx.sessionId}`, correcciones: {}, motivo: null } as const;
  await registrarDecision(rutasDelProyecto(ctx.directory), { ...decision, id_contrato: registro.id_contrato, accion: registro.accion, cambios: registro.cambios }).catch(
    (falla: unknown) => console.error(`[decisiones] no se pudo anotar la confirmación de ${mensajeId}: ${mensajeDeError(falla)}`),
  );
}

function revisionDe(llamada: LlamadaHerramienta, resultado: Resultado<unknown>): LlamadaEjecutada["revision"] {
  const mensajeId = mensajeIdDe(llamada.args);
  if (!mensajeId) return null;
  if (validacionPendiente(llamada.nombre, resultado)) return { mensajeId, estado: "pendiente" };
  if (!esRegistrar(llamada.nombre)) return null;
  if (resultado.ok) return { mensajeId, estado: "registrado" };
  return resultado.error.startsWith(PREFIJO_REQUIERE_REVISION) ? { mensajeId, estado: "pendiente" } : null;
}

export async function ejecutarLlamada(llamada: LlamadaHerramienta, ctx: ContextoHerramienta, pendientes: ReadonlySet<string>): Promise<LlamadaEjecutada> {
  const json = (await confirmacionNoAutorizada(llamada, ctx, pendientes)) ?? (await ejecutarHerramienta(llamada.nombre, llamada.args, ctx));
  // Todas las herramientas (y la guarda) devuelven `Resultado` serializado.
  const resultado = JSON.parse(json) as Resultado<unknown>;
  await anotarConfirmacionDelChat(llamada, ctx, resultado);
  const resumen = resultado.ok ? resumirEjecucion(llamada.nombre, json) : resultado.error;
  return {
    json,
    visible: { nombre: llamada.nombre, args: llamada.args, ok: resultado.ok, resumen },
    revision: revisionDe(llamada, resultado),
  };
}
