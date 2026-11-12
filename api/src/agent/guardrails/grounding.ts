/**
 * Guarda de respaldo (CA2): el modelo no puede afirmar un dato que no salió de una herramienta.
 * Se revisan los datos que más daño hacen si se inventan (ids de contrato y de mensaje, fechas ISO y montos)
 * contra lo que el modelo vio de afuera: resultados de herramientas, mensajes de la analista y el prompt de sistema.
 * Lo que no aparezca en esas fuentes se señala en la respuesta; no se reescribe, para no esconder el error.
 */

const ID_CONTRATO = /\b[A-Z]{2,}-\d{4}-\d+\b/g;
const ID_MENSAJE = /\bmsg-[A-Za-z0-9_]+\b/g;
const FECHA_ISO = /\b\d{4}-\d{2}-\d{2}\b/g;
/** Cifras con separadores de miles (265.000.000, 120,000.00) o de 4 dígitos o más; las cuentas pequeñas no se revisan. */
const MONTO = /\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d{4,}(?:[.,]\d{1,2})?/g;

/** `120,000.00` y `120000` son el mismo monto: sin decimales ni separadores. */
const normalizarMonto = (cifra: string): string => cifra.replace(/[.,]\d{1,2}$/, "").replace(/[.,]/g, "");

const coincidencias = (texto: string, patron: RegExp): string[] => texto.match(patron) ?? [];

/** Datos verificables de un texto: los ids y fechas se retiran antes de buscar montos para no leer «2026» de CT-2026-015. */
function datosDe(texto: string): { literales: string[]; montos: string[] } {
  const literales = [ID_CONTRATO, ID_MENSAJE, FECHA_ISO].flatMap((patron) => coincidencias(texto, patron));
  const sinLiterales = [ID_CONTRATO, ID_MENSAJE, FECHA_ISO].reduce((resto, patron) => resto.replace(patron, " "), texto);
  return { literales, montos: coincidencias(sinLiterales, MONTO) };
}

/** Datos de la respuesta que no aparecen en ninguna fuente, en el orden en que aparecen y sin repetir. */
export function datosSinRespaldo(respuesta: string, fuentes: readonly string[]): string[] {
  const corpus = fuentes.join("\n");
  // Conjuntos y no `includes`: un id inventado como CT-2026-01 no debe pasar por estar dentro de CT-2026-015.
  const literalesConocidos = new Set(datosDe(corpus).literales);
  const montosConocidos = new Set(coincidencias(corpus, MONTO).map(normalizarMonto));
  const { literales, montos } = datosDe(respuesta);
  const sinRespaldo = [...literales.filter((dato) => !literalesConocidos.has(dato)), ...montos.filter((cifra) => !montosConocidos.has(normalizarMonto(cifra)))];
  return [...new Set(sinRespaldo)];
}

export const avisoDeRespaldo = (sinRespaldo: readonly string[]): string =>
  `> **Verificación del servidor:** estos datos de la respuesta no salen de ninguna herramienta ni de tus mensajes: ${sinRespaldo.join(", ")}. No los tomes como registrados; pídeme que los consulte.`;

/** Texto final del modelo con el aviso agregado si algo no tiene respaldo. */
export function revisarRespaldo(respuesta: string, fuentes: readonly string[]): { texto: string; sinRespaldo: string[] } {
  const sinRespaldo = datosSinRespaldo(respuesta, fuentes);
  return { texto: sinRespaldo.length > 0 ? `${respuesta}\n\n${avisoDeRespaldo(sinRespaldo)}` : respuesta, sinRespaldo };
}
