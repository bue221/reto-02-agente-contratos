import { type Campo, ausente, encontrado } from "../domain/contract.ts";
import { normalizar } from "../domain/text.ts";
import type { Clausula } from "./document.ts";

export interface PolizaExtraida {
  requiere_poliza: Campo<boolean>;
  tipo_poliza: Campo<string>;
}

const TIPOS_POLIZA: ReadonlyArray<[RegExp, string]> = [
  [/\bcumplimiento\b/, "cumplimiento"],
  [/\bresponsabilidad civil\b/, "responsabilidad_civil"],
  [/\bcalidad\b/, "calidad"],
  [/\bsalarios\b|\bprestaciones sociales\b/, "salarios_prestaciones"],
  [/\banticipo\b/, "buen_manejo_anticipo"],
];

/** Garantía exigida solo para órdenes futuras, no para el contrato en sí. */
const PATRON_CONDICIONAL = /\bpara cada orden\b|\bcuyo valor supere\b|\ben caso de que\b/;

const tiposMencionados = (cuerpo: string): string[] => {
  const texto = normalizar(cuerpo);
  return TIPOS_POLIZA.filter(([patron]) => patron.test(texto)).map(([, tipo]) => tipo);
};

export function extraerPoliza(clausula: Clausula | null, esOtrosi: boolean, notas: string[]): PolizaExtraida {
  if (!clausula) {
    if (esOtrosi) return { requiere_poliza: ausente(), tipo_poliza: ausente() };
    return { requiere_poliza: encontrado(false, 0.9, "sin cláusula de garantías"), tipo_poliza: encontrado("", 0.9) };
  }
  const tipos = tiposMencionados(clausula.cuerpo);
  if (PATRON_CONDICIONAL.test(normalizar(clausula.cuerpo))) {
    notas.push(
      `Garantía condicional (${tipos.join(";") || "sin tipo"}) exigida por orden de servicio, no por el contrato: se registra requiere_poliza = false y cada orden se evalúa al llegar.`,
    );
    return { requiere_poliza: encontrado(false, 0.75, clausula.cuerpo), tipo_poliza: encontrado("", 0.75) };
  }
  if (tipos.length === 0) {
    notas.push("La cláusula de garantías no nombra el tipo de póliza.");
    return { requiere_poliza: encontrado(true, 0.9, clausula.cuerpo), tipo_poliza: encontrado("", 0.5) };
  }
  return { requiere_poliza: encontrado(true, 0.95, clausula.cuerpo), tipo_poliza: encontrado(tipos.join(";"), 0.95, clausula.cuerpo) };
}
