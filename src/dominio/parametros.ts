/**
 * Parámetros de negocio del registro de contratos.
 * Cambiar una regla aquí no toca el servidor ni el ciclo del agente.
 */

/** RN5: por debajo de este umbral un campo requiere revisión humana. */
export const UMBRAL_CONFIANZA = 0.8;

/** RN2: similitud mínima de `objeto` (mismo NIT) para considerar actualización. */
export const UMBRAL_SIMILITUD_OBJETO = 0.9;

/** Fecha en que se congeló el maestro; lo registrado desde aquí es el "gap cubierto". */
export const FECHA_CORTE_MAESTRO = "2026-05-30";

/** HU-5: ventana de alerta de vencimiento. */
export const DIAS_ALERTA_VENCIMIENTO = 60;

/** Longitud máxima de la columna `objeto` del maestro. */
export const MAX_LONGITUD_OBJETO = 200;

/** Periferia es siempre EL CONTRATISTA; nunca debe tomarse como cliente. */
export const EMPRESA_PROPIA = {
  nombre: "PERIFERIA IT GROUP S.A.S.",
  idTributario: "900123456",
} as const;
