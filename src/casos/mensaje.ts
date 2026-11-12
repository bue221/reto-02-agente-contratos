import { type Adjunto, type Correo, adjuntoDeContrato, leerCorreo } from "../almacen/buzon.ts";
import type { Rutas } from "../almacen/rutas.ts";
import { type Contrato, contratoVacio } from "../dominio/contrato.ts";
import { type Resultado, exito } from "../dominio/resultado.ts";
import { extraerContrato } from "../extraccion/extractor.ts";

export interface MensajeCargado {
  correo: Correo;
  adjunto: Adjunto | null;
}

export async function cargarMensaje(rutas: Rutas, mensajeId: string): Promise<MensajeCargado> {
  const correo = await leerCorreo(rutas, mensajeId);
  return { correo, adjunto: await adjuntoDeContrato(rutas, correo) };
}

/** Un mensaje sin adjunto de contrato no es un error: se devuelve un contrato vacío tipo "otro" para que RN4 lo rechace. */
export function extraerDeMensaje(mensaje: MensajeCargado): Resultado<Contrato> {
  if (!mensaje.adjunto) {
    const adjuntos = mensaje.correo.adjuntos.join(", ") || "ninguno";
    return exito(contratoVacio("otro", [`El mensaje no trae adjunto de contrato (adjuntos: ${adjuntos}).`]));
  }
  const extraido = extraerContrato(mensaje.adjunto.texto);
  return extraido.ok ? extraido : { ok: false, error: `${mensaje.adjunto.nombre}: ${extraido.error}` };
}
