import type { Context, Hono } from "hono";
import { mensajeDeError } from "../core/domain/result.ts";
import { errorApi } from "./helpers.ts";

/**
 * Publica el servidor de LangGraph de `studio/` bajo `/langgraph/*` del mismo origen: el contenedor expone un solo
 * puerto y el de LangGraph escucha solo en la interfaz local. Studio (smith.langchain.com) lo usa como `baseUrl`.
 * El reenvío es transparente, CORS incluido: lo resuelve el servidor de LangGraph, que acepta cualquier origen.
 */

export const PREFIJO_LANGGRAPH = "/langgraph";

/** Cabeceras de un salto: describen esta conexión, no la petición, y no se reenvían. */
const CABECERAS_DE_SALTO = ["host", "connection", "keep-alive", "transfer-encoding", "content-length", "accept-encoding"];
/** `fetch` ya descomprimió el cuerpo y fija su propia longitud al reenviarlo. */
const CABECERAS_DE_RESPUESTA_DESCARTADAS = ["content-encoding", "content-length", "transfer-encoding", "connection"];

function sinCabeceras(origen: Headers, descartar: readonly string[]): Headers {
  const copia = new Headers(origen);
  for (const nombre of descartar) copia.delete(nombre);
  return copia;
}

async function reenviar(c: Context, destino: string): Promise<Response> {
  const { pathname, search } = new URL(c.req.url);
  const url = `${destino}${pathname.slice(PREFIJO_LANGGRAPH.length) || "/"}${search}`;
  const conCuerpo = c.req.method !== "GET" && c.req.method !== "HEAD";
  try {
    const respuesta = await fetch(url, {
      method: c.req.method,
      headers: sinCabeceras(c.req.raw.headers, CABECERAS_DE_SALTO),
      ...(conCuerpo ? { body: await c.req.raw.arrayBuffer() } : {}),
      // Si Studio cierra un stream, también se corta la petición al servidor de LangGraph.
      signal: c.req.raw.signal,
      redirect: "manual",
    });
    return new Response(respuesta.body, { status: respuesta.status, statusText: respuesta.statusText, headers: sinCabeceras(respuesta.headers, CABECERAS_DE_RESPUESTA_DESCARTADAS) });
  } catch (error) {
    console.error(`[langgraph] ${c.req.method} ${pathname}: ${mensajeDeError(error)}`);
    // Sin esta cabecera el navegador oculta el error a Studio y solo muestra un fallo de red.
    c.header("access-control-allow-origin", "*");
    return c.json(errorApi("langgraph_no_disponible", "El servidor de LangGraph Studio no está disponible en este momento."), 502);
  }
}

export function rutasLangGraph(app: Hono, destino: string): void {
  const base = destino.replace(/\/+$/, "");
  app.all(PREFIJO_LANGGRAPH, (c) => reenviar(c, base));
  app.all(`${PREFIJO_LANGGRAPH}/*`, (c) => reenviar(c, base));
}
