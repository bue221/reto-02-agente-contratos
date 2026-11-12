export const MESES: Record<string, number> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7,
  agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
};

const pad = (n: number) => String(n).padStart(2, "0");
export const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
export const ultimoDiaMes = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
export const diasEntre = (a: string, b: string) =>
  Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

export const formatoCOP = (n: number) =>
  "$" + String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");

export interface Parseado<T> {
  valor: T | null;
  confianza: number;
  evidencia: string;
}

/** Interpreta fechas en ISO, "1 de junio de 2026" o "a finales de diciembre de 2026" (esta última = estimación). */
export function parseFecha(txt: string): Parseado<string> {
  const t = txt.trim();
  const mIso = t.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (mIso) return { valor: mIso[0], confianza: 0.97, evidencia: t };

  const mLarga = t.match(/(\d{1,2})\s+de\s+([a-záéíóú]+)\s+de\s+(\d{4})/i);
  if (mLarga) {
    const mes = MESES[mLarga[2].toLowerCase()];
    if (mes) return { valor: iso(+mLarga[3], mes, +mLarga[1]), confianza: 0.97, evidencia: t };
  }

  const mVaga = t.match(/finales\s+de\s+([a-záéíóú]+)(?:\s+de\s+(\d{4}))?/i);
  if (mVaga) {
    const mes = MESES[mVaga[1].toLowerCase()];
    const anio = mVaga[2] ? +mVaga[2] : null;
    if (mes && anio) {
      // No dice el día exacto: se estima el último día del mes, con confianza baja.
      return { valor: iso(anio, mes, ultimoDiaMes(anio, mes)), confianza: 0.4, evidencia: t };
    }
  }
  return { valor: null, confianza: 0, evidencia: t };
}

/** Interpreta "COP $120.000.000" o "120 millones". */
export function parseValor(txt: string): Parseado<number> {
  const t = txt.trim();
  const mNum = t.match(/(\d{1,3}(?:\.\d{3})+|\d+)/);
  const mMill = t.match(/(\d+(?:,\d+)?)\s+millones/i);
  if (mMill && !/\d{1,3}(?:\.\d{3}){2,}/.test(t)) {
    return { valor: Math.round(parseFloat(mMill[1].replace(",", ".")) * 1_000_000), confianza: 0.8, evidencia: t };
  }
  if (mNum) return { valor: Number(mNum[1].replace(/\./g, "")), confianza: 0.95, evidencia: t };
  return { valor: null, confianza: 0, evidencia: t };
}

export function parseCsv(texto: string): string[][] {
  const filas: string[][] = [];
  let fila: string[] = [];
  let celda = "";
  let enComillas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (enComillas) {
      if (c === '"' && texto[i + 1] === '"') { celda += '"'; i++; }
      else if (c === '"') enComillas = false;
      else celda += c;
    } else if (c === '"') enComillas = true;
    else if (c === ",") { fila.push(celda); celda = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && texto[i + 1] === "\n") i++;
      fila.push(celda); celda = "";
      if (fila.some((x) => x !== "")) filas.push(fila);
      fila = [];
    } else celda += c;
  }
  if (celda !== "" || fila.length) { fila.push(celda); filas.push(fila); }
  return filas;
}

export function toCsv(filas: string[][]): string {
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return filas.map((f) => f.map(esc).join(",")).join("\n") + "\n";
}
