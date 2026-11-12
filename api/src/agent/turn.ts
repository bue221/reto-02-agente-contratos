import type { LlamadaVisible } from "../http/types.ts";
import { leerProcesados } from "../infrastructure/logs.ts";
import { rutasDelProyecto } from "../infrastructure/paths.ts";
import { mensajeDeError } from "../core/domain/result.ts";
import type { ProveedorLlm } from "../llm/adapter.ts";

/**
 * Reglas de un turno de la recepcionista que no dependen de quién ejecuta el bucle:
 * las usan el ciclo propio (`loop.ts`) y el grafo de LangGraph de `studio/`.
 */

/** Un mensaje resuelto en otro canal (bandeja u otra sesión) deja de esperar confirmación. */
export async function pendientesVigentes(directorio: string, pendientes: readonly string[]): Promise<string[]> {
  if (pendientes.length === 0) return [];
  try {
    const procesados = await leerProcesados(rutasDelProyecto(directorio));
    return pendientes.filter((id) => !(id in procesados));
  } catch (error) {
    console.error(`[agente] no se pudo leer procesados.json: ${mensajeDeError(error)}`);
    return [...pendientes];
  }
}

export interface CierreTurno {
  /** Lo que la sesión sigue esperando al terminar el turno. */
  pendientes: string[];
  /** Lo que el motor pausó en este turno: obliga a terminar con una pregunta (CA3). */
  nuevas: string[];
}

/** CA3 determinista: la confirmación se decide por lo que el motor pausó, no por el texto del modelo. */
export function cerrarPendientes(alInicio: Iterable<string>, enRevision: Iterable<string>, resueltos: ReadonlySet<string>): CierreTurno {
  const nuevas = [...new Set(enRevision)].filter((id) => !resueltos.has(id));
  const pendientes = [...new Set([...alInicio, ...nuevas])].filter((id) => !resueltos.has(id));
  return { pendientes, nuevas };
}

const preguntaExplicita = (ids: readonly string[]): string =>
  `¿Confirmas los campos en revisión de ${ids.join(", ")}? Responde «confirmo …» con los valores correctos para registrarlos.`;

/** Si el motor pausó algo y el modelo olvidó preguntar, el turno termina igual con una pregunta explícita. */
export const conPreguntaExplicita = (texto: string, nuevas: readonly string[]): string =>
  nuevas.length > 0 && !texto.endsWith("?") ? `${texto}\n\n${preguntaExplicita(nuevas)}` : texto;

export const errorDeProveedor = (proveedor: ProveedorLlm, error: string): string =>
  `No pude obtener respuesta del modelo (${proveedor.nombre}/${proveedor.modelo}): ${error}. La sesión sigue activa: vuelve a intentarlo en un momento.`;

/** CA1: al agotar las iteraciones se responde con lo hecho y lo que falta. */
export function mensajeDeTope(maxIteraciones: number, llamadas: readonly LlamadaVisible[], ultimoTexto: string): string {
  const hechas = llamadas.map((llamada) => `- ${llamada.nombre}: ${llamada.ok ? "ok" : "error"} — ${llamada.resumen}`);
  return [
    `Alcancé el tope de ${maxIteraciones} iteraciones de este turno sin terminar.`,
    ultimoTexto,
    hechas.length > 0 ? `Lo que alcancé a hacer:\n${hechas.join("\n")}` : "No alcancé a ejecutar herramientas.",
    "Lo que falta: revisar esos resultados y completar los pasos pendientes. Escribe «continúa» para seguir desde aquí.",
  ]
    .filter(Boolean)
    .join("\n\n");
}
