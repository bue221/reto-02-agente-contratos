import type { Resultado } from "../core/domain/result.ts";

/**
 * Interfaz propia del proveedor LLM (PRD 6.1): el ciclo del agente solo conoce estos tipos.
 * Cambiar de proveedor es escribir otra implementación de `ProveedorLlm`, sin tocar el ciclo.
 */

export interface LlamadaHerramienta {
  /** Id estable dentro del turno para emparejar la llamada con su resultado. */
  id: string;
  nombre: string;
  args: Record<string, unknown>;
  /** Metadato opaco que algunos proveedores exigen reenviar tal cual (p. ej. `thoughtSignature` de Gemini). */
  firma?: string;
}

export type MensajeLlm =
  | { rol: "sistema"; texto: string }
  | { rol: "usuario"; texto: string }
  | { rol: "asistente"; texto: string; llamadas: LlamadaHerramienta[] }
  | { rol: "herramienta"; id: string; nombre: string; resultado: string };

export interface DefinicionHerramienta {
  nombre: string;
  descripcion: string;
  /** JSON Schema de los argumentos (generado desde zod). */
  parametros: Record<string, unknown>;
}

export interface UsoTokens {
  entrada: number;
  salida: number;
}

export interface RespuestaLlm {
  texto: string;
  llamadas: LlamadaHerramienta[];
  uso: UsoTokens;
}

export interface ProveedorLlm {
  readonly nombre: string;
  readonly modelo: string;
  /** Nunca lanza: un fallo de red, timeout o HTTP vuelve como `{ ok: false, error }` en lenguaje claro. */
  enviar(mensajes: readonly MensajeLlm[], herramientas: readonly DefinicionHerramienta[]): Promise<Resultado<RespuestaLlm>>;
}

export const totalTokens = (uso: UsoTokens): number => uso.entrada + uso.salida;
