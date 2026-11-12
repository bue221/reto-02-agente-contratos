# Primeros pasos

## Requisitos

- [Bun](https://bun.sh) ≥ 1.2 (CI usa 1.4.4). No se usa Node, npm, pnpm ni yarn.
- Opcional: clave de [Google AI Studio](https://aistudio.google.com/apikey) para conversar con Gemini.
- Opcional: Docker, solo para probar la imagen de despliegue.

## Levantar en local

```bash
bun install && bun run dev
```

El repositorio es un monorepo con tres workspaces de Bun. `bun run dev` (en la raíz) ejecuta en paralelo el script `dev` de los que lo tienen (`bun run --filter '*' dev`), con la salida prefijada por workspace:

| Workspace | URL | Script |
|---|---|---|
| `api/` | <http://localhost:3000> | `dev`: `bun --env-file=../.env --watch src/server.ts` (recarga al guardar y lee el `.env` de la raíz). |
| `web/` | <http://localhost:5173> | `dev`: Vite con proxy de `/api` a la API. |
| `studio/` | <http://localhost:2024> | `studio` (no entra en `bun run dev`): `bun run studio` levanta los grafos para [LangGraph Studio](Studio.md). |

También puedes levantar uno solo: `bun run --cwd api dev` o `bun run --cwd web dev`.

Abre <http://localhost:5173>. Para ver los grafos en Studio, en otra terminal: `bun run studio` y abre <https://smith.langchain.com/studio?baseUrl=http://localhost:2024>.

### Con o sin modelo

- **Sin clave**: el backend usa el proveedor `offline`, un guion determinista que hace de recepcionista con las mismas herramientas. Alcanza para recorrer la demo completa.
- **Con Gemini**: `cp .env.example .env` (en la raíz), completa `GOOGLE_API_KEY` y reinicia. Con `LLM_PROVIDER=auto` (por defecto) se usa Gemini si hay clave. La API y Studio leen el mismo `.env`. Para forzar el modo sin modelo aunque haya clave: `LLM_PROVIDER=offline` en `.env`.

`GET /api/health` dice qué proveedor quedó activo: `{ "ok": true, "provider": "offline", "model": "guion-determinista", "studio": false }` (`studio` es `true` cuando `LANGGRAPH_URL` publica LangGraph Studio en `/langgraph`).

## Variables de entorno

Todas opcionales. Se validan con zod en `api/src/config.ts`; una variable vacía cuenta como no definida.

| Variable | Por defecto | Uso |
|---|---|---|
| `LLM_PROVIDER` | `auto` | `auto`, `gemini` u `offline`. `gemini` sin clave falla al arrancar. |
| `GOOGLE_API_KEY` | — | Clave de Gemini (secreto, solo backend). |
| `GEMINI_MODEL` | `gemini-2.5-flash` | Modelo de Gemini. |
| `LLM_TIMEOUT_MS` | `60000` | Timeout por llamada al proveedor. |
| `LLM_REINTENTOS` | `2` | Reintentos ante 429, 5xx o fallo de red (no ante timeout), con espera exponencial; máx. 5. |
| `MAX_ITERACIONES` | `25` | Tope de llamadas al modelo por turno (CA1). |
| `MAX_TOKENS_SESION` | `300000` | Tope de tokens por sesión. |
| `MAX_TOKENS_PROCESO` | `3000000` | Tope de tokens del proceso. |
| `PORT` | `3000` | Puerto del backend (y destino del proxy de Vite). |
| `CORS_ORIGINS` | vacío | Orígenes del front desplegado aparte, separados por coma. |
| `LANGGRAPH_URL` | vacío (imagen: `http://127.0.0.1:2024`) | Servidor de LangGraph de `studio/` que la API publica en `/langgraph` ([Studio](Studio.md#desde-la-web)). |
| `VITE_API_URL` | vacío | Solo en el build del front: URL pública del backend. |

## Recorrer la demo

1. Pestaña **Chat**, sesión nueva, pega el prompt del PRD §11:

   ```
   Procesa el buzón de contratos con fecha de hoy 2026-09-03. Registra lo que
   esté limpio, muéstrame lo que requiere revisión campo por campo y termina
   con el reporte de alertas. No registres nada dudoso sin preguntarme.
   ```

2. La recepcionista enciende el motor con una sola llamada (`recepcion_procesar_buzon`, con los pasos `contratos_*` anidados debajo). El motor procesa los 6 mensajes, `msg-006` queda en revisión (valor por demanda y plazo en meses) y el turno termina con una pregunta.
3. Responde `confirmo el valor 0 y la fecha fin 2027-08-31`, o usa el botón **Confirmo** del banner, o aprueba en la **Bandeja de aprobación**.
4. Revisa el resultado en **Maestro CSV** y en `out/`.

Resultado esperado por mensaje:

| Mensaje | Caso | Resultado |
|---|---|---|
| `msg-001` | Contrato nuevo con póliza | `nuevo`, registrado, póliza `pendiente`. |
| `msg-002` | Contrato nuevo sin póliza | `nuevo`, registrado, `no_aplica`. |
| `msg-003` | Otrosí que extiende `fecha_fin` | `actualizacion`, fila modificada + historial. |
| `msg-004` | Reenvío de un contrato existente | `duplicado`, sin escritura. |
| `msg-005` | Cotización, sin contrato | `rechazado`. |
| `msg-006` | Valor por demanda, plazo en meses, remitente desconocido | `nuevo` con revisión; se registra tras confirmar. |

## Verificar sin modelo

```bash
bun run demo        # demo.ts: limpia out/, primera pasada, confirma msg-006 y genera alertas (pisa el estado de la app y Studio)
bun run test        # 170 pruebas: api/tests y studio/tests
bun run typecheck   # api + web + studio
```

## Reiniciar el estado

`out/` es global al proceso. Para volver a empezar usa **Reiniciar demo** en la barra lateral o `curl -X POST localhost:3000/api/demo/reset`. También puedes borrar `out/` con el servidor detenido.

## Problemas frecuentes

| Síntoma | Causa y solución |
|---|---|
| `409 ya_procesado` al analizar | El mensaje ya se cerró. Reinicia la demo. |
| `409 no_pendiente` al aprobar | Solo se aprueba lo que espera confirmación: analízalo primero desde el Buzón. |
| `configuración inválida: …` al arrancar | Una variable no cumple el esquema (p. ej. `MAX_ITERACIONES=abc`). |
| `LLM_PROVIDER=gemini requiere GOOGLE_API_KEY` | Define la clave o usa `auto`/`offline`. |
| El front no ve el backend | El backend no está en `PORT` o, en despliegue separado, falta `VITE_API_URL`/`CORS_ORIGINS`. |
| Studio muestra el chat deshabilitado | El servidor de `bun run studio` no está corriendo en `:2024`, o se abrió otro grafo: elige `recepcionista` y haz un hard-refresh. Ver [LangGraph Studio](Studio.md). |
