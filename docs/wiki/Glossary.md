# Glosario

## Dominio

| Término | Significado |
|---|---|
| **Maestro** | Registro de contratos vigentes (CSV), una fila por contrato. El de trabajo vive en `out/sharepoint/`. |
| **Buzón** | Buzón único de recepción de contratos (`contratos@…`), simulado con `fixtures/reto-02/buzon/`. |
| **Bandeja de aprobación** | Lista de mensajes que esperan una decisión humana, fuera del chat. |
| **Otrosí** | Documento que modifica un contrato existente (p. ej. extiende el plazo). |
| **Póliza** | Garantía que exige el contrato (cumplimiento, calidad…). Estados: `vigente`, `pendiente`, `vencida`, `no_aplica`. |
| **NIT / RUC / RTN** | Identificador tributario (Colombia / Ecuador y Perú / Honduras). Se guarda sin puntos ni dígito de verificación. |
| **Comercial** | Persona que cierra el contrato y debe enviarlo al buzón (`comerciales.json`). |
| **Analista administrativa** | Usuaria principal y dueña del maestro. |
| **Corte / gap** | El maestro se congeló el 2026-05-30; lo registrado desde entonces es el "gap cubierto". |
| **Confianza** | Nivel fijo en `[0, 1]` por campo extraído según la fuerza de la evidencia. Umbral 0.8. |
| **Evidencia** | Fragmento literal del documento que respalda un valor. |
| **Requiere revisión** | Campos con confianza < 0.8 o en conflicto con el maestro; bloquean el registro sin confirmación. |
| **HITL** | Human-in-the-loop: confirmación humana antes de escribir lo dudoso. |

## Siglas del PRD

| Sigla | Significado |
|---|---|
| **HU-n** | Historia de usuario (HU-1 leer buzón … HU-6 errores). |
| **RN-n** | Regla de negocio (RN1 duplicado … RN7 log). Ver [Reglas de negocio](Business-Rules.md). |
| **CA-n** | Regla del ciclo del agente (CA1 tope … CA5 errores). Ver [Ciclo del agente](Agent-Loop.md). |
| **P0 / P1** | Prioridad obligatoria / opcional. |

## Español en el código ↔ inglés en las carpetas

Carpetas y archivos están en inglés; identificadores, campos y textos siguen en español (contrato del PRD). Equivalencias:

| Código (es) | Carpeta / archivo (en) |
|---|---|
| agente, ciclo | `api/src/agent/loop.ts` |
| ejecución de llamadas | `api/src/agent/execution.ts` |
| sesiones | `api/src/agent/sessions.ts` |
| herramienta | `api/src/tools/tool.ts` |
| fábrica de proveedores | `api/src/llm/factory.ts` |
| guion / historial / redacción (offline) | `api/src/llm/offline/script.ts`, `history.ts`, `replies.ts` |
| tipos de la API | `api/src/http/types.ts` |
| casos de uso | `api/src/application/use-cases/` |
| leer buzón | `read-mailbox.ts` |
| validar / registrar | `validate.ts` / `register.ts` |
| alertas | `alerts.ts` |
| estado de mensajes | `message-status.ts` |
| vista del buzón | `mailbox-view.ts` |
| línea de tiempo | `timeline.ts` |
| reinicio | `reset-demo.ts` |
| flujo, orquestación | `api/src/application/workflows/` |
| motor determinista / grafo de un mensaje | `application/workflows/` / `contract-graph.ts` |
| pasada del buzón / reanudación tras la pausa | `process-mailbox.ts` / `approval-tray.ts` |
| recepcionista (herramientas del chat) | `tools/recepcion.ts` |
| dominio | `api/src/core/domain/` |
| contrato / maestro / parámetros / resultado / fechas / texto | `contract.ts` / `master.ts` / `parameters.ts` / `result.ts` / `dates.ts` / `text.ts` |
| extracción | `api/src/core/extraction/` |
| documento / partes / valor / plazo / póliza / fechas en texto | `document.ts` / `parties.ts` / `amount.ts` / `term.ts` / `policy.ts` / `prose-dates.ts` |
| reglas | `api/src/core/rules/` |
| clasificar / coincidencia / campos / fila | `classify.ts` / `matching.ts` / `fields.ts` / `master-row.ts` |
| almacén | `api/src/infrastructure/` |
| rutas / archivos / bitácoras / buzón / comerciales | `paths.ts` / `files.ts` / `logs.ts` / `mailbox.ts` / `sales-reps.ts` |
| maestro / análisis / decisiones / acceso a out | `master-store.ts` / `analysis-store.ts` / `decision-store.ts` / `out-lock.ts` |
| apoyo de tests | `api/tests/helpers.ts` |
| Vista Buzón / Bandeja / Maestro / Chat | `MailboxView` / `ApprovalTrayView` / `MasterView` / `ChatView` |
| Tarjeta de propuesta / resolución | `ProposalCard` / `ResolutionCard` |
| Llamada(s) a herramienta | `ToolCall` / `ToolCallList` |
| Texto Markdown | `MarkdownText` |
| cliente de API / formato | `web/src/lib/api.ts` / `format.ts` |
