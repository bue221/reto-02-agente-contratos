# Despliegue

## Topología en producción

```mermaid
flowchart LR
  subgraph Navegador["Navegador de la analista o del evaluador"]
    SPA["Front React · reto02-contratos.vercel.app"]
    LS["LangGraph Studio · smith.langchain.com"]
  end

  subgraph Vercel["Vercel"]
    CDN["web/dist estático · rewrites a index.html"]
  end

  subgraph Lightsail["AWS Lightsail Containers · nano · us-east-1"]
    subgraph Contenedor["Contenedor de la imagen · puerto 3000 expuesto"]
      API["Bun · API Hono + web/dist · :3000"]
      LG["Node 22 · langgraphjs dev · 127.0.0.1:2024"]
      OUT[("out/ · disco efímero")]
      FX[("fixtures/ · solo lectura")]
      LGD[("studio/.langgraph_api/ · hilos")]
    end
  end

  Gemini["Google Gemini API · generativelanguage.googleapis.com"]

  SPA -->|descarga el front| CDN
  SPA -->|"/api/* · CORS_ORIGINS"| API
  LS -->|"baseUrl = backend/langgraph"| API
  API -->|"/langgraph/* · reenvío transparente"| LG
  API -->|"GOOGLE_API_KEY · solo en el backend"| Gemini
  LG -->|recepcionista con Gemini| Gemini
  API --> OUT
  API --> FX
  LG --> OUT
  LG --> FX
  LG --> LGD
```

El front y Studio son solo clientes: toda la lógica, la clave del modelo y el estado viven en el contenedor. La API y el servidor de LangGraph comparten `out/`, así que un registro hecho desde Studio aparece en la web y al revés.

## Imagen única (API + front + LangGraph Studio)

```mermaid
flowchart LR
  subgraph E1["1 · dependencias · oven/bun:1"]
    I["bun install --frozen-lockfile · api, web, studio"]
  end
  subgraph E2["2 · front"]
    B["bun run build → web/dist"]
  end
  subgraph EN["node:22-bookworm-slim"]
    N["binario node"]
  end
  subgraph E3["3 · ejecución · oven/bun:1-slim"]
    P["bun install --production"]
    R["api/src + agent + fixtures + studio/src + web/dist"]
    EP["docker-entrypoint.sh · usuario bun · :3000"]
  end
  I --> B
  P --> R
  B -->|web/dist| R
  N -->|/usr/local/bin/node| R
  R --> EP
```

`Dockerfile` en tres etapas:

1. **dependencias**: `bun install --frozen-lockfile` de los workspaces `api/`, `web/` y `studio/`.
2. **front**: copia `web/` y `api/src/http/types.ts` (tipos compartidos) y ejecuta `bun run build`.
3. **ejecución** (`oven/bun:1-slim` + el binario de Node 22 de `node:22-bookworm-slim`): dependencias de producción, `api/src/`, `agent/`, `fixtures/`, `studio/src` con su `langgraph.json` y `web/dist`; usuario `bun`; arranca con `docker-entrypoint.sh` en el puerto 3000.

```mermaid
flowchart TD
  S([docker-entrypoint.sh]) --> Q{"¿LANGGRAPH_URL tiene valor?"}
  Q -- "sí · la imagen trae http://127.0.0.1:2024" --> L["en segundo plano: bun run --cwd studio studio<br/>--host 127.0.0.1 --port del URL --no-reload<br/>LANGGRAPH_CLI_NO_ANALYTICS=1"]
  L --> A
  Q -- "no · -e LANGGRAPH_URL=" --> A["exec bun run start · API + front en :3000"]
  A --> H{"GET /api/health"}
  H -->|con LANGGRAPH_URL| HS["studio: true · el front muestra el botón de Studio"]
  H -->|sin LANGGRAPH_URL| HN["studio: false · solo la app"]
```

`docker-entrypoint.sh` hace `exec bun run start` (API + front). Si `LANGGRAPH_URL` tiene valor (la imagen trae `http://127.0.0.1:2024`), antes levanta en segundo plano `langgraphjs dev` de `studio/` bajo Node, escuchando solo en `127.0.0.1` y en el puerto de esa URL, sin recarga ni telemetría. La API lo publica en `/langgraph/*` (`api/src/http/langgraph-proxy.ts`), porque el contenedor expone un solo puerto, y `/api/health` responde `studio: true`, que es lo que muestra el botón **Abrir en LangGraph Studio** del front. Si el servidor de LangGraph se cae, la app sigue y `/langgraph` responde `502 langgraph_no_disponible`. Con `-e LANGGRAPH_URL=` solo arranca la API.

El contexto lo filtra `.dockerignore` (sin `node_modules`, `.env`, `.git`, `docs`, `out`, `api/tests`, `studio/tests`, `studio/.langgraph_api`).

```bash
docker build -t agente-contratos .
docker run -p 3000:3000 -e GOOGLE_API_KEY=... agente-contratos
# o
docker compose up --build        # lee .env si existe
```

## Producción actual: Vercel + AWS Lightsail

| Pieza | Servicio | Configuración |
|---|---|---|
| Front (`web/`) | Vercel, proyecto `reto02-contratos` | `web/vercel.json`; variable de build `VITE_API_URL` = URL del backend. |
| Backend (imagen) | AWS Lightsail Containers `reto02-contratos` (nano, 1 nodo, `us-east-1`) | Puerto 3000, health check `/api/health`; `LLM_PROVIDER=gemini`, `GOOGLE_API_KEY`, `GEMINI_MODEL`, `CORS_ORIGINS=https://reto02-contratos.vercel.app`. |

Studio queda en `https://<servicio>.cs.amazonlightsail.com/langgraph`; el botón del front abre `https://smith.langchain.com/studio/?baseUrl=<backend>/langgraph`. Studio llama a ese `baseUrl` desde el navegador; el servidor de LangGraph acepta cualquier origen, así que `CORS_ORIGINS` no hace falta para Studio. Memoria medida: unos 250–310 MB con los dos procesos, dentro de los 512 MB del plan nano; si se queda corto, usa `micro`.

Por qué Lightsail y no Lambda: un proceso siempre encendido conserva sesiones y `out/` entre «procesa el buzón» y «confirmo…» (`SOLUCION.md` §7).

### Integración y despliegue continuo

`.github/workflows/backend.yml` corre en cada push a `main` y en cada pull request que toque `api/`, `agent/`, `modulo/`, `fixtures/`, `web/`, `demo.ts`, el `Dockerfile` o el propio workflow. Siempre con `LLM_PROVIDER=offline`: la CI nunca llama a Gemini ni necesita secretos del modelo.

```mermaid
flowchart LR
  T(["push a main · pull request · manual"]) --> V
  subgraph V["verificar · Bun 1.4.4"]
    V1[bun install --frozen-lockfile] --> V2[bun run typecheck] --> V3[sync:module --check] --> V4[bun test] --> V5[bun run demo]
  end
  V --> I
  subgraph I["imagen"]
    I1["docker build · caché gha"] --> I2["docker run · espera /api/health hasta 30 s"]
  end
  I --> Q{"¿main, no PR y<br/>vars.AWS_ROLE_ARN?"}
  Q -- no --> F([fin])
  Q -- sí --> D
  subgraph D["desplegar · OIDC id-token"]
    D1["build linux/amd64"] --> D2["aws lightsail push-container-image"]
    D2 --> D3["create-container-service-deployment<br/>reutiliza variables del despliegue vigente"]
    D3 --> D4["espera ACTIVE · hasta 15 min"]
    D4 --> D5["curl /api/health, /api/buzon, /api/bandeja"]
  end
```

El despliegue asume un rol de AWS por OIDC (sin claves guardadas en GitHub) y copia las variables del despliegue vigente, así `GOOGLE_API_KEY` solo vive en Lightsail. El front no lo despliega la CI: se publica con `vercel deploy` (abajo).

### Backend

```bash
docker buildx build --platform linux/amd64 -t reto02-contratos:latest --load .
aws lightsail create-container-service --service-name reto02-contratos --power nano --scale 1   # primera vez
aws lightsail push-container-image --service-name reto02-contratos --label app --image reto02-contratos:latest
# create-container-service-deployment con la imagen ":reto02-contratos.app.<n>", variables y health check
```

Con `aws login`, exporta las credenciales para `lightsailctl`: `eval "$(aws configure export-credentials --format env)"`.

### Front

```bash
cd web && vercel deploy --prod --build-env VITE_API_URL=https://<servicio>.cs.amazonlightsail.com
```

### Apagar

```bash
aws lightsail delete-container-service --service-name reto02-contratos
```

## Alternativa: Render

`render.yaml` despliega la misma imagen (API + front) como un servicio web Docker con health check `/api/health`. Solo hay que cargar `GOOGLE_API_KEY` como secreto en el panel.

## Seguridad y operación

- La clave del LLM solo existe como variable de entorno del contenedor: no está en el repositorio, la imagen ni el front.
- El disco del contenedor es efímero: `out/` y las sesiones se pierden al redesplegar. Mientras vive, **Reiniciar demo** deja el buzón limpio.
- El link es público y el estado es compartido: los topes de iteraciones y tokens protegen la clave. En producción: autenticación, aprobador tomado de la identidad y reinicio deshabilitado (`SOLUCION.md` §11).
- `/langgraph` también es público y sin autenticación. El grafo `recepcionista` aplica los mismos topes que la app (iteraciones por turno, tokens por hilo y por proceso), pero cada proceso lleva su propia cuenta: el consumo máximo del contenedor es el doble de `MAX_TOKENS_PROCESO`. En Studio se puede editar el estado de un hilo (`tokens`, `pendientes`), así que el tope que no se puede evadir es el del proceso; los hilos viven en `studio/.langgraph_api/` y se pierden al redesplegar.
- `idleTimeout` de Bun en 255 s: un turno con varias llamadas al modelo puede tardar más que los 10 s por defecto.
