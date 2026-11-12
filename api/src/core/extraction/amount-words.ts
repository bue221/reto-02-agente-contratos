import type { Moneda } from "../domain/master.ts";
import { normalizar } from "../domain/text.ts";

export interface MontoEnLetras {
  monto: number;
  moneda: Moneda;
  texto: string;
}

const VALORES: Readonly<Record<string, number>> = {
  un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9,
  diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15,
  dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19,
  veinte: 20, veintiun: 21, veintiuno: 21, veintidos: 22, veintitres: 23, veinticuatro: 24,
  veinticinco: 25, veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29,
  treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90,
  cien: 100, ciento: 100, doscientos: 200, trescientos: 300, cuatrocientos: 400, quinientos: 500,
  seiscientos: 600, setecientos: 700, ochocientos: 800, novecientos: 900,
};

const MILLON = new Set(["millon", "millones"]);

const MONEDA_POR_NOMBRE: Readonly<Record<string, Moneda>> = {
  pesos: "COP", dolares: "USD", soles: "PEN", balboas: "PAB", lempiras: "HNL",
};

const esPalabraNumerica = (palabra: string | undefined): boolean =>
  palabra !== undefined && (palabra in VALORES || palabra === "mil" || MILLON.has(palabra));

/** "doscientos sesenta y cinco millones" → 265000000. "mil" multiplica el grupo en curso; "millones" lo cierra. */
function sumarPalabras(palabras: readonly string[]): number {
  let total = 0;
  let grupo = 0;
  for (const palabra of palabras) {
    if (palabra === "mil") grupo = (grupo || 1) * 1_000;
    else if (MILLON.has(palabra)) {
      total += (grupo || 1) * 1_000_000;
      grupo = 0;
    } else grupo += VALORES[palabra] ?? 0;
  }
  return total + grupo;
}

/**
 * Primer monto escrito en letras seguido del nombre de la moneda ("ciento veinte mil dólares").
 * Exigir la moneda evita confundir el valor con otras cantidades en prosa ("tres cuotas", "diez por ciento").
 */
export function montoEnLetras(texto: string): MontoEnLetras | null {
  const palabras = normalizar(texto).split(" ");
  for (let inicio = 0; inicio < palabras.length; inicio++) {
    if (!esPalabraNumerica(palabras[inicio])) continue;
    let fin = inicio;
    while (esPalabraNumerica(palabras[fin + 1]) || (palabras[fin + 1] === "y" && esPalabraNumerica(palabras[fin + 2]))) fin++;
    const tramo = palabras.slice(inicio, fin + 1).filter((palabra) => palabra !== "y");
    const posMoneda = palabras[fin + 1] === "de" ? fin + 2 : fin + 1;
    const moneda = MONEDA_POR_NOMBRE[palabras[posMoneda] ?? ""];
    if (moneda) return { monto: sumarPalabras(tramo), moneda, texto: palabras.slice(inicio, posMoneda + 1).join(" ") };
    inicio = fin;
  }
  return null;
}
