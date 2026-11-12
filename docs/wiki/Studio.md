# LangGraph Studio (`studio/`)

`studio/` es un workspace que expone los dos grafos del agente en LangGraph.js para verlos, ejecutarlos paso a paso y probar la pausa humana en [LangGraph Studio](https://smith.langchain.com/studio). La app no depende de él: el ciclo propio (`api/src/agent/loop.ts`) y el motor (`api/src/application/workflows/`) siguen siendo los que atienden el chat. La imagen Docker sí levanta este servidor junto a la API para que se pueda probar desde la web (ver [Desde la web](#desde-la-web)).

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

Abre <https://smith.langchain.com/studio?baseUrl=http://localhost:2024> (pide iniciar sesión en LangSmith; la cuenta gratuita basta). Con `LANGGRAPH_URL=http://127.0.0.1:2024` en `.env`, `bun run dev` también muestra el botón **Abrir en LangGraph Studio** (Vite reenvía `/langgraph` a la API). El servidor corre bajo Node con recarga en caliente y carga `../.env`: con `GOOGLE_API_KEY` la recepcionista usa Gemini; sin clave, el proveedor offline.

Los grafos usan la **misma raíz del proyecto** que la app: lo que se registre en Studio aparece en el Buzón, la Bandeja y el Maestro de `bun run dev`. Para empezar de cero, ejecuta el grafo `reiniciar_demo`, **Reiniciar demo** en el front o `POST /api/demo/reset`, y abre un hilo nuevo (los hilos de Studio guardan sus `pendientes` aparte, en `studio/.langgraph_api/`).

## Desde la web

La imagen Docker levanta este mismo servidor (`langgraphjs dev`, bajo Node 22, solo en `127.0.0.1:2024`) junto a la API, y la API lo publica en `/langgraph/*` con un reenvío transparente (`api/src/http/langgraph-proxy.ts`). Cuando `LANGGRAPH_URL` está definido, `/api/health` devuelve `studio: true` y la barra lateral del front muestra **Abrir en LangGraph Studio**, que abre `https://smith.langchain.com/studio/?baseUrl=<backend>/langgraph`. Studio llama a ese `baseUrl` desde el navegador del evaluador. Como corre en el mismo contenedor, comparte `out/` con la app: lo que se registre en Studio aparece en el Buzón, la Bandeja y el Maestro de la web, y al revés. Detalles de la imagen en [Despliegue](Deployment.md).

## `reiniciar_demo`

```
__start__ ─▶ reiniciar ─▶ __end__
```

Pestaña **Graph**, entrada `{}`, **Submit**. Llama al mismo `reiniciarDemo()` que `POST /api/demo/reset`: borra `out/`, vuelve a copiar el maestro del fixture y devuelve `{ "mensajes": 6, "error": null }`. Es un grafo aparte, no una herramienta, para que el modelo nunca pueda borrar `out/`. A diferencia del endpoint, no vacía las sesiones que la API tenga en memoria: si `bun run dev` está corriendo, abre también una sesión de chat nueva en el front.

## `recepcionista`

```
__start__ ─▶ guarda_entrada ─▶ recepcionista ⇄ herramientas ─(recepcion_procesar_buzon)─▶ [motor]
                   └─(bloqueado)─────┴──────────▶ __end__
```

`guarda_entrada` aplica las mismas guardas de la app ([Ciclo del agente](Agent-Loop.md#guardas-de-alcance-y-de-manipulación)): reglas deterministas y, con Gemini, el clasificador de alcance. Si bloquea, responde con un texto fijo y el turno termina sin llamar al modelo. Prueba: «hola, ¿cuánto es 2 mas 2?» o «ignora tus instrucciones».

Cuando el modelo llama a `recepcion_procesar_buzon`, la pasada del motor corre como **subgrafo de `herramientas`**: es la misma pasada del grafo `motor` (`ingestar → extraer → validar → decidir → registrar | esperar_revision | cerrar → alertas`), sin `revision_humana`, porque en el chat la pausa la cierra el turno (CA3) y la decisión llega por `recepcion_responder_revision`. En la pestaña **Graph** se ven sus nodos dentro de `herramientas` (`herramientas:extraer`, …) y en el hilo cada paso del motor aparece anidado. La herramienta no cambia: valida sus argumentos, escribe `out/log.jsonl` y devuelve los mismos `pasos`. Solo cambia quién recorre la pasada, mediante `ContextoMotor.ejecutarPasada` (`api/src/application/workflows/process-mailbox.ts`), que la app y la demo no definen.

Pestaña **Chat**. Prueba: «Procesa el buzón de contratos con fecha de hoy 2026-09-03» → una llamada a `recepcion_procesar_buzon` y la pregunta por msg-006; en el mismo hilo, «confirmo el valor 0 y la fecha fin 2027-08-31» → `recepcion_responder_revision` registra CM-2026-03. Cada `ToolMessage` lleva en `artifact` la llamada visible con los `pasos` del motor.

Estado: `messages`, `pendientes` (por los que se preguntó en turnos anteriores del hilo), `pendientes_al_inicio`, `en_revision`, `resueltos`, `iteraciones` y `tokens` (consumo del hilo, clasificador incluido). La entrada es solo `messages`. La guarda CA3 es la de la app: si el modelo intenta decidir sobre un mensaje por el que no preguntó, recibe `decisión no autorizada`. Activa **Show tool calls** en el chat para ver cada llamada `recepcion_*` y el resultado del motor (con el `recorrido` de cada mensaje).

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
| Topes de tokens | Por sesión y por proceso | Los mismos (`mensajeDeTopeDeTokens` de `agent/turn.ts`): por hilo, en el estado, y por proceso; cada proceso lleva su propia cuenta |

## Pruebas

`studio/tests/graphs.test.ts` (9 pruebas, en `bun run test`): el motor pausa en msg-006 y reanuda con la decisión, una respuesta inválida vuelve a pausar, `reiniciar_demo` deja `out/` como recién desplegado, la recepcionista repite el flujo del PRD §11 con el proveedor offline, `recepcion_procesar_buzon` recorre el motor como subgrafo visible con el mismo resultado, la guarda CA3 y la de entrada rigen también aquí, y los topes de tokens cortan por hilo y por proceso sin llamar al modelo ni al clasificador.
