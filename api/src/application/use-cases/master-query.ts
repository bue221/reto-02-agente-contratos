import { leerMaestro } from "../../infrastructure/master-store.ts";
import type { Rutas } from "../../infrastructure/paths.ts";
import type { FilaMaestro } from "../../core/domain/master.ts";
import { type Resultado, exito } from "../../core/domain/result.ts";
import { normalizar } from "../../core/domain/text.ts";

/** Lectura del maestro de trabajo para responder preguntas en el chat: nunca escribe. */

export const MAX_FILAS_CONSULTA = 25;

export interface ConsultaMaestro {
  total: number;
  filas: FilaMaestro[];
  /** Hay más coincidencias que las devueltas: afinar la consulta. */
  truncado: boolean;
}

const coincide = (fila: FilaMaestro, consulta: string): boolean =>
  normalizar(`${fila.id_contrato} ${fila.cliente} ${fila.nit_cliente}`).includes(consulta);

export async function consultarMaestro(rutas: Rutas, consulta: string | undefined): Promise<Resultado<ConsultaMaestro>> {
  const maestro = await leerMaestro(rutas);
  const buscada = normalizar(consulta ?? "");
  const encontradas = buscada ? maestro.filter((fila) => coincide(fila, buscada)) : maestro;
  return exito({ total: encontradas.length, filas: encontradas.slice(0, MAX_FILAS_CONSULTA), truncado: encontradas.length > MAX_FILAS_CONSULTA });
}
