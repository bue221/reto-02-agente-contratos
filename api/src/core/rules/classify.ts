import { CAMPOS_CONTRATO, type CampoContrato, type Contrato } from "../domain/contract.ts";
import type { FilaMaestro } from "../domain/master.ts";
import { UMBRAL_CONFIANZA } from "../domain/parameters.ts";
import { mismoCliente } from "../domain/text.ts";
import { type CamposEfectivos, type ValorCampo, camposEfectivos } from "./fields.ts";
import { type Coincidencia, buscarCoincidencia } from "./matching.ts";

export type Clasificacion = "nuevo" | "actualizacion" | "duplicado" | "rechazado";

export interface Revision {
  campo: CampoContrato;
  motivo: string;
}

export interface Diferencia {
  campo: CampoContrato;
  maestro: ValorCampo;
  documento: ValorCampo;
}

export interface Validacion {
  clasificacion: Clasificacion;
  motivo: string | null;
  id_contrato_existente: string | null;
  requiere_revision: CampoContrato[];
  revisiones: Revision[];
  diferencias: Diferencia[];
  avisos: string[];
}

export interface EntradaValidacion {
  propuesto: Contrato;
  extraido: Contrato;
  tieneContrato: boolean;
  adjuntos: readonly string[];
  maestro: readonly FilaMaestro[];
  avisos: string[];
}

export interface Evaluacion {
  validacion: Validacion;
  campos: CamposEfectivos | null;
  existente: FilaMaestro | null;
}

function motivoDeRechazo(entrada: EntradaValidacion, coincidencia: Coincidencia | null): string | null {
  const { propuesto } = entrada;
  if (!entrada.tieneContrato || propuesto.tipo_documento === "otro") {
    return `el mensaje no trae adjunto de contrato (adjuntos: ${entrada.adjuntos.join(", ") || "ninguno"})`;
  }
  if (propuesto.tipo_documento === "otrosi" && !coincidencia) {
    return `otrosí de un contrato que no está en el maestro (${propuesto.id_contrato.valor ?? "sin número"}); registre primero el contrato original`;
  }
  if (!propuesto.cliente.valor) return "el documento no identifica la contraparte (EL CONTRATANTE)";
  if (!propuesto.objeto.valor && !coincidencia) return "el documento no tiene un objeto identificable";
  return null;
}

/** RN1: mismo id_contrato y mismos valor, fecha_inicio y fecha_fin. */
const esDuplicado = (campos: CamposEfectivos, coincidencia: Coincidencia): boolean =>
  coincidencia.criterio === "id_contrato" &&
  (["valor", "fecha_inicio", "fecha_fin"] as const).every((campo) => campos[campo].valor === coincidencia.fila[campo]);

function revisionesPorConfianza(campos: CamposEfectivos, hayCoincidencia: boolean): Revision[] {
  return CAMPOS_CONTRATO.flatMap((campo): Revision[] => {
    const { valor, confianza, origen, extraido } = campos[campo];
    if (origen === "maestro" || confianza >= UMBRAL_CONFIANZA) return [];
    if (campo === "id_contrato" && valor === null && !hayCoincidencia) return [];
    if (origen === "usuario") return [{ campo, motivo: `difiere de lo extraído del documento (${JSON.stringify(extraido)})` }];
    if (valor === null) return [{ campo, motivo: "ausente en el documento" }];
    return [{ campo, motivo: `confianza ${confianza} < ${UMBRAL_CONFIANZA}` }];
  });
}

function conflictosConMaestro(campos: CamposEfectivos, coincidencia: Coincidencia | null, maestro: readonly FilaMaestro[]): Revision[] {
  const conflictos: Revision[] = [];
  const { fila } = coincidencia ?? {};
  if (fila && campos.nit_cliente.valor !== fila.nit_cliente) {
    conflictos.push({ campo: "nit_cliente", motivo: `el maestro tiene ${fila.nit_cliente} para ${fila.id_contrato}` });
  }
  if (fila && coincidencia?.criterio === "nit_objeto" && campos.id_contrato.valor !== fila.id_contrato) {
    conflictos.push({ campo: "id_contrato", motivo: `mismo cliente y objeto que ${fila.id_contrato} con otro número` });
  }
  const mismoNit = maestro.find((otra) => otra.nit_cliente === campos.nit_cliente.valor);
  if (!fila && mismoNit && typeof campos.cliente.valor === "string" && !mismoCliente(mismoNit.cliente, campos.cliente.valor)) {
    conflictos.push({ campo: "cliente", motivo: `el NIT ya figura en el maestro como "${mismoNit.cliente}"` });
  }
  const { fecha_inicio: inicio, fecha_fin: fin } = campos;
  if (typeof inicio.valor === "string" && typeof fin.valor === "string" && fin.valor < inicio.valor) {
    conflictos.push({ campo: "fecha_fin", motivo: "es anterior a fecha_inicio" });
  }
  return conflictos;
}

const mismoValor = (campo: CampoContrato, a: ValorCampo, b: ValorCampo): boolean =>
  campo === "cliente" && typeof a === "string" && typeof b === "string" ? mismoCliente(a, b) : a === b;

function diferenciasConFila(campos: CamposEfectivos, fila: FilaMaestro): Diferencia[] {
  return CAMPOS_CONTRATO.filter((campo) => campos[campo].origen !== "maestro" && !mismoValor(campo, campos[campo].valor, fila[campo])).map(
    (campo) => ({ campo, maestro: fila[campo], documento: campos[campo].valor }),
  );
}

const validacionBase = (avisos: string[]): Validacion => ({
  clasificacion: "rechazado",
  motivo: null,
  id_contrato_existente: null,
  requiere_revision: [],
  revisiones: [],
  diferencias: [],
  avisos,
});

/** RN1–RN5. Función pura: no lee ni escribe archivos. */
export function clasificar(entrada: EntradaValidacion): Evaluacion {
  const base = validacionBase(entrada.avisos);
  const coincidencia = buscarCoincidencia(entrada.propuesto, entrada.maestro);
  const motivo = motivoDeRechazo(entrada, coincidencia);
  if (motivo) return { validacion: { ...base, motivo }, campos: null, existente: null };

  const fila = coincidencia?.fila ?? null;
  const campos = camposEfectivos(entrada.propuesto, entrada.extraido, fila);
  const id_contrato_existente = fila?.id_contrato ?? null;
  if (coincidencia && esDuplicado(campos, coincidencia)) {
    const duplicado = `ya registrado en el maestro como ${coincidencia.fila.id_contrato} con el mismo valor y fechas`;
    return { validacion: { ...base, clasificacion: "duplicado", motivo: duplicado, id_contrato_existente }, campos, existente: fila };
  }
  const revisiones = [...revisionesPorConfianza(campos, fila !== null), ...conflictosConMaestro(campos, coincidencia, entrada.maestro)];
  const diferencias = fila ? diferenciasConFila(campos, fila) : [];
  const clasificacion: Clasificacion = !fila ? "nuevo" : diferencias.length > 0 ? "actualizacion" : "duplicado";
  const validacion: Validacion = {
    ...base,
    clasificacion,
    motivo: clasificacion === "duplicado" ? `sin cambios respecto a ${id_contrato_existente}` : null,
    id_contrato_existente,
    requiere_revision: [...new Set(revisiones.map((revision) => revision.campo))],
    revisiones,
    diferencias,
  };
  return { validacion, campos, existente: fila };
}
