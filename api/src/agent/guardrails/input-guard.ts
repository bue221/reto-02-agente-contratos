import { normalizar } from "../../core/domain/text.ts";
import type { Resultado } from "../../core/domain/result.ts";
import type { UsoTokens } from "../../llm/adapter.ts";

/**
 * Guarda de entrada: decide en el servidor, antes de que el modelo vea el mensaje, si la recepcionista lo atiende.
 * El prompt también delimita el alcance, pero un prompt se puede desarmar con otro prompt; esto no.
 *   1. Reglas deterministas contra manipulación (no gastan tokens y no se pueden convencer).
 *   2. Clasificador de alcance opcional: una llamada aparte, sin herramientas, que solo devuelve un veredicto.
 */

export type VeredictoAlcance = "permitido" | "fuera_de_alcance" | "manipulacion";

export interface ClasificacionAlcance {
  veredicto: VeredictoAlcance;
  uso: UsoTokens;
}

export interface ClasificadorDeAlcance {
  /** `contexto` es la última respuesta de la recepcionista: sin ella, un «sí, confirmo» no se entiende. Nunca lanza. */
  clasificar(mensaje: string, contexto: string): Promise<Resultado<ClasificacionAlcance>>;
}

export type MotivoBloqueo = "manipulacion" | "fuera_de_alcance" | "sin_verificar";

export interface Bloqueo {
  motivo: MotivoBloqueo;
  /** Para el log: qué regla o veredicto lo bloqueó. Nunca va al chat. */
  detalle: string;
}

export interface RevisionEntrada {
  bloqueo: Bloqueo | null;
  uso: UsoTokens;
}

const SIN_USO: UsoTokens = { entrada: 0, salida: 0 };

/** Sobre texto normalizado (`normalizar`: sin tildes, minúsculas, solo letras, dígitos y espacios). */
const REGLAS_MANIPULACION: readonly { nombre: string; patron: RegExp }[] = [
  {
    nombre: "anular instrucciones",
    patron:
      /\b(ignora|ignorar|olvida|olvidar|omite|desobedece|anula|saltate|ignore|forget|disregard|bypass|override)\b(\s+\w+){0,6}\s+(instrucciones|reglas|indicaciones|restricciones|prompt|instructions|rules|guidelines)\b/,
  },
  { nombre: "prompt de sistema", patron: /\b(prompt|mensaje|instrucciones)\s+(de|del)\s+sistema\b|\bsystem\s+(prompt|message|instructions)\b/ },
  {
    nombre: "revelar instrucciones",
    patron: /\b(revela|revelame|muestrame|dime|repite|imprime|copia|reveal|show|print|repeat)\b(\s+\w+){0,4}\s+(tu|tus|your)\s+(instrucciones|configuracion|prompt|instructions|configuration)\b/,
  },
  {
    nombre: "cambio de rol",
    patron:
      /\b(actua|comportate)\s+como\b|\b(finge|pretende|simula)\s+(ser|que\s+eres)\b|\b(a\s+partir\s+de\s+ahora|desde\s+ahora)\s+(eres|seras|actuaras|responderas)\b|\b(ahora\s+eres|you\s+are\s+now|act\s+as|pretend\s+to\s+be)\b/,
  },
  { nombre: "modo sin restricciones", patron: /\b(modo|mode)\s+(desarrollador|developer|dios|god|dan|sin\s+restricciones|admin|administrador)\b|\bjailbreak\b/ },
  { nombre: "clave del modelo", patron: /\b(api\s*key|apikey|google\s+api\s+key|clave\s+(de\s+)?(la\s+)?(api|gemini|google|llm|del\s+modelo))\b/ },
];

/** Sobre el texto crudo: etiquetas que imitan turnos de sistema o de desarrollador. */
const ETIQUETA_DE_ROL = /<\s*\/?\s*(system|sistema|assistant|developer)\s*>|\[\s*\/?\s*(system|sistema|inst)\s*\]/i;

export function reglaDeManipulacion(mensaje: string): string | null {
  if (ETIQUETA_DE_ROL.test(mensaje)) return "etiqueta de rol";
  const texto = normalizar(mensaje);
  return REGLAS_MANIPULACION.find(({ patron }) => patron.test(texto))?.nombre ?? null;
}

export interface OpcionesRevision {
  clasificador?: ClasificadorDeAlcance | undefined;
  ultimaRespuesta: string;
}

/** Nunca lanza. Si el clasificador falla, bloquea: sin veredicto no se deja pasar el mensaje al modelo. */
export async function revisarEntrada(mensaje: string, { clasificador, ultimaRespuesta }: OpcionesRevision): Promise<RevisionEntrada> {
  const regla = reglaDeManipulacion(mensaje);
  if (regla) return { bloqueo: { motivo: "manipulacion", detalle: `regla: ${regla}` }, uso: SIN_USO };
  if (!clasificador) return { bloqueo: null, uso: SIN_USO };
  const clasificacion = await clasificador.clasificar(mensaje, ultimaRespuesta);
  if (!clasificacion.ok) return { bloqueo: { motivo: "sin_verificar", detalle: clasificacion.error }, uso: SIN_USO };
  const { veredicto, uso } = clasificacion.data;
  return { bloqueo: veredicto === "permitido" ? null : { motivo: veredicto, detalle: `clasificador: ${veredicto}` }, uso };
}

const OFERTA = "procesar el buzón, consultar su estado, buscar un contrato en el maestro, explicar la validación de un mensaje, responder una revisión o generar las alertas";

const RESPUESTAS: Record<MotivoBloqueo, string> = {
  fuera_de_alcance: `Solo puedo ayudarte con la recepción de contratos: ${OFERTA}.`,
  manipulacion: `No puedo cambiar mis instrucciones ni mi rol, ni revelar mi configuración. Puedo ayudarte con la recepción de contratos: ${OFERTA}.`,
  sin_verificar: "No pude verificar tu mensaje en este momento. Vuelve a intentarlo en unos segundos.",
};

/** Respuesta fija: no la redacta el modelo, así que no hay nada que convencer. */
export function respuestaDeBloqueo(bloqueo: Bloqueo, pendientes: readonly string[]): string {
  const recordatorio = pendientes.length > 0 ? `\n\nSigue pendiente tu decisión sobre ${pendientes.join(", ")}.` : "";
  return `${RESPUESTAS[bloqueo.motivo]}${recordatorio}`;
}
