/** Normalización de texto para comparar nombres y objetos sin depender de tildes ni mayúsculas. */

export const quitarTildes = (texto: string): string =>
  texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

export const normalizar = (texto: string): string =>
  quitarTildes(texto).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const SUFIJOS_SOCIETARIOS = /\b(s\.?\s?a\.?\s?s|s\.?\s?a\.?\s?c|s\.?\s?a|s\.?\s?de\s?r\.?\s?l|ltda|e\.?\s?u)\.?$/i;

/** Razón social sin sufijo societario: "Industrias Delta S.A.S." → "Industrias Delta". */
export const sinSufijoSocietario = (razonSocial: string): string =>
  razonSocial.trim().replace(SUFIJOS_SOCIETARIOS, "").replace(/[\s,.]+$/, "");

/** Carpeta del cliente en SharePoint, compatible con las rutas del maestro existente. */
export const slugCliente = (razonSocial: string): string =>
  normalizar(sinSufijoSocietario(razonSocial)).replace(/ /g, "-");

export const mismoCliente = (a: string, b: string): boolean =>
  normalizar(sinSufijoSocietario(a)) === normalizar(sinSufijoSocietario(b));

function distanciaLevenshtein(a: string, b: string): number {
  let anterior = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const actual = [i];
    for (let j = 1; j <= b.length; j++) {
      const costo = a[i - 1] === b[j - 1] ? 0 : 1;
      actual[j] = Math.min((actual[j - 1] ?? 0) + 1, (anterior[j] ?? 0) + 1, (anterior[j - 1] ?? 0) + costo);
    }
    anterior = actual;
  }
  return anterior[b.length] ?? 0;
}

/** Similitud en [0, 1] sobre texto normalizado (1 = idénticos). Textos de ≤200 caracteres: O(n·m) es suficiente. */
export function similitud(a: string, b: string): number {
  const x = normalizar(a);
  const y = normalizar(b);
  const mayor = Math.max(x.length, y.length);
  if (mayor === 0) return 1;
  return 1 - distanciaLevenshtein(x, y) / mayor;
}

export function truncarEnPalabra(texto: string, maximo: number): string {
  if (texto.length <= maximo) return texto;
  const corte = texto.slice(0, maximo - 1);
  const ultimoEspacio = corte.lastIndexOf(" ");
  return `${(ultimoEspacio > 0 ? corte.slice(0, ultimoEspacio) : corte).replace(/[,;:]$/, "")}…`;
}
