# LangGraph Studio (`studio/`)

`studio/` es un workspace de **solo desarrollo** que expone los dos grafos del agente en LangGraph.js para verlos, ejecutarlos paso a paso y probar la pausa humana en [LangGraph Studio](https://smith.langchain.com/studio). La app no depende de él: el ciclo propio (`api/src/agent/loop.ts`) y el motor (`api/src/application/workflows/`) siguen siendo los que corren en producción, y la imagen Docker no instala LangGraph.

No es una copia: los grafos de Studio llaman a las mismas piezas que la app.

| Grafo | Archivo | Reutiliza |
|---|---|---|
| `recepcionista` | `studio/src/receptionist-graph.ts` | `agent/prompt.md` + conocimiento, `ProveedorLlm` (Gemini u offline), `definicionesParaModelo()` (las cinco `recepcion_*`), `ejecutarLlamada` (guarda CA3) y `agent/turn.ts` (cierre del turno, pregunta forzada, topes). |
| `motor` | `studio/src/engine-graph.ts` | `ingestar`, la tabla `NODOS` y la topología `ARISTAS` de `contract-graph.ts`, `contratos_alertas` y `reanudarRevision` (la misma reanudación que el chat y la bandeja). |

## Arrancar

```bash
bun install
bun run studio          # langgraphjs dev en http://localhost:2024
```

Abre <https://smith.langchain.com/studio?baseUrl=http://localhost:2024> (pide iniciar sesión en LangSmith; la cuenta gratuita basta). El servidor corre bajo Node con recarga en caliente y carga `../.env`: con `GOOGLE_API_KEY` la recepcionista usa Gemini; sin clave, el proveedor offline.

Los grafos usan la **misma raíz del proyecto** que la app: lo que se registre en Studio aparece en el Buzón, la Bandeja y el Maestro de `bun run dev`. Para empezar de cero, **Reiniciar demo** en el front o `POST /api/demo/reset`.

## `recepcionista`

```
__start__ ─▶ recepcionista ⇄ herramientas
                   └──────────▶ __end__
```

Pestaña **Chat**. Prueba: «Procesa el buzón de contratos con fecha de hoy 2026-09-03» → una llamada a `recepcion_procesar_buzon` y la pregunta por msg-006; en el mismo hilo, «confirmo el valor 0 y la fecha fin 2027-08-31» → `recepcion_responder_revision` registra CM-2026-03. Cada `ToolMessage` lleva en `artifact` la llamada visible con los `pasos` del motor.

Estado: `messages`, `pendientes` (por los que se preguntó en turnos anteriores del hilo), `pendientes_al_inicio`, `en_revision`, `resueltos` e `iteraciones`. La entrada es solo `messages`. La guarda CA3 es la de la app: si el modelo intenta decidir sobre un mensaje por el que no preguntó, recibe `decisión no autorizada`. Activa **Show tool calls** en el chat para ver cada llamada `recepcion_*` y el resultado del motor (con el `recorrido` de cada mensaje).

El estado se declara sobre `MessagesZodState` (zod v3, el que exporta LangGraph) y no con `Annotation`: así el servidor publica `messages` con `langgraph_type: "messages"`, que es lo que Studio necesita para habilitar la pestaña **Chat**. Con `Annotation` o con un `z.custom` de zod 4, el esquema sale sin tipo de mensaje y el chat queda deshabilitado.

El aviso «LangSmith API key is missing» de Studio es opcional: solo hace falta `LANGSMITH_API_KEY` en `.env` si quieres además las trazas en LangSmith.

## `motor`

```
ingestar ─▶ siguiente_mensaje ─┬─▶ extraer ─▶ validar ─▶ decidir ─┬─▶ registrar ──────┐
                 ▲             │                                 ├─▶ esperar_revision ┤
                 └─────────────┼─────────────────────────────────┴─▶ cerrar ──────────┘
                               └─▶ alertas ─┬─▶ revision_humana (interrupt) ─▶ alertas
                                            └─▶ __end__
```

Pestaña **Graph**. Entrada: `{ "hoy": "2026-09-03" }` (opcional `"mensaje_ids": ["msg-006"]`). El grafo procesa todo el buzón, genera alertas y se **detiene en `revision_humana`** con el detalle de msg-006 (campos, confianza, evidencia). Reanuda desde Studio con:

```json
{ "decision": "aprobar", "correcciones": { "valor": 0, "fecha_fin": "2027-08-31" }, "aprobador": "Ana" }
```

o `{ "decision": "rechazar", "motivo": "falta la firma" }`. La decisión queda en `out/decisiones.jsonl` con `via: "studio"` y las alertas se regeneran. Una respuesta con forma inválida no decide nada: el grafo vuelve a pausar en el mismo mensaje.

Estado: `hoy`, `mensaje_ids`, `cola`, `actual` (el mensaje en curso y su `recorrido`), `siguiente`, `mensajes` (resultado de cada uno con su `desenlace`), `omitidos`, `en_revision`, `decisiones`, `reporte` (alertas) y `error`.

## Diferencias con la app

| Tema | App | Studio |
|---|---|---|
| Quién recorre el grafo | `ejecutarGrafoMensaje` y el bucle de `loop.ts` | LangGraph |
| Pausa humana | Termina el turno; se reanuda en el turno siguiente o en la bandeja | `interrupt()` en `revision_humana`; se reanuda con un `Command` |
| Sesiones | `out/sesiones/<id>.json` | Hilos del servidor de LangGraph (en memoria, en `studio/.langgraph_api/`) |
| Topes de tokens | Por sesión y por proceso | Solo el tope de iteraciones (CA1) |

## Pruebas

`studio/tests/graphs.test.ts` (4 pruebas, en `bun run test`): el motor pausa en msg-006 y reanuda con la decisión, una respuesta inválida vuelve a pausar, la recepcionista repite el flujo del PRD §11 con el proveedor offline y la guarda CA3 rige también aquí.
