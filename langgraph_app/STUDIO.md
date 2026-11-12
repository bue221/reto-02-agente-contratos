# Cómo leer los grafos en LangSmith Studio

Hay **tres grafos**. El agente recomienda; el humano decide.

| Grafo | Quién lo dispara | Qué hace |
|-------|------------------|----------|
| `pipeline` | El agente (tools) | Analiza un correo y deja una **recomendación** pendiente |
| `resolucion` | **Solo un humano** | Aprueba/rechaza la recomendación; reglas revalidan y ejecutan |
| `chat` | Usuario | Conversa y elige tools (no puede aprobar) |

## 1. `pipeline` — el agente RECOMIENDA

```
START → cargar → clasificar ─┬→ extraer → resolver_autoria
                             └→ resolver_autoria
      → buscar_existente → validar → recomendar → proponer → END
```

`proponer` guarda una tarjeta en `output-langgraph/propuestas.json`. **No toca el maestro.**

Input: `{ "msgId": "msg-006" }`

## 2. `resolucion` — el humano DECIDE

```
START → cargar_propuesta ─┬→ aplicar_correcciones → buscar_existente → validar → decidir
                          │      ─┬→ ejecutar_registrar ─┐
                          │       ├→ ejecutar_actualizar ┤
                          │       ├→ ejecutar_duplicado  ├→ auditar_resolucion → END
                          │       ├→ ejecutar_rechazar   ┤
                          │       └→ bloquear → END      │
                          └→ ejecutar_rechazo_humano ────┘
```

Aprobar (con corrección de la fecha vaga de msg-006):

```json
{ "msgId": "msg-006", "accion": "aprobar", "aprobador": "yo", "correcciones": { "fechaFin": "2026-12-31" } }
```

Rechazar:

```json
{ "msgId": "msg-005", "accion": "rechazar", "comentario": "Es una cotización" }
```

Reglas clave:
- Lo que el humano confirma o corrige pasa a confianza 1.0, pero **NIT, duplicados, fechas y autoría se validan igual**.
- Si una corrección rompe una regla (p.ej. NIT inválido), termina en `bloquear`: nada se ejecuta y la tarjeta sigue pendiente.

## 3. `chat` — ReAct

```
START → recepcionista ⇄ herramientas → END
```

Pestaña **Chat**: `procesa msg-006` · `qué tengo por aprobar` · `aprueba msg-006` (responde que no puede: no tiene esa tool).

> Si Chat sale en gris: hard-refresh y verifica que el selector diga `chat`.

## Arrancar

```bash
cd langgraph_app
bun run studio
```

https://smith.langchain.com/studio?baseUrl=http://localhost:2024

Flujo de demo en Studio: `pipeline` con msg-006 → `resolucion` con la corrección → `chat` "consulta C-006".
