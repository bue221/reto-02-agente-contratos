# SOLUCION · Agente "Registro de Contratos Vigentes"

## 1. Problema en una frase

Desde el 30 de mayo de 2026 nadie alimenta el maestro de contratos y solo llegan los que requieren póliza, así que **la analista administrativa** (dueña del maestro) no sabe qué está vigente, **gerencia** no puede responder qué vence este trimestre y **la empresa** asume el riesgo de pólizas exigidas que nadie constituye.

## 2. Arquitectura

```
┌────────────────────────┐  POST /api/chat       ┌──────────────────────────────────────────────┐
│ Front React (web/)     │ ────────────────────▶ │ API Bun + Hono (api/src/server.ts, http/)    │
│ Pestañas:              │ ◀──────────────────── │  Recepcionista ReAct (api/src/agent/loop.ts) │
│ - Buzón (7 pasos,      │  { reply, toolCalls,  │   prompt → ProveedorLlm.enviar → 5 tools     │
│   correo vs extracción)│    needsConfirmation} │   recepcion_* (tools/recepcion.ts) → …       │
│ - Bandeja de aprobación│  /api/buzon/*         │  Motor determinista (application/workflows): │
│ - Maestro CSV          │  /api/bandeja/*       │   ingestar → extraer → validar → decidir →   │
│ - Chat (tool calls y   │  /api/chat/stream SSE │   registrar | esperar_revision | cerrar →    │
│   pasos del motor,     │  /api/demo/reset      │   alertas; la bandeja reanuda la misma pausa │
│   confirmación)        │  /api/maestro(.csv)   │  ProveedorLlm: Gemini (fetch) | Offline       │
└────────────────────────┘                       │  Sesiones: memoria + out/sesiones/<id>.json   │
                                                 │  AccesoOut: turnos/bandeja comparten out/     │
                                                 └──────────────┬───────────────────────────────┘
                                                                │ herramientas contratos_* (zod), solo desde el motor
                                       ┌────────────────────────┴────────────────────┐
                                       ▼                                             ▼
                          fixtures/reto-02/ (solo lectura)          out/ (escritura)
                          buzon/, maestro-contratos.csv,            sharepoint/maestro-contratos.csv,
                          comerciales.json                          sharepoint/Contratos/…, historial.jsonl,
                                                                    procesados.json, analisis.json,
                                                                    decisiones.jsonl, log.jsonl, alertas.md
```

| Pieza | Dónde vive | Regla |
|---|---|---|
| **Comportamiento** | `agent/prompt.md` | Qué hace el agente, qué no puede afirmar, cuándo pregunta, formato de respuesta. |
| **Conocimiento** | `api/src/knowledge/registro-contratos.md` | RN1–RN7, esquema, umbral 0.8, alertas, supuestos y resumen de gobierno. Se anexa al prompt de sistema. |
| **Ejecución** | `api/src/tools/recepcion.ts` (lo que ve el modelo) → motor en `api/src/application/workflows/` → `api/src/tools/contratos.ts` (+ `api/src/core/`, `api/src/application/use-cases/`, `api/src/infrastructure/`) | Única fuente de valores y único dueño del orden del proceso. Importable desde `demo.ts`, los tests y `modulo/` sin el servidor. |
| **Parámetros de negocio** | `api/src/core/domain/parameters.ts` | Umbral, similitud, fecha de corte, ventana de alertas. |

El prompt y el conocimiento **se leen en cada turno**: cambiar una regla del proceso no toca ni reinicia el servidor. El servidor solo compone dependencias (`api/src/server.ts`) y expone HTTP (`api/src/http/app.ts` y `api/src/http/hitl.ts`, rutas delgadas); el ciclo solo conoce la interfaz `ProveedorLlm`.

**Dos grafos: la recepcionista conversa, el motor ejecuta.** El modelo no ve las cinco herramientas del PRD: ve cinco `recepcion_*` que no contienen reglas de negocio. Tres son de lectura (`consultar_estado`, `consultar_maestro`, `explicar_validacion`) y dos son "botones" del motor: `procesar_buzon` lo enciende y `responder_revision` lo reanuda tras la decisión humana. El motor (`application/workflows/`) recorre siempre el mismo grafo por mensaje: `extraer → validar → decidir → registrar | esperar_revision | cerrar`, y al final `alertas`. La arista de `decidir` es una función pura de la validación (`rutaTrasValidar`). Así el modelo no puede decidir "hoy no valido", inventar un NIT ni saltarse la confirmación: no tiene herramientas para hacerlo. Cada mensaje devuelve su `recorrido` de nodos y su `desenlace`, y las llamadas `contratos_*` del motor se muestran en el chat anidadas bajo la llamada que las disparó.

**Human-in-the-loop fuera del chat.** Además del chat, el front tiene un **Buzón** (estado de cada correo derivado de `out/`, línea de tiempo de 7 pasos y el correo al lado de la extracción) y una **Bandeja de aprobación**. Ninguna acción de la bandeja tiene lógica de negocio propia: `procesar` es el mismo grafo del motor para un mensaje, y `aprobar` y `rechazar` son la misma reanudación que usa `recepcion_responder_revision` (aprobar llama a `contratos_registrar` con `confirmado: true` y el contrato corregido; rechazar cierra el mensaje como `rechazado`). Todo pasa por las herramientas (zod + `out/log.jsonl`) y cada decisión humana queda en `out/decisiones.jsonl` con quién, cuándo, por qué canal y qué corrigió.

**Reinicio de la demo.** `out/` es global al proceso: en el link público, quien procesa el buzón lo deja procesado para todos. `POST /api/demo/reset` (botón **Reiniciar demo**) borra `out/` (incluidas sesiones y pendientes de confirmación) y vuelve a copiar el maestro del fixture. `AccesoOut` coordina el acceso: turnos del chat y acciones de la bandeja lo comparten y el reinicio lo toma en exclusiva, así que espera a que termine un turno en curso y retiene los nuevos hasta acabar.

## 3. Ciclo del agente

`AgenteContratos.conversar(sessionId, mensaje)` (`api/src/agent/loop.ts`):

1. **Serializa por sesión** (un cerrojo por `sessionId`): dos peticiones simultáneas no intercalan historial.
2. Agrega el mensaje del usuario y carga el prompt de sistema (prompt + conocimiento).
3. **Bucle** hasta `MAX_ITERACIONES` (25): verifica topes de tokens → `proveedor.enviar(mensajes, herramientas recepcion_*)` → si la respuesta no trae llamadas, es la respuesta final; si trae, ejecuta cada una (valida con zod, nunca lanza, escribe `out/log.jsonl`) y agrega los resultados al historial. Los argumentos inválidos y las herramientas fuera de las cinco `recepcion_*` (incluidas las `contratos_*`, que solo llama el motor) vuelven al modelo como `{ ok: false, error }` para que se corrija.
4. **CA1**: si se agota el tope, responde con lo que alcanzó a hacer (cada llamada con su resumen) y lo que falta, e invita a «continúa».
5. **Topes de costo**: tokens por sesión (`MAX_TOKENS_SESION`) y por proceso (`MAX_TOKENS_PROCESO`, para que abrir sesiones nuevas no evada el límite). Al llegar, se corta antes de llamar al modelo con un mensaje claro.
6. **CA5**: un error del proveedor (HTTP, red, timeout por `AbortController`, respuesta bloqueada) o interno vuelve como `reply` legible; el turno siempre cierra con un mensaje del asistente para que la sesión siga siendo válida para el modelo. Antes, el adaptador de Gemini reintenta los fallos transitorios (429, 5xx, red) con espera exponencial acotada (`LLM_REINTENTOS`). Un timeout no se reintenta, para no multiplicar la espera.
7. **CA4**: cada llamada queda en `toolCalls` (nombre, argumentos, ok, resumen, y en `pasos` las `contratos_*` que ejecutó el motor por debajo), en el historial de la sesión (`GET /api/sessions/:id`) y en `out/log.jsonl`. Con `POST /api/chat/stream` el chat las ve **en vivo** (SSE): qué hace el modelo, la herramienta en curso y cada paso del motor apenas termina.
8. **CA2 en el servidor**: la respuesta final del modelo pasa por la guarda de respaldo (`api/src/agent/guardrails/grounding.ts`). Cada id de contrato, id de mensaje, fecha ISO o monto que cite debe aparecer en el prompt, en un mensaje de la analista o en un resultado de herramienta. Si alguno no aparece, la respuesta llega con un aviso que lo nombra y queda `guarda_respaldo` en `out/log.jsonl`.

**Confirmación humana (CA3), determinista y no solo por prompt:**

- Un mensaje queda *pendiente de confirmación* cuando el motor lo deja en el nodo `esperar_revision` (clasificación `nuevo`/`actualizacion` con `requiere_revision` no vacío): `recepcion_procesar_buzon` lo devuelve en `en_revision` con el detalle campo por campo. La pausa la decide el motor, no el modelo. Sale de pendientes cuando `recepcion_responder_revision` lo aprueba o lo rechaza.
- Si el turno deja pendientes nuevos, la respuesta lleva `needsConfirmation: true`; si el texto del modelo no termina en pregunta, el ciclo agrega una pregunta explícita. El front resalta la burbuja y muestra un banner con botón **Confirmo**.
- **Guarda en el servidor** (`api/src/agent/execution.ts`): `recepcion_responder_revision` solo se ejecuta para mensajes que quedaron pendientes **en un turno anterior** de la misma sesión. El modelo no puede aprobar ni rechazar en el mismo turno en que el motor pausó el mensaje, ni sobre uno por el que nunca preguntó: recibe un error y debe preguntar. Tampoco puede llamar a `contratos_registrar` con `confirmado: true` por su cuenta, porque esa herramienta no está en su conjunto.
- Además, `registrar` vuelve a extraer el documento en el servidor: las correcciones que dicta la analista quedan con confianza 1 y la evidencia de quién las fijó, y cualquier otro valor sale del documento.
- **Una sola verdad para chat y bandeja**: `validar` guarda el último análisis de cada mensaje en `out/analisis.json`. Un mensaje *espera confirmación* si ese análisis es `nuevo`/`actualizacion` con campos en revisión y no está en `procesados.json`. Chat y bandeja reanudan la pausa con la misma función, así que lo que el chat deja en revisión aparece en la bandeja y lo que se aprueba o rechaza en cualquiera de los dos sale de ambos. Al empezar cada turno, la sesión descarta los pendientes que ya se cerraron en otro canal, y una confirmación tardía en el chat recibe «ya fue procesado» en lugar de registrar dos veces.
- **La bandeja también cumple CA3**: solo aprueba o rechaza mensajes que esperan confirmación (`409 no_pendiente` si no), con un humano identificado (`aprobador`). Las correcciones se validan con el mismo esquema zod de los campos del contrato y quedan con confianza 1 y evidencia «corregido por …»; el servidor revalida todo antes de escribir.
- Un mensaje ya cerrado no se reevalúa: validarlo de nuevo contra el maestro que él mismo actualizó lo marcaría como duplicado.

Verificado con Gemini real (turnos del PRD §11 y una pregunta): primer turno con **una** llamada del modelo (`recepcion_procesar_buzon`) y 17 pasos del motor (lectura, 6 extracciones, 6 validaciones, 3 registros, alertas), msg-006 en `esperar_revision` y `needsConfirmation: true`; tras «confirmo el valor 0 y la fecha fin 2027-08-31», una llamada a `recepcion_responder_revision` con `correcciones: { valor: 0, fecha_fin: "2027-08-31" }` → `contratos_registrar` confirmado → `insertado CM-2026-03` y alertas regeneradas; «¿cuándo vence CT-2026-009?» → una lectura de `recepcion_consultar_maestro`, sin tocar el motor.

## 4. Elección del modelo

**Google Gemini 2.5 Flash** (`gemini-2.5-flash`) vía REST `generateContent` con `fetch`, `temperature: 0`.

- *Por qué*: function calling sólido con **llamadas paralelas** (extrae o valida varios mensajes en un paso, lo que reduce iteraciones), contexto de 1M tokens, latencia baja y precio bajo; AI Studio ofrece clave gratuita con límites, útil para una demo pública. El modelo no extrae datos (lo hace la herramienta determinista), así que no se necesita un modelo "Pro": su trabajo es orquestar, explicar y preguntar.
- *Alternativas descartadas*: Gemini 2.5 Pro (≈4× el costo y más lento sin mejora visible en orquestación), Claude Sonnet / GPT (buen tool use, pero mayor costo por token para este volumen; cambiarlos es escribir otra clase que implemente `ProveedorLlm`, sin tocar el ciclo).
- *Costo medido* (ejecución real del flujo §11, precios de lista de 2.5 Flash: USD 0.30 por 1M tokens de entrada y USD 2.50 por 1M de salida, salida incluye "thinking"):

| Sesión | Entrada | Salida | Costo aprox. |
|---|---|---|---|
| Procesar buzón (6 mensajes) + confirmar msg-006 + una consulta al maestro | 36.260 | 1.529 | **≈ USD 0.015** |
| Referencia: la versión anterior, en que el modelo llamaba a las `contratos_*` una por una (solo los dos primeros turnos) | 110.618 | 14.309 | ≈ USD 0.069 |

**≈ USD 0.0025 por caso procesado**, unas 5 veces menos que antes. El ahorro viene de la arquitectura: el modelo ya no reenvía el `Contrato` completo a `validar` y `registrar` ni acumula 15 resultados en el historial. Hace una llamada por intención y el motor devuelve un resumen compacto, sin el contrato. Con los topes por defecto, una sesión no puede pasar de 300.000 tokens (≈ USD 0.15) ni el proceso de 3M (≈ USD 1.5).

## 5. Estrategia de extracción

Determinista sobre `contrato.txt` (`api/src/core/extraction/`), sin modelo:

1. **Segmentación**: encabezado, preámbulo, cláusulas (`PRIMERA — OBJETO`, …) y bloque de firmas. **Tipo**: contrato, otrosí u otro (cotización → rechazo RN4).
2. **Partes**: el cliente es la parte rotulada «EL CONTRATANTE» distinta de Periferia (NIT 900123456); la razón social se toma del preámbulo y se busca su forma en el bloque de firmas. NIT sin puntos ni DV (`890.900.111-4` → `890900111`). **País** por tipo de identificador (NIT→CO, RTN→HN, RUC 13→EC, RUC 11→PE) cruzado con el domicilio.
3. **Valor y moneda**: cláusula VALOR; formatos `265.000.000` y `120,000.00`; código ISO explícito. `$` sin código → COP con confianza 0.6. "Por demanda" → `valor = 0`, `valor_indeterminado = true`, confianza 0.5. Moneda fuera de COP/USD/PEN/PAB/HNL → error legible. **Verificación cruzada**: la cifra se contrasta con el valor en letras ("DOSCIENTOS SESENTA Y CINCO MILLONES DE PESOS"); si la cifra o la moneda lo contradicen, ese campo baja a 0.5. Si la cláusula cita varias cifras distintas (cuotas, anticipo, IVA aparte), el valor baja a 0.6 porque la primera puede no ser el total.
4. **Plazo**: fechas en prosa leídas de la cifra entre paréntesis (`primero (1) de agosto de 2026`); plazo en meses → fin inclusivo (`inicio + N meses − 1 día`); si rango y meses no cuadran, `fecha_fin` baja a 0.6; firma solo con mes → inicio día 1 y fin último día del mes N, ambos 0.5.
5. **Póliza**: cláusula de garantías/pólizas; tipos normalizados separados por `;`; garantía condicional por orden de servicio → `requiere_poliza = false` (0.75) con nota.

**Confianza**: niveles fijos por fuerza de la evidencia, no probabilidades: 0.95 explícito y consistente; 0.85–0.9 derivado (fin por meses, objeto truncado); 0.75 inferido (tomado de otra cláusula, interpretación de una garantía condicional, id sin «No.»); 0.5–0.6 ambiguo o contradictorio; `null`/0 si no aparece. Umbral **0.8** (RN5): ningún nivel cae justo en el umbral, así que toda inferencia pasa por revisión humana. Cada campo trae `evidencia` (el fragmento literal).

**Dónde entra el modelo**: decide cuándo consultar y cuándo encender o reanudar el motor, presenta resultados, pregunta y traduce la respuesta de la analista a `recepcion_responder_revision` con sus correcciones. **Dónde no**: no extrae, no clasifica, no elige el camino de un contrato, no calcula alertas ni escribe archivos. Las correcciones que transmite pasan por `contratos_registrar`, que reextrae el documento en el servidor y vuelve a validar antes de escribir.

## 6. Regla de gobierno

**Dueña del maestro**: la **analista administrativa** (rol, no persona), con la **Dirección Administrativa y Financiera** como responsable final y un suplente designado para ausencias. Sin área legal, nadie revisa cláusulas: el maestro registra lo firmado y sus vigencias, no da concepto jurídico.

| # | Regla |
|---|---|
| 1. **Canal único** | `contratos@periferia-ficticia.com`, buzón compartido administrado por la analista administrativa (suplente con acceso). Es el **único** canal válido: un contrato enviado a otra persona se considera no entregado. El agente lee este buzón. |
| 2. **Obligación del comercial** | Enviar **todo** contrato firmado, con o sin póliza: PDF firmado por ambas partes y anexos, cada **otrosí** y cada **acta de terminación o liquidación**, dentro de **3 días hábiles** desde la firma. Un documento por correo, con asunto `CONTRATO \| <cliente> \| <número> \| <NUEVO \| OTROSÍ \| TERMINACIÓN>`. Cuando se constituye la póliza, se envía con el mismo asunto y el tipo `PÓLIZA`. |
| 3. **Acuse automático** | En menos de **1 hora hábil** el agente responde al remitente: radicado (`mensaje_id`), clasificación (nuevo, actualización, duplicado, rechazado), id de contrato registrado y, si aplica, qué falta o qué campos quedaron en revisión. |
| 4. **Excepciones y escalamiento** | *Sin firma*: se rechaza como no vigente y se devuelve al comercial. *Sin valor o por demanda, fechas ambiguas*: se registra solo tras confirmación de la analista con el comercial (caso msg-006). *Remitente no registrado*: se registra con su correo y se pide asignar un comercial responsable. Sin respuesta del comercial en **5 días hábiles** → escala a su **gerente comercial**; en **10 días** → Dirección Administrativa y Financiera. Póliza `pendiente` a los 15 días de la firma → escala al gerente comercial. |
| 5. **Cierre del gap jun–ago 2026** | Campaña única de dos semanas: (a) facturación extrae los clientes y órdenes facturados entre el 2026-05-30 y el 2026-08-31; (b) se cruzan contra el maestro y sale una lista de faltantes por comercial; (c) cada comercial reenvía sus contratos al buzón en 10 días hábiles con asunto normal y prefijo `[GAP-2026]`; (d) el agente los procesa como cualquier otro y quedan en la sección "registrados desde el corte" de las alertas; (e) al cierre, la lista de faltantes que quede se escala a gerencia comercial. |
| 6. **Indicador mensual** | **Cobertura del maestro**: % de contratos con facturación en el mes que existen en el maestro (meta ≥ 95 %). Acompañado de la mediana de días entre firma y registro (meta ≤ 3 días hábiles) y del número de pólizas pendientes con más de 15 días. Lo publica la analista en el comité administrativo mensual. |

## 7. Decisiones y trade-offs

| Decisión | Alternativa descartada | Por qué |
|---|---|---|
| **Ciclo propio + `fetch` a la API REST de Gemini** | LangGraph/LangChain (la versión anterior del repo) o un SDK (Vercel AI SDK, `@google/genai`) | El PRD evalúa el ciclo, el tope de iteraciones y la confirmación: tenerlos en ~200 líneas propias los hace explicables línea por línea y testeables con un proveedor falso. Menos dependencias y ningún comportamiento oculto de reintentos o memoria. Costo: mapear a mano el formato de Gemini (roles, `functionResponse`, `thoughtSignature`). |
| **Extracción determinista como única fuente de valores** | Extracción con el modelo (salida estructurada) | El riesgo principal del PRD es que el modelo "redondee" o invente. Con regex y heurísticas, cada valor tiene evidencia literal y una confianza reproducible; la demo y los tests no necesitan clave. Costo: menos cobertura ante formatos nuevos (se mitiga con revisión humana bajo 0.8). |
| **Dos grafos: recepcionista ReAct con 5 herramientas + motor determinista** | Un solo ReAct con las `contratos_*` (la versión anterior), o 10+ herramientas finas | Con las `contratos_*` expuestas, el modelo podía decidir el orden, saltarse `validar` o reenviar valores alterados, y cada caso costaba 15 llamadas con el contrato completo en el historial. Con cinco herramientas sin reglas de negocio, el camino lo fija el grafo y el modelo solo conversa: menos opciones para equivocarse, ~5× menos tokens y un recorrido auditable por mensaje. Costo: preguntas muy finas ("vuelve a validar solo msg-003") pasan igual por el grafo completo del mensaje. Las `contratos_*` siguen siendo el contrato del PRD para `demo.ts`, el motor y `modulo/`. |
| **CA3 decidido por el motor + guarda en el servidor** | Confiar en que el modelo pregunte (solo prompt) o una herramienta `pedir_confirmacion` | La pausa es un nodo del grafo (`esperar_revision`), así que `needsConfirmation` no depende de que el modelo intente registrar. La guarda impide que el modelo apruebe o rechace sin haber preguntado en un turno anterior. |
| **Proveedor offline con guion determinista** | Solo mocks en tests | Permite probar la app completa sin clave (también en el link si la clave falla) y es el mismo contrato `ProveedorLlm` sobre las mismas cinco herramientas de la recepcionista. Costo: no conversa libremente; responde ayuda fuera del guion. |
| **Sesiones en memoria + JSON en `out/sesiones/`** | Base de datos o Redis | El PRD no pide base de datos y hay un solo proceso. Costo: en el disco efímero del contenedor se pierden al redesplegar. |
| **Front en Vercel + backend en AWS Lightsail Containers** | Imagen única (API + front) en Render; AWS Lambda con Function URL | Lightsail mantiene un proceso siempre encendido, así que la sesión sobrevive entre "procesa el buzón" y "confirmo…" (en Lambda cada invocación puede caer en otra instancia y habría que llevar sesiones y `out/` a S3). Vercel sirve el front estático desde CDN. Costo: dos orígenes, por eso CORS restringido a `CORS_ORIGINS` y `VITE_API_URL` en el build; Lightsail nano cuesta ≈ 7 USD/mes. |
| **Bandeja de aprobación además del chat** | Solo el chat | La analista revisa campo por campo con la evidencia al lado y corrige en un formulario, sin depender de que el modelo traduzca bien «confirmo …». La bandeja no duplica reglas: reanuda la pausa del motor con la misma función que el chat, así que RN5 y la revalidación en el servidor son idénticas. |
| **Estado de revisión derivado de `out/` (`analisis.json` + `procesados.json`)** | Pendientes solo dentro de cada sesión de chat | Con pendientes por sesión, la bandeja no vería lo que dejó el chat y una aprobación en la bandeja no se reflejaría en el chat. Derivarlo de archivos que ya escriben las herramientas da una fuente única. Costo: la guarda CA3 del chat sigue siendo por sesión (el agente debe haber preguntado en esa conversación). |
| **Reinicio de la demo por API con cerrojo lector/escritor** | Redesplegar para limpiar `out/` | El link público es compartido: sin reinicio, el primero que procesa el buzón deja a los demás sin nada que probar. El cerrojo evita borrar `out/` en medio de un turno. |
| **CA2 como aviso del servidor sobre ids, fechas y montos** | Pedirle al modelo que se corrija (otra llamada) o reemplazar la respuesta | Es determinista, no gasta tokens y no esconde el error: la analista ve exactamente qué dato no tiene respaldo. Revisar solo datos con formato reconocible evita falsos positivos en texto libre. Costo: no detecta una fecha en prosa ni una cifra en palabras. |
| **Streaming por SSE sobre `POST` (`/api/chat/stream`)** | WebSocket, o consultar el estado de la sesión cada pocos segundos | El turno es una petición con eventos de ida: SSE alcanza, pasa por proxies y balanceadores sin configuración y se lee con `fetch` (~20 líneas, sin dependencias). `/api/chat` queda intacto como contrato del PRD. Costo: `EventSource` no admite `POST`, así que el front trae su propio lector de SSE. |
| **Render de Markdown propio en el front (subconjunto)** | `react-markdown` + `remark-gfm` | Las respuestas solo usan tablas, títulos, listas, negrita y código; ~100 líneas sin dependencias y sin HTML crudo (React escapa todo, sin superficie de inyección desde el texto del modelo). |
| **Mantener el `Contrato` completo como argumento de `validar`/`registrar`** | Pasar solo `mensaje_id` + correcciones | Es el contrato de herramientas del PRD. Desde que las llama el motor, el contrato lo arma el servidor y el modelo solo envía `mensaje_id` y las correcciones que dictó la analista. El esquema sigue tolerando campos `null` omitidos o `evidencia: null` para quien use `modulo/tools/contratos.ts` directamente. |

**Dependencias** (todas justificadas): `zod` (obligatorio; además genera el JSON Schema que ve el modelo y valida la configuración y la API), `hono` (enrutador HTTP y archivos estáticos sobre Bun, pequeño y tipado), `react`/`react-dom` + `vite` + `@vitejs/plugin-react` (front), `typescript` y `@types/bun` (desarrollo). Sin SDK de LLM.

## 8. Supuestos

**Extracción**

1. Cliente = la parte rotulada «EL CONTRATANTE» distinta de Periferia (NIT 900123456); razón social del preámbulo, forma con mayúsculas/minúsculas del bloque de firmas.
2. NIT sin DV: primer segmento antes del guion, sin puntos. RUC/RTN se dejan como vienen.
3. País por tipo de identificador cruzado con el domicilio: coinciden 0.95, solo uno 0.85, se contradicen 0.5.
4. Fechas en prosa: se usa la cifra entre paréntesis. Una fecha imposible o un mes desconocido es un error legible, no un `null`.
5. Plazo de N meses: fin inclusivo (`inicio + N meses − 1 día`). Si rango y meses no cuadran, `fecha_fin` baja a 0.6.
6. msg-006 (firma solo con mes): inicio = día 1 del mes de firma, fin = último día del mes N (`2027-08-31`), ambos 0.5. Coincide con la confirmación del PRD.
7. Valor por demanda: `valor = 0`, `valor_indeterminado = true`, confianza 0.5; la moneda se toma de otra cláusula que cite un código (0.75, a confirmar).
8. Garantía condicional por orden de servicio (msg-006): `requiere_poliza = false` (0.75, a confirmar) con nota; cada orden se evaluará al llegar. Descartado: `true` + `pendiente`, que generaría una alerta de una póliza que hoy nadie puede constituir.
9. Objeto: texto literal de la cláusula, truncado en palabra a 200 caracteres (0.85 si se trunca); no se resume.
10. Moneda desconocida: un código de 3 letras fuera de COP/USD/PEN/PAB/HNL delante de una cifra en la cláusula de valor es error (salvo siglas como IVA/NIT/RUC).

**Reglas**

11. La confianza nunca viene del llamador: `validar` y `registrar` reextraen en el servidor; un valor cambiado queda en 0.
12. Un otrosí trae solo los campos que modifica; el resto se hereda del maestro con confianza 1. Un otrosí de un contrato ausente se rechaza.
13. Otrosí que amplía el plazo de un contrato con póliza → `estado_poliza = pendiente` (la póliza vigente no cubre el nuevo plazo).
14. Duplicado (RN1) se evalúa antes que actualización. Un otrosí ya aplicado también es duplicado.
15. Conflictos que entran en `requiere_revision`: NIT distinto para el mismo id; mismo NIT + objeto ≥ 0.9 con otro número; NIT conocido con otra razón social; `fecha_fin` < `fecha_inicio`.
16. Rechazado y duplicado son terminales: se marcan en `procesados.json` y salen del buzón sin escribir el maestro.
17. Remitente desconocido: aviso; la columna `comercial` guarda su correo.

**Salidas**

18. Archivo en `Contratos/<año_inicio>/<slug-cliente-sin-sufijo-societario>/<id>.<ext>` (`.txt` en los fixtures). Un otrosí se archiva como `<id>-otrosi-<n>.<ext>`; la fila conserva la ruta del contrato original.
19. Una actualización conserva `fecha_registro`, `fuente` y `comercial` originales.
20. `fecha_registro` = fecha del sistema (la demo y los tests la fijan en 2026-09-03). La fecha de las alertas (`hoy`) la da la analista en el chat.
21. "Vencen en ≤ 60 días" incluye 0–60 días restantes; los ya vencidos no aparecen en esa sección.

**Agente y app**

22. «Confirmo …» cubre todos los campos en revisión que el agente mostró; los valores que la analista dicta reemplazan a los extraídos y el resto queda como lo devolvió `extraer`.
23. Una sola usuaria, sin autenticación (link público); los topes de tokens protegen la clave.
24. `contratos_leer_pdf` (P1 opcional) no se implementó: los fixtures traen texto.

## 9. Cobertura

| Historia | Estado | Qué falta para producción |
|---|---|---|
| HU-1 Leer el buzón | Hecho (chat y pestaña Buzón con estado por correo) | Conector real a Exchange/Graph en lugar de carpetas; leer adjuntos PDF. |
| HU-2 Extraer | Hecho | OCR para escaneos; más formatos de contrato; `contratos_leer_pdf`. |
| HU-3 Validar y clasificar | Hecho | Normalización de razón social más robusta; maestro con más volumen (índices). |
| HU-4 Registrar y archivar | Hecho (confirmación desde el chat o la Bandeja de aprobación) | SharePoint real (Graph API), escrituras transaccionales y bloqueo entre procesos. |
| HU-5 Alertar | Hecho | Envío programado del reporte (correo/Teams) y fecha `hoy` automática. |
| HU-6 Manejo de errores | Hecho (incluye reintentos con espera exponencial ante fallos transitorios de Gemini) | Fallback a otro proveedor ante caídas prolongadas. |

| Regla del ciclo / requisito | Estado | Evidencia |
|---|---|---|
| CA1 tope de iteraciones | Hecho | `MAX_ITERACIONES`; test "CA1". |
| CA2 no afirmar valores sin herramienta | Hecho | Prompt + diseño (el modelo no es fuente de valores) + guarda de respaldo en el servidor, en la app y en Studio, que señala ids, fechas y montos sin respaldo; tests unitarios y de ciclo. Cubre datos con formato reconocible, no frases libres (ver riesgos). |
| CA3 confirmación humana | Hecho | Detección determinista, pregunta forzada, guarda en servidor, banner en el chat y Bandeja de aprobación que comparte la misma verdad; tests de chat ↔ bandeja. |
| Bandeja HITL y reinicio de la demo | Hecho | `/api/buzon`, `/api/bandeja`, `/api/demo/reset`; tests de aprobar con correcciones (msg-006 → valor 0, fin 2027-08-31), rechazar, errores zod y reinicio durante un turno. |
| CA4 llamadas visibles y en log | Hecho | `toolCalls`, historial de sesión, `out/log.jsonl`; test. |
| CA5 errores en lenguaje claro | Hecho | Errores de proveedor, timeout y argumentos; tests. |
| Front, API, adaptador, prompt aparte | Hecho | `web/`, `api/src/http/`, `api/src/llm/`, `agent/prompt.md`. |
| Arranque en un comando | Hecho | `bun run dev` (≈ segundos tras `bun install`). |
| Link público | Hecho | Front en Vercel (<https://reto02-contratos.vercel.app>) y backend en AWS Lightsail; flujo de la sección 11 del PRD probado contra el link con Gemini. |
| Bonus `modulo/` | Hecho | Generado desde las mismas piezas + test de sincronía. |

## 10. Uso de IA

Se usaron **agentes de Cursor con modelos Claude** para:

- **Diagnóstico**: contrastar la versión anterior (LangGraph en `langgraph_app/`, hoy retirada del árbol y disponible en el historial de git) con el PRD y decidir reconstruir sobre un núcleo de herramientas propio.
- **Implementación**: fase 1 (dominio, extractor, reglas, almacenamiento, herramientas, `demo.ts`, pruebas) y fase 2 (adaptador LLM, ciclo del agente, API, front, módulo, despliegue), con commits pequeños y pruebas en cada paso.
- **Verificación**: ejecución real contra Gemini, que destapó dos problemas corregidos: el modelo a veces no intenta `registrar` y solo pregunta (la confirmación pasó a detectarse también desde `validar`), y al reenviar el contrato omite campos `null` o manda `evidencia: null` (el esquema ahora los tolera y el prompt pide reintentar ante argumentos inválidos).
- **Documentación**: este archivo y el README.

Descartado de lo propuesto: mantener LangGraph (más dependencias y comportamiento difícil de defender línea a línea), dejar que el modelo extraiga los campos, `react-markdown` para el chat, y confiar solo en el prompt para la confirmación humana.

> **TODO (candidato)**: completar con tu experiencia personal: qué asistentes usaste además de Cursor, en qué momentos, qué sugerencias rechazaste y por qué, y qué partes reescribiste a mano.

## 11. Riesgos de producción y mitigación

| Riesgo | Mitigación |
|---|---|
| Contratos escaneados o formatos nuevos que la extracción no reconoce. | OCR + extracción asistida por modelo **solo como propuesta**; todo lo bajo 0.8 sigue pasando por revisión humana. Medir % de campos en revisión por mes. |
| El modelo afirma o recalcula un valor de memoria (en una prueba en vivo de la versión anterior actualizó una lista de alertas sin volver a llamar la herramienta). | `recepcion_responder_revision` regenera las alertas tras cada decisión, el modelo no calcula nada y la guarda de respaldo señala todo id, fecha ISO o monto que no salga de herramientas o de la analista. Queda fuera lo que no tiene formato reconocible: fechas en prosa («31 de agosto»), cifras en palabras o conteos pequeños. Siguiente paso: armar las tablas del chat desde `toolCalls` en lugar de texto libre. |
| Inyección de instrucciones desde el texto del contrato o del correo. | Las herramientas son la única vía de escritura, no hay shell ni edición de archivos, y `confirmado` lo controla el servidor. El prompt trata documentos y resultados de herramientas como datos, no como instrucciones. Falta delimitar el texto de documentos en los resultados. |
| Uso del chat para temas ajenos al proceso (cálculos, charla, programación) o intentos de cambiarle el rol. | Guardas en el servidor (`api/src/agent/guardrails/`), no solo en el prompt: reglas deterministas contra manipulación, un clasificador de alcance aislado que falla cerrado y un canario que detecta el volcado del prompt de sistema. Lo bloqueado recibe una respuesta fija, no entra al historial del modelo y queda en `out/log.jsonl`. Falta: métricas de bloqueos y revisión periódica de falsos positivos. |
| Estado compartido en el link público: cualquiera puede procesar, aprobar o reiniciar la demo para todos. | Aceptable para la demo (botón con confirmación). En producción: autenticación, aprobador tomado de la identidad y no de un campo libre, reinicio deshabilitado. |
| Abuso del link público y gasto de la clave. | Topes de iteraciones y tokens por sesión y por proceso; en producción, autenticación (SSO) y límite por IP/usuario. |
| Pérdida de datos: disco efímero, CSV sin transacciones, varios procesos. | Persistir en SharePoint/almacenamiento durable; escritura atómica y bloqueo; respaldo diario del maestro y del historial. |
| Datos personales y comerciales en `out/log.jsonl` y sesiones. | Retención limitada, acceso restringido, no registrar el texto completo del contrato en logs. |
| Caída o latencia del proveedor (≈ 1 minuto por buzón). | Timeout, error claro, reintentos con espera exponencial ante 429/5xx/red y streaming de eventos al chat (la analista ve el avance y los latidos SSE evitan que un proxy corte la conexión) ya implementados. Falta fallback al proveedor offline o a otro modelo vía `ProveedorLlm` ante una caída prolongada. |
| Falsos duplicados por variaciones del nombre del cliente. | Deduplicar por NIT antes que por nombre (ya implementado) y revisar conflictos NIT/razón social. |
| El proceso muere otra vez por rotación. | Regla de gobierno con dueño por rol, suplente, indicador mensual y conocimiento del proceso versionado en el repositorio. |
