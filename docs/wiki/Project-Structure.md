# Estructura del proyecto

Carpetas y archivos con nombres en inglés; identificadores, campos y textos en español (ver [Glosario](Glossary.md)). Las rutas marcadas con **PRD** las fija el enunciado y no se mueven.

## Raíz

| Ruta | Contenido |
|---|---|
| `AGENTS.md` | Reglas para agentes de código. |
| `README.md` **PRD** | Arranque, variables, API, despliegue. |
| `SOLUCION.md` **PRD** | Planteamiento de la solución (11 secciones del PRD §9.1). |
| `agent/prompt.md` **PRD** | System prompt del agente. |
| `demo.ts` **PRD** | Verificación sin modelo. |
| `.env.example` **PRD** | Variables sin valores. |
| `api/` | Backend (workspace de Bun): `src/`, `tests/`, `scripts/`, `package.json`, `tsconfig.json`. |
| `web/` **PRD** | Front React (workspace de Bun). |
| `package.json`, `bun.lock` | Declaran los workspaces y scripts que delegan en `api/` y `web/`. Bun usa un solo lockfile para todo el monorepo. |
| `modulo/` **PRD** | El agente empaquetado para otras plataformas (bonus PRD §9.4). Ver [Módulo reutilizable](Agent-Module.md). |
| `fixtures/reto-02/` **PRD** | Entrada entregada por el reto. Solo lectura. |
| `out/` **PRD** | Salidas en ejecución (ignorado por git). |
| `docs/` | `PRD.md` y esta wiki. |
| `Dockerfile`, `.dockerignore`, `docker-compose.yml`, `render.yaml` | Imagen única y despliegues. |
| `.github/workflows/backend.yml` | CI: typecheck, sincronía del módulo, tests, demo, imagen + health check. |

## `api/` (backend)

```
api/
├── package.json               dependencias (hono, zod) y scripts: dev, start, test, typecheck, sync:module
├── tsconfig.json              incluye src/, tests/, scripts/, ../modulo y ../demo.ts
├── scripts/sync-module.ts     genera modulo/agent.md y SKILL.md
├── tests/                     ver más abajo
└── src/
```

La raíz del proyecto para leer y escribir archivos (`config.directorio`, `ctx.directory`) es la carpeta del repositorio, no `api/`: `fixtures/`, `out/`, `agent/` y `web/dist` se resuelven desde ahí.

```
api/src/
├── server.ts                  arranque: compone dependencias y sirve API + front compilado
├── config.ts                  variables de entorno validadas con zod → Configuracion
├── knowledge/
│   └── registro-contratos.md  conocimiento del proceso (PRD)
├── tools/
│   ├── contratos.ts           las 5 herramientas, su registro y ejecutarHerramienta (PRD)
│   └── tool.ts                definirHerramienta: zod + ejecutar sin lanzar + log; ContextoHerramienta
├── agent/
│   ├── loop.ts                AgenteContratos: ciclo del turno, topes, cierre con needsConfirmation
│   ├── execution.ts           ejecutarLlamada: guarda CA3 y anotación de confirmaciones del chat
│   ├── model-tools.ts         definiciones que ve el modelo (JSON Schema desde zod)
│   ├── prompt.ts              lee agent/prompt.md + conocimiento en cada turno
│   ├── sessions.ts            SesionesEnArchivo (memoria + out/sesiones/) y CerrojoPorSesion
│   └── module-bundle.ts       contenido esperado de modulo/agent.md y SKILL.md
├── llm/
│   ├── adapter.ts             interfaz ProveedorLlm y tipos de mensajes (PRD)
│   ├── factory.ts             crearProveedor(config): único punto que conoce las implementaciones
│   ├── gemini.ts              ProveedorGemini: REST generateContent con fetch
│   ├── offline.ts             ProveedorOffline: guion determinista, 0 tokens
│   └── offline/
│       ├── script.ts          siguientePaso(historial): qué herramientas llamar o qué responder
│       ├── history.ts         lectura del historial (ejecuciones previas, último mensaje del usuario)
│       └── replies.ts         redacción de respuestas con datos de herramientas
├── http/
│   ├── app.ts                 crearApp: health, chat, sesiones, maestro, CORS, front estático, 404/500
│   ├── hitl.ts                buzón, bandeja, descarga CSV y reinicio de la demo
│   ├── helpers.ts             errores tipados, leerCuerpo (zod), responder (código → HTTP)
│   └── types.ts               tipos compartidos con el front
├── application/
│   ├── use-cases/
│   │   ├── read-mailbox.ts    HU-1: mensajes no procesados
│   │   ├── message.ts         cargar un mensaje y extraer su adjunto
│   │   ├── validate.ts        HU-3: reextraer, clasificar, guardar análisis, cerrar terminales
│   │   ├── register.ts        HU-4: revalidar, exigir confirmación, escribir fila, archivar, historial
│   │   ├── alerts.ts          HU-5: out/alertas.md (vencimientos, pólizas, registrados desde el corte)
│   │   ├── message-status.ts  estado de cada mensaje derivado de out/ (una sola verdad)
│   │   ├── mailbox-view.ts    vistas de solo lectura del buzón, detalle y bandeja
│   │   ├── timeline.ts        los 7 pasos de un correo para el detalle del buzón
│   │   └── reset-demo.ts      vacía out/ y vuelve a copiar el maestro
│   └── workflows/
│       ├── process-mailbox.ts pasada extraer → validar → registrar (demo.ts, tests, botón Analizar)
│       └── approval-tray.ts   procesar, aprobar con correcciones y rechazar desde la bandeja
├── core/
│   ├── domain/
│   │   ├── contract.ts        ContratoSchema (campo = valor + confianza + evidencia), Correcciones
│   │   ├── master.ts          FilaMaestro, países, monedas, estados de póliza, fuentes
│   │   ├── parameters.ts      parámetros de negocio
│   │   ├── result.ts          Resultado<T>, exito, fallo, mensajeDeError
│   │   ├── dates.ts           fechas ISO en UTC: sumar meses/días, validar
│   │   └── text.ts            normalizar, similitud, slug del cliente, sufijos societarios
│   ├── extraction/
│   │   ├── extractor.ts       extraerContrato(texto): orquesta los extractores
│   │   ├── document.ts        segmentar en preámbulo, cláusulas y firmas; detectar tipo
│   │   ├── parties.ts         cliente, NIT y país
│   │   ├── amount.ts          valor y moneda
│   │   ├── term.ts            fechas de inicio y fin (plazo en meses)
│   │   ├── policy.ts          requiere_poliza y tipo_poliza
│   │   └── prose-dates.ts     fechas escritas en prosa legal
│   └── rules/
│       ├── classify.ts        clasificar(): RN1–RN5, revisiones, diferencias
│       ├── matching.ts        buscarCoincidencia(): por id o por NIT + objeto ≥ 0.9
│       ├── fields.ts          camposEfectivos(): confianza recalculada contra el documento
│       └── master-row.ts      construirFila(), id AUTO, estado de póliza, cambiosEntre()
└── infrastructure/
    ├── paths.ts               rutasDelProyecto() y segmentoSeguro()
    ├── files.ts               lectura opcional, escritura atómica, JSONL tolerante
    ├── csv.ts                 CSV RFC 4180 mínimo
    ├── mailbox.ts             correo.json y adjuntos del buzón
    ├── sales-reps.ts          comerciales.json y resolución del remitente
    ├── master-store.ts        maestro de trabajo: copia inicial (RN6), leer, guardar fila
    ├── logs.ts                procesados.json, historial.jsonl, log.jsonl, archivar documento
    ├── analysis-store.ts      analisis.json: último análisis por mensaje
    ├── decision-store.ts      decisiones.jsonl: decisiones humanas
    └── out-lock.ts            AccesoOut: cerrojo lector/escritor de out/
```

## `web/` (front)

```
web/
├── index.html, vite.config.ts, vercel.json, tsconfig.json, package.json
└── api/src/
    ├── main.tsx               monta App y los estilos
    ├── App.tsx                barra lateral, pestañas, aprobador, reinicio, refresco de datos
    ├── views/
    │   ├── MailboxView.tsx     Buzón: lista, analizar, detalle con línea de tiempo y extracción
    │   ├── ApprovalTrayView.tsx Bandeja: pendientes editables y decisiones tomadas
    │   ├── MasterView.tsx      Maestro CSV con filas resaltadas y descarga
    │   └── ChatView.tsx        Chat: turnos, llamadas a herramientas, banner de confirmación
    ├── components/
    │   ├── ProposalCard.tsx    ProposalCard (aprobar/rechazar con correcciones) y ResolutionCard
    │   ├── ToolCallList.tsx    ToolCall y ToolCallList
    │   └── MarkdownText.tsx    render de Markdown propio (tablas, listas, títulos, código)
    ├── lib/
    │   ├── api.ts              cliente único de la API + tipos reexportados de api/src/http/types.ts
    │   └── format.ts           etiquetas, formatos de valores y fechas, mensajes de error
    └── styles/
        ├── global.css
        └── chat.css
```

## `api/tests/`

```
api/tests/
├── helpers.ts                 proyecto temporal con copia de fixtures, utilidades de lectura
├── unit/
│   ├── extraction.test.ts     extractor y utilidades (13)
│   └── llm.test.ts            adaptador Gemini y selección de proveedor (8)
└── integration/
    ├── tools.test.ts          herramientas, buzón completo, RN5, alertas, zod (21)
    ├── agent.test.ts          ciclo con offline y proveedores falsos, CA1–CA5 (13)
    ├── api.test.ts            API del chat, errores, CORS (9)
    ├── approval-tray.test.ts  buzón, bandeja, chat ↔ bandeja, reinicio (16)
    └── module.test.ts         sincronía de modulo/ (4)
```

## `modulo/`

```
modulo/
├── agent.md                         generado desde agent/prompt.md
├── tools/contratos.ts               reexporta api/src/tools/contratos.ts
└── skill/registro-contratos/SKILL.md generado desde api/src/knowledge/registro-contratos.md
```
