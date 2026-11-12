import { aIso, esFechaValida } from "../domain/dates.ts";
import { normalizar } from "../domain/text.ts";
import { ErrorExtraccion } from "./document.ts";

const MESES: Readonly<Record<string, number>> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7,
  agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
};

export interface FechaEnTexto {
  iso: string;
  evidencia: string;
}

export interface MesEnTexto {
  anio: number;
  mes: number;
  evidencia: string;
}

/**
 * Fechas escritas en prosa legal: "primero (1) de agosto de 2026", "a los treinta (30) días del mes de julio de 2026"
 * o "15 de agosto de 2026". Se usa el número entre paréntesis, que es el que el documento fija como cifra.
 */
const PATRON_FECHA = /\(?(\d{1,2})\)?\s+(?:d[ií]as\s+del\s+mes\s+)?de\s+([a-záéíóúñ]+)\s+de\s+(\d{4})/gi;
const PATRON_MES = /\bmes\s+de\s+([a-záéíóúñ]+)\s+de\s+(\d{4})/i;

const numeroDeMes = (nombre: string): number | undefined => MESES[normalizar(nombre)];

export function fechasEnTexto(texto: string): FechaEnTexto[] {
  return [...texto.matchAll(PATRON_FECHA)].map((coincidencia) => {
    const [evidencia, dia, nombreMes, anio] = coincidencia;
    const mes = numeroDeMes(nombreMes ?? "");
    if (mes === undefined || !esFechaValida(Number(anio), mes, Number(dia))) {
      throw new ErrorExtraccion(`fecha inválida en el documento: "${evidencia.trim()}"`);
    }
    return { iso: aIso(Number(anio), mes, Number(dia)), evidencia };
  });
}

/** Fecha con precisión de mes ("en el mes de agosto de 2026"), sin día. */
export function mesEnTexto(texto: string): MesEnTexto | null {
  const coincidencia = PATRON_MES.exec(texto);
  const mes = numeroDeMes(coincidencia?.[1] ?? "");
  if (!coincidencia || mes === undefined) return null;
  return { anio: Number(coincidencia[2]), mes, evidencia: coincidencia[0] };
}
