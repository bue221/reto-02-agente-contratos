import type { Contrato } from "../dominio/contrato.ts";
import type { FilaMaestro } from "../dominio/maestro.ts";
import { UMBRAL_SIMILITUD_OBJETO } from "../dominio/parametros.ts";
import { similitud } from "../dominio/texto.ts";

export interface Coincidencia {
  fila: FilaMaestro;
  criterio: "id_contrato" | "nit_objeto";
  similitudObjeto: number | null;
}

/** RN2: primero por número de contrato; si no, mismo NIT con objeto casi idéntico (dedupe por NIT antes que por nombre). */
export function buscarCoincidencia(contrato: Contrato, maestro: readonly FilaMaestro[]): Coincidencia | null {
  const id = contrato.id_contrato.valor;
  const porId = id ? maestro.find((fila) => fila.id_contrato === id) : undefined;
  if (porId) return { fila: porId, criterio: "id_contrato", similitudObjeto: null };
  const nit = contrato.nit_cliente.valor;
  const objeto = contrato.objeto.valor;
  if (!nit || !objeto) return null;
  const candidatas = maestro
    .filter((fila) => fila.nit_cliente === nit)
    .map((fila) => ({ fila, similitudObjeto: similitud(fila.objeto, objeto) }))
    .filter((candidata) => candidata.similitudObjeto >= UMBRAL_SIMILITUD_OBJETO)
    .sort((a, b) => b.similitudObjeto - a.similitudObjeto);
  const mejor = candidatas[0];
  return mejor ? { ...mejor, criterio: "nit_objeto" } : null;
}
