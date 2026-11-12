# Arquitectura

```
langgraph_app/
  prompts/                 ← system prompt en Markdown (editable)
    agent-system.md
    agent-help.md
  src/
    domain/                ← tipos + Zod
      types.ts
      schemas.ts
    ports/                 ← interfaces (DIP)
      llm.ts
      mailbox.ts
      audit.ts
    adapters/
      llm/                 ← Gemini | offline | stubs OpenAI/Anthropic
      fixtures-mailbox.ts
      master.ts
      …
    tools/                 ← tools Zod del agente (sin tool de aprobar)
    agent/                 ← grafo chat ReAct
    graph.ts + nodes.ts    ← pipeline: analiza y recomienda
    hitl/                  ← propuestas, grafo `resolucion`, servicio de aprobación
    buzon/vista.ts         ← read model para la UI (estado por correo + timeline)
    api/                   ← Hono REST + chat
web/                       ← frontend Vite/React → consume /v1
  src/views/               ← BuzonView (lista + detalle + timeline), MaestroView (tabla CSV)
  src/PropuestaCard.tsx    ← tarjeta de aprobación y tarjeta post-decisión
```

El estado por correo y el timeline se calculan en el backend (`buzon/vista.ts`) a partir de
propuestas y auditoría; el frontend solo los pinta.

## Proveedor LLM intercambiable

```ts
// LLM_PROVIDER=gemini|offline|openai|anthropic
import { getLlm } from "./adapters/llm";

const { documents, chat, providerId } = getLlm();
await documents.clasificar(correo);   // DocumentLlmPort
chat.createChatModel();               // BaseChatModel | null (LangChain)
```

| Provider | Documentos | Chat |
|----------|------------|------|
| `gemini` | ChatGoogle + structured output | ChatGoogle.bindTools |
| `offline` | Heurístico | Planificador local de tools |
| `openai` / `anthropic` | Stub → heurístico | Stub (completar con `@langchain/openai` / `@langchain/anthropic`) |

El pipeline **siempre** valida con `rules.ts`; el LLM no escribe el maestro.

## Tres entradas

1. **API** `bun run api` → producto para el front  
2. **CLI** `bun start`  
3. **Studio** `bun run studio` → debug de grafos `pipeline` / `chat`

## Frontend

```bash
cd web && bun install && bun run dev   # :5173 (proxy → :8787)
cd langgraph_app && bun run api        # :8787
```
