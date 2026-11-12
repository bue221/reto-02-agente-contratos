import type { ExplicacionMensaje } from "../../application/use-cases/mailbox-view.ts";
import type { ConsultaMaestro } from "../../application/use-cases/master-query.ts";
import { fechaDeHoy } from "../../core/domain/dates.ts";
import type { RespuestaBuzon } from "../../http/types.ts";
import type { DecisionReportada, PasadaReportada } from "../../tools/recepcion.ts";
import type { MensajeLlm } from "../adapter.ts";
import { type Ejecucion, buscar, ejecuciones, indiceUltimoUsuario, mensajeIdDe, textoUltimoUsuario } from "./history.ts";
import {
  AYUDA_OFFLINE,
  cierreDePasada,
  describirDecision,
  explicacion,
  resumenDeAlertas,
  tablaDeEstado,
  tablaDeMaestro,
} from "./replies.ts";

/**
 * Guion determinista del proveedor offline: hace de recepcionista con las mismas cinco herramientas
 * que ve un modelo real y decide el siguiente paso solo a partir del historial.
 */

export type Paso = { tipo: "llamar"; llamadas: { nombre: string; args: Record<string, unknown> }[] } | { tipo: "responder"; texto: string };

const ESTADO = "recepcion_consultar_estado";
const MAESTRO = "recepcion_consultar_maestro";
const EXPLICAR = "recepcion_explicar_validacion";
const PROCESAR = "recepcion_procesar_buzon";
const RESPONDER = "recepcion_responder_revision";

const llamar = (...llamadas: { nombre: string; args: Record<string, unknown> }[]): Paso => ({ tipo: "llamar", llamadas });
const responder = (texto: string): Paso => ({ tipo: "responder", texto });

const FECHA = /\b(\d{4}-\d{2}-\d{2})\b/;
const fechaDelTexto = (texto: string): string | null => FECHA.exec(texto)?.[1] ?? null;
const idsCitados = (texto: string): string[] => [...texto.matchAll(/msg-\d+/gi)].map((coincidencia) => coincidencia[0].toLowerCase());

/** Una vez que la herramienta respondió, el guion redacta; si aún no, la pide. */
function consultarYResponder<T>(turno: readonly Ejecucion[], nombre: string, args: Record<string, unknown>, redactar: (data: T) => string): Paso {
  const resultado = buscar<T>(turno, nombre);
  if (!resultado) return llamar({ nombre, args });
  return responder(resultado.ok ? redactar(resultado.data) : `No pude completar la consulta: ${resultado.error}`);
}

function procesar(turno: readonly Ejecucion[], hoy: string, mensajeIds: string[] | null): Paso {
  const args = { hoy, ...(mensajeIds ? { mensaje_ids: mensajeIds } : {}) };
  return consultarYResponder<PasadaReportada>(turno, PROCESAR, args, (pasada) =>
    mensajeIds?.length === 0 ? resumenDeAlertas(pasada.alertas) : cierreDePasada(pasada),
  );
}

/** Mensajes que el motor pausó en turnos anteriores y que ninguna decisión ha cerrado todavía. */
function pausados(previas: readonly Ejecucion[]): string[] {
  const enEspera = new Set<string>();
  for (const ejecucion of previas) {
    if (!ejecucion.resultado.ok) continue;
    if (ejecucion.nombre === PROCESAR) for (const id of (ejecucion.resultado.data as PasadaReportada).en_revision) enEspera.add(id);
    const id = mensajeIdDe(ejecucion);
    if (ejecucion.nombre === RESPONDER && id) enEspera.delete(id);
  }
  return [...enEspera];
}

const ultimaFecha = (previas: readonly Ejecucion[]): string | null => {
  const hoy = previas.findLast((ejecucion) => ejecucion.nombre === PROCESAR)?.args.hoy;
  return typeof hoy === "string" ? hoy : null;
};

const CORRECCIONES: readonly { campo: string; patron: RegExp; convertir: (texto: string) => unknown }[] = [
  { campo: "valor", patron: /valor\s+(?:de\s+)?\$?\s*([\d.,]+)/i, convertir: (texto) => Number(texto.replace(/[.,]/g, "")) },
  { campo: "fecha_fin", patron: /fecha\s+(?:de\s+)?fin\s+(\d{4}-\d{2}-\d{2})/i, convertir: (texto) => texto },
  { campo: "fecha_inicio", patron: /fecha\s+(?:de\s+)?inicio\s+(\d{4}-\d{2}-\d{2})/i, convertir: (texto) => texto },
];

/** Solo los valores que la analista dictó explícitamente: el resto queda como lo extrajo el motor. */
function correccionesDelTexto(texto: string): Record<string, unknown> {
  const correcciones: Record<string, unknown> = {};
  for (const { campo, patron, convertir } of CORRECCIONES) {
    const encontrado = patron.exec(texto)?.[1];
    if (encontrado) correcciones[campo] = convertir(encontrado);
  }
  return correcciones;
}

const motivoDelTexto = (texto: string): string => /(?:porque|motivo:?)\s+(.+)/i.exec(texto)?.[1]?.trim() ?? texto.trim();

function decidir(mensajes: readonly MensajeLlm[], turno: readonly Ejecucion[], texto: string, decision: "aprobar" | "rechazar"): Paso {
  const previas = ejecuciones(mensajes.slice(0, indiceUltimoUsuario(mensajes)));
  const citados = idsCitados(texto);
  const objetivo = pausados(previas).filter((id) => citados.length === 0 || citados.includes(id));
  if (objetivo.length === 0) return responder("No hay mensajes esperando tu decisión en esta sesión.");
  const faltan = objetivo.filter((id) => !buscar(turno, RESPONDER, id));
  if (faltan.length > 0) {
    const hoy = ultimaFecha(previas);
    const detalle = decision === "aprobar" ? { correcciones: correccionesDelTexto(texto) } : { motivo: motivoDelTexto(texto) };
    return llamar(...faltan.map((id) => ({ nombre: RESPONDER, args: { mensaje_id: id, decision, ...detalle, ...(hoy ? { hoy } : {}) } })));
  }
  const resultados = objetivo.map((id) => [id, buscar<DecisionReportada>(turno, RESPONDER, id)] as const);
  const lineas = resultados.map(([id, resultado]) => (resultado?.ok ? describirDecision(resultado.data) : `- ${id}: ${resultado?.error ?? "sin respuesta"}`));
  const alertas = resultados.map(([, resultado]) => (resultado?.ok ? resultado.data.alertas : null)).findLast((actual) => actual !== null) ?? null;
  return responder([`Con tu decisión el motor reanudó:`, lineas.join("\n"), resumenDeAlertas(alertas)].filter(Boolean).join("\n\n"));
}

const pideRechazo = (texto: string): boolean => /\brechaz/i.test(texto);
const pideConfirmar = (texto: string): boolean => /\bconfirm/i.test(texto) && !/\bno\b/i.test(texto);
const CONTRATO = /\b[A-Z]{2,}-\d{4}-\d+\b/i;

export function siguientePaso(mensajes: readonly MensajeLlm[]): Paso {
  const texto = textoUltimoUsuario(mensajes);
  const turno = ejecuciones(mensajes.slice(indiceUltimoUsuario(mensajes)));
  const citados = idsCitados(texto);
  if (pideRechazo(texto)) return decidir(mensajes, turno, texto, "rechazar");
  if (pideConfirmar(texto)) return decidir(mensajes, turno, texto, "aprobar");
  if (/\bproces/i.test(texto) && citados.length > 0) return procesar(turno, fechaDelTexto(texto) ?? fechaDeHoy(), citados);
  if (/\bestado\b/i.test(texto)) return consultarYResponder<RespuestaBuzon>(turno, ESTADO, {}, tablaDeEstado);
  if (/buz[oó]n/i.test(texto)) return procesar(turno, fechaDelTexto(texto) ?? fechaDeHoy(), null);
  if (/alerta/i.test(texto)) return procesar(turno, fechaDelTexto(texto) ?? fechaDeHoy(), []);
  const [citado] = citados;
  if (citado) return consultarYResponder<ExplicacionMensaje>(turno, EXPLICAR, { mensaje_id: citado }, explicacion);
  const contrato = CONTRATO.exec(texto)?.[0];
  if (contrato || /maestro/i.test(texto)) return consultarYResponder<ConsultaMaestro>(turno, MAESTRO, contrato ? { consulta: contrato } : {}, tablaDeMaestro);
  return responder(AYUDA_OFFLINE);
}
