# Reto 02 · Agente conversacional "Registro de Contratos Vigentes"

Agente de chat que actúa como **punto único de recepción de contratos**: lee el buzón, extrae los datos de cada contrato con confianza por campo, lo clasifica contra el maestro (nuevo, actualización, duplicado, rechazado), registra lo limpio, **pide confirmación humana** para lo dudoso y genera el reporte de alertas. La confirmación se puede dar en el chat o en una **bandeja de aprobación**. Backend Bun + Hono, herramientas tipadas con zod, adaptador LLM propio (Gemini 2.5 Flash) y front React.

- **Link de prueba**: <https://reto02-contratos.vercel.app> (público, sin clave de acceso).
- **Backend (AWS Lightsail)**: <https://reto02-contratos.wn60e6ytewk9j.us-east-1.cs.amazonlightsail.com/api/health>
- **Planteamiento de la solución**: [`SOLUCION.md`](SOLUCION.md).
- **Enunciado del reto**: [`docs/PRD.md`](docs/PRD.md) · **Wiki técnica**: [`docs/wiki/`](docs/wiki/Home.md).

## Arranque local (un comando)

Requisito: [Bun](https://bun.sh) ≥ 1.2.

```bash
bun install && bun run dev
```

Abre <http://localhost:5173>. `bun run dev` ejecuta el script `dev` de cada workspace: la API (`api/`) en `:3000` con recarga y el front Vite (`web/`) en `:5173` con proxy de `/api` a la API.

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

Luego: `confirmo el valor 0 y la fecha fin 2027-08-31` (o el botón **Confirmo** del banner, o **Confirmar datos y registrar** en la Bandeja de aprobación).

### Interfaz

| Pestaña | Qué muestra |
|---|---|
| **Buzón** | Los 6 correos con su estado (sin analizar, por aprobar, registrado, actualizado, duplicado, rechazado). **Analizar** procesa uno (extraer → validar → registrar sin confirmación) y **Analizar todo en orden** recorre los pendientes con progreso y botón **Detener**. El detalle trae una línea de tiempo de 7 pasos, el correo y el adjunto al lado de lo extraído con confianza y evidencia por campo, la clasificación y la auditoría de `out/log.jsonl`. |
| **Bandeja de aprobación** | Lo que espera una decisión humana (con un contador en la pestaña): campos en revisión editables, **Confirmar datos y registrar** (con correcciones) o **Rechazar** con motivo. A la derecha, las decisiones ya tomadas, aquí o en el chat: quién, cuándo, qué corrigió y qué se escribió. |
| **Maestro CSV** | `out/sharepoint/maestro-contratos.csv` con las filas creadas o modificadas por una aprobación resaltadas, y **Descargar CSV**. |
| **Chat** | El agente: cada llamada a herramienta (nombre, argumentos, resultado) y la burbuja resaltada cuando pide confirmación. |

El nombre del **Aprobador** (barra lateral) queda en las decisiones. Chat y bandeja comparten la misma verdad: lo que el chat deja en revisión aparece en la bandeja y lo que se aprueba en cualquiera de los dos sale de ambos.

### Reiniciar la demo

El estado de `out/` es **global al proceso**: en el link público, quien procese el buzón lo deja procesado para todos. Para empezar de cero usa **Reiniciar demo** en la barra lateral (pide confirmación): borra `out/` (procesados, análisis, decisiones, log, sesiones de chat), vuelve a copiar el maestro del fixture, refresca las pestañas y abre una sesión de chat nueva. Por API: `curl -X POST <backend>/api/demo/reset`.

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
| `CORS_ORIGINS` | vacío | Orígenes del front desplegado aparte, separados por coma. Vacío: solo mismo origen. |
| `VITE_API_URL` | vacío | Solo en el build del front: URL pública del backend. Vacío: mismo origen. |

## Verificación sin modelo

```bash
bun install && bun run demo.ts   # procesa los 6 mensajes llamando directo a las herramientas
bun run test                     # 84 pruebas de api/tests: extracción, reglas, herramientas, ciclo, HTTP, bandeja, reinicio, módulo
bun run typecheck                # api + web
```

`demo.ts` limpia `out/`, hace la primera pasada (msg-006 queda sin registrar por revisión), una segunda llamada con `confirmado: true` y genera `out/alertas.md`.

## API

| Método | Ruta | Cuerpo / respuesta |
|---|---|---|
| `POST` | `/api/chat` | `{ sessionId, message }` → `{ reply, toolCalls: [{ nombre, args, ok, resumen }], needsConfirmation }` |
| `GET` | `/api/sessions/:id` | Sesión completa: `turnos[]` visibles, `mensajes[]` del modelo, `tokens`, `pendientesConfirmacion[]` |
| `GET` | `/api/health` | `{ ok: true, provider, model }` (sin claves) |
| `GET` | `/api/maestro` | `{ filas[] }` del maestro de trabajo (`out/sharepoint/maestro-contratos.csv`) |
| `GET` | `/api/maestro.csv` | Descarga del CSV del maestro de trabajo |
| `GET` | `/api/buzon` | `{ contadores: { total, pendientes, requiere_revision, procesados }, mensajes[], errores[] }`; cada mensaje con `estado` (`pendiente`, `requiere_revision`, `registrado`, `actualizado`, `duplicado`, `rechazado`), `clasificacion`, `id_contrato` y `decidido_por` |
| `GET` | `/api/buzon/:id` | Detalle de solo lectura: correo, adjuntos con texto, extracción con `confianza` y `evidencia` por campo (tras analizar), validación (`clasificacion`, `requiere_revision`, `revisiones`, `diferencias`, `avisos`), decisión humana, fila del maestro, `linea_tiempo[7]`, historial y log del mensaje |
| `POST` | `/api/buzon/:id/procesar` | extraer → validar → registrar **sin** confirmación (igual que `demo.ts`): lo limpio se registra, lo dudoso pasa a la bandeja. `409 ya_procesado` si ya se cerró |
| `GET` | `/api/bandeja` | `{ pendientes: [{ mensaje, validacion, contrato, desde }], resueltas: [decisiones] }` |
| `POST` | `/api/bandeja/:id/aprobar` | `{ aprobador, correcciones? }` → `contratos_registrar` con `confirmado: true` y el contrato corregido (el servidor vuelve a validar). `correcciones` acepta solo campos del contrato con su tipo, p. ej. `{ "valor": 0, "fecha_fin": "2027-08-31" }` |
| `POST` | `/api/bandeja/:id/rechazar` | `{ aprobador, motivo }` → cierra el mensaje como `rechazado` sin tocar el maestro |
| `POST` | `/api/demo/reset` | `{ ok: true, mensajes }`: vacía `out/` y las sesiones y vuelve a copiar el maestro; espera a que terminen los turnos de chat en curso |

Errores tipados: `{ ok: false, error: { codigo, mensaje } }` con `400 peticion_invalida` (cuerpo que no cumple el esquema zod o JSON roto: `sessionId` con `[A-Za-z0-9_-]{1,64}`, `message` de 1 a 4000 caracteres, `aprobador` y `motivo` obligatorios, `correcciones` sin campos desconocidos), `404` (`mensaje_no_encontrado`, `sesion_no_encontrada`, `ruta_no_encontrada`), `409` (`ya_procesado`, `no_pendiente`: solo se aprueba o rechaza lo que espera confirmación), `422 registro_fallido` y `500`. Un error del modelo o de una herramienta en el chat **no** es un error HTTP: vuelve como `reply` en lenguaje claro y la sesión sigue (CA5). Cada acción de la bandeja pasa por las mismas herramientas y queda en `out/log.jsonl` (`bandeja_aprobar`, `bandeja_rechazar`); las decisiones humanas, en `out/decisiones.jsonl`.

## Estructura

Monorepo con dos workspaces de Bun: `api/` (backend) y `web/` (front).

```
api/                                 backend Bun + Hono (workspace)
├── package.json, tsconfig.json      dependencias y scripts de la API (dev, start, test, typecheck, sync:module)
├── src/
│   ├── server.ts                    arranque: compone dependencias y sirve API + front
│   ├── config.ts                    variables de entorno validadas con zod
│   ├── knowledge/registro-contratos.md  conocimiento del proceso (reglas, esquema, gobierno)
│   ├── tools/                       herramientas contratos_* (contratos.ts) y su envoltorio común (tool.ts)
│   ├── agent/                       ciclo del agente, guarda de confirmación, sesiones, prompt
│   ├── llm/                         adaptador (adapter.ts), Gemini, offline y fábrica
│   ├── http/                        rutas Hono (chat en app.ts, buzón/bandeja/reinicio en hitl.ts) y tipos compartidos con el front
│   ├── application/use-cases/       validar, registrar, alertas, estado de mensajes, vistas del buzón, línea de tiempo, reinicio
│   ├── application/workflows/       orquestación sobre las herramientas: pasada de demo.ts y acciones de la bandeja
│   ├── core/                        núcleo puro, sin E/S: domain/, extraction/, rules/
│   └── infrastructure/              archivos de fixtures/ y out/: buzón, maestro CSV, bitácoras, análisis, decisiones, cerrojo
├── tests/                           unit/ (extracción, LLM) e integration/ (herramientas, agente, HTTP, bandeja, módulo)
└── scripts/sync-module.ts           genera modulo/ desde agent/ y el conocimiento
web/                                 front React + Vite (workspace): src/views, components, lib, styles
agent/prompt.md                      comportamiento del agente (system prompt), compartido por la API y modulo/
modulo/                              bonus PRD 9.4: el mismo agente empaquetado para otras plataformas (ver abajo)
fixtures/reto-02/                    buzón, maestro y comerciales de entrada (solo lectura)
docs/                                PRD del reto y wiki técnica (docs/wiki/Home.md)
demo.ts                              verificación sin modelo
package.json, bun.lock               workspaces y scripts que delegan en api/ y web/
Dockerfile, docker-compose.yml, render.yaml   imagen única (API + front) y despliegues
```

Desde la raíz, `bun run dev`, `bun run test`, `bun run typecheck`, `bun run demo` y `bun run sync:module` delegan en los workspaces; también puedes ejecutarlos dentro de `api/` o `web/`.

**¿Qué es `modulo/`?** Es el bonus del PRD (§9.4): el mismo agente empaquetado como tres archivos para que otra plataforma de agentes lo use sin este servidor: `agent.md` (el prompt con frontmatter), `skill/registro-contratos/SKILL.md` (el conocimiento) y `tools/contratos.ts` (reexporta las herramientas de `api/`). No es código aparte.

`modulo/agent.md` y `modulo/skill/registro-contratos/SKILL.md` se generan con `bun run sync:module` (un test falla si divergen); `modulo/tools/contratos.ts` reexporta las mismas herramientas.

La documentación técnica completa está en la [wiki](docs/wiki/Home.md); las instrucciones para agentes de código, en [`AGENTS.md`](AGENTS.md).

## Despliegue

La imagen [`Dockerfile`](Dockerfile) compila el front y ejecuta `bun run start` (API + front en el mismo puerto).

```bash
docker build -t agente-contratos .
docker run -p 3000:3000 -e GOOGLE_API_KEY=... agente-contratos
```

### Despliegue actual: front en Vercel, backend en AWS Lightsail

| Pieza | Servicio | Configuración |
|---|---|---|
| Front (`web/`) | Vercel, proyecto `reto02-contratos` | [`web/vercel.json`](web/vercel.json); variable de build `VITE_API_URL` = URL del backend. |
| Backend (imagen del `Dockerfile`) | AWS Lightsail Containers `reto02-contratos` (nano, 1 nodo, `us-east-1`) | Puerto 3000, health check `/api/health`; variables `LLM_PROVIDER=gemini`, `GOOGLE_API_KEY`, `GEMINI_MODEL`, `CORS_ORIGINS=https://reto02-contratos.vercel.app`. |

La clave de Gemini solo existe como variable de entorno del contenedor en Lightsail: no está en el repositorio, en la imagen ni en el front.

Backend (requiere AWS CLI y `lightsailctl`):

```bash
docker buildx build --platform linux/amd64 -t reto02-contratos:latest --load .
aws lightsail create-container-service --service-name reto02-contratos --power nano --scale 1   # solo la primera vez
aws lightsail push-container-image --service-name reto02-contratos --label app --image reto02-contratos:latest
# create-container-service-deployment con la imagen ":reto02-contratos.app.<n>", las variables de arriba y el health check
```

Si usas `aws login`, `lightsailctl` no lee esas credenciales: expórtalas antes con `eval "$(aws configure export-credentials --format env)"`.

Front:

```bash
cd web && vercel deploy --prod --build-env VITE_API_URL=https://<servicio>.cs.amazonlightsail.com
```

Para apagar el backend al terminar la defensa: `aws lightsail delete-container-service --service-name reto02-contratos`.

**Alternativa en un solo servicio**: el blueprint [`render.yaml`](render.yaml) despliega la misma imagen (API + front) en Render; solo hay que cargar `GOOGLE_API_KEY` como secreto.

En local, `docker compose up --build` levanta la misma imagen en <http://localhost:3000> y lee `.env` si existe.

Notas: el contexto de build lo filtra [`.dockerignore`](.dockerignore). El disco del contenedor es efímero: `out/` y las sesiones se pierden al redesplegar o reiniciar, lo cual es aceptable para la demo; mientras el contenedor vive, **Reiniciar demo** deja el buzón limpio sin redesplegar.

> La versión anterior con LangGraph (`langgraph_app/`) se retiró del árbol; sigue disponible en el historial de git.
