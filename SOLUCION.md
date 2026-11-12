# SOLUCION · Agente "Registro de Contratos Vigentes"

## 1. Problema en una frase

Desde el 30 de mayo de 2026 nadie alimenta el maestro de contratos y solo llegan los que requieren póliza, así que **la analista administrativa** (dueña del maestro) no sabe qué está vigente, **gerencia** no puede responder qué vence este trimestre y **la empresa** asume el riesgo de pólizas exigidas que nadie constituye.

## 2. Arquitectura

```
┌──────────────────────┐  POST /api/chat     ┌──────────────────────────────────────────────┐
│ Front React (web/)   │ ──────────────────▶ │ Backend Bun + Hono (src/server.ts, src/api/) │
│ - historial          │ ◀────────────────── │  AgenteContratos (src/agente/ciclo.ts)       │
│ - tool calls         │  { reply, toolCalls,│   prompt → ProveedorLlm.enviar → llamadas    │
│ - banner confirmar   │    needsConfirmation}│   → ejecutarHerramienta → … → respuesta      │
│ - panel maestro      │  GET /api/maestro   │  ProveedorLlm: Gemini (fetch) | Offline       │
└──────────────────────┘                     │  Sesiones: memoria + out/sesiones/<id>.json   │
                                             └──────────────┬───────────────────────────────┘
                                                            │ herramientas contratos_* (zod)
                                       ┌────────────────────┴────────────────────┐
                                       ▼                                         ▼
                          fixtures/reto-02/ (solo lectura)          out/ (escritura)
                          buzon/, maestro-contratos.csv,            sharepoint/maestro-contratos.csv,
                          comerciales.json                          sharepoint/Contratos/…, historial.jsonl,
                                                                    procesados.json, log.jsonl, alertas.md
```

| Pieza | Dónde vive | Regla |
|---|---|---|
| **Comportamiento** | `agent/prompt.md` | Qué hace el agente, qué no puede afirmar, cuándo pregunta, formato de respuesta. |
| **Conocimiento** | `src/knowledge/registro-contratos.md` | RN1–RN7, esquema, umbral 0.8, alertas, supuestos y resumen de gobierno. Se anexa al prompt de sistema. |
| **Ejecución** | `src/tools/contratos.ts` (+ `src/extraccion`, `src/reglas`, `src/casos`, `src/almacen`) | Única fuente de valores. Importable desde `demo.ts`, los tests y `modulo/` sin el servidor. |
| **Parámetros de negocio** | `src/dominio/parametros.ts` | Umbral, similitud, fecha de corte, ventana de alertas. |

El prompt y el conocimiento **se leen en cada turno**: cambiar una regla del proceso no toca ni reinicia el servidor. El servidor solo compone dependencias (`src/server.ts`) y expone HTTP (`src/api/app.ts`); el ciclo solo conoce la interfaz `ProveedorLlm`.

## 3. Ciclo del agente

`AgenteContratos.conversar(sessionId, mensaje)` (`src/agente/ciclo.ts`):

1. **Serializa por sesión** (un cerrojo por `sessionId`): dos peticiones simultáneas no intercalan historial.
2. Agrega el mensaje del usuario y carga el prompt de sistema (prompt + conocimiento).
3. **Bucle** hasta `MAX_ITERACIONES` (25): verifica topes de tokens → `proveedor.enviar(mensajes, herramientas)` → si la respuesta no trae llamadas, es la respuesta final; si trae, ejecuta cada una con `ejecutarHerramienta` (valida con zod, nunca lanza, escribe `out/log.jsonl`) y agrega los resultados al historial. Los argumentos inválidos y las herramientas inexistentes vuelven al modelo como `{ ok: false, error }` para que se corrija.
4. **CA1**: si se agota el tope, responde con lo que alcanzó a hacer (cada llamada con su resumen) y lo que falta, e invita a «continúa».
5. **Topes de costo**: tokens por sesión (`MAX_TOKENS_SESION`) y por proceso (`MAX_TOKENS_PROCESO`, para que abrir sesiones nuevas no evada el límite). Al llegar, se corta antes de llamar al modelo con un mensaje claro.
6. **CA5**: un error del proveedor (HTTP, red, timeout por `AbortController`, respuesta bloqueada) o interno vuelve como `reply` legible; el turno siempre cierra con un mensaje del asistente para que la sesión siga siendo válida para el modelo.
7. **CA4**: cada llamada queda en `toolCalls` (nombre, argumentos, ok, resumen), en el historial de la sesión (`GET /api/sessions/:id`) y en `out/log.jsonl`.

**Confirmación humana (CA3), determinista y no solo por prompt:**

- Un mensaje queda *pendiente de confirmación* si `contratos_validar` devuelve `requiere_revision` no vacío para un `nuevo`/`actualizacion`, o si `contratos_registrar` responde `requiere revisión: …`. Sale de pendientes cuando `registrar` tiene éxito.
- Si el turno deja pendientes nuevos, la respuesta lleva `needsConfirmation: true`; si el texto del modelo no termina en pregunta, el ciclo agrega una pregunta explícita. El front resalta la burbuja y muestra un banner con botón **Confirmo**.
- **Guarda en el servidor** (`src/agente/ejecucion.ts`): `registrar` con `confirmado: true` solo se ejecuta para mensajes que quedaron pendientes **en un turno anterior**. El modelo no puede autoconfirmar en el mismo turno en que detecta la duda: recibe un error y debe preguntar.
- Además, `registrar` vuelve a extraer el documento en el servidor: si el modelo cambia un valor, ese campo queda con confianza 0 y solo pasa con `confirmado: true`.

Verificado con Gemini real (dos turnos del PRD §11): primer turno con 15 llamadas (lectura, 5 extracciones, 5 validaciones, 3 registros, alertas), msg-006 sin registrar y `needsConfirmation: true`; tras «confirmo el valor 0 y la fecha fin 2027-08-31», una llamada a `registrar` con `confirmado: true` → `insertado CM-2026-03`.

## 4. Elección del modelo

**Google Gemini 2.5 Flash** (`gemini-2.5-flash`) vía REST `generateContent` con `fetch`, `temperature: 0`.

- *Por qué*: function calling sólido con **llamadas paralelas** (extrae o valida varios mensajes en un paso, lo que reduce iteraciones), contexto de 1M tokens, latencia baja y precio bajo; AI Studio ofrece clave gratuita con límites, útil para una demo pública. El modelo no extrae datos (lo hace la herramienta determinista), así que no se necesita un modelo "Pro": su trabajo es orquestar, explicar y preguntar.
- *Alternativas descartadas*: Gemini 2.5 Pro (≈4× el costo y más lento sin mejora visible en orquestación), Claude Sonnet / GPT (buen tool use, pero mayor costo por token para este volumen; cambiarlos es escribir otra clase que implemente `ProveedorLlm`, sin tocar el ciclo).
- *Costo medido* (ejecución real del flujo §11, precios de lista de 2.5 Flash: USD 0.30 por 1M tokens de entrada y USD 2.50 por 1M de salida, salida incluye "thinking"):

| Turno | Entrada | Salida | Costo aprox. |
|---|---|---|---|
| Procesar buzón (6 mensajes) | 72.432 | 13.043 | USD 0.054 |
| Confirmar msg-006 | 38.186 | 1.266 | USD 0.015 |
| **Total** | **110.618** | **14.309** | **≈ USD 0.069** |

**≈ USD 0.012 por caso procesado** (unos 18.000 tokens de entrada por caso). La entrada domina porque cada iteración reenvía el historial, incluido el `Contrato` que el modelo devuelve completo a `validar` y `registrar` (contrato de herramientas del PRD). Con los topes por defecto, una sesión no puede pasar de 300.000 tokens (≈ USD 0.15) ni el proceso de 3M (≈ USD 1.5).

## 5. Estrategia de extracción

Determinista sobre `contrato.txt` (`src/extraccion/`), sin modelo:

1. **Segmentación**: encabezado, preámbulo, cláusulas (`PRIMERA — OBJETO`, …) y bloque de firmas. **Tipo**: contrato, otrosí u otro (cotización → rechazo RN4).
2. **Partes**: el cliente es la parte rotulada «EL CONTRATANTE» distinta de Periferia (NIT 900123456); la razón social se toma del preámbulo y se busca su forma en el bloque de firmas. NIT sin puntos ni DV (`890.900.111-4` → `890900111`). **País** por tipo de identificador (NIT→CO, RTN→HN, RUC 13→EC, RUC 11→PE) cruzado con el domicilio.
3. **Valor y moneda**: cláusula VALOR; formatos `265.000.000` y `120,000.00`; código ISO explícito. `$` sin código → COP con confianza 0.6. "Por demanda" → `valor = 0`, `valor_indeterminado = true`, confianza 0.5. Moneda fuera de COP/USD/PEN/PAB/HNL → error legible.
4. **Plazo**: fechas en prosa leídas de la cifra entre paréntesis (`primero (1) de agosto de 2026`); plazo en meses → fin inclusivo (`inicio + N meses − 1 día`); si rango y meses no cuadran, `fecha_fin` baja a 0.6; firma solo con mes → inicio día 1 y fin último día del mes N, ambos 0.5.
5. **Póliza**: cláusula de garantías/pólizas; tipos normalizados separados por `;`; garantía condicional por orden de servicio → `requiere_poliza = false` (0.8) con nota.

**Confianza**: niveles fijos por fuerza de la evidencia, no probabilidades: 0.95 explícito y consistente; 0.85–0.9 derivado (fin por meses, objeto truncado); 0.8 tomado de otra cláusula; 0.5–0.6 ambiguo o contradictorio; `null`/0 si no aparece. Umbral **0.8** (RN5). Cada campo trae `evidencia` (el fragmento literal).

**Dónde entra el modelo**: orquesta las herramientas, presenta resultados, pregunta y traduce la respuesta de la analista a una llamada con `confirmado: true` (y valores corregidos). **Dónde no**: no extrae, no clasifica, no calcula alertas ni escribe archivos. Cualquier valor que proponga pasa por `validar`/`registrar`, que reextraen en el servidor y le asignan confianza 0 si difiere del documento.

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
| **CA3 detectado por resultados de herramientas + guarda en el servidor** | Confiar en que el modelo pregunte (solo prompt) o una herramienta `pedir_confirmacion` | La prueba en vivo mostró que el modelo a veces no intenta `registrar` y solo pregunta: detectar por `validar`/`registrar` hace `needsConfirmation` fiable, y la guarda impide autoconfirmar. Una herramienta extra dependería igual de que el modelo la llame. |
| **Proveedor offline con guion determinista** | Solo mocks en tests | Permite probar la app completa sin clave (también en el link si la clave falla) y es el mismo contrato `ProveedorLlm`. Costo: no conversa libremente; responde ayuda fuera del guion. |
| **Sesiones en memoria + JSON en `out/sesiones/`** | Base de datos o Redis | El PRD no pide base de datos y hay un solo proceso. Costo: en un disco efímero (Render free) se pierden al reiniciar. |
| **Render de Markdown propio en el front (subconjunto)** | `react-markdown` + `remark-gfm` | Las respuestas solo usan tablas, títulos, listas, negrita y código; ~100 líneas sin dependencias y sin HTML crudo (React escapa todo, sin superficie de inyección desde el texto del modelo). |
| **Mantener el `Contrato` completo como argumento de `validar`/`registrar`** | Pasar solo `mensaje_id` + correcciones | Es el contrato de herramientas del PRD. Costo: más tokens y el modelo puede omitir campos `null`; se mitigó con valores por defecto en el esquema (los errores de validación además vuelven al modelo, que se corrige). |

**Dependencias** (todas justificadas): `zod` (obligatorio; además genera el JSON Schema que ve el modelo y valida la configuración y la API), `hono` (enrutador HTTP y archivos estáticos sobre Bun, pequeño y tipado), `react`/`react-dom` + `vite` + `@vitejs/plugin-react` (front), `typescript` y `@types/bun` (desarrollo). Sin SDK de LLM.

## 8. Supuestos

**Extracción**

1. Cliente = la parte rotulada «EL CONTRATANTE» distinta de Periferia (NIT 900123456); razón social del preámbulo, forma con mayúsculas/minúsculas del bloque de firmas.
2. NIT sin DV: primer segmento antes del guion, sin puntos. RUC/RTN se dejan como vienen.
3. País por tipo de identificador cruzado con el domicilio: coinciden 0.95, solo uno 0.85, se contradicen 0.5.
4. Fechas en prosa: se usa la cifra entre paréntesis. Una fecha imposible o un mes desconocido es un error legible, no un `null`.
5. Plazo de N meses: fin inclusivo (`inicio + N meses − 1 día`). Si rango y meses no cuadran, `fecha_fin` baja a 0.6.
6. msg-006 (firma solo con mes): inicio = día 1 del mes de firma, fin = último día del mes N (`2027-08-31`), ambos 0.5. Coincide con la confirmación del PRD.
7. Valor por demanda: `valor = 0`, `valor_indeterminado = true`, confianza 0.5; la moneda se toma de otra cláusula que cite un código (0.8).
8. Garantía condicional por orden de servicio (msg-006): `requiere_poliza = false` (0.8) con nota; cada orden se evaluará al llegar. Descartado: `true` + `pendiente`, que generaría una alerta de una póliza que hoy nadie puede constituir.
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
| HU-1 Leer el buzón | Hecho | Conector real a Exchange/Graph en lugar de carpetas; leer adjuntos PDF. |
| HU-2 Extraer | Hecho | OCR para escaneos; más formatos de contrato; `contratos_leer_pdf`. |
| HU-3 Validar y clasificar | Hecho | Normalización de razón social más robusta; maestro con más volumen (índices). |
| HU-4 Registrar y archivar | Hecho | SharePoint real (Graph API), escrituras transaccionales y bloqueo entre procesos. |
| HU-5 Alertar | Hecho | Envío programado del reporte (correo/Teams) y fecha `hoy` automática. |
| HU-6 Manejo de errores | Hecho | Reintentos con backoff ante fallos transitorios del proveedor. |

| Regla del ciclo / requisito | Estado | Evidencia |
|---|---|---|
| CA1 tope de iteraciones | Hecho | `MAX_ITERACIONES`; test "CA1". |
| CA2 no afirmar valores sin herramienta | Parcial | Prompt + diseño (el modelo no es fuente de valores); un modelo aún puede resumir de memoria (ver riesgos). |
| CA3 confirmación humana | Hecho | Detección determinista, pregunta forzada, guarda en servidor, banner en el front; tests. |
| CA4 llamadas visibles y en log | Hecho | `toolCalls`, historial de sesión, `out/log.jsonl`; test. |
| CA5 errores en lenguaje claro | Hecho | Errores de proveedor, timeout y argumentos; tests. |
| Front, API, adaptador, prompt aparte | Hecho | `web/`, `src/api/`, `src/llm/`, `agent/prompt.md`. |
| Arranque en un comando | Hecho | `bun run dev` (≈ segundos tras `bun install`). |
| Link público | Pendiente | Blueprint de Render y Dockerfile listos; falta desplegar. |
| Bonus `modulo/` | Hecho | Generado desde las mismas piezas + test de sincronía. |

## 10. Uso de IA

Se usaron **agentes de Cursor con modelos Claude** para:

- **Diagnóstico**: contrastar la versión anterior (LangGraph en `langgraph_app/`) con el PRD y decidir reconstruir sobre un núcleo de herramientas propio.
- **Implementación**: fase 1 (dominio, extractor, reglas, almacenamiento, herramientas, `demo.ts`, pruebas) y fase 2 (adaptador LLM, ciclo del agente, API, front, módulo, despliegue), con commits pequeños y pruebas en cada paso.
- **Verificación**: ejecución real contra Gemini, que destapó dos problemas corregidos: el modelo a veces no intenta `registrar` y solo pregunta (la confirmación pasó a detectarse también desde `validar`), y omite campos `null` al reenviar el contrato (valores por defecto en el esquema).
- **Documentación**: este archivo y el README.

Descartado de lo propuesto: mantener LangGraph (más dependencias y comportamiento difícil de defender línea a línea), dejar que el modelo extraiga los campos, `react-markdown` para el chat, y confiar solo en el prompt para la confirmación humana.

> **TODO (candidato)**: completar con tu experiencia personal: qué asistentes usaste además de Cursor, en qué momentos, qué sugerencias rechazaste y por qué, y qué partes reescribiste a mano.

## 11. Riesgos de producción y mitigación

| Riesgo | Mitigación |
|---|---|
| Contratos escaneados o formatos nuevos que la extracción no reconoce. | OCR + extracción asistida por modelo **solo como propuesta**; todo lo bajo 0.8 sigue pasando por revisión humana. Medir % de campos en revisión por mes. |
| El modelo afirma o recalcula un valor de memoria (en la prueba en vivo actualizó una lista de alertas sin volver a llamar la herramienta). | Regla en el prompt; validar en el servidor que cifras e ids de la respuesta existan en resultados de herramientas del turno; tablas renderizadas desde `toolCalls` en lugar de texto libre. |
| Inyección de instrucciones desde el texto del contrato o del correo. | Las herramientas son la única vía de escritura, no hay shell ni edición de archivos, y `confirmado` lo controla el servidor. Delimitar el texto de documentos en los resultados. |
| Abuso del link público y gasto de la clave. | Topes de iteraciones y tokens por sesión y por proceso; en producción, autenticación (SSO) y límite por IP/usuario. |
| Pérdida de datos: disco efímero, CSV sin transacciones, varios procesos. | Persistir en SharePoint/almacenamiento durable; escritura atómica y bloqueo; respaldo diario del maestro y del historial. |
| Datos personales y comerciales en `out/log.jsonl` y sesiones. | Retención limitada, acceso restringido, no registrar el texto completo del contrato en logs. |
| Caída o latencia del proveedor (≈ 1 minuto por buzón). | Timeout y error claro ya implementados; agregar streaming de eventos al front, reintentos con backoff y fallback al proveedor offline o a otro modelo vía `ProveedorLlm`. |
| Falsos duplicados por variaciones del nombre del cliente. | Deduplicar por NIT antes que por nombre (ya implementado) y revisar conflictos NIT/razón social. |
| El proceso muere otra vez por rotación. | Regla de gobierno con dueño por rol, suplente, indicador mensual y conocimiento del proceso versionado en el repositorio. |
