# Pruebas

Runner: `bun test` (sin dependencias extra). 111 pruebas: 106 de la API en `api/tests/` y 5 de los grafos de LangGraph en `studio/tests/` ([LangGraph Studio](Studio.md)); ninguna necesita clave ni red. Se ejecutan con `bun run test` desde la raíz, o `bun test` desde la raíz (todas) o desde `api/` o `studio/`.

## Organización

| Carpeta | Qué prueba | Archivos |
|---|---|---|
| `api/tests/unit/` | Funciones puras o con dependencias simuladas. | `extraction.test.ts` (extractor, errores legibles, utilidades), `llm.test.ts` (adaptador Gemini con `fetch` simulado, selección de proveedor). |
| `api/tests/integration/` | Varias capas juntas sobre un proyecto temporal con los fixtures reales. | `tools.test.ts` (buzón completo PRD §7.4, RN5/CA3, alertas, HU-6, zod), `agent.test.ts` (ciclo de la recepcionista con offline y proveedores falsos, CA1–CA5, el modelo solo ve `recepcion_*`), `receptionist.test.ts` (herramientas `recepcion_*`, recorrido del grafo, pausa y reanudación), `api.test.ts` (chat, errores, CORS), `approval-tray.test.ts` (buzón, bandeja, chat ↔ bandeja, reinicio), `module.test.ts` (sincronía de `modulo/`). |
| `api/tests/helpers.ts` | Utilidades compartidas. | — |

## Utilidades (`api/tests/helpers.ts`)

| Utilidad | Uso |
|---|---|
| `crearProyecto()` | Copia `fixtures/reto-02/` a una carpeta temporal y devuelve un `ContextoHerramienta` con `hoy = 2026-09-03`. Cada test tiene su propio `out/`. |
| `agregarMensaje(ctx, id, adjuntos)` | Agrega un correo al buzón temporal para provocar casos nuevos. |
| `contratoModificado(cambios)` | Texto de `msg-001` con fragmentos reemplazados (fechas inválidas, monedas desconocidas…). |
| `extraerOk(ctx, id)` | Llama a `contratos_extraer` y falla el test si no es `ok`. |
| `leerSalida(ctx, ...ruta)`, `lineasJson(texto)` | Leer archivos de `out/` y parsear JSONL. |
| `RAIZ`, `HOY`, `leerFixture` | Raíz del repo, fecha fija y lectura de fixtures. |

## Patrones

- **Proveedor falso**: `agent.test.ts` define `proveedorFijo(responder)` que implementa `ProveedorLlm` y devuelve respuestas programadas; así se prueban topes, errores del proveedor y la guarda CA3 sin modelo.
- **App sin servidor**: `api.test.ts` y `approval-tray.test.ts` llaman `crearApp(...).request(...)` de Hono, sin abrir puertos.
- **Determinismo**: fecha fija por `ctx.hoy` y `hoy` en las dependencias del agente y la API.

## Comandos

```bash
bun test                                   # todo
bun test api/tests/unit                        # solo unitarias
bun test api/tests/integration/agent.test.ts   # un archivo
bun test -t "CA1"                          # por nombre
LLM_PROVIDER=offline bun test              # como en CI
```

## CI (`.github/workflows/backend.yml`)

Se dispara con cambios en `api/`, `agent/`, `modulo/`, `fixtures/`, `web/`, `demo.ts`, `package.json`, `bun.lock`, `Dockerfile` o `.dockerignore`.

| Job | Pasos |
|---|---|
| `verificar` | `bun install --frozen-lockfile` → typecheck de `api/` → `sync:module --check` → `bun test` → `bun run demo`. |
| `imagen` | Construye la imagen Docker, la levanta y espera `GET /api/health` (30 s). |

CI usa `LLM_PROVIDER=offline`: nunca llama a Gemini ni necesita secretos.
