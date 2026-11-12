import type { Correcciones } from "../dominio/contrato.ts";
import type { Cambios } from "../reglas/fila.ts";
import { agregarLineaJson, leerLineasJson } from "./archivos.ts";
import type { Rutas } from "./rutas.ts";

/** Quién resolvió un mensaje en revisión, cuándo, por qué canal y con qué correcciones. */
export interface DecisionHumana {
  ts: string;
  mensaje_id: string;
  decision: "aprobado" | "rechazado";
  via: "bandeja" | "chat";
  aprobador: string;
  correcciones: Correcciones;
  motivo: string | null;
  id_contrato: string | null;
  accion: string | null;
  cambios: Cambios;
}

export const registrarDecision = async (rutas: Rutas, decision: Omit<DecisionHumana, "ts">): Promise<DecisionHumana> => {
  const completa = { ts: new Date().toISOString(), ...decision };
  await agregarLineaJson(rutas.decisiones, completa);
  return completa;
};

// Archivo escrito solo por `registrarDecision`.
export const leerDecisiones = async (rutas: Rutas): Promise<DecisionHumana[]> => (await leerLineasJson(rutas.decisiones)) as DecisionHumana[];
