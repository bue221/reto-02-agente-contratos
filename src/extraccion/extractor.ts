import { type Campo, type CampoContrato, type Contrato, ausente, contratoVacio, encontrado } from "../dominio/contrato.ts";
import { MAX_LONGITUD_OBJETO } from "../dominio/parametros.ts";
import { type Resultado, exito, fallo } from "../dominio/resultado.ts";
import { truncarEnPalabra } from "../dominio/texto.ts";
import { type Documento, ErrorExtraccion, buscarClausula, detectarTipo, segmentar } from "./documento.ts";
import { extraerPartes } from "./partes.ts";
import { extraerPlazo } from "./plazo.ts";
import { extraerPoliza } from "./poliza.ts";
import { extraerValor } from "./valor.ts";

const PATRON_ID_CON_NUMERO = /\bNo\.?\s*([A-Z]{1,5}-\d{4}-\d{1,5})\b/;
const PATRON_ID = /\b([A-Z]{2,5}-\d{4}-\d{1,5})\b/;

/** En un otrosí el primer "No." es el del otrosí; el patrón exige formato de contrato, así toma el referenciado. */
function extraerIdContrato(documento: Documento): Campo<string> {
  const conNumero = PATRON_ID_CON_NUMERO.exec(documento.texto);
  if (conNumero?.[1]) return encontrado(conNumero[1], 0.95, conNumero[0]);
  const suelto = PATRON_ID.exec(documento.texto);
  return suelto?.[1] ? encontrado(suelto[1], 0.8, suelto[0]) : ausente();
}

function extraerObjeto(documento: Documento, notas: string[]): Campo<string> {
  const cuerpo = buscarClausula(documento, /OBJETO/)?.cuerpo.replace(/\s+/g, " ");
  if (!cuerpo) return ausente();
  if (cuerpo.length <= MAX_LONGITUD_OBJETO) return encontrado(cuerpo, 0.9, cuerpo);
  notas.push(`Objeto truncado a ${MAX_LONGITUD_OBJETO} caracteres.`);
  return encontrado(truncarEnPalabra(cuerpo, MAX_LONGITUD_OBJETO), 0.85, cuerpo);
}

const CAMPOS_POR_CLAUSULA: ReadonlyArray<[RegExp, CampoContrato[]]> = [
  [/VALOR/, ["valor", "moneda"]],
  [/PLAZO|DURACI[OÓ]N/, ["fecha_fin"]],
  [/OBJETO/, ["objeto"]],
  [/GARANT[IÍ]A|P[OÓ]LIZA/, ["requiere_poliza", "tipo_poliza"]],
];

function camposModificados(documento: Documento): CampoContrato[] {
  return documento.clausulas.flatMap((clausula) => {
    const modificada = /modificar la cl[aá]usula\s+\S+\s*\(([^)]+)\)/i.exec(clausula.cuerpo)?.[1]?.toUpperCase();
    if (!modificada) return [];
    return CAMPOS_POR_CLAUSULA.find(([patron]) => patron.test(modificada))?.[1] ?? [];
  });
}

function numeroOtrosi(documento: Documento): number | null {
  const numero = /otros[ií]\s+No\.?\s*(\d+)/i.exec(documento.encabezado)?.[1];
  return numero ? Number(numero) : null;
}

function extraerDeDocumento(documento: Documento): Contrato {
  const tipo = detectarTipo(documento);
  if (tipo === "otro") return contratoVacio("otro", ["El documento no es un contrato ni un otrosí."]);
  const esOtrosi = tipo === "otrosi";
  const notas: string[] = esOtrosi ? ["Otrosí: los campos que no modifica se heredan de la fila del maestro."] : [];
  const valor = extraerValor(buscarClausula(documento, /VALOR/), documento.texto, notas);
  return {
    tipo_documento: tipo,
    numero_otrosi: esOtrosi ? numeroOtrosi(documento) : null,
    campos_modificados: esOtrosi ? camposModificados(documento) : [],
    valor_indeterminado: valor.valor_indeterminado,
    id_contrato: extraerIdContrato(documento),
    ...extraerPartes(documento.texto, documento.preambulo, notas),
    objeto: extraerObjeto(documento, notas),
    valor: valor.valor,
    moneda: valor.moneda,
    ...extraerPlazo(buscarClausula(documento, /PLAZO|DURACI[OÓ]N/), documento.firma, notas),
    ...extraerPoliza(buscarClausula(documento, /GARANT[IÍ]A|P[OÓ]LIZA/), esOtrosi, notas),
    notas,
  };
}

/** Extracción determinista. Los errores de datos del documento vuelven como `fallo`; los inesperados los captura la capa de herramientas. */
export function extraerContrato(texto: string): Resultado<Contrato> {
  if (texto.trim() === "") return fallo("el texto del contrato está vacío");
  try {
    return exito(extraerDeDocumento(segmentar(texto)));
  } catch (error) {
    if (error instanceof ErrorExtraccion) return fallo(error.message);
    throw error;
  }
}
