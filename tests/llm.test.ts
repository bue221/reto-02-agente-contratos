import { describe, expect, test } from "bun:test";
import { leerConfiguracion } from "../src/config.ts";
import type { MensajeLlm } from "../src/llm/adapter.ts";
import { crearProveedor } from "../src/llm/fabrica.ts";
import { ProveedorGemini, cuerpoDePeticion } from "../src/llm/gemini.ts";

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
