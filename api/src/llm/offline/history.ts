import type { Resultado } from "../../core/domain/result.ts";
import type { MensajeLlm } from "../adapter.ts";

/** Lectura del historial que hace el guion offline: qué herramientas se ejecutaron y con qué resultado. */

export interface Ejecucion {
  nombre: string;
  args: Record<string, unknown>;
  resultado: Resultado<unknown>;
}

function parsear(resultado: string): Resultado<unknown> {
  try {
    return JSON.parse(resultado) as Resultado<unknown>;
  } catch {
    return { ok: false, error: resultado };
  }
}

/** El ciclo agrega los resultados en el mismo orden que las llamadas: se emparejan por posición, no por id. */
export function ejecuciones(mensajes: readonly MensajeLlm[]): Ejecucion[] {
  const pendientes: { nombre: string; args: Record<string, unknown> }[] = [];
  const hechas: Ejecucion[] = [];
  for (const mensaje of mensajes) {
    if (mensaje.rol === "asistente") pendientes.push(...mensaje.llamadas);
    if (mensaje.rol !== "herramienta") continue;
    const llamada = pendientes.shift();
    if (llamada) hechas.push({ nombre: llamada.nombre, args: llamada.args, resultado: parsear(mensaje.resultado) });
  }
  return hechas;
}

export function indiceUltimoUsuario(mensajes: readonly MensajeLlm[]): number {
  return mensajes.findLastIndex((mensaje) => mensaje.rol === "usuario");
}

export function textoUltimoUsuario(mensajes: readonly MensajeLlm[]): string {
  const ultimo = mensajes[indiceUltimoUsuario(mensajes)];
  return ultimo?.rol === "usuario" ? ultimo.texto : "";
}

export const mensajeIdDe = (ejecucion: Ejecucion): string | null =>
  typeof ejecucion.args.mensaje_id === "string" ? ejecucion.args.mensaje_id : null;

/** Última ejecución de una herramienta (opcionalmente para un mensaje), con el tipo de `data` que fija quien llama. */
export function buscar<T>(lista: readonly Ejecucion[], nombre: string, mensajeId: string | null = null): Resultado<T> | undefined {
  const encontrada = lista.findLast((ejecucion) => ejecucion.nombre === nombre && (mensajeId === null || mensajeIdDe(ejecucion) === mensajeId));
  return encontrada?.resultado as Resultado<T> | undefined;
}
