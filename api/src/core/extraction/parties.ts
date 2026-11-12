import { type Campo, ausente, encontrado } from "../domain/contract.ts";
import type { Pais } from "../domain/master.ts";
import { EMPRESA_PROPIA } from "../domain/parameters.ts";
import { normalizar } from "../domain/text.ts";

export interface PartesExtraidas {
  cliente: Campo<string>;
  nit_cliente: Campo<string>;
  pais: Campo<Pais>;
}

interface Parte {
  nombre: string;
  tipoId: string;
  id: string;
  evidencia: string;
  /** Texto desde la parte hasta la siguiente: contiene su domicilio y su rol. */
  contexto: string;
}

const PATRON_PARTE =
  /([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ0-9 .&'-]*[A-ZÁÉÍÓÚÑ.]),\s*(?:identificad[ao]\s+con\s+)?(NIT|RUC|RTN)\.?\s*(?:No\.?\s*)?(\d[\d.-]*\d)/g;

/** "890.900.111-4" → "890900111": el primer segmento es el identificador, lo que sigue al guion es el DV. */
const limpiarIdentificador = (crudo: string): string => (crudo.split("-")[0] ?? "").replace(/\D/g, "");

function partesDelPreambulo(preambulo: string): Parte[] {
  const coincidencias = [...preambulo.matchAll(PATRON_PARTE)];
  return coincidencias.map((coincidencia, i) => ({
    nombre: (coincidencia[1] ?? "").trim(),
    tipoId: coincidencia[2] ?? "",
    id: limpiarIdentificador(coincidencia[3] ?? ""),
    evidencia: coincidencia[0],
    contexto: preambulo.slice(coincidencia.index, coincidencias[i + 1]?.index ?? preambulo.length),
  }));
}

const esEmpresaPropia = (parte: Parte): boolean =>
  parte.id === EMPRESA_PROPIA.idTributario || normalizar(parte.nombre).startsWith("periferia");

const tieneRolContratante = (parte: Parte): boolean => /\bEL CONTRATANTE\b/.test(parte.contexto);

/** La razón social aparece en mayúsculas en el preámbulo y con mayúsculas/minúsculas en el bloque de firmas. */
function formaPropia(texto: string, nombreMayusculas: string): string | null {
  const minusculas = texto.toLowerCase();
  const buscado = nombreMayusculas.toLowerCase();
  for (let i = minusculas.indexOf(buscado); i >= 0; i = minusculas.indexOf(buscado, i + 1)) {
    const original = texto.slice(i, i + buscado.length);
    if (original !== original.toUpperCase()) return original;
  }
  return null;
}

const aTitulo = (texto: string): string =>
  texto.toLowerCase().replace(/(^|\s)(\p{L})/gu, (_, espacio: string, letra: string) => espacio + letra.toUpperCase());

const PAIS_POR_TEXTO: ReadonlyArray<[RegExp, Pais]> = [
  [/\b(colombia|bogota|medellin|barranquilla|cali|cartagena|bucaramanga)\b/, "CO"],
  [/\b(ecuador|quito|guayaquil|cuenca)\b/, "EC"],
  [/\b(peru|lima|arequipa)\b/, "PE"],
  [/\b(panama)\b/, "PA"],
  [/\b(honduras|tegucigalpa|san pedro sula)\b/, "HN"],
];

function paisPorDomicilio(contexto: string): Pais | null {
  const domicilio = /domicilio en ([^()]+?)(?:,\s*representad|\(|$)/i.exec(contexto)?.[1] ?? "";
  const texto = normalizar(domicilio);
  return PAIS_POR_TEXTO.find(([patron]) => patron.test(texto))?.[1] ?? null;
}

/** NIT → CO; RTN → HN; RUC de 13 dígitos → EC, de 11 → PE, otro → PA. */
function paisPorIdentificador(parte: Parte): Pais {
  if (parte.tipoId === "NIT") return "CO";
  if (parte.tipoId === "RTN") return "HN";
  if (parte.id.length === 13) return "EC";
  return parte.id.length === 11 ? "PE" : "PA";
}

function inferirPais(parte: Parte): Campo<Pais> {
  const porId = paisPorIdentificador(parte);
  const porDomicilio = paisPorDomicilio(parte.contexto);
  if (porDomicilio === null) return encontrado(porId, 0.85, `${parte.tipoId} ${parte.id}`);
  if (porDomicilio === porId) return encontrado(porId, 0.95, `${parte.tipoId} ${parte.id}, domicilio`);
  return encontrado(porDomicilio, 0.5, `domicilio sugiere ${porDomicilio}, ${parte.tipoId} sugiere ${porId}`);
}

export function extraerPartes(texto: string, preambulo: string, notas: string[]): PartesExtraidas {
  const candidatas = partesDelPreambulo(preambulo).filter((parte) => !esEmpresaPropia(parte));
  const cliente = candidatas.find(tieneRolContratante) ?? candidatas[0];
  if (!cliente) {
    notas.push("No se identificó una contraparte distinta de Periferia en el preámbulo.");
    return { cliente: ausente(), nit_cliente: ausente(), pais: ausente() };
  }
  const confianzaRol = tieneRolContratante(cliente) ? 0.95 : 0.75;
  if (confianzaRol < 0.8) notas.push("La contraparte no aparece rotulada como EL CONTRATANTE.");
  const nombre = formaPropia(texto, cliente.nombre);
  if (!nombre) notas.push("Razón social tomada del preámbulo en mayúsculas y convertida a formato título.");
  return {
    cliente: encontrado(nombre ?? aTitulo(cliente.nombre), nombre ? confianzaRol : Math.min(confianzaRol, 0.85), cliente.nombre),
    nit_cliente: encontrado(cliente.id, confianzaRol, cliente.evidencia),
    pais: inferirPais(cliente),
  };
}
