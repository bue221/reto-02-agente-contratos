import type { Alertas } from "../../application/use-cases/alerts.ts";
import type { Buzon } from "../../application/use-cases/read-mailbox.ts";
import type { Registro } from "../../application/use-cases/register.ts";
import type { ValidacionReportada } from "../../application/use-cases/validate.ts";
import type { Contrato } from "../../core/domain/contract.ts";
import { fechaDeHoy } from "../../core/domain/dates.ts";
import type { Resultado } from "../../core/domain/result.ts";
import type { MensajeLlm } from "../adapter.ts";
import { type Ejecucion, buscar, ejecuciones, esPendienteDeRevision, indiceUltimoUsuario, mensajeIdDe, textoUltimoUsuario } from "./history.ts";
import { AYUDA_OFFLINE, detalleDeRevision, preguntaDeConfirmacion, resumenDeAlertas, tablaDeMensajes } from "./replies.ts";

/**
 * Guion determinista del proveedor offline: decide el siguiente paso solo a partir del historial.
 * Las llamadas sin dependencias pendientes salen en lote, como haría un modelo con llamadas paralelas.
 */

export type Paso = { tipo: "llamar"; llamadas: { nombre: string; args: Record<string, unknown> }[] } | { tipo: "responder"; texto: string };

const LEER_BUZON = "contratos_leer_buzon";
const EXTRAER = "contratos_extraer";
const VALIDAR = "contratos_validar";
const REGISTRAR = "contratos_registrar";
const ALERTAS = "contratos_alertas";
const CLASIFICACIONES_REGISTRABLES = new Set(["nuevo", "actualizacion"]);

const llamar = (...llamadas: { nombre: string; args: Record<string, unknown> }[]): Paso => ({ tipo: "llamar", llamadas });
const responder = (texto: string): Paso => ({ tipo: "responder", texto });

const fechaDelTexto = (texto: string): string => /\b(\d{4}-\d{2}-\d{2})\b/.exec(texto)?.[1] ?? fechaDeHoy();

/** Siguiente llamada del pipeline extraer → validar → registrar para un mensaje, o null si ya terminó. */
function siguienteDelMensaje(turno: readonly Ejecucion[], id: string): { nombre: string; args: Record<string, unknown> } | null {
  const extraido = buscar<Contrato>(turno, EXTRAER, id);
  if (!extraido) return { nombre: EXTRAER, args: { mensaje_id: id } };
  if (!extraido.ok) return null;
  const validacion = buscar<ValidacionReportada>(turno, VALIDAR, id);
  if (!validacion) return { nombre: VALIDAR, args: { mensaje_id: id, contrato: extraido.data } };
  if (!validacion.ok || !CLASIFICACIONES_REGISTRABLES.has(validacion.data.clasificacion)) return null;
  if (buscar<Registro>(turno, REGISTRAR, id)) return null;
  return { nombre: REGISTRAR, args: { mensaje_id: id, contrato: extraido.data } };
}

const pendientesDelTurno = (turno: readonly Ejecucion[]): string[] =>
  turno.filter((ejecucion) => ejecucion.nombre === REGISTRAR && esPendienteDeRevision(ejecucion.resultado)).flatMap((ejecucion) => mensajeIdDe(ejecucion) ?? []);

function cierreDelBuzon(turno: readonly Ejecucion[], ids: readonly string[]): string {
  const pendientes = pendientesDelTurno(turno);
  const partes = [
    `Procesé ${ids.length} mensajes del buzón:`,
    tablaDeMensajes(turno, ids),
    ...pendientes.map((id) => detalleDeRevision(turno, id)),
    resumenDeAlertas(buscar<Alertas>(turno, ALERTAS)),
  ];
  if (pendientes.length > 0) partes.push(`No registré nada dudoso. ${preguntaDeConfirmacion(pendientes)}`);
  return partes.filter(Boolean).join("\n\n");
}

function procesarBuzon(turno: readonly Ejecucion[], hoy: string): Paso {
  const buzon = buscar<Buzon>(turno, LEER_BUZON);
  if (!buzon) return llamar({ nombre: LEER_BUZON, args: {} });
  if (!buzon.ok) return responder(`No pude leer el buzón: ${buzon.error}`);
  const ids = buzon.data.mensajes.map((mensaje) => mensaje.id);
  const siguientes = ids.flatMap((id) => siguienteDelMensaje(turno, id) ?? []);
  if (siguientes.length > 0) return llamar(...siguientes);
  if (!buscar<Alertas>(turno, ALERTAS)) return llamar({ nombre: ALERTAS, args: { hoy } });
  if (ids.length === 0) return responder(`El buzón no tiene mensajes pendientes.\n\n${resumenDeAlertas(buscar<Alertas>(turno, ALERTAS))}`);
  return responder(cierreDelBuzon(turno, ids));
}

/** Contratos que quedaron en "requiere revisión" y aún no se registraron, con el contrato que se propuso. */
function pendientesDeConfirmar(previas: readonly Ejecucion[]): Map<string, Record<string, unknown>> {
  const pendientes = new Map<string, Record<string, unknown>>();
  for (const ejecucion of previas) {
    const id = mensajeIdDe(ejecucion);
    if (ejecucion.nombre !== REGISTRAR || !id) continue;
    if (esPendienteDeRevision(ejecucion.resultado) && typeof ejecucion.args.contrato === "object" && ejecucion.args.contrato !== null) {
      pendientes.set(id, ejecucion.args.contrato as Record<string, unknown>);
    } else if (ejecucion.resultado.ok) {
      pendientes.delete(id);
    }
  }
  return pendientes;
}

const CORRECCIONES: readonly { campo: string; patron: RegExp; convertir: (texto: string) => unknown }[] = [
  { campo: "valor", patron: /valor\s+(?:de\s+)?\$?\s*([\d.,]+)/i, convertir: (texto) => Number(texto.replace(/[.,]/g, "")) },
  { campo: "fecha_fin", patron: /fecha\s+(?:de\s+)?fin\s+(\d{4}-\d{2}-\d{2})/i, convertir: (texto) => texto },
  { campo: "fecha_inicio", patron: /fecha\s+(?:de\s+)?inicio\s+(\d{4}-\d{2}-\d{2})/i, convertir: (texto) => texto },
];

/** Aplica al contrato propuesto solo los valores que el usuario dictó explícitamente. */
function conCorrecciones(contrato: Record<string, unknown>, texto: string): Record<string, unknown> {
  const corregido = { ...contrato };
  for (const { campo, patron, convertir } of CORRECCIONES) {
    const encontrado = patron.exec(texto)?.[1];
    const actual = corregido[campo];
    if (encontrado && typeof actual === "object" && actual !== null) corregido[campo] = { ...actual, valor: convertir(encontrado) };
  }
  return corregido;
}

function describirRegistro(id: string, resultado: Resultado<Registro> | undefined): string {
  if (!resultado) return `- ${id}: sin respuesta`;
  return resultado.ok ? `- ${id}: ${resultado.data.accion} ${resultado.data.id_contrato ?? ""} → ${resultado.data.ruta_archivo ?? "sin archivo"}` : `- ${id}: ${resultado.error}`;
}

function confirmar(mensajes: readonly MensajeLlm[], turno: readonly Ejecucion[], texto: string): Paso {
  const pendientes = pendientesDeConfirmar(ejecuciones(mensajes.slice(0, indiceUltimoUsuario(mensajes))));
  const citados = [...texto.matchAll(/msg-\d+/gi)].map((coincidencia) => coincidencia[0].toLowerCase());
  const objetivo = [...pendientes.keys()].filter((id) => citados.length === 0 || citados.includes(id));
  if (objetivo.length === 0) return responder("No hay registros pendientes de confirmación en esta sesión.");
  const faltan = objetivo.filter((id) => !buscar<Registro>(turno, REGISTRAR, id));
  if (faltan.length > 0) {
    return llamar(...faltan.map((id) => ({ nombre: REGISTRAR, args: { mensaje_id: id, contrato: conCorrecciones(pendientes.get(id) ?? {}, texto), confirmado: true } })));
  }
  return responder(["Con tu confirmación registré:", ...objetivo.map((id) => describirRegistro(id, buscar<Registro>(turno, REGISTRAR, id)))].join("\n"));
}

function generarAlertas(turno: readonly Ejecucion[], hoy: string): Paso {
  const alertas = buscar<Alertas>(turno, ALERTAS);
  return alertas ? responder(resumenDeAlertas(alertas)) : llamar({ nombre: ALERTAS, args: { hoy } });
}

export function siguientePaso(mensajes: readonly MensajeLlm[]): Paso {
  const texto = textoUltimoUsuario(mensajes);
  const turno = ejecuciones(mensajes.slice(indiceUltimoUsuario(mensajes)));
  if (/\bconfirm/i.test(texto) && !/\bno\b/i.test(texto)) return confirmar(mensajes, turno, texto);
  if (/buz[oó]n/i.test(texto)) return procesarBuzon(turno, fechaDelTexto(texto));
  if (/alerta/i.test(texto)) return generarAlertas(turno, fechaDelTexto(texto));
  return responder(AYUDA_OFFLINE);
}
