# Proveedores LLM

Código: `api/src/llm/`. El ciclo del agente solo conoce la interfaz; cambiar de proveedor no toca `api/src/agent/`.

## Interfaz (`adapter.ts`)

```ts
interface ProveedorLlm {
  readonly nombre: string;
  readonly modelo: string;
  /** Nunca lanza: red, timeout o HTTP vuelven como { ok: false, error } en lenguaje claro. */
  enviar(mensajes: readonly MensajeLlm[], herramientas: readonly DefinicionHerramienta[]): Promise<Resultado<RespuestaLlm>>;
}

type MensajeLlm =
  | { rol: "sistema"; texto: string }
  | { rol: "usuario"; texto: string }
  | { rol: "asistente"; texto: string; llamadas: LlamadaHerramienta[] }
  | { rol: "herramienta"; id: string; nombre: string; resultado: string };

interface RespuestaLlm { texto: string; llamadas: LlamadaHerramienta[]; uso: { entrada: number; salida: number } }
```

`LlamadaHerramienta` lleva `id`, `nombre`, `args` y una `firma` opcional: un metadato opaco que algunos proveedores exigen reenviar tal cual (en Gemini, `thoughtSignature`).

## Selección (`factory.ts`)

`crearProveedor(config)` es el único punto que conoce las implementaciones:

| `LLM_PROVIDER` | Clave | Resultado |
|---|---|---|
| `auto` (defecto) | con `GOOGLE_API_KEY` | Gemini |
| `auto` | sin clave | Offline |
| `gemini` | con clave | Gemini |
| `gemini` | sin clave | Error al arrancar |
| `offline` | — | Offline |

## Gemini (`gemini.ts`)

- REST `POST https://generativelanguage.googleapis.com/v1beta/models/<modelo>:generateContent` con `fetch`, sin SDK.
- `temperature: 0`.
- Timeout por llamada con `AbortController` (`LLM_TIMEOUT_MS`).
- Mapea roles y llamadas al formato de Gemini (`functionCall` / `functionResponse`) y reenvía `thoughtSignature`.
- La respuesta se valida con zod; un bloqueo (`promptFeedback`) o un candidato vacío vuelven como error legible.
- Tokens: entrada = `promptTokenCount`; salida = `candidatesTokenCount + thoughtsTokenCount`.
- La clave va en la cabecera de la petición; nunca en logs ni en respuestas.

Costo medido y justificación de la elección: `SOLUCION.md` §4.

## Offline (`offline.ts` + `offline/`)

Proveedor sin modelo para probar la app completa sin clave (también es el que usan CI y los tests). Reporta 0 tokens. Hace de recepcionista con las mismas cinco herramientas `recepcion_*` que ve un modelo real.

| Archivo | Rol |
|---|---|
| `offline/script.ts` | `siguientePaso(historial)`: decide qué herramienta `recepcion_*` llamar o qué responder, solo a partir del historial. |
| `offline/history.ts` | Lee el historial: ejecuciones previas (emparejadas por posición) y último mensaje del usuario. |
| `offline/replies.ts` | Redacta respuestas citando solo resultados de herramientas (CA2). |

Cubre el guion del PRD §11 (procesar el buzón, dejar `msg-006` en revisión, registrarlo tras «confirmo …») y además «rechaza msg-006 porque …», «estado del buzón», «explica msg-00x», «busca CT-… en el maestro» y «alertas al YYYY-MM-DD». Fuera del guion responde con ayuda.

## Agregar un proveedor

1. Crea `api/src/llm/<proveedor>.ts` con una clase que implemente `ProveedorLlm`. Mapea `MensajeLlm` al formato del proveedor y las llamadas de vuelta a `LlamadaHerramienta`. Captura todo error y devuélvelo como `fallo(...)`.
2. Agrega la variable de selección y la clave en `api/src/config.ts` (esquema zod) y en `.env.example`.
3. Agrega la rama en `api/src/llm/factory.ts`.
4. Pruebas en `api/tests/unit/llm.test.ts`: cuerpo de la petición, parseo de la respuesta, error HTTP y timeout (con `fetch` simulado).
5. Documenta la variable en el README y en [Primeros pasos](Getting-Started.md).

`api/src/agent/` no se modifica.
