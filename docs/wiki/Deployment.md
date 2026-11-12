# Despliegue

## Imagen única (API + front)

`Dockerfile` en tres etapas:

1. **dependencias**: `bun install --frozen-lockfile` de los workspaces `api/` y `web/`.
2. **front**: copia `web/` y `api/src/http/types.ts` (tipos compartidos) y ejecuta `bun run build`.
3. **ejecución** (`oven/bun:1-slim`): dependencias de producción, `api/src/`, `agent/`, `fixtures/` y `web/dist`; usuario `bun`; `bun run start` en el puerto 3000.

El contexto lo filtra `.dockerignore` (sin `node_modules`, `.env`, `.git`, `docs`, `out`, `api/tests`).

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

Por qué Lightsail y no Lambda: un proceso siempre encendido conserva sesiones y `out/` entre «procesa el buzón» y «confirmo…» (`SOLUCION.md` §7).

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
- `idleTimeout` de Bun en 255 s: un turno con varias llamadas al modelo puede tardar más que los 10 s por defecto.
