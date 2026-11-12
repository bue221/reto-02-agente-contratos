# API HTTP

Código: `api/src/http/app.ts` (chat, salud, sesiones, maestro), `api/src/http/hitl.ts` (buzón, bandeja, CSV, reinicio), `api/src/http/helpers.ts` (errores y validación), `api/src/http/types.ts` (tipos compartidos con el front). Las rutas son delgadas: validan el cuerpo con zod y delegan en el agente, los casos de uso o la orquestación.

## Endpoints

| Método | Ruta | Cuerpo | Respuesta |
|---|---|---|---|
| `GET` | `/api/health` | — | `{ ok: true, provider, model }` (sin claves) |
| `POST` | `/api/chat` | `{ sessionId, message }` | `{ reply, toolCalls: [{ nombre, args, ok, resumen }], needsConfirmation }` |
| `GET` | `/api/sessions/:id` | — | Sesión completa: `turnos[]`, `mensajes[]`, `tokens`, `pendientesConfirmacion[]` |
| `GET` | `/api/maestro` | — | `{ filas[] }` del maestro de trabajo |
| `GET` | `/api/maestro.csv` | — | Descarga del CSV (`text/csv`, `attachment`) |
| `GET` | `/api/buzon` | — | `{ contadores, mensajes[], errores[] }` con el estado de cada mensaje |
| `GET` | `/api/buzon/:id` | — | Detalle: correo, adjuntos, extracción con confianza y evidencia, validación, decisión, fila, `linea_tiempo[7]`, historial y log |
| `POST` | `/api/buzon/:id/procesar` | — | `{ mensaje, accion, requiere_revision[], avisos[] }`: extraer → validar → registrar sin confirmación |
| `GET` | `/api/bandeja` | — | `{ pendientes: [{ mensaje, validacion, contrato, desde }], resueltas: [decisiones] }` |
| `POST` | `/api/bandeja/:id/aprobar` | `{ aprobador, correcciones? }` | `{ mensaje, decision }` |
| `POST` | `/api/bandeja/:id/rechazar` | `{ aprobador, motivo }` | `{ mensaje, decision }` |
| `POST` | `/api/demo/reset` | — | `{ ok: true, mensajes }` |

Rutas fuera de `/api/*` sirven el front compilado (`web/dist`) si existe, con fallback a `index.html`.

## Validación de cuerpos

| Campo | Regla |
|---|---|
| `sessionId` | `[A-Za-z0-9_-]{1,64}` |
| `message` | 1 a 4000 caracteres (sin espacios en los extremos) |
| `aprobador` | obligatorio, máx. 80 |
| `motivo` | obligatorio, máx. 500 |
| `correcciones` | solo campos del contrato con su tipo (`CorreccionesSchema`, `.strict()`): p. ej. `{ "valor": 0, "fecha_fin": "2027-08-31" }` |

## Errores tipados

Forma única: `{ ok: false, error: { codigo, mensaje } }`.

| HTTP | `codigo` | Cuándo |
|---|---|---|
| 400 | `peticion_invalida` | JSON roto o cuerpo que no cumple el esquema (el mensaje trae el detalle de zod). |
| 404 | `mensaje_no_encontrado` | El id no está en el buzón. |
| 404 | `sesion_no_encontrada` | `GET /api/sessions/:id` de una sesión inexistente. |
| 404 | `ruta_no_encontrada` | Ruta `/api/*` desconocida. |
| 409 | `ya_procesado` | El mensaje ya se cerró. |
| 409 | `no_pendiente` | Aprobar o rechazar algo que no espera confirmación. |
| 422 | `registro_fallido` | `registrar` falló al aprobar (p. ej. datos inválidos tras corregir). |
| 500 | `error_interno` | Excepción no prevista; el detalle solo va al log del servidor. |

Un error del modelo o de una herramienta **en el chat no es un error HTTP**: vuelve como `reply` legible con `200` y la sesión sigue (CA5).

## Ejemplos

```bash
curl -s localhost:3000/api/health

curl -s -X POST localhost:3000/api/chat \
  -H 'content-type: application/json' \
  -d '{"sessionId":"demo-1","message":"Procesa el buzón con fecha de hoy 2026-09-03"}'

curl -s -X POST localhost:3000/api/buzon/msg-006/procesar

curl -s -X POST localhost:3000/api/bandeja/msg-006/aprobar \
  -H 'content-type: application/json' \
  -d '{"aprobador":"Analista","correcciones":{"valor":0,"fecha_fin":"2027-08-31"}}'

curl -s -X POST localhost:3000/api/demo/reset
```

## Concurrencia y trazabilidad

- `/api/chat` y las lecturas usan `AccesoOut` en modo compartido; `/api/demo/reset` en modo exclusivo (espera turnos en curso).
- Las acciones de la bandeja (`procesar`, `aprobar`, `rechazar`) se serializan con un cerrojo propio porque leen y reescriben los mismos JSON.
- Cada acción de la bandeja pasa por las herramientas y queda en `out/log.jsonl`; las decisiones humanas, en `out/decisiones.jsonl`.

## CORS

Si `CORS_ORIGINS` tiene valores, `/api/*` solo autoriza esos orígenes. Vacío: solo mismo origen (local con proxy de Vite o imagen única).

## Agregar un endpoint

Ver [Contribuir → Nuevo endpoint](Contributing.md#nuevo-endpoint).
