import { extname } from "node:path";
import { archivarDocumento, leerProcesados, marcarProcesado, registrarHistorial } from "../almacen/bitacoras.ts";
import { rutaAdjunto } from "../almacen/buzon.ts";
import { nombreComercial } from "../almacen/comerciales.ts";
import { guardarFila } from "../almacen/maestro.ts";
import type { Rutas } from "../almacen/rutas.ts";
import type { Contrato } from "../dominio/contrato.ts";
import { type Resultado, exito, fallo } from "../dominio/resultado.ts";
import type { Revision } from "../reglas/clasificar.ts";
import { type Cambios, type FilaConstruida, cambiosEntre, construirFila } from "../reglas/fila.ts";
import { type MensajeEvaluado, anotarEvaluacion, evaluarMensaje } from "./validar.ts";

export interface SolicitudRegistro {
  mensajeId: string;
  contrato: Contrato;
  confirmado: boolean;
  fechaRegistro: string;
}

export interface Registro {
  id_contrato: string | null;
  accion: "insertado" | "actualizado" | "duplicado";
  ruta_archivo: string | null;
  cambios: Cambios;
  avisos: string[];
}

/** Prefijo del error de RN5: el ciclo del agente lo usa para detectar de forma determinista que debe pedir confirmación. */
export const PREFIJO_REQUIERE_REVISION = "requiere revisión";

const describirRevisiones = (revisiones: readonly Revision[]): string =>
  revisiones.map((revision) => `${revision.campo} (${revision.motivo})`).join(", ");

async function escribir(rutas: Rutas, evaluado: MensajeEvaluado, construida: FilaConstruida, mensajeId: string): Promise<Registro> {
  const { existente } = evaluado.evaluacion;
  const { fila, rutaArchivo } = construida;
  const accion = existente ? "actualizado" : "insertado";
  const cambios = cambiosEntre(existente, fila);
  const adjunto = evaluado.mensaje.adjunto?.nombre ?? "";
  await archivarDocumento(rutas, rutaAdjunto(rutas, mensajeId, adjunto), rutaArchivo);
  await guardarFila(rutas, fila, existente?.id_contrato ?? null);
  await registrarHistorial(rutas, { id_contrato: fila.id_contrato, accion, cambios, mensaje_id: mensajeId, ruta_archivo: rutaArchivo });
  await marcarProcesado(rutas, mensajeId, accion === "insertado" ? "registrado" : "actualizado", fila.id_contrato);
  return { id_contrato: fila.id_contrato, accion, ruta_archivo: rutaArchivo, cambios, avisos: evaluado.evaluacion.validacion.avisos };
}

/**
 * HU-4 / RN5: vuelve a validar en el servidor (no confía en la clasificación del llamador) y solo escribe
 * si no hay campos en revisión o si el usuario confirmó explícitamente.
 */
export async function registrarMensaje(rutas: Rutas, solicitud: SolicitudRegistro): Promise<Resultado<Registro>> {
  const { mensajeId } = solicitud;
  const previo = (await leerProcesados(rutas))[mensajeId];
  if (previo) return fallo(`el mensaje ${mensajeId} ya fue procesado (${previo.estado}${previo.id_contrato ? ` ${previo.id_contrato}` : ""})`);

  const evaluado = await evaluarMensaje(rutas, mensajeId, solicitud.contrato);
  if (!evaluado.ok) return evaluado;
  const { validacion, campos, existente } = evaluado.data.evaluacion;
  await anotarEvaluacion(rutas, mensajeId, validacion, solicitud.confirmado);
  if (validacion.clasificacion === "rechazado") return fallo(`rechazado: ${validacion.motivo ?? "sin motivo"}`);
  if (validacion.clasificacion === "duplicado" || !campos) {
    return exito({ id_contrato: validacion.id_contrato_existente, accion: "duplicado", ruta_archivo: null, cambios: {}, avisos: validacion.avisos });
  }
  if (validacion.requiere_revision.length > 0 && !solicitud.confirmado) {
    return fallo(`${PREFIJO_REQUIERE_REVISION}: ${describirRevisiones(validacion.revisiones)}. Confirme con el usuario y vuelva a llamar con confirmado = true`);
  }
  const construida = construirFila(campos, {
    contrato: solicitud.contrato,
    existente,
    maestro: evaluado.data.maestro,
    comercial: nombreComercial(evaluado.data.remitente),
    fechaRegistro: solicitud.fechaRegistro,
    extension: extname(evaluado.data.mensaje.adjunto?.nombre ?? "") || ".txt",
  });
  if (!construida.ok) return construida;
  return exito(await escribir(rutas, evaluado.data, construida.data, mensajeId));
}
