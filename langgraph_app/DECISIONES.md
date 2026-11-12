# Decisiones técnicas — Reto 2 (Agente de contratos)

Documento de defensa: **qué se eligió, por qué, y qué se descartó**.

---

## 1. Principio rector

> Un solo núcleo de negocio. Tres formas de entrar.

| | Modo A — Agente IA | Modo B — Demo determinista | Modo C — API HTTP |
|---|---|---|---|
| Entrada | Chat (`agente` / `bun start`) | `bun run process` / grafo `pipeline` | `bun run api` (Hono) |
| Quién decide el “qué” | LLM o planificador local (`tool_calls`) | Código: nodos + reglas | Front → chat o REST |
| Quién decide el “si se escribe al maestro” | **Nunca la IA** → `rules.ts` | Igual: `rules.ts` | Igual: `rules.ts` |
| Herramientas | Las mismas → pipeline | Pipeline directo | Mismas tools / pipeline |
| Persistencia | `output-langgraph/` | `output-langgraph/` | `output-langgraph/` |

No hay tres sistemas. Hay **tres entradas** sobre las **mismas tools y validaciones**.

---

## 2. Por qué LangGraph (y no “solo LangChain” ni “solo un chat”)

| Opción | Por qué sí / no |
|---|---|
| **LangGraph StateGraph** | El flujo del correo es un grafo con branches (`decidir` → registrar/actualizar/duplicado/revisión/rechazar). Studio permite **ver** nodos/edges y auditar. |
| Solo LangChain chains | Encadenan pasos lineales; peor para branches, HITL y trazas por nodo. |
| Toda la lógica en el prompt | No auditable, no reproducible, no cumple el espíritu del reto (“reglas fuera del modelo”). |
| Solo regex sin grafo | Cumple el demo, pero no demuestra agente ni orquestación visible. |

**Decisión:** LangGraph para orquestar; LangChain tools + Gemini para el modo conversacional.

---

## 3. Por qué TypeScript + Bun

| Decisión | Motivo |
|---|---|
| **TypeScript** | Tipado del contrato de tools/estado; Zod en tools; mismo lenguaje front/back futuro. |
| **Bun** | Runtime rápido, `.env` nativo, `bun start` simple. Compatible con el requisito Bun/Node 20+. |
| Node vía LangGraph CLI | Studio (`langgraph dev`) hoy corre sobre Node; Bun orquesta scripts y lógica de negocio. |

---

## 4. Por qué Gemini (y fallback heurístico)

| Decisión | Motivo |
|---|---|
| **Gemini** | Modelo pedido para el agente; clasificar/extraer con confianza cuando hay API. |
| **Fallback heurístico** (`heuristic.ts`) | El demo y los tests deben funcionar **sin modelo** (reproducible, offline, defensa ante API caída/cuota). |
| La IA **no** escribe al CSV | Extrae/clasifica; `rules.ts` + nodos `ejecutar_*` validan y persisten. |

Separación clave del reto:

- **IA / heurística:** interpretar texto → tipo + campos `{ valor, confianza, evidencia }`.
- **TypeScript:** NIT, duplicados, autoría, umbral de confianza, decisión final, archivo, auditoría.

---

## 5. Por qué el pipeline es un grafo fijo (no lo decide el LLM)

```
cargar → clasificar → [extraer?] → resolver_autoria → buscar_existente
      → validar → decidir → ejecutar_* → auditar
```

| Decisión | Motivo |
|---|---|
| Orden fijo en código (`graph.ts`) | Flujo predecible, auditable, testeable. El LLM no puede saltarse validaciones. |
| Edges condicionales en `decidir` | Se ve en Studio el branch real (p.ej. msg-003 → `ejecutar_duplicado`). |
| Clasificar/extraer como nodos | Pueden usar Gemini o heurística; el resto del grafo no cambia. |

Esto es el **Modo B** (orquestador determinista) y también el motor que invocan las tools del chat.

---

## 6. Por qué las tools están separadas del chat

Tools actuales (`tools/contratos.ts`, contratos Zod):

- `estado_buzon` / `listar_pendientes` / `listar_mensajes`
- `ultima_auditoria` (confianza / decisión del último o por msgId)
- `procesar_mensaje` → invoca el **mismo** `pipeline`
- `procesar_buzon`
- `reporte_vencimientos`
- `consultar_contrato`
- `reiniciar_demo`

| Decisión | Motivo |
|---|---|
| Tools = fachada del núcleo | El agente conversacional **no** reimplementa reglas; llama tools. |
| Zod en cada tool | Contrato de entrada/salida explícito (evaluable en defensa). |
| `procesar_*` delega en pipeline | Una sola implementación de validar/registrar/archivar. |
| Tools de estado del buzón | Sin ellas el chat no puede responder “cuántos faltan” con datos reales. |

El backend HTTP (`api/`) y el front consumen las **mismas** tools / pipeline; el UI solo renderiza.

---

## 7. Por qué hay dos grafos en Studio (`agente` vs `pipeline`)

| Grafo | Rol |
|---|---|
| **`agente`** | Modo conversacional (Chat). ReAct: `agent ↔ tools`. Memoria de thread en Studio. |
| **`pipeline`** | Inspección del flujo por mensaje (`{ msgId }`). Demo/debug del núcleo. |

No son dos productos: `agente` **usa** `pipeline` vía tools.

---

## 8. Por qué el bucle agentico emite `tool_calls` aunque Gemini falle

| Enfoque malo | Enfoque elegido |
|---|---|
| Si no hay LLM, llamar funciones en un `if` y devolver texto | Planificador local emite `AIMessage.tool_calls` → `ToolNode` → vuelve a `agent` |

**Motivo:** el grafo sigue siendo agentico (mismo camino Studio). La diferencia es **quién elige la tool** (Gemini vs reglas de intención), no **dónde vive la lógica de negocio**.

---

## 9. Qué NO hace (a propósito) la IA

- No decide sola “registrar aunque la confianza sea 0.4”.
- No bypasea duplicados / NIT / autoría.
- No toca el seed `fixtures/`; escribe en `output-langgraph/`.
- No usa `new Date()` para alertas: fecha de referencia fija `2026-05-30`.

---

## 10. Mapa mental del repo (hoy)

```
langgraph_app/src/
  agent/chat-graph.ts ← Modo A: ReAct + MemorySaver (thread_id)
  graph.ts + nodes.ts ← Modo B: pipeline determinista del correo
  tools/contratos.ts  ← Herramientas compartidas (Zod)
  ports/              ← MailboxPort + AuditStore (swap IMAP/Graph después)
  adapters/           ← FixturesMailbox, CSV, JSONL, archivo
  api/                ← Modo C: Hono REST + chat SSE/sync
  rules.ts            ← Validaciones puras (sin LLM)
  cli.ts              ← Entrada local
```

Tres entradas → un núcleo: **API** (producto) · **CLI** · **Studio** (debug).

---

## 11. ¿El agente usa tools “libremente” o sigue un flujo fijo?

**Las dos cosas, en capas distintas:**

| Capa | ¿Libre? | Qué decide |
|---|---|---|
| Chat / ReAct | **Sí** | Qué tool llamar (`estado_buzon`, `procesar_mensaje`, …) |
| Dentro de `procesar_*` | **No** | Clasificar→extraer→validar→decidir→ejecutar (grafo fijo) |
| `rules.ts` | **No** | Si se escribe al maestro, revisión humana, duplicado, etc. |

El agente **puede** elegir procesar msg-006 o pedir el reporte.  
El agente **no puede** decir “registra igual aunque confianza=0.4”: no hay tool para eso.

---

## 12. Por qué API propia (Hono) y no solo LangGraph Studio

| Decisión | Motivo |
|---|---|
| **Bun + Hono** | Contrato REST/SSE estable para un frontend; Studio no es producto. |
| Chat con `threadId` + checkpointer | Memoria multi-turno sin que el front reenvíe todo el historial. |
| REST de buzón/maestro | Paneles UI sin pasar por el LLM (botón “Procesar” → pipeline directo). |
| `MailboxPort` + `procesados.json` | Fixtures hoy; IMAP/Graph mañana sin tocar tools/API. |

Qué **no** hace esta fase: IMAP real, auth de usuarios, DB enterprise.

---

## 13. Human-in-the-loop: el agente recomienda, el humano decide

| Decisión | Motivo |
|---|---|
| El pipeline termina en `proponer` | El agente deja una **recomendación** (tarjeta); nunca escribe el maestro. |
| Grafo `resolucion` aparte | Solo lo dispara un humano (`POST /v1/propuestas/:id/aprobar|rechazar` o Studio). |
| Sin tool de aprobar | El LLM no puede aprobar aunque se lo pidan: la capacidad no existe. |
| Aprobar revalida con `rules.ts` | Lo confirmado por el humano pasa a confianza 1.0, pero NIT, duplicados, fechas y autoría se validan igual. Si una corrección rompe una regla → `bloquear` (422) y la tarjeta sigue pendiente. |
| Cola persistente (`propuestas.json`) en vez de `interrupt()` | La aprobación es asíncrona (minutos u horas) y debe sobrevivir a reinicios de la API. `interrupt()` + `MemorySaver` vive en memoria y, invocado desde una tool, pausaría también el chat. |
| Lock en memoria por `msgId` | Evita doble ejecución por doble clic o dos pestañas. |
| Auditoría en dos fases | `fase: "propuesta"` (qué recomendó el agente) y `fase: "resolucion"` (quién decidió, correcciones, qué se ejecutó). |

---

## 14. Resumen en una frase

**La IA interpreta y recomienda; el humano aprueba o rechaza; TypeScript revalida y persiste; la API expone el mismo núcleo al frontend.**
