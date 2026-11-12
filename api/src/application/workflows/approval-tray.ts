import { marcarProcesado, registrarLog } from "../../infrastructure/logs.ts";
import { type DecisionHumana, registrarDecision } from "../../infrastructure/decision-store.ts";
import { rutasDelProyecto } from "../../infrastructure/paths.ts";
import type { RespuestaDecision, RespuestaProcesar } from "../../http/types.ts";
import {
  type ResultadoHitl,
  describirProcesado,
  esperaConfirmacion,
  existeMensaje,
  falloHitl,
  leerEstadoOut,
} from "../use-cases/message-status.ts";
import { cargarMensaje, extraerDeMensaje } from "../use-cases/message.ts";
import type { Registro } from "../use-cases/register.ts";
import { resumenMensaje } from "../use-cases/mailbox-view.ts";
import type { Contrato, Correcciones } from "../../core/domain/contract.ts";
import type { ContextoHerramienta } from "../../tools/tool.ts";
import { llamarHerramienta, procesarMensaje } from "./process-mailbox.ts";

/**
 * Acciones humanas del buzón y la bandeja. Todo pasa por las mismas herramientas que usa el agente
 * (validadas con zod y trazadas en `out/log.jsonl`); aquí solo se decide qué está permitido.
 */

export interface Aprobacion {
  aprobador: string;
  correcciones: Correcciones;
}

export interface Rechazo {
  aprobador: string;
  motivo: string;
}

async function comprobarAbierto(ctx: ContextoHerramienta, id: string): Promise<ResultadoHitl<null>> {
  const rutas = rutasDelProyecto(ctx.directory);
  if (!(await existeMensaje(rutas, id))) return falloHitl("mensaje_no_encontrado", `no existe el mensaje ${id} en el buzón`);
  const procesado = describirProcesado(await leerEstadoOut(rutas), id);
  return procesado ? falloHitl("ya_procesado", procesado) : { ok: true, data: null };
}

/** extraer → validar → registrar sin confirmación, igual que la pasada scripted: lo dudoso queda en la bandeja. */
export async function procesarDesdeBuzon(ctx: ContextoHerramienta, id: string): Promise<ResultadoHitl<RespuestaProcesar>> {
  const abierto = await comprobarAbierto(ctx, id);
  if (!abierto.ok) return abierto;
  const resultado = await procesarMensaje(id, ctx);
  const mensaje = await resumenMensaje(rutasDelProyecto(ctx.directory), id);
  return { ok: true, data: { mensaje, accion: resultado.accion, requiere_revision: resultado.requiere_revision, avisos: resultado.avisos } };
}

/** Equivalente en la bandeja a la pregunta del chat (CA3): solo se decide sobre lo que espera confirmación. */
async function enEspera(ctx: ContextoHerramienta, id: string): Promise<ResultadoHitl<null>> {
  const abierto = await comprobarAbierto(ctx, id);
  if (!abierto.ok) return abierto;
  if (esperaConfirmacion(await leerEstadoOut(rutasDelProyecto(ctx.directory)), id)) return abierto;
  return falloHitl("no_pendiente", `el mensaje ${id} no está esperando aprobación: analízalo primero desde el buzón`);
}

/** Lo corregido por una persona queda con confianza 1 y la evidencia de quién lo fijó. */
export function aplicarCorrecciones(contrato: Contrato, correcciones: Correcciones, aprobador: string): Contrato {
  const corregido: Contrato = { ...contrato };
  for (const [campo, valor] of Object.entries(correcciones)) {
    Object.assign(corregido, { [campo]: { valor, confianza: 1, evidencia: `corregido por ${aprobador}` } });
  }
  return corregido;
}

async function extraerParaAprobar(ctx: ContextoHerramienta, id: string): Promise<ResultadoHitl<Contrato>> {
  const extraido = extraerDeMensaje(await cargarMensaje(rutasDelProyecto(ctx.directory), id));
  return extraido.ok ? extraido : falloHitl("registro_fallido", extraido.error);
}

async function anotar(ctx: ContextoHerramienta, decision: Omit<DecisionHumana, "ts">): Promise<RespuestaDecision> {
  const rutas = rutasDelProyecto(ctx.directory);
  const { mensaje_id: id, aprobador } = decision;
  const resumen = decision.decision === "aprobado" ? `aprobado por ${aprobador}: ${decision.accion} ${decision.id_contrato ?? ""}`.trim() : `rechazado por ${aprobador}: ${decision.motivo}`;
  await registrarLog(rutas, { herramienta: `bandeja_${decision.decision === "aprobado" ? "aprobar" : "rechazar"}`, mensaje_id: id, ok: true, resumen });
  const anotada = await registrarDecision(rutas, decision);
  return { mensaje: await resumenMensaje(rutas, id), decision: anotada };
}

/** `contratos_registrar` con `confirmado = true`: el servidor vuelve a validar el contrato corregido. */
export async function aprobar(ctx: ContextoHerramienta, id: string, aprobacion: Aprobacion): Promise<ResultadoHitl<RespuestaDecision>> {
  const espera = await enEspera(ctx, id);
  if (!espera.ok) return espera;
  const extraido = await extraerParaAprobar(ctx, id);
  if (!extraido.ok) return extraido;
  const contrato = aplicarCorrecciones(extraido.data, aprobacion.correcciones, aprobacion.aprobador);
  const registro = await llamarHerramienta<Registro>("contratos_registrar", { mensaje_id: id, contrato, confirmado: true }, ctx);
  if (!registro.ok) return falloHitl("registro_fallido", registro.error);
  const { id_contrato, accion, cambios } = registro.data;
  const decision = { mensaje_id: id, decision: "aprobado", via: "bandeja", motivo: null, ...aprobacion, id_contrato, accion, cambios } as const;
  return { ok: true, data: await anotar(ctx, decision) };
}

/** El rechazo humano cierra el mensaje sin tocar el maestro y deja el motivo en el log y en las decisiones. */
export async function rechazar(ctx: ContextoHerramienta, id: string, rechazo: Rechazo): Promise<ResultadoHitl<RespuestaDecision>> {
  const espera = await enEspera(ctx, id);
  if (!espera.ok) return espera;
  await marcarProcesado(rutasDelProyecto(ctx.directory), id, "rechazado", null);
  const decision = { mensaje_id: id, decision: "rechazado", via: "bandeja", correcciones: {}, ...rechazo, id_contrato: null, accion: null, cambios: {} } as const;
  return { ok: true, data: await anotar(ctx, decision) };
}
