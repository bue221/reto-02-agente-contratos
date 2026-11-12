import { type BaseMessage, type MessageContent, isAIMessage, isHumanMessage, isToolMessage } from "@langchain/core/messages";
import type { LlamadaHerramienta, MensajeLlm } from "../../api/src/llm/adapter.ts";

/**
 * Traducción entre los mensajes de LangChain (lo que guarda y muestra Studio) y `MensajeLlm` (lo que entiende
 * `ProveedorLlm`). Así el grafo de Studio usa el mismo adaptador, prompt y proveedor que la app.
 */

/** Las firmas opacas (p. ej. `thoughtSignature` de Gemini) viajan en `additional_kwargs` del mensaje del modelo. */
export const CLAVE_FIRMAS = "firmas";

export function textoDe(contenido: MessageContent): string {
  if (typeof contenido === "string") return contenido;
  return contenido.map((parte) => (parte.type === "text" && typeof parte.text === "string" ? parte.text : "")).join("");
}

function firmasDe(mensaje: BaseMessage): Record<string, string> {
  const firmas = mensaje.additional_kwargs[CLAVE_FIRMAS];
  return typeof firmas === "object" && firmas !== null ? (firmas as Record<string, string>) : {};
}

/** Marca la respuesta fija de la guarda de entrada: ni ella ni el mensaje que bloqueó vuelven al modelo. */
export const CLAVE_BLOQUEO = "bloqueado";

export const esBloqueo = (mensaje: BaseMessage | undefined): boolean => mensaje !== undefined && isAIMessage(mensaje) && mensaje.additional_kwargs[CLAVE_BLOQUEO] === true;

export function aMensajesLlm(mensajes: readonly BaseMessage[]): MensajeLlm[] {
  return mensajes.flatMap((mensaje, indice): MensajeLlm[] => {
    if (esBloqueo(mensaje)) return [];
    if (isHumanMessage(mensaje)) return esBloqueo(mensajes[indice + 1]) ? [] : [{ rol: "usuario", texto: textoDe(mensaje.content) }];
    if (isToolMessage(mensaje)) return [{ rol: "herramienta", id: mensaje.tool_call_id, nombre: mensaje.name ?? "", resultado: textoDe(mensaje.content) }];
    if (!isAIMessage(mensaje)) return [];
    const firmas = firmasDe(mensaje);
    const llamadas = (mensaje.tool_calls ?? []).map((llamada): LlamadaHerramienta => {
      const id = llamada.id ?? "";
      const firma = firmas[id];
      return { id, nombre: llamada.name, args: llamada.args, ...(firma ? { firma } : {}) };
    });
    return [{ rol: "asistente", texto: textoDe(mensaje.content), llamadas }];
  });
}

export const firmasDeLlamadas = (llamadas: readonly LlamadaHerramienta[]): Record<string, string> =>
  Object.fromEntries(llamadas.flatMap((llamada) => (llamada.firma ? [[llamada.id, llamada.firma]] : [])));
