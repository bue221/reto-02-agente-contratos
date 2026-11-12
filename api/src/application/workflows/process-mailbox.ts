import type { Alertas } from "../use-cases/alerts.ts";
import type { Buzon } from "../use-cases/read-mailbox.ts";
import { type Resultado, exito } from "../../core/domain/result.ts";
import type { ContextoHerramienta } from "../../tools/tool.ts";
import { type ResultadoMensaje, ejecutarGrafoMensaje, mensajeConError } from "./contract-graph.ts";
import { llamarHerramienta } from "./tool-call.ts";

/**
 * Pasada del motor determinista por el buzón (lo que dispara `recepcion_procesar_buzon`):
 *
 *   ingestar (contratos_leer_buzon) ─▶ grafo de cada mensaje ─▶ alertas (contratos_alertas)
 *
 * El orden, las herramientas y las aristas están fijos aquí; el modelo solo decide cuándo disparar la pasada.
 */

export type { ResultadoMensaje } from "./contract-graph.ts";

export interface Omitido {
  mensaje_id: string;
  motivo: string;
}

export interface Recorrido {
  mensajes: ResultadoMensaje[];
  /** Ids pedidos que no estaban pendientes en el buzón. */
  omitidos: Omitido[];
}

export interface Pasada extends Recorrido {
  /** Mensajes pausados esperando una decisión humana (CA3). */
  en_revision: string[];
  alertas: Resultado<Alertas>;
}

export interface SolicitudPasada {
  hoy: string;
  /** Sin lista se procesa todo lo pendiente; con `[]` solo se regeneran las alertas. */
  mensajeIds?: readonly string[];
}

export interface Ingesta {
  ids: string[];
  omitidos: Omitido[];
  ilegibles: Buzon["errores"];
}

/** Nodo `ingestar`: qué mensajes entran al grafo, cuáles se pidieron sin estar pendientes y cuáles no se pudieron leer. */
export async function ingestar(ctx: ContextoHerramienta, pedidos: readonly string[] | undefined): Promise<Resultado<Ingesta>> {
  const buzon = await llamarHerramienta<Buzon>("contratos_leer_buzon", {}, ctx);
  if (!buzon.ok) return buzon;
  const pendientes = buzon.data.mensajes.map((mensaje) => mensaje.id);
  if (pedidos === undefined) return exito({ ids: pendientes, omitidos: [], ilegibles: buzon.data.errores });
  const unicos = [...new Set(pedidos)];
  const ilegibles = buzon.data.errores.filter((error) => unicos.includes(error.id));
  const conocidos = new Set([...pendientes, ...ilegibles.map((error) => error.id)]);
  return exito({
    ids: unicos.filter((id) => pendientes.includes(id)),
    omitidos: unicos.filter((id) => !conocidos.has(id)).map((id) => ({ mensaje_id: id, motivo: "no está pendiente en el buzón (ya procesado o inexistente)" })),
    ilegibles,
  });
}

async function recorrerBuzon(ctx: ContextoHerramienta, pedidos?: readonly string[]): Promise<Resultado<Recorrido>> {
  const ingesta = await ingestar(ctx, pedidos);
  if (!ingesta.ok) return ingesta;
  const mensajes: ResultadoMensaje[] = [];
  // Secuencial a propósito: cada registro modifica el maestro contra el que se clasifica el siguiente.
  for (const id of ingesta.data.ids) mensajes.push(await ejecutarGrafoMensaje(id, ctx));
  for (const { id, error } of ingesta.data.ilegibles) mensajes.push(mensajeConError(id, error));
  return exito({ mensajes, omitidos: ingesta.data.omitidos });
}

/** Primera pasada de `demo.ts` y los tests: sin alertas, que la demo genera al final. */
export async function procesarBuzon(ctx: ContextoHerramienta): Promise<Resultado<ResultadoMensaje[]>> {
  const recorrido = await recorrerBuzon(ctx);
  return recorrido.ok ? exito(recorrido.data.mensajes) : recorrido;
}

export async function ejecutarPasada(ctx: ContextoHerramienta, solicitud: SolicitudPasada): Promise<Resultado<Pasada>> {
  const recorrido = await recorrerBuzon(ctx, solicitud.mensajeIds);
  if (!recorrido.ok) return recorrido;
  const alertas = await llamarHerramienta<Alertas>("contratos_alertas", { hoy: solicitud.hoy }, ctx);
  const en_revision = recorrido.data.mensajes.filter((mensaje) => mensaje.desenlace === "en_revision").map((mensaje) => mensaje.mensaje_id);
  return exito({ ...recorrido.data, en_revision, alertas });
}
