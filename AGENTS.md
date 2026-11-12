# AGENTS.md

Guía para agentes de código (Cursor, Claude, Codex, Copilot…) que trabajen en este repositorio. Léela completa antes de editar. La documentación detallada vive en la [wiki](docs/wiki/Home.md); el enunciado original, en [`docs/PRD.md`](docs/PRD.md).

## Qué es

Agente conversacional que actúa como **punto único de recepción de contratos**: lee un buzón (carpetas en `fixtures/`), extrae los datos de cada contrato con confianza por campo, lo clasifica contra un maestro CSV (nuevo, actualización, duplicado, rechazado), registra lo limpio, **pide confirmación humana** para lo dudoso y genera un reporte de alertas. Backend Bun + Hono, herramientas tipadas con zod, adaptador LLM propio (Gemini 2.5 Flash u offline determinista) y front React + Vite.

## Comandos

Requisito: Bun ≥ 1.2. Usa siempre `bun` (no npm, pnpm, yarn ni node).

| Comando | Qué hace |
|---|---|
| `bun install` | Instala dependencias de los workspaces `api/` y `web/` (un solo `bun.lock` en la raíz). |
| `bun run dev` | Script `dev` de cada workspace: API con recarga en `:3000` + front Vite en `:5173` (proxy de `/api`). |
| `bun run test` | 84 pruebas de `api/tests/` (`unit/` e `integration/`). No necesitan clave. `bun test` desde la raíz o desde `api/` también sirve. |
| `bun run typecheck` | `tsc --noEmit` de `api/` y de `web/`. |
| `bun run demo` | `demo.ts`: procesa el buzón llamando directo a las herramientas, sin modelo. |
| `bun run sync:module` | Regenera `modulo/agent.md` y `modulo/skill/…/SKILL.md`. `--check` falla si están desactualizados. |
| `bun run build` / `bun run start` | Compila el front y sirve API + front en un solo proceso. |

Sin `GOOGLE_API_KEY` el backend usa el proveedor `offline`. Para forzarlo: `LLM_PROVIDER=offline`.

## Mapa del repositorio

Monorepo con dos workspaces de Bun: `api/` y `web/`.

```
api/                                backend (workspace): package.json, tsconfig.json
├── src/
│   ├── server.ts, config.ts        arranque y variables de entorno (zod)
│   ├── knowledge/                  conocimiento del proceso (se anexa al prompt)
│   ├── tools/                      herramientas contratos_* (contratos.ts) + envoltorio común (tool.ts)
│   ├── agent/                      ciclo del agente, guarda de confirmación, sesiones, prompt, empaquetado del módulo
│   ├── llm/                        interfaz ProveedorLlm (adapter.ts), Gemini, offline, fábrica
│   ├── http/                       Hono: chat (app.ts), buzón/bandeja/reinicio (hitl.ts), helpers.ts, tipos compartidos con el front (types.ts)
│   ├── application/use-cases/      casos de uso: validar, registrar, alertas, estado y vistas del buzón, reinicio
│   ├── application/workflows/      orquestación sobre las herramientas: pasada del buzón y acciones de la bandeja
│   ├── core/domain/                tipos y esquemas del contrato y del maestro, fechas, texto, parámetros, Resultado
│   ├── core/extraction/            extractor determinista (regex + heurísticas)
│   ├── core/rules/                 clasificación RN1–RN5, coincidencias, campos efectivos, fila del maestro
│   └── infrastructure/             lectura/escritura de fixtures/ y out/ (CSV, JSONL, rutas, cerrojo)
├── tests/                          helpers.ts, unit/, integration/
└── scripts/sync-module.ts          genera modulo/
web/                                front (workspace): src/App.tsx, views/, components/, lib/ (api.ts, format.ts), styles/
agent/prompt.md                     comportamiento del agente (system prompt)
modulo/                             bonus PRD 9.4: el agente empaquetado para otras plataformas (generado, no editar a mano)
fixtures/reto-02/                   buzón, maestro y comerciales de entrada (SOLO LECTURA)
out/                                salidas en ejecución (ignorado por git)
docs/                               PRD.md y wiki/
demo.ts                             verificación sin modelo
package.json, bun.lock              workspaces y scripts que delegan
```

La **raíz del proyecto** (`ctx.directory`, `config.directorio`) es la carpeta del repositorio, no `api/`: desde ahí se resuelven `fixtures/`, `out/`, `agent/` y `web/dist`.

### Rutas fijadas por el PRD: no las muevas ni las renombres

En la raíz: `agent/prompt.md`, `web/`, `fixtures/`, `out/`, `demo.ts` (el PRD pide `bun run demo.ts` desde la raíz), `modulo/` (con `agent.md`, `tools/contratos.ts`, `skill/registro-contratos/SKILL.md`), `README.md`, `SOLUCION.md`, `.env.example`. Dentro de `api/src/`: `knowledge/registro-contratos.md`, `tools/contratos.ts`, `llm/adapter.ts`, `server.ts` (el PRD los sugiere bajo `src/`; viven en el `src/` de la API). El nombre que ve el modelo de cada herramienta es `<archivo>_<export>`, así que renombrar `contratos.ts` o sus exports rompe el contrato.

## Arquitectura en una mirada

Capas con dependencias hacia adentro: `core` no importa nada del proyecto; `infrastructure` solo importa `core`; `application` usa `core` e `infrastructure`; `tools` envuelve los casos de uso; `agent`, `api` y `llm` son la capa exterior. El ciclo del agente solo conoce la interfaz `ProveedorLlm`. Detalle y diagramas: [Arquitectura](docs/wiki/Architecture.md).

Tres piezas separadas (lo que evalúa el PRD):

- **Comportamiento** → `agent/prompt.md`.
- **Conocimiento** → `api/src/knowledge/registro-contratos.md`.
- **Ejecución** → `api/src/tools/contratos.ts` y lo que hay debajo.

Prompt y conocimiento se leen en cada turno: cambiarlos no requiere reiniciar el servidor.

## Convenciones

- **Nombres**: carpetas y archivos en inglés (`kebab-case.ts`; componentes React en `PascalCase.tsx`). Los identificadores de código, los campos del dominio (`id_contrato`, `valor`…), las rutas de la API (`/api/buzon`…), los nombres de herramientas (`contratos_*`) y los textos visibles siguen en español porque son el contrato del PRD. Consulta el [Glosario](docs/wiki/Glossary.md).
- **TypeScript estricto**, sin `any`. `noUncheckedIndexedAccess` está activo.
- **Errores sin excepciones**: la lógica devuelve `Resultado<T>` (`{ ok: true, data } | { ok: false, error }`, en `api/src/core/domain/result.ts`). Las herramientas y `ProveedorLlm.enviar` **nunca lanzan**.
- **zod** para todo lo que entra de afuera: argumentos de herramientas, cuerpo HTTP, variables de entorno, respuesta de Gemini.
- **Rutas**: siempre desde la raíz del proyecto (`ctx.directory` → `rutasDelProyecto()` en `api/src/infrastructure/paths.ts`), nunca absolutas. Ids de mensaje y nombres de adjuntos pasan por `segmentoSeguro()`.
- **Parámetros de negocio** (umbral 0.8, similitud 0.9, fecha de corte, ventana de 60 días) solo en `api/src/core/domain/parameters.ts`.
- **Comentarios** solo para el *por qué* que el código no muestra. Funciones cortas y nombres descriptivos.
- **Commits** en inglés con Conventional Commits: `type(scope): Subject` (p. ej. `feat(agent): Add retry on provider timeout`).

## Invariantes que no se rompen

1. **El modelo no es fuente de valores.** Toda cifra, fecha o clasificación sale de una herramienta. `validar` y `registrar` reextraen el documento en el servidor; un valor que el modelo cambie queda con confianza 0.
2. **Confirmación humana (CA3) en el servidor**: `contratos_registrar` con `confirmado: true` solo se acepta para mensajes que quedaron pendientes en un turno **anterior** (`api/src/agent/execution.ts`). No relajes esta guarda.
3. **Lo dudoso no se escribe**: con `requiere_revision` no vacío y sin `confirmado`, `registrar` falla con el prefijo `requiere revisión` (el ciclo lo detecta por ese prefijo).
4. **`fixtures/` es de solo lectura.** Todo lo que se escribe va a `out/`; el maestro de trabajo es una copia.
5. **Toda llamada a herramienta queda en `out/log.jsonl`** y en el historial del chat (CA4).
6. **La clave del LLM nunca sale del backend**: ni al front, ni a logs, ni a respuestas de la API.
7. **Las herramientas no ejecutan shell** ni escriben fuera de `out/`.
8. **Chat y bandeja comparten la misma verdad** (`out/analisis.json` + `out/procesados.json`). No guardes estado de revisión en otro lugar.
9. **`modulo/` se genera**: edita `agent/prompt.md` o el conocimiento y ejecuta `bun run sync:module`.

## Recetas rápidas

Pasos completos en [Contribuir](docs/wiki/Contributing.md).

- **Cambiar una regla de negocio**: `api/src/core/rules/` o `api/src/core/domain/parameters.ts` + prueba en `api/tests/` + actualizar `api/src/knowledge/registro-contratos.md` y `bun run sync:module`.
- **Mejorar la extracción**: `api/src/core/extraction/<campo>.ts`, con niveles de confianza fijos y evidencia literal; prueba en `api/tests/unit/extraction.test.ts`.
- **Nueva herramienta**: `definirHerramienta({...})` exportada desde `api/src/tools/contratos.ts` y registrada en `herramientas`; la lógica va a un caso de uso en `api/src/application/use-cases/`.
- **Nuevo proveedor LLM**: clase que implemente `ProveedorLlm` en `api/src/llm/<proveedor>.ts` + rama en `api/src/llm/factory.ts` + variable en `api/src/config.ts` y `.env.example`. El ciclo no se toca.
- **Nuevo endpoint**: ruta delgada en `api/src/http/app.ts` o `api/src/http/hitl.ts`, cuerpo validado con zod (`leerCuerpo`), tipos en `api/src/http/types.ts` (los comparte el front).
- **Nueva vista del front**: `web/src/views/<Nombre>View.tsx`, llamadas solo vía `web/src/lib/api.ts`.

## Antes de terminar

```bash
bun run typecheck && bun test && bun run sync:module --check && bun run demo
```

Si cambiaste el front: `bun run build`. Si cambiaste rutas, comandos o comportamiento visible: actualiza `README.md`, `SOLUCION.md` y la página de la wiki correspondiente.
