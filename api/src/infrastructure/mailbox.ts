import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { detectarTipo, segmentar } from "../core/extraction/document.ts";
import { leerTextoOpcional } from "./files.ts";
import { type Rutas, segmentoSeguro } from "./paths.ts";

export const CorreoSchema = z.object({
  id: z.string(),
  de: z.string(),
  para: z.string(),
  asunto: z.string(),
  fecha: z.string(),
  cuerpo: z.string(),
  adjuntos: z.array(z.string()),
});

export type Correo = z.infer<typeof CorreoSchema>;

export interface Adjunto {
  nombre: string;
  texto: string;
}

export async function listarIdsMensajes(rutas: Rutas): Promise<string[]> {
  const entradas = await readdir(rutas.buzon, { withFileTypes: true });
  return entradas
    .filter((entrada) => entrada.isDirectory())
    .map((entrada) => entrada.name)
    .sort();
}

const carpetaMensaje = (rutas: Rutas, mensajeId: string): string => join(rutas.buzon, segmentoSeguro(mensajeId, "mensaje_id"));

export async function leerCorreo(rutas: Rutas, mensajeId: string): Promise<Correo> {
  const texto = await leerTextoOpcional(join(carpetaMensaje(rutas, mensajeId), "correo.json"));
  if (texto === null) throw new Error(`no existe el mensaje ${mensajeId} en el buzón`);
  const validado = CorreoSchema.safeParse(JSON.parse(texto));
  if (!validado.success) throw new Error(`correo.json de ${mensajeId} no tiene el formato esperado`);
  return validado.data;
}

export const rutaAdjunto = (rutas: Rutas, mensajeId: string, nombre: string): string =>
  join(carpetaMensaje(rutas, mensajeId), segmentoSeguro(nombre, "adjunto"));

async function leerAdjunto(rutas: Rutas, mensajeId: string, nombre: string): Promise<Adjunto | null> {
  const texto = await leerTextoOpcional(rutaAdjunto(rutas, mensajeId, nombre));
  return texto === null ? null : { nombre, texto };
}

const pareceContratoPorNombre = (nombre: string): boolean => /contrato|otros[ií]/i.test(nombre);

/**
 * El adjunto de contrato se reconoce por su contenido (encabezado CONTRATO/OTROSÍ o partes CONTRATANTE/CONTRATISTA);
 * si ninguno lo es, por el nombre, para que un contrato vacío se reporte como error y no como "sin contrato".
 */
export async function adjuntoDeContrato(rutas: Rutas, correo: Correo): Promise<Adjunto | null> {
  const adjuntos = (await Promise.all(correo.adjuntos.map((nombre) => leerAdjunto(rutas, correo.id, nombre)))).filter(
    (adjunto): adjunto is Adjunto => adjunto !== null,
  );
  const porContenido = adjuntos.find((adjunto) => detectarTipo(segmentar(adjunto.texto)) !== "otro");
  return porContenido ?? adjuntos.find((adjunto) => pareceContratoPorNombre(adjunto.nombre)) ?? null;
}
