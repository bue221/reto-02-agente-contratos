import { z } from "zod";
import { type Resultado, exito, fallo, mensajeDeError } from "../core/domain/result.ts";
import type { DefinicionHerramienta, LlamadaHerramienta, MensajeLlm, ProveedorLlm, RespuestaLlm } from "./adapter.ts";

/** Adaptador Gemini vía REST (`generateContent`) con `fetch`: sin SDK, con timeout por AbortController y reintentos ante fallos transitorios. */

export interface OpcionesGemini {
  apiKey: string;
  modelo: string;
  timeoutMs: number;
  /** Reintentos ante 429, 5xx o fallo de red (no ante timeout); 0 los desactiva. */
  reintentos?: number;
  /** Inyectable para tests; por defecto el `fetch` global. */
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
  /** Inyectable para tests; por defecto un `setTimeout`. */
  esperar?: (ms: number) => Promise<void>;
}

const URL_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const ESPERA_BASE_MS = 1000;
const ESPERA_MAXIMA_MS = 10_000;
const ESTADOS_TRANSITORIOS = new Set([429, 500, 502, 503, 504]);

const dormir = (ms: number): Promise<void> => new Promise((resolver) => setTimeout(resolver, ms));

/** Un intento de llamada: si falló, si vale la pena repetirlo y cuánto pidió esperar el servidor. */
interface Intento {
  resultado: Resultado<RespuestaLlm>;
  reintentable: boolean;
  esperaPedidaMs?: number;
}

/** `Retry-After` en segundos; la forma de fecha HTTP no la usa Gemini. */
function esperaPedida(respuesta: Response): number | undefined {
  const segundos = Number(respuesta.headers.get("retry-after"));
  return Number.isFinite(segundos) && segundos > 0 ? segundos * 1000 : undefined;
}

/** Espera exponencial (1 s, 2 s, 4 s…) salvo que el servidor pida otra; siempre acotada para no colgar el turno. */
const esperaAntesDe = (reintento: number, pedida: number | undefined): number => Math.min(pedida ?? ESPERA_BASE_MS * 2 ** reintento, ESPERA_MAXIMA_MS);

type Parte =
  | { text: string }
  | { functionCall: { name: string; args: Record<string, unknown> }; thoughtSignature?: string }
  | { functionResponse: { name: string; response: Record<string, unknown> } };

interface Contenido {
  role: "user" | "model";
  parts: Parte[];
}

const ParteRespuestaSchema = z.object({
  text: z.string().optional(),
  thought: z.boolean().optional(),
  thoughtSignature: z.string().optional(),
  functionCall: z.object({ name: z.string(), args: z.record(z.string(), z.unknown()).optional() }).optional(),
});

const RespuestaGeminiSchema = z.object({
  candidates: z
    .array(
      z.object({
        content: z.object({ parts: z.array(ParteRespuestaSchema).optional() }).optional(),
        finishReason: z.string().optional(),
      }),
    )
    .optional(),
  usageMetadata: z
    .object({
      promptTokenCount: z.number().optional(),
      candidatesTokenCount: z.number().optional(),
      thoughtsTokenCount: z.number().optional(),
    })
    .optional(),
  promptFeedback: z.object({ blockReason: z.string().optional() }).optional(),
});

const ErrorGeminiSchema = z.object({ error: z.object({ message: z.string() }) });

/** `functionResponse.response` debe ser un objeto; los resultados de herramientas ya lo son (`{ ok, data | error }`). */
function comoObjeto(resultado: string): Record<string, unknown> {
  try {
    const valor: unknown = JSON.parse(resultado);
    return typeof valor === "object" && valor !== null && !Array.isArray(valor) ? (valor as Record<string, unknown>) : { resultado: valor };
  } catch {
    return { resultado };
  }
}

function parteDeLlamada(llamada: LlamadaHerramienta): Parte {
  const parte: Parte = { functionCall: { name: llamada.nombre, args: llamada.args } };
  return llamada.firma ? { ...parte, thoughtSignature: llamada.firma } : parte;
}

function contenidoDe(mensaje: Exclude<MensajeLlm, { rol: "sistema" }>): Contenido {
  switch (mensaje.rol) {
    case "usuario":
      return { role: "user", parts: [{ text: mensaje.texto }] };
    case "asistente": {
      const texto: Parte[] = mensaje.texto ? [{ text: mensaje.texto }] : [];
      return { role: "model", parts: [...texto, ...mensaje.llamadas.map(parteDeLlamada)] };
    }
    case "herramienta":
      return { role: "user", parts: [{ functionResponse: { name: mensaje.nombre, response: comoObjeto(mensaje.resultado) } }] };
  }
}

const soloRespuestasDeHerramienta = (contenido: Contenido): boolean =>
  contenido.role === "user" && contenido.parts.every((parte) => "functionResponse" in parte);

/** Gemini exige alternancia de roles: los resultados de herramientas consecutivos van en un solo contenido. */
function contenidosDe(mensajes: readonly MensajeLlm[]): Contenido[] {
  const contenidos: Contenido[] = [];
  for (const mensaje of mensajes) {
    if (mensaje.rol === "sistema") continue;
    const contenido = contenidoDe(mensaje);
    const anterior = contenidos.at(-1);
    if (anterior && mensaje.rol === "herramienta" && soloRespuestasDeHerramienta(anterior)) {
      anterior.parts.push(...contenido.parts);
    } else {
      contenidos.push(contenido);
    }
  }
  return contenidos;
}

function declaracionDe(herramienta: DefinicionHerramienta): Record<string, unknown> {
  const { $schema: _omitido, ...esquema } = herramienta.parametros;
  const sinArgumentos = Object.keys((esquema.properties as Record<string, unknown> | undefined) ?? {}).length === 0;
  return { name: herramienta.nombre, description: herramienta.descripcion, ...(sinArgumentos ? {} : { parametersJsonSchema: esquema }) };
}

export function cuerpoDePeticion(mensajes: readonly MensajeLlm[], herramientas: readonly DefinicionHerramienta[]): Record<string, unknown> {
  const sistema = mensajes.filter((mensaje) => mensaje.rol === "sistema").map((mensaje) => mensaje.texto).join("\n\n");
  return {
    ...(sistema ? { systemInstruction: { parts: [{ text: sistema }] } } : {}),
    contents: contenidosDe(mensajes),
    tools: herramientas.length > 0 ? [{ functionDeclarations: herramientas.map(declaracionDe) }] : undefined,
    generationConfig: { temperature: 0 },
  };
}

export function respuestaDe(json: unknown): Resultado<RespuestaLlm> {
  const leido = RespuestaGeminiSchema.safeParse(json);
  if (!leido.success) return fallo("Gemini devolvió una respuesta con un formato inesperado");
  const { candidates, usageMetadata, promptFeedback } = leido.data;
  const candidato = candidates?.[0];
  const partes = candidato?.content?.parts ?? [];
  if (partes.length === 0) {
    const motivo = promptFeedback?.blockReason ?? candidato?.finishReason ?? "sin motivo";
    return fallo(`Gemini no devolvió contenido (${motivo})`);
  }
  const texto = partes
    .filter((parte) => parte.text && !parte.thought)
    .map((parte) => parte.text)
    .join("");
  const llamadas = partes.flatMap((parte, indice): LlamadaHerramienta[] =>
    parte.functionCall
      ? [{ id: `llamada-${indice}`, nombre: parte.functionCall.name, args: parte.functionCall.args ?? {}, ...(parte.thoughtSignature ? { firma: parte.thoughtSignature } : {}) }]
      : [],
  );
  const uso = {
    entrada: usageMetadata?.promptTokenCount ?? 0,
    salida: (usageMetadata?.candidatesTokenCount ?? 0) + (usageMetadata?.thoughtsTokenCount ?? 0),
  };
  return exito({ texto, llamadas, uso });
}

async function errorHttp(respuesta: Response): Promise<string> {
  const cuerpo: unknown = await respuesta.json().catch(() => null);
  const leido = ErrorGeminiSchema.safeParse(cuerpo);
  const detalle = leido.success ? `: ${leido.data.error.message}` : "";
  return `Gemini respondió HTTP ${respuesta.status}${detalle}`;
}

export class ProveedorGemini implements ProveedorLlm {
  readonly nombre = "gemini";
  readonly modelo: string;
  readonly #opciones: OpcionesGemini;

  constructor(opciones: OpcionesGemini) {
    this.modelo = opciones.modelo;
    this.#opciones = opciones;
  }

  async enviar(mensajes: readonly MensajeLlm[], herramientas: readonly DefinicionHerramienta[]): Promise<Resultado<RespuestaLlm>> {
    const { reintentos = 0, esperar = dormir } = this.#opciones;
    const cuerpo = JSON.stringify(cuerpoDePeticion(mensajes, herramientas));
    for (let reintento = 0; ; reintento++) {
      const { resultado, reintentable, esperaPedidaMs } = await this.#intentar(cuerpo);
      if (resultado.ok) return resultado;
      if (!reintentable || reintento >= reintentos) return reintento > 0 ? fallo(`${resultado.error} (tras ${reintento + 1} intentos)`) : resultado;
      const espera = esperaAntesDe(reintento, esperaPedidaMs);
      console.warn(`[gemini] ${resultado.error}; reintento ${reintento + 1}/${reintentos} en ${espera} ms`);
      await esperar(espera);
    }
  }

  /** Un timeout no se reintenta: ya consumió `timeoutMs` y repetirlo multiplicaría la espera de la analista. */
  async #intentar(cuerpo: string): Promise<Intento> {
    const { apiKey, timeoutMs } = this.#opciones;
    const hacerFetch = this.#opciones.fetch ?? fetch;
    const controlador = new AbortController();
    const temporizador = setTimeout(() => controlador.abort(), timeoutMs);
    try {
      const respuesta = await hacerFetch(`${URL_BASE}/${encodeURIComponent(this.modelo)}:generateContent`, {
        method: "POST",
        // La clave va en cabecera, nunca en la URL, para que no aparezca en logs de proxies ni en errores.
        headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
        body: cuerpo,
        signal: controlador.signal,
      });
      if (!respuesta.ok) {
        const espera = esperaPedida(respuesta);
        return { resultado: fallo(await errorHttp(respuesta)), reintentable: ESTADOS_TRANSITORIOS.has(respuesta.status), ...(espera ? { esperaPedidaMs: espera } : {}) };
      }
      return { resultado: respuestaDe(await respuesta.json()), reintentable: false };
    } catch (error) {
      if (controlador.signal.aborted) return { resultado: fallo(`Gemini no respondió en ${timeoutMs} ms (tiempo de espera agotado)`), reintentable: false };
      return { resultado: fallo(`no se pudo contactar a Gemini: ${mensajeDeError(error)}`), reintentable: true };
    } finally {
      clearTimeout(temporizador);
    }
  }
}
