import { leerHistorial, leerLog } from "../almacen/bitacoras.ts";
import { listarIdsMensajes, rutaAdjunto } from "../almacen/buzon.ts";
import { leerTextoOpcional } from "../almacen/archivos.ts";
import { leerMaestro } from "../almacen/maestro.ts";
import type { Rutas } from "../almacen/rutas.ts";
import type { DetalleMensaje, FilaMaestroVisible, ItemBandeja, MensajeBuzon, RespuestaBandeja, RespuestaBuzon } from "../api/tipos.ts";
import type { Contrato } from "../dominio/contrato.ts";
import { mensajeDeError } from "../dominio/resultado.ts";
import { type EstadoOut, type ResultadoHitl, decisionDe, esperaConfirmacion, estadoDe, existeMensaje, falloHitl, leerEstadoOut } from "./estado-mensajes.ts";
import { lineaDeTiempo } from "./linea-tiempo.ts";
import { type MensajeCargado, cargarMensaje, extraerDeMensaje } from "./mensaje.ts";

/** Vistas de solo lectura del buzón y la bandeja: nunca escriben en `out/`. */

function aMensajeBuzon(id: string, { correo, adjunto }: MensajeCargado, out: EstadoOut): MensajeBuzon {
  const validacion = out.analisis[id]?.validacion ?? null;
  return {
    id,
    de: correo.de,
    asunto: correo.asunto,
    fecha: correo.fecha,
    adjuntos: correo.adjuntos,
    tiene_contrato: adjunto !== null,
    estado: estadoDe(out, id),
    clasificacion: validacion?.clasificacion ?? null,
    id_contrato: out.procesados[id]?.id_contrato ?? validacion?.id_contrato_existente ?? null,
    decidido_por: decisionDe(out, id)?.aprobador ?? null,
  };
}

export async function resumenMensaje(rutas: Rutas, id: string, out?: EstadoOut): Promise<MensajeBuzon> {
  return aMensajeBuzon(id, await cargarMensaje(rutas, id), out ?? (await leerEstadoOut(rutas)));
}

export async function listarBuzon(rutas: Rutas): Promise<RespuestaBuzon> {
  const out = await leerEstadoOut(rutas);
  const respuesta: RespuestaBuzon = { contadores: { total: 0, pendientes: 0, requiere_revision: 0, procesados: 0 }, mensajes: [], errores: [] };
  for (const id of await listarIdsMensajes(rutas)) {
    try {
      respuesta.mensajes.push(await resumenMensaje(rutas, id, out));
    } catch (error) {
      respuesta.errores.push({ id, error: mensajeDeError(error) });
    }
  }
  const contar = (estados: readonly string[]): number => respuesta.mensajes.filter((mensaje) => estados.includes(mensaje.estado)).length;
  respuesta.contadores = {
    total: respuesta.mensajes.length,
    pendientes: contar(["pendiente"]),
    requiere_revision: contar(["requiere_revision"]),
    procesados: contar(["registrado", "actualizado", "duplicado", "rechazado"]),
  };
  return respuesta;
}

async function adjuntosConTexto(rutas: Rutas, cargado: MensajeCargado): Promise<DetalleMensaje["adjuntos"]> {
  return Promise.all(
    cargado.correo.adjuntos.map(async (nombre) => ({
      nombre,
      texto: await leerTextoOpcional(rutaAdjunto(rutas, cargado.correo.id, nombre)).catch(() => null),
      es_contrato: nombre === cargado.adjunto?.nombre,
    })),
  );
}

async function filaRegistrada(rutas: Rutas, idContrato: string | null): Promise<FilaMaestroVisible | null> {
  if (!idContrato) return null;
  return (await leerMaestro(rutas)).find((fila) => fila.id_contrato === idContrato) ?? null;
}

/** La extracción es determinista: recalcularla da lo mismo que vio el agente al analizar. */
function extraccionDe(cargado: MensajeCargado): { extraccion: Contrato | null; error: string | null } {
  const extraido = extraerDeMensaje(cargado);
  return extraido.ok ? { extraccion: extraido.data, error: null } : { extraccion: null, error: extraido.error };
}

export async function detalleMensaje(rutas: Rutas, id: string): Promise<ResultadoHitl<DetalleMensaje>> {
  if (!(await existeMensaje(rutas, id))) return falloHitl("mensaje_no_encontrado", `no existe el mensaje ${id} en el buzón`);
  const [cargado, out, historial, log] = await Promise.all([cargarMensaje(rutas, id), leerEstadoOut(rutas), leerHistorial(rutas), leerLog(rutas)]);
  const mensaje = aMensajeBuzon(id, cargado, out);
  const analisis = out.analisis[id] ?? null;
  const { extraccion, error } = mensaje.estado === "pendiente" ? { extraccion: null, error: null } : extraccionDe(cargado);
  const delMensaje = historial.filter((entrada) => entrada.mensaje_id === id);
  const decision = decisionDe(out, id);
  return {
    ok: true,
    data: {
      mensaje,
      para: cargado.correo.para,
      cuerpo: cargado.correo.cuerpo,
      adjuntos: await adjuntosConTexto(rutas, cargado),
      extraccion,
      error_extraccion: error,
      validacion: analisis?.validacion ?? null,
      decision,
      fila: await filaRegistrada(rutas, delMensaje.length > 0 ? mensaje.id_contrato : null),
      linea_tiempo: lineaDeTiempo({
        fecha: cargado.correo.fecha,
        adjuntos: cargado.correo.adjuntos.length,
        adjuntoContrato: cargado.adjunto?.nombre ?? null,
        estado: mensaje.estado,
        analisis,
        extraccion,
        decision,
        historial: delMensaje.at(-1) ?? null,
      }),
      historial: delMensaje,
      log: log.filter((entrada) => entrada.mensaje_id === id),
    },
  };
}

async function itemBandeja(rutas: Rutas, id: string, out: EstadoOut): Promise<ItemBandeja | null> {
  const analisis = esperaConfirmacion(out, id);
  if (!analisis) return null;
  const cargado = await cargarMensaje(rutas, id);
  const { extraccion } = extraccionDe(cargado);
  if (!extraccion) return null;
  return { mensaje: aMensajeBuzon(id, cargado, out), validacion: analisis.validacion, contrato: extraccion, desde: analisis.ts };
}

/** Lo que espera una decisión humana y lo ya resuelto (bandeja y chat), lo más reciente primero. */
export async function listarBandeja(rutas: Rutas): Promise<RespuestaBandeja> {
  const out = await leerEstadoOut(rutas);
  const items = await Promise.all(
    Object.keys(out.analisis)
      .sort()
      .map((id) =>
        itemBandeja(rutas, id, out).catch((error: unknown) => {
          console.error(`[bandeja] no se pudo preparar ${id}: ${mensajeDeError(error)}`);
          return null;
        }),
      ),
  );
  return { pendientes: items.filter((item) => item !== null), resueltas: [...out.decisiones].reverse() };
}
