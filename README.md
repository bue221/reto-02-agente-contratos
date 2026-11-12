# Reto 02 · Agente conversacional "Registro de Contratos Vigentes"

Agente de chat que actúa como **punto único de recepción de contratos**: lee el buzón, extrae los datos de cada contrato con confianza por campo, lo clasifica contra el maestro (nuevo, actualización, duplicado, rechazado), registra lo limpio, **pide confirmación humana** para lo dudoso y genera el reporte de alertas. Backend Bun + Hono, herramientas tipadas con zod, adaptador LLM propio (Gemini 2.5 Flash) y front React.

- **Link de prueba**: `<pendiente de despliegue>` (público, sin clave de acceso).
- **Planteamiento de la solución**: [`SOLUCION.md`](SOLUCION.md).

## Arranque local (un comando)

Requisito: [Bun](https://bun.sh) ≥ 1.2.

```bash
bun install && bun run dev
```

Abre <http://localhost:5173>. `bun run dev` levanta el backend en `:3000` (con recarga) y el front Vite en `:5173` (con proxy de `/api` al backend).

- **Sin clave** el backend usa el proveedor `offline`: un guion determinista que llama a las mismas herramientas, suficiente para recorrer el flujo de la demo (procesar el buzón, pedir confirmación de msg-006, registrar tras «confirmo …»).
- **Con Gemini**: `cp .env.example .env` y completa `GOOGLE_API_KEY` ([Google AI Studio](https://aistudio.google.com/apikey)). Con `LLM_PROVIDER=auto` (por defecto) el backend usa Gemini si encuentra la clave.

Modo producción (un solo proceso que sirve API + front compilado):

```bash
bun run build && bun run start   # http://localhost:3000
```

### Prompt de la demo (PRD §11)

```
Procesa el buzón de contratos con fecha de hoy 2026-09-03. Registra lo que
esté limpio, muéstrame lo que requiere revisión campo por campo y termina
con el reporte de alertas. No registres nada dudoso sin preguntarme.
```

Luego: `confirmo el valor 0 y la fecha fin 2027-08-31` (o el botón **Confirmo** del banner). Para repetir la demo desde cero, borra `out/` y abre una sesión nueva.

## Variables de entorno

Todas opcionales; ver [`.env.example`](.env.example). La clave solo vive en el backend: nunca llega al front, a los logs ni a las respuestas de la API.

| Variable | Por defecto | Uso |
|---|---|---|
| `LLM_PROVIDER` | `auto` | `auto` (Gemini si hay clave, si no offline), `gemini` u `offline`. |
| `GOOGLE_API_KEY` | — | Clave de Gemini (secreto). |
| `GEMINI_MODEL` | `gemini-2.5-flash` | Modelo de Gemini. |
| `LLM_TIMEOUT_MS` | `60000` | Timeout por llamada al proveedor. |
| `MAX_ITERACIONES` | `25` | Tope de iteraciones modelo → herramientas por turno (CA1). |
| `MAX_TOKENS_SESION` | `300000` | Tope de tokens por sesión. |
| `MAX_TOKENS_PROCESO` | `3000000` | Tope de tokens del proceso (abrir sesiones nuevas no lo evade). |
| `PORT` | `3000` | Puerto del backend. |

## Verificación sin modelo

```bash
bun install && bun run demo.ts   # procesa los 6 mensajes llamando directo a las herramientas
bun test                         # 66 pruebas: extracción, reglas, herramientas, ciclo, API, módulo
bun run typecheck                # backend + front
```

`demo.ts` limpia `out/`, hace la primera pasada (msg-006 queda sin registrar por revisión), una segunda llamada con `confirmado: true` y genera `out/alertas.md`.

## API

| Método | Ruta | Cuerpo / respuesta |
|---|---|---|
| `POST` | `/api/chat` | `{ sessionId, message }` → `{ reply, toolCalls: [{ nombre, args, ok, resumen }], needsConfirmation }` |
| `GET` | `/api/sessions/:id` | Sesión completa: `turnos[]` visibles, `mensajes[]` del modelo, `tokens`, `pendientesConfirmacion[]` |
| `GET` | `/api/health` | `{ ok: true, provider, model }` (sin claves) |
| `GET` | `/api/maestro` | `{ filas[] }` del maestro de trabajo (`out/sharepoint/maestro-contratos.csv`), solo lectura para el panel lateral |

Errores tipados: `{ ok: false, error: { codigo, mensaje } }` con `400` (cuerpo inválido: `sessionId` con `[A-Za-z0-9_-]{1,64}`, `message` de 1 a 4000 caracteres), `404` y `500`. Un error del modelo o de una herramienta **no** es un error HTTP: vuelve como `reply` en lenguaje claro y la sesión sigue (CA5).

## Estructura

```
agent/prompt.md                     comportamiento (system prompt)
src/knowledge/registro-contratos.md conocimiento del proceso (reglas, esquema, gobierno)
src/tools/contratos.ts              herramientas contratos_* (zod, nunca lanzan, log en out/log.jsonl)
src/agente/                         ciclo del agente, sesiones, guarda de confirmación
src/llm/                            adaptador (adapter.ts), Gemini (gemini.ts), offline (offline.ts)
src/api/                            app Hono y tipos compartidos con el front
src/server.ts                       arranque
web/src/chat/                       front de chat
modulo/                             bonus: agente empaquetado (generado desde agent/ y src/knowledge/)
demo.ts                             verificación sin modelo
```

`modulo/agent.md` y `modulo/skill/registro-contratos/SKILL.md` se generan con `bun run sync:modulo` (un test falla si divergen); `modulo/tools/contratos.ts` reexporta las mismas herramientas.

## Despliegue

La imagen [`Dockerfile`](Dockerfile) compila el front y ejecuta `bun run start` (API + front en el mismo puerto).

```bash
docker build -t agente-contratos .
docker run -p 3000:3000 -e GOOGLE_API_KEY=... agente-contratos
```

**Render** (blueprint [`render.yaml`](render.yaml)):

1. Sube el repositorio a GitHub/GitLab.
2. En Render: *New → Blueprint* y selecciona el repositorio; crea el servicio `agente-contratos-reto02` (Docker, plan free, health check `/api/health`).
3. En *Environment*, carga `GOOGLE_API_KEY` (marcado como secreto, `sync: false`).
4. *Manual Deploy* y prueba `https://<servicio>.onrender.com/api/health`. Reemplaza el link de arriba.

Notas: el contexto de build usa [`Dockerfile.dockerignore`](Dockerfile.dockerignore) (BuildKit lo prefiere sobre `.dockerignore`, que hoy excluye `src/` y `web/` por la versión anterior en `langgraph_app/`). En el plan free de Render el disco es efímero: `out/` y las sesiones se pierden al reiniciar, lo cual es aceptable para la demo.

> `langgraph_app/` es la versión anterior (LangGraph) y no forma parte de esta entrega.
