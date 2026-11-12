/** Utilidades de fechas `YYYY-MM-DD` en UTC, sin zona horaria para evitar corrimientos de día. */

const MS_POR_DIA = 86_400_000;

const dosDigitos = (n: number): string => String(n).padStart(2, "0");

export const aIso = (anio: number, mes: number, dia: number): string =>
  `${anio}-${dosDigitos(mes)}-${dosDigitos(dia)}`;

export const ultimoDiaDelMes = (anio: number, mes: number): number =>
  new Date(Date.UTC(anio, mes, 0)).getUTCDate();

export function esFechaValida(anio: number, mes: number, dia: number): boolean {
  return mes >= 1 && mes <= 12 && dia >= 1 && dia <= ultimoDiaDelMes(anio, mes);
}

export function esFechaIso(texto: string): boolean {
  const partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto);
  if (!partes) return false;
  return esFechaValida(Number(partes[1]), Number(partes[2]), Number(partes[3]));
}

const aFecha = (iso: string): Date => new Date(`${iso}T00:00:00Z`);
const deFecha = (fecha: Date): string => fecha.toISOString().slice(0, 10);

export const sumarDias = (iso: string, dias: number): string =>
  deFecha(new Date(aFecha(iso).getTime() + dias * MS_POR_DIA));

export const diasEntre = (desde: string, hasta: string): number =>
  Math.round((aFecha(hasta).getTime() - aFecha(desde).getTime()) / MS_POR_DIA);

/** Suma meses conservando el día; si el mes destino es más corto, cae en su último día. */
export function sumarMeses(iso: string, meses: number): string {
  const [anio, mes, dia] = iso.split("-").map(Number) as [number, number, number];
  const total = anio * 12 + (mes - 1) + meses;
  const anioDestino = Math.floor(total / 12);
  const mesDestino = (total % 12) + 1;
  return aIso(anioDestino, mesDestino, Math.min(dia, ultimoDiaDelMes(anioDestino, mesDestino)));
}

/** Fin de un plazo de N meses que arranca en `inicio` (el último día es inclusivo). */
export const finDePlazo = (inicio: string, meses: number): string =>
  sumarDias(sumarMeses(inicio, meses), -1);

export const fechaDeHoy = (): string => new Date().toISOString().slice(0, 10);
