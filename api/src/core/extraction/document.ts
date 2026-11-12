/** Segmenta la prosa legal en preámbulo, cláusulas y párrafo de firma. */

/** Error de datos del documento (fecha inválida, moneda desconocida…): se convierte en `{ ok: false }` en el borde. */
export class ErrorExtraccion extends Error {}

export interface Clausula {
  ordinal: string;
  titulo: string | null;
  cuerpo: string;
}

export interface Documento {
  texto: string;
  encabezado: string;
  preambulo: string;
  clausulas: Clausula[];
  firma: string | null;
}

const ORDINALES = "PRIMERA|SEGUNDA|TERCERA|CUARTA|QUINTA|SEXTA|S[EÉ]PTIMA|OCTAVA|NOVENA|D[EÉ]CIMA";
const PATRON_CLAUSULA = new RegExp(`^(${ORDINALES})\\.\\s*(?:([A-ZÁÉÍÓÚÑ ]{3,})\\.\\s*)?([\\s\\S]*)$`);

function aClausula(parrafo: string): Clausula | null {
  const partes = PATRON_CLAUSULA.exec(parrafo);
  if (!partes) return null;
  return { ordinal: partes[1] ?? "", titulo: partes[2]?.trim() ?? null, cuerpo: (partes[3] ?? "").trim() };
}

export function segmentar(texto: string): Documento {
  const parrafos = texto
    .split(/\n\s*\n/)
    .map((parrafo) => parrafo.trim())
    .filter(Boolean);
  return {
    texto,
    encabezado: parrafos[0] ?? "",
    preambulo: parrafos.find((parrafo) => /^entre\b/i.test(parrafo)) ?? "",
    clausulas: parrafos.map(aClausula).filter((clausula): clausula is Clausula => clausula !== null),
    firma: parrafos.find((parrafo) => /\bse firma\b/i.test(parrafo)) ?? null,
  };
}

/**
 * Busca la cláusula por su título ("SEGUNDA. VALOR.") o, en un otrosí,
 * por la cláusula que modifica ("Modificar la cláusula SEGUNDA (VALOR)").
 */
export function buscarClausula(documento: Documento, titulo: RegExp): Clausula | null {
  const porTitulo = documento.clausulas.find((clausula) => clausula.titulo && titulo.test(clausula.titulo));
  if (porTitulo) return porTitulo;
  return (
    documento.clausulas.find((clausula) => {
      const modificada = /cl[aá]usula\s+\S+\s*\(([^)]+)\)/i.exec(clausula.cuerpo);
      return modificada?.[1] !== undefined && titulo.test(modificada[1].toUpperCase());
    }) ?? null
  );
}

export type TipoDocumento = "contrato" | "otrosi" | "otro";

export function detectarTipo(documento: Documento): TipoDocumento {
  if (/^otros[ií](?=\s|$)/i.test(documento.encabezado)) return "otrosi";
  if (/^contrato\b/i.test(documento.encabezado)) return "contrato";
  return /\bCONTRATANTE\b/.test(documento.texto) && /\bCONTRATISTA\b/.test(documento.texto) ? "contrato" : "otro";
}
