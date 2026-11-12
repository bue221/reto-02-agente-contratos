import type { Campo, Clasificacion, Correo, Extraccion, Tipo } from "../../domain/types.ts";
import type { DocumentLlmPort } from "../../ports/llm.ts";
import { parseFecha, parseValor } from "../../parse.ts";

const vacio = <T>(): Campo<T> => ({ valor: null, confianza: 0 });

export function clasificarHeuristico(correo: Correo): Clasificacion {
  const nombres = correo.adjuntos.map((a) => a.nombre.toLowerCase());
  const primeraLinea = (correo.adjuntos[0]?.texto ?? "").trim().slice(0, 80).toLowerCase();
  const asuntoCuerpo = `${correo.asunto} ${correo.cuerpo}`;
  const mencionaId = /\bC-\d{3}\b/i.test(asuntoCuerpo);

  const hay = (re: RegExp) => nombres.some((n) => re.test(n)) || re.test(primeraLinea);
  let tipo: Tipo = "otro";
  let razon = "Sin adjuntos reconocibles";
  if (hay(/otros[ií]/)) {
    tipo = "otrosi";
    razon = "Adjunto/encabezado indica otrosí";
  } else if (hay(/cotizaci/)) {
    tipo = "cotizacion";
    razon = "Adjunto/encabezado indica cotización";
  } else if (hay(/contrato/)) {
    if (mencionaId && /actualiz|nueva versi|modific|correg/i.test(asuntoCuerpo)) {
      tipo = "actualizacion";
      razon = "Contrato que referencia un id existente y pide actualizarlo";
    } else {
      tipo = "contrato";
      razon = "Adjunto/encabezado indica contrato";
    }
  }
  return { tipo, confianza: tipo === "otro" ? 0.5 : 0.9, razon };
}

export function extraerHeuristico(texto: string): Extraccion {
  const linea = (re: RegExp) => texto.match(re)?.[1]?.trim();
  const out: Extraccion = {
    idContrato: vacio(),
    cliente: vacio(),
    nit: vacio(),
    valor: vacio(),
    fechaInicio: vacio(),
    fechaFin: vacio(),
  };

  const id = texto.match(/\bC-\d{3}\b/i)?.[0];
  if (id) out.idContrato = { valor: id.toUpperCase(), confianza: 0.95, evidencia: id };

  const cliente = linea(/^\s*(?:Cliente|Contratante)\s*:\s*(.+)$/im);
  if (cliente) out.cliente = { valor: cliente, confianza: 0.95, evidencia: cliente };

  const nit = linea(/NIT\.?\s*:?\s*([\d.\-]*\d)/i);
  if (nit) {
    const ok = /^\d{3}\.\d{3}\.\d{3}-\d$/.test(nit);
    out.nit = { valor: nit, confianza: ok ? 0.97 : 0.6, evidencia: nit };
  }

  const valor = linea(/^\s*(?:Nuevo\s+)?valor[^:\n]*:\s*(.+)$/im);
  if (valor) out.valor = parseValor(valor);

  const ini = linea(/^\s*(?:Nueva\s+)?fecha\s+de\s+inicio\s*:\s*(.+)$/im);
  if (ini) out.fechaInicio = parseFecha(ini);

  const fin = linea(
    /^\s*(?:Nueva\s+)?fecha\s+de\s+(?:terminaci[oó]n|fin|finalizaci[oó]n)\s*:\s*(.+)$/im,
  );
  if (fin) out.fechaFin = parseFecha(fin);

  return out;
}

/** Adapter offline: siempre responde (nunca null). */
export class HeuristicDocumentLlm implements DocumentLlmPort {
  readonly id = "offline";

  async probe(): Promise<boolean> {
    return true;
  }

  isActive(): boolean {
    return true;
  }

  async clasificar(correo: Correo): Promise<Clasificacion> {
    return clasificarHeuristico(correo);
  }

  async extraer(texto: string, _tipo: Tipo): Promise<Extraccion> {
    return extraerHeuristico(texto);
  }
}
