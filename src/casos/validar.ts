import { guardarAnalisis } from "../almacen/analisis.ts";
import { leerProcesados, marcarProcesado } from "../almacen/bitacoras.ts";
import { type Remitente, avisoDeRemitente, resolverRemitente } from "../almacen/comerciales.ts";
import { leerMaestro } from "../almacen/maestro.ts";
import type { Rutas } from "../almacen/rutas.ts";
import type { Contrato } from "../dominio/contrato.ts";
import type { FilaMaestro } from "../dominio/maestro.ts";
import { type Resultado, exito } from "../dominio/resultado.ts";
import { type Clasificacion, type Evaluacion, type Validacion, clasificar } from "../reglas/clasificar.ts";
import { type MensajeCargado, cargarMensaje, extraerDeMensaje } from "./mensaje.ts";

export interface MensajeEvaluado {
  mensaje: MensajeCargado;
  remitente: Remitente;
  maestro: FilaMaestro[];
  propuesto: Contrato;
  evaluacion: Evaluacion;
}

/**
 * Reextrae el documento en el servidor y clasifica la propuesta del llamador contra esa extracción:
 * la confianza que envía el modelo nunca se usa.
 */
export async function evaluarMensaje(rutas: Rutas, mensajeId: string, propuesto: Contrato): Promise<Resultado<MensajeEvaluado>> {
  const mensaje = await cargarMensaje(rutas, mensajeId);
  const extraido = extraerDeMensaje(mensaje);
  if (!extraido.ok) return extraido;
  const [maestro, remitente] = await Promise.all([leerMaestro(rutas), resolverRemitente(rutas, mensaje.correo.de)]);
  const evaluacion = clasificar({
    propuesto,
    extraido: extraido.data,
    tieneContrato: mensaje.adjunto !== null,
    adjuntos: mensaje.correo.adjuntos,
    maestro,
    avisos: avisoDeRemitente(remitente),
  });
  return exito({ mensaje, remitente, maestro, propuesto, evaluacion });
}

export type ValidacionReportada = Validacion & { comercial: string | null; procesado: boolean };

const CLASIFICACIONES_REGISTRABLES: ReadonlySet<Clasificacion> = new Set(["nuevo", "actualizacion"]);

/** RN5 / CA3: el mensaje solo se registra con una confirmación humana explícita. */
export const requiereConfirmacion = (validacion: Pick<Validacion, "clasificacion" | "requiere_revision">): boolean =>
  CLASIFICACIONES_REGISTRABLES.has(validacion.clasificacion) && validacion.requiere_revision.length > 0;

/** Rechazado y duplicado son estados terminales: no hay nada que registrar, el mensaje sale del buzón. */
async function marcarSiEsTerminal(rutas: Rutas, mensajeId: string, validacion: Validacion): Promise<boolean> {
  const { clasificacion, id_contrato_existente } = validacion;
  if (clasificacion !== "rechazado" && clasificacion !== "duplicado") return false;
  await marcarProcesado(rutas, mensajeId, clasificacion, id_contrato_existente);
  return true;
}

/**
 * Deja constancia de la evaluación: el último análisis sin confirmación humana es la fuente única
 * de "espera confirmación" para el chat y la bandeja. Devuelve si el mensaje quedó cerrado.
 * Un mensaje ya cerrado no se toca: revalidarlo contra el maestro que él mismo actualizó daría "duplicado".
 */
export async function anotarEvaluacion(rutas: Rutas, mensajeId: string, validacion: Validacion, confirmado: boolean): Promise<boolean> {
  if ((await leerProcesados(rutas))[mensajeId]) return true;
  if (!confirmado) await guardarAnalisis(rutas, mensajeId, validacion);
  return marcarSiEsTerminal(rutas, mensajeId, validacion);
}

export async function validarMensaje(rutas: Rutas, mensajeId: string, propuesto: Contrato): Promise<Resultado<ValidacionReportada>> {
  const evaluado = await evaluarMensaje(rutas, mensajeId, propuesto);
  if (!evaluado.ok) return evaluado;
  const { validacion } = evaluado.data.evaluacion;
  const procesado = await anotarEvaluacion(rutas, mensajeId, validacion, false);
  return exito({ ...validacion, comercial: evaluado.data.remitente.comercial?.nombre ?? null, procesado });
}
