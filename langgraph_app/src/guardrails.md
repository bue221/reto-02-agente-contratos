# Guardrails del agente — qué puede / no puede equivocarse

## Capas (de blando a duro)

| Capa | Qué es | ¿El LLM puede saltársela? |
|------|--------|---------------------------|
| 1. System prompt | `prompts/agent-system.md` | **Sí** (puede ignorarlo) |
| 2. Catálogo de tools | Solo las tools registradas en `TOOLS` | **No** inventa tools nuevas |
| 3. Sin tool de aprobar | Aprobar/rechazar solo existe en la API (humano) | **No** — la capacidad no existe |
| 4. Pipeline + `rules.ts` | Validar / recomendar | **No** — el pipeline solo propone |
| 5. Revalidación al aprobar | El grafo `resolucion` vuelve a correr las reglas | **No** — ni el humano salta NIT/duplicados |

## Qué SÍ puede fallar (blando)

- Elegir la tool equivocada.
- Resumir mal una recomendación en el texto del chat (la tarjeta muestra los datos reales).
- Con Gemini, contestar sin llamar tool → mitigado por prompt; **no puede persistir** nada.

## Qué NO puede hacer (duro)

- Escribir en el maestro → solo ocurre en `resolucion`, tras aprobación humana.
- Aprobar una recomendación → no hay tool; el chat responde que uses la tarjeta.
- Registrar con NIT inválido aunque el humano apruebe → `bloquear` (422).

## Cómo comprobarlo

1. Chat: `aprueba msg-006` → "No puedo aprobar…".
2. `procesa msg-006` → tarjeta `REVISION_HUMANA`; el maestro no cambia.
3. Aprobar con `nit: "12345"` → 422 `BLOQUEADO_POR_REGLAS`, tarjeta sigue pendiente.
4. `bun run smoke:api` cubre todo lo anterior.
