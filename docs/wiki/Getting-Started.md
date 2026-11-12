# Primeros pasos

## Requisitos

- [Bun](https://bun.sh) ≥ 1.2 (CI usa 1.4.4). No se usa Node, npm, pnpm ni yarn.
- Opcional: clave de [Google AI Studio](https://aistudio.google.com/apikey) para conversar con Gemini.
- Opcional: Docker, solo para probar la imagen de despliegue.

## Levantar en local

```bash
bun install && bun run dev
```

El repositorio es un monorepo con dos workspaces de Bun. `bun run dev` (en la raíz) ejecuta en paralelo el script `dev` de cada uno (`bun run --filter '*' dev`), con la salida prefijada por workspace:

| Workspace | URL | Script `dev` |
|---|---|---|
| `api/` | <http://localhost:3000> | `bun --watch src/server.ts` (recarga al guardar). |
| `web/` | <http://localhost:5173> | Vite con proxy de `/api` a la API. |

También puedes levantar uno solo: `bun run --cwd api dev` o `bun run --cwd web dev`.

Abre <http://localhost:5173>.

### Con o sin modelo

- **Sin clave**: el backend usa el proveedor `offline`, un guion determinista que llama a las mismas herramientas. Alcanza para recorrer la demo completa.
- **Con Gemini**: `cp .env.example .env`, completa `GOOGLE_API_KEY` y reinicia. Con `LLM_PROVIDER=auto` (por defecto) se usa Gemini si hay clave.

`GET /api/health` dice qué proveedor quedó activo: `{ "ok": true, "provider": "offline", "model": "guion-determinista" }`.

## Variables de entorno

Todas opcionales. Se validan con zod en `api/src/config.ts`; una variable vacía cuenta como no definida.

| Variable | Por defecto | Uso |
|---|---|---|
| `LLM_PROVIDER` | `auto` | `auto`, `gemini` u `offline`. `gemini` sin clave falla al arrancar. |
| `GOOGLE_API_KEY` | — | Clave de Gemini (secreto, solo backend). |
| `GEMINI_MODEL` | `gemini-2.5-flash` | Modelo de Gemini. |
| `LLM_TIMEOUT_MS` | `60000` | Timeout por llamada al proveedor. |
| `MAX_ITERACIONES` | `25` | Tope de llamadas al modelo por turno (CA1). |
| `MAX_TOKENS_SESION` | `300000` | Tope de tokens por sesión. |
| `MAX_TOKENS_PROCESO` | `3000000` | Tope de tokens del proceso. |
| `PORT` | `3000` | Puerto del backend (y destino del proxy de Vite). |
| `CORS_ORIGINS` | vacío | Orígenes del front desplegado aparte, separados por coma. |
| `VITE_API_URL` | vacío | Solo en el build del front: URL pública del backend. |

## Recorrer la demo

1. Pestaña **Chat**, sesión nueva, pega el prompt del PRD §11:

   ```
   Procesa el buzón de contratos con fecha de hoy 2026-09-03. Registra lo que
   esté limpio, muéstrame lo que requiere revisión campo por campo y termina
   con el reporte de alertas. No registres nada dudoso sin preguntarme.
   ```

2. El agente procesa los 6 mensajes. `msg-006` queda en revisión (valor por demanda y plazo en meses) y el turno termina con una pregunta.
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
bun run demo        # demo.ts: limpia out/, primera pasada, confirma msg-006 y genera alertas
bun run test        # 84 pruebas de api/tests
bun run typecheck   # backend + front
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
