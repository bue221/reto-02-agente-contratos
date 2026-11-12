# Wiki · Agente "Registro de Contratos Vigentes"

Documentación técnica del repositorio: cómo está construido, por qué y cómo cambiarlo sin romper nada. El enunciado está en [`docs/PRD.md`](../PRD.md), las decisiones de la entrega en [`SOLUCION.md`](../../SOLUCION.md) y las reglas para agentes de código en [`AGENTS.md`](../../AGENTS.md).

## En 30 segundos

El maestro de contratos de la empresa está congelado desde el 2026-05-30. Este agente es el **punto único de recepción**: lee un buzón de correos, extrae los datos de cada contrato con una confianza por campo, lo clasifica contra el maestro, registra lo limpio, **pide confirmación humana** para lo dudoso y genera alertas de vencimientos y pólizas.

```mermaid
flowchart LR
  U[Analista] -->|chat o bandeja| W[Front React]
  W -->|HTTP /api| B[Backend Bun + Hono]
  B --> A[Recepcionista: ciclo ReAct]
  A -->|enviar| L[ProveedorLlm: Gemini u offline]
  A -->|5 herramientas recepcion_*| M[Motor determinista]
  M -->|contratos_*| T[Herramientas zod]
  T --> F[(fixtures/ solo lectura)]
  T --> O[(out/ maestro, archivo, logs)]
```

## Diagramas

| Qué muestra | Dónde |
|---|---|
| Capas del sistema y los dos grafos (recepcionista y motor) | [Arquitectura](Architecture.md) |
| Turno del chat, guardas de entrada y salida, pausa humana desde chat, bandeja y Studio | [Ciclo del agente](Agent-Loop.md) |
| Grafos de LangGraph (`recepcionista`, `motor`, `reiniciar_demo`) y cómo se abre Studio desde la web | [LangGraph Studio](Studio.md) |
| Topología en producción, etapas de la imagen, arranque del contenedor y CI/CD | [Despliegue](Deployment.md) |
| Quién escribe y quién lee cada archivo de `out/` | [Datos y almacenamiento](Data-and-Storage.md) |
| Mapa de rutas HTTP y eventos SSE del chat | [API HTTP](API.md) |
| Vistas del front y su cliente de API | [Front](Frontend.md) |
| Clasificación RN1–RN5 y estados de un mensaje | [Reglas de negocio](Business-Rules.md) |
| Pipeline del extractor | [Extracción](Extraction.md) |
| Envoltorio común de herramientas | [Herramientas](Tools.md) |

## Páginas

| Página | Para qué |
|---|---|
| [Primeros pasos](Getting-Started.md) | Instalar, levantar en local, variables de entorno, flujo de la demo. |
| [Arquitectura](Architecture.md) | Capas, dependencias, composición y concurrencia. |
| [Estructura del proyecto](Project-Structure.md) | Qué hay en cada carpeta y archivo. |
| [Ciclo del agente](Agent-Loop.md) | Turno, topes, confirmación humana (CA1–CA5) y sesiones. |
| [Herramientas](Tools.md) | Las `recepcion_*` que ve el modelo y las `contratos_*` del motor: contrato, validación, log y cómo llamarlas. |
| [Extracción](Extraction.md) | Extractor determinista y niveles de confianza. |
| [Reglas de negocio](Business-Rules.md) | RN1–RN7, clasificación, campos efectivos y estados de un mensaje. |
| [Datos y almacenamiento](Data-and-Storage.md) | Fixtures de entrada y cada archivo de `out/`. |
| [API HTTP](API.md) | Endpoints, cuerpos, errores tipados. |
| [Front](Frontend.md) | Pestañas, componentes y cliente de API. |
| [Proveedores LLM](LLM-Providers.md) | Interfaz `ProveedorLlm`, Gemini, offline, cómo agregar otro. |
| [Módulo reutilizable](Agent-Module.md) | `modulo/` (bonus PRD 9.4) y su sincronía. |
| [LangGraph Studio](Studio.md) | `studio/`: los dos grafos en LangGraph.js para verlos y probar la pausa humana en Studio. |
| [Pruebas](Testing.md) | Organización, utilidades y CI. |
| [Despliegue](Deployment.md) | Docker, Vercel + AWS Lightsail, Render. |
| [Contribuir](Contributing.md) | Convenciones, recetas paso a paso y checklist. |
| [Glosario](Glossary.md) | Términos del dominio y equivalencias español ↔ inglés. |

## Enlaces rápidos

- Demo pública: <https://reto02-contratos.vercel.app>
- Comandos: `bun install && bun run dev` · `bun test` · `bun run typecheck` · `bun run demo`
