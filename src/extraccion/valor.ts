import { type Campo, ausente, encontrado } from "../dominio/contrato.ts";
import { MONEDAS, type Moneda } from "../dominio/maestro.ts";
import { type Clausula, ErrorExtraccion } from "./documento.ts";

export interface ValorExtraido {
  valor: Campo<number>;
  moneda: Campo<Moneda>;
  valor_indeterminado: boolean;
}

const PATRON_MONTO_CON_CODIGO = /\b([A-Z]{3})\s*\$?\s*(\d[\d.,]*\d)/g;
const PATRON_MONTO_PESOS = /\$\s*(\d[\d.,]*\d)/;
const PATRON_INDETERMINADO = /no tiene (?:un )?valor determinado|valor indeterminado|cuant[ií]a indeterminada|por demanda/i;
/** Siglas de 3 letras que preceden cifras en prosa legal y no son monedas. */
const NO_MONEDAS = new Set(["IVA", "NIT", "RUC", "RTN"]);

const esMoneda = (codigo: string): codigo is Moneda => (MONEDAS as readonly string[]).includes(codigo);

/**
 * "265.000.000" (puntos de miles) o "120,000.00" (comas de miles y punto decimal):
 * el último separador es decimal solo si le siguen 1 o 2 dígitos.
 */
export function parsearMonto(crudo: string): number | null {
  const ultimoSeparador = Math.max(crudo.lastIndexOf("."), crudo.lastIndexOf(","));
  const decimales = ultimoSeparador >= 0 ? crudo.length - ultimoSeparador - 1 : 0;
  const tieneDecimales = ultimoSeparador >= 0 && decimales <= 2;
  const entero = (tieneDecimales ? crudo.slice(0, ultimoSeparador) : crudo).replace(/[.,]/g, "");
  const fraccion = tieneDecimales ? crudo.slice(ultimoSeparador + 1) : "0";
  const monto = Number(`${entero}.${fraccion}`);
  return Number.isFinite(monto) ? monto : null;
}

function montoConCodigo(cuerpo: string): ValorExtraido | null {
  for (const [evidencia, codigo = "", cifra = ""] of cuerpo.matchAll(PATRON_MONTO_CON_CODIGO)) {
    if (NO_MONEDAS.has(codigo)) continue;
    if (!esMoneda(codigo)) throw new ErrorExtraccion(`moneda desconocida en el documento: "${codigo}" (admitidas: ${MONEDAS.join(", ")})`);
    const monto = parsearMonto(cifra);
    if (monto === null) return null;
    return { valor: encontrado(monto, 0.95, evidencia), moneda: encontrado(codigo, 0.95, evidencia), valor_indeterminado: false };
  }
  return null;
}

function montoEnPesos(cuerpo: string, notas: string[]): ValorExtraido | null {
  const coincidencia = PATRON_MONTO_PESOS.exec(cuerpo);
  const monto = parsearMonto(coincidencia?.[1] ?? "");
  if (!coincidencia || monto === null) return null;
  notas.push("Valor con '$' sin código de moneda: se asume COP con confianza baja.");
  return { valor: encontrado(monto, 0.9, coincidencia[0]), moneda: encontrado("COP", 0.6, coincidencia[0]), valor_indeterminado: false };
}

/** En un contrato por demanda la moneda solo puede inferirse de otras cláusulas (p. ej. topes de garantías). */
function monedaEnOtraClausula(texto: string): Campo<Moneda> {
  for (const [evidencia, codigo = ""] of texto.matchAll(PATRON_MONTO_CON_CODIGO)) {
    if (esMoneda(codigo)) return encontrado(codigo, 0.8, evidencia);
  }
  return ausente();
}

export function extraerValor(clausula: Clausula | null, texto: string, notas: string[]): ValorExtraido {
  if (!clausula) return { valor: ausente(), moneda: ausente(), valor_indeterminado: false };
  const indeterminado = PATRON_INDETERMINADO.exec(clausula.cuerpo);
  if (indeterminado) {
    notas.push("Contrato por demanda: valor 0 con valor_indeterminado = true; requiere confirmación humana.");
    return { valor: encontrado(0, 0.5, indeterminado[0]), moneda: monedaEnOtraClausula(texto), valor_indeterminado: true };
  }
  const valor = montoConCodigo(clausula.cuerpo) ?? montoEnPesos(clausula.cuerpo, notas);
  if (valor) return valor;
  notas.push("La cláusula de valor no contiene una cifra reconocible.");
  return { valor: ausente(), moneda: ausente(), valor_indeterminado: false };
}
