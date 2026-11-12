import { describe, expect, test } from "bun:test";
import { leerConfiguracion } from "../../src/config.ts";
import type { MensajeLlm } from "../../src/llm/adapter.ts";
import { crearProveedor } from "../../src/llm/factory.ts";
import { ProveedorGemini, cuerpoDePeticion } from "../../src/llm/gemini.ts";

const CLAVE = "clave-de-prueba-no-real";
const HERRAMIENTAS = [
  { nombre: "contratos_leer_buzon", descripcion: "Lista el buzón", parametros: { type: "object", properties: {} } },
  { nombre: "contratos_extraer", descripcion: "Extrae", parametros: { $schema: "x", type: "object", properties: { mensaje_id: { type: "string" } } } },
];
const CONVERSACION: MensajeLlm[] = [
  { rol: "sistema", texto: "Eres el agente" },
  { rol: "usuario", texto: "procesa" },
  {
    rol: "asistente",
    texto: "",
    llamadas: [
      { id: "a", nombre: "contratos_extraer", args: { mensaje_id: "msg-001" }, firma: "firma-opaca" },
      { id: "b", nombre: "contratos_extraer", args: { mensaje_id: "msg-002" } },
    ],
  },
  { rol: "herramienta", id: "a", nombre: "contratos_extraer", resultado: '{"ok":true,"data":{"x":1}}' },
  { rol: "herramienta", id: "b", nombre: "contratos_extraer", resultado: '{"ok":false,"error":"malo"}' },
];

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

const gemini = (fetch: Fetch, timeoutMs = 1000): ProveedorGemini => new ProveedorGemini({ apiKey: CLAVE, modelo: "gemini-2.5-flash", timeoutMs, fetch });

describe("adaptador Gemini", () => {
  test("traduce el historial: sistema aparte, firmas reenviadas y resultados agrupados en un contenido", () => {
    const cuerpo = cuerpoDePeticion(CONVERSACION, HERRAMIENTAS);
    expect(cuerpo.systemInstruction).toEqual({ parts: [{ text: "Eres el agente" }] });
    expect(cuerpo.contents).toEqual([
      { role: "user", parts: [{ text: "procesa" }] },
      {
        role: "model",
        parts: [
          { functionCall: { name: "contratos_extraer", args: { mensaje_id: "msg-001" } }, thoughtSignature: "firma-opaca" },
          { functionCall: { name: "contratos_extraer", args: { mensaje_id: "msg-002" } } },
        ],
      },
      {
        role: "user",
        parts: [
          { functionResponse: { name: "contratos_extraer", response: { ok: true, data: { x: 1 } } } },
          { functionResponse: { name: "contratos_extraer", response: { ok: false, error: "malo" } } },
        ],
      },
    ]);
    expect(cuerpo.tools).toEqual([
      {
        functionDeclarations: [
          { name: "contratos_leer_buzon", description: "Lista el buzón" },
          { name: "contratos_extraer", description: "Extrae", parametersJsonSchema: { type: "object", properties: { mensaje_id: { type: "string" } } } },
        ],
      },
    ]);
  });

  test("envía la clave solo en cabecera y lee texto, llamadas y tokens", async () => {
    const peticiones: { url: string; init: RequestInit }[] = [];
    const proveedor = gemini(async (url, init) => {
      peticiones.push({ url, init });
      return Response.json({
        candidates: [{ content: { parts: [{ text: "pienso", thought: true }, { text: "Hola" }, { functionCall: { name: "contratos_leer_buzon" }, thoughtSignature: "s1" }] } }],
        usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20, thoughtsTokenCount: 5 },
      });
    });
    const respuesta = await proveedor.enviar(CONVERSACION, HERRAMIENTAS);
    expect(respuesta).toEqual({
      ok: true,
      data: { texto: "Hola", llamadas: [{ id: "llamada-2", nombre: "contratos_leer_buzon", args: {}, firma: "s1" }], uso: { entrada: 100, salida: 25 } },
    });
    const [peticion] = peticiones;
    if (!peticion) throw new Error("no se llamó a fetch");
    const { url, init } = peticion;
    expect(url).not.toContain(CLAVE);
    expect(String(init.body)).not.toContain(CLAVE);
    expect(new Headers(init.headers).get("x-goog-api-key")).toBe(CLAVE);
  });

  test("un error HTTP vuelve como mensaje claro sin lanzar", async () => {
    const proveedor = gemini(async () => Response.json({ error: { message: "API key not valid" } }, { status: 400 }));
    expect(await proveedor.enviar(CONVERSACION, [])).toEqual({ ok: false, error: "Gemini respondió HTTP 400: API key not valid" });
  });

  test("agota el tiempo de espera con AbortController", async () => {
    const colgado: Fetch = (_url, init) =>
      new Promise((_resolver, rechazar) => init.signal?.addEventListener("abort", () => rechazar(new DOMException("aborted", "AbortError"))));
    const respuesta = await gemini(colgado, 30).enviar(CONVERSACION, []);
    expect(respuesta).toEqual({ ok: false, error: "Gemini no respondió en 30 ms (tiempo de espera agotado)" });
  });

  test("una respuesta sin contenido se reporta con su motivo", async () => {
    const proveedor = gemini(async () => Response.json({ candidates: [{ finishReason: "SAFETY" }] }));
    expect(await proveedor.enviar(CONVERSACION, [])).toEqual({ ok: false, error: "Gemini no devolvió contenido (SAFETY)" });
  });
});

describe("reintentos del adaptador Gemini", () => {
  const RESPUESTA_OK = { candidates: [{ content: { parts: [{ text: "listo" }] } }] };

  /** Responde en orden lo que diga la secuencia y anota cada espera sin dormir de verdad. */
  function conSecuencia(respuestas: ((init: RequestInit) => Response | Promise<Response>)[], reintentos = 2) {
    const esperas: number[] = [];
    let llamadas = 0;
    const proveedor = new ProveedorGemini({
      apiKey: CLAVE,
      modelo: "gemini-2.5-flash",
      timeoutMs: 30,
      reintentos,
      fetch: async (_url, init) => {
        const siguiente = respuestas[Math.min(llamadas, respuestas.length - 1)];
        llamadas += 1;
        if (!siguiente) throw new Error("secuencia vacía");
        return siguiente(init);
      },
      esperar: async (ms) => {
        esperas.push(ms);
      },
    });
    return { proveedor, esperas, llamadas: () => llamadas };
  }

  test("un 503 seguido de éxito se reintenta con espera exponencial", async () => {
    const caso = conSecuencia([
      () => Response.json({ error: { message: "overloaded" } }, { status: 503 }),
      () => Response.json({ error: { message: "overloaded" } }, { status: 503 }),
      () => Response.json(RESPUESTA_OK),
    ]);
    const respuesta = await caso.proveedor.enviar(CONVERSACION, []);
    expect(respuesta).toMatchObject({ ok: true, data: { texto: "listo" } });
    expect(caso.llamadas()).toBe(3);
    expect(caso.esperas).toEqual([1000, 2000]);
  });

  test("respeta Retry-After acotado y reintenta un fallo de red", async () => {
    const caso = conSecuencia([
      () => Response.json({ error: { message: "quota" } }, { status: 429, headers: { "retry-after": "60" } }),
      () => Promise.reject(new TypeError("fetch failed")),
      () => Response.json(RESPUESTA_OK),
    ]);
    expect((await caso.proveedor.enviar(CONVERSACION, [])).ok).toBe(true);
    expect(caso.esperas).toEqual([10_000, 2000]);
  });

  test("al agotar los reintentos devuelve el último error con el número de intentos", async () => {
    const caso = conSecuencia([() => Response.json({ error: { message: "overloaded" } }, { status: 503 })]);
    expect(await caso.proveedor.enviar(CONVERSACION, [])).toEqual({ ok: false, error: "Gemini respondió HTTP 503: overloaded (tras 3 intentos)" });
    expect(caso.llamadas()).toBe(3);
  });

  test("un error que no es transitorio (400) o un timeout no se reintentan", async () => {
    const invalido = conSecuencia([() => Response.json({ error: { message: "API key not valid" } }, { status: 400 })]);
    expect(await invalido.proveedor.enviar(CONVERSACION, [])).toEqual({ ok: false, error: "Gemini respondió HTTP 400: API key not valid" });
    expect(invalido.llamadas()).toBe(1);

    const colgado = conSecuencia([
      (init) => new Promise<Response>((_resolver, rechazar) => init.signal?.addEventListener("abort", () => rechazar(new DOMException("aborted", "AbortError")))),
    ]);
    expect(await colgado.proveedor.enviar(CONVERSACION, [])).toEqual({ ok: false, error: "Gemini no respondió en 30 ms (tiempo de espera agotado)" });
    expect(colgado.llamadas()).toBe(1);
  });
});

describe("selección de proveedor por entorno", () => {
  test("auto usa offline sin clave y Gemini con clave", () => {
    expect(crearProveedor(leerConfiguracion({})).nombre).toBe("offline");
    expect(crearProveedor(leerConfiguracion({ GOOGLE_API_KEY: CLAVE })).nombre).toBe("gemini");
    expect(crearProveedor(leerConfiguracion({ GOOGLE_API_KEY: CLAVE, LLM_PROVIDER: "offline" })).nombre).toBe("offline");
  });

  test("las variables vacías de .env.example toman los valores por defecto", () => {
    const config = leerConfiguracion({ LLM_PROVIDER: "", GOOGLE_API_KEY: "", PORT: "", MAX_ITERACIONES: " " });
    expect(config).toMatchObject({ proveedor: "offline", puerto: 3000, maxIteraciones: 25, modeloGemini: "gemini-2.5-flash" });
  });

  test("gemini explícito sin clave es un error de configuración claro", () => {
    expect(() => leerConfiguracion({ LLM_PROVIDER: "gemini" })).toThrow("LLM_PROVIDER=gemini requiere GOOGLE_API_KEY");
  });
});
