import { leerProcesados } from "../almacen/bitacoras.ts";
import { listarIdsMensajes } from "../almacen/buzon.ts";
import type { Rutas } from "../almacen/rutas.ts";
import { type Resultado, exito, mensajeDeError } from "../dominio/resultado.ts";
import { cargarMensaje } from "./mensaje.ts";

export interface ResumenMensaje {
  id: string;
  de: string;
  asunto: string;
  fecha: string;
  adjuntos: string[];
  tiene_contrato: boolean;
}

export interface Buzon {
  mensajes: ResumenMensaje[];
  /** HU-6: un correo ilegible se reporta aquí y no impide listar los demás. */
  errores: { id: string; error: string }[];
}

async function resumir(rutas: Rutas, id: string): Promise<ResumenMensaje> {
  const { correo, adjunto } = await cargarMensaje(rutas, id);
  return { id, de: correo.de, asunto: correo.asunto, fecha: correo.fecha, adjuntos: correo.adjuntos, tiene_contrato: adjunto !== null };
}

/** HU-1: mensajes del buzón que no están en `out/procesados.json`, en orden de id. */
export async function leerBuzon(rutas: Rutas): Promise<Resultado<Buzon>> {
  const procesados = await leerProcesados(rutas);
  const pendientes = (await listarIdsMensajes(rutas)).filter((id) => !(id in procesados));
  const buzon: Buzon = { mensajes: [], errores: [] };
  for (const id of pendientes) {
    try {
      buzon.mensajes.push(await resumir(rutas, id));
    } catch (error) {
      buzon.errores.push({ id, error: mensajeDeError(error) });
    }
  }
  return exito(buzon);
}
