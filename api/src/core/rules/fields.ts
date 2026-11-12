import { CAMPOS_CONTRATO, type CampoContrato, type Contrato } from "../domain/contract.ts";
import type { FilaMaestro } from "../domain/master.ts";

export type ValorCampo = string | number | boolean | null;

export interface CampoEfectivo {
  valor: ValorCampo;
  confianza: number;
  /** documento: coincide con la extracción del servidor; usuario: el llamador lo cambió; maestro: heredado de la fila. */
  origen: "documento" | "usuario" | "maestro";
  extraido: ValorCampo;
}

export type CamposEfectivos = Record<CampoContrato, CampoEfectivo>;

/**
 * La confianza nunca se toma del llamador: se recalcula contra la extracción del servidor.
 * Un valor distinto al del documento queda con confianza 0, así solo pasa con confirmación humana.
 */
function campoEfectivo(campo: CampoContrato, propuesto: Contrato, extraido: Contrato): CampoEfectivo {
  const valor = propuesto[campo].valor;
  const delDocumento = extraido[campo];
  if (valor === delDocumento.valor) return { valor, confianza: delDocumento.confianza, origen: "documento", extraido: delDocumento.valor };
  return { valor, confianza: 0, origen: "usuario", extraido: delDocumento.valor };
}

const heredarDeFila = (campo: CampoContrato, efectivo: CampoEfectivo, fila: FilaMaestro | null): CampoEfectivo =>
  efectivo.valor === null && fila ? { valor: fila[campo], confianza: 1, origen: "maestro", extraido: null } : efectivo;

export function camposEfectivos(propuesto: Contrato, extraido: Contrato, fila: FilaMaestro | null): CamposEfectivos {
  const entradas = CAMPOS_CONTRATO.map((campo) => [campo, heredarDeFila(campo, campoEfectivo(campo, propuesto, extraido), fila)]);
  return Object.fromEntries(entradas) as CamposEfectivos;
}
