import { type Campo, ausente, encontrado } from "../domain/contract.ts";
import { aIso, finDePlazo, sumarMeses, ultimoDiaDelMes } from "../domain/dates.ts";
import type { Clausula } from "./document.ts";
import { fechasEnTexto, mesEnTexto } from "./prose-dates.ts";

export interface PlazoExtraido {
  fecha_inicio: Campo<string>;
  fecha_fin: Campo<string>;
}

const SIN_PLAZO: PlazoExtraido = { fecha_inicio: ausente(), fecha_fin: ausente() };

const mesesDelPlazo = (cuerpo: string): number | null => {
  const coincidencia = /\(?(\d{1,3})\)?\s+meses\b/i.exec(cuerpo);
  return coincidencia ? Number(coincidencia[1]) : null;
};

function plazoConRango(inicio: string, fin: string, meses: number | null, evidencia: string, notas: string[]): PlazoExtraido {
  const consistente = meses === null || finDePlazo(inicio, meses) === fin;
  if (!consistente) notas.push(`El rango de fechas no coincide con el plazo de ${meses} meses declarado.`);
  return { fecha_inicio: encontrado(inicio, 0.95, evidencia), fecha_fin: encontrado(fin, consistente ? 0.95 : 0.6, evidencia) };
}

/**
 * "N meses contados a partir de la fecha de su firma". Si la firma solo dice el mes, el día de inicio es
 * desconocido: se toma el primer día del mes y, como fin, el último día del mes N (cota superior), ambos con
 * confianza baja para forzar la confirmación humana.
 */
function plazoDesdeFirma(meses: number, firma: string | null, notas: string[]): PlazoExtraido {
  const fechaFirma = firma ? fechasEnTexto(firma)[0] : undefined;
  if (fechaFirma) {
    notas.push(`Inicio = fecha de firma; fin derivado de ${meses} meses.`);
    return {
      fecha_inicio: encontrado(fechaFirma.iso, 0.85, fechaFirma.evidencia),
      fecha_fin: encontrado(finDePlazo(fechaFirma.iso, meses), 0.85, `${meses} meses desde la firma`),
    };
  }
  const mesFirma = firma ? mesEnTexto(firma) : null;
  if (!mesFirma) return SIN_PLAZO;
  const inicio = aIso(mesFirma.anio, mesFirma.mes, 1);
  const [anioFin, mesFin] = sumarMeses(inicio, meses).split("-").map(Number) as [number, number];
  notas.push(
    `La firma solo indica "${mesFirma.evidencia}": inicio supuesto el día 1 y fin al cierre del mes ${meses}; confirmar con el comercial.`,
  );
  return {
    fecha_inicio: encontrado(inicio, 0.5, mesFirma.evidencia),
    fecha_fin: encontrado(aIso(anioFin, mesFin, ultimoDiaDelMes(anioFin, mesFin)), 0.5, `${meses} meses desde la firma`),
  };
}

export function extraerPlazo(clausula: Clausula | null, firma: string | null, notas: string[]): PlazoExtraido {
  if (!clausula) return SIN_PLAZO;
  const { cuerpo } = clausula;
  const fechas = fechasEnTexto(cuerpo);
  const meses = mesesDelPlazo(cuerpo);
  const [primera, segunda] = fechas;
  if (primera && segunda && /\bdesde\b/i.test(cuerpo)) return plazoConRango(primera.iso, segunda.iso, meses, cuerpo, notas);
  if (primera && /\bhasta\b/i.test(cuerpo)) return { fecha_inicio: ausente(), fecha_fin: encontrado(primera.iso, 0.95, primera.evidencia) };
  if (primera && meses !== null) {
    notas.push(`Fin derivado de inicio + ${meses} meses.`);
    return {
      fecha_inicio: encontrado(primera.iso, 0.95, primera.evidencia),
      fecha_fin: encontrado(finDePlazo(primera.iso, meses), 0.85, `${meses} meses`),
    };
  }
  if (meses !== null && /\bfirma\b/i.test(cuerpo)) return plazoDesdeFirma(meses, firma, notas);
  notas.push("La cláusula de plazo no tiene fechas ni duración reconocibles.");
  return SIN_PLAZO;
}
