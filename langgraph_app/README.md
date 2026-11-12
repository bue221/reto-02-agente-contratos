# Reto 2 — Agente de contratos

**TypeScript + Bun + LangGraph + Hono + React**

Ver estructura y adapters LLM en [ARCHITECTURE.md](./ARCHITECTURE.md).  
Prompts editables: [`prompts/agent-system.md`](./prompts/agent-system.md).

## Arranque rápido

```bash
# Backend API
cd langgraph_app
bun install
cp .env.example .env   # GOOGLE_API_KEY + LLM_PROVIDER
bun run api            # http://127.0.0.1:8787

# Frontend (otra terminal)
cd ../web
bun install
bun run dev            # http://127.0.0.1:5173  (proxy → API)

# Studio (debug grafos)
cd ../langgraph_app
bun run studio
```

## Scripts

| Comando | Qué hace |
|---------|----------|
| `bun run api` | Backend Hono |
| `bun run web` | Frontend Vite (desde langgraph_app) |
| `bun start` | CLI chat |
| `bun run studio` | LangGraph Studio |
| `bun run smoke:api` | Smoke HTTP |
| `bun run process` | Demo batch determinista |

## LLM intercambiable

```bash
LLM_PROVIDER=gemini    # ChatGoogle
LLM_PROVIDER=offline   # heurístico + planificador tools
LLM_PROVIDER=openai    # stub → completar adapters/llm/stubs.ts
LLM_PROVIDER=anthropic # stub
```

## Frontend (pestañas)

| Pestaña | Qué muestra |
|---------|-------------|
| **Buzón** | Lista de correos con estado; detalle con timeline de 7 pasos, correo + adjunto al lado de lo extraído (confianza por campo) y la tarjeta para decidir. Botón **Analizar todo en orden**. |
| **Bandeja de aprobación** | Tarjetas pendientes (aprobar/corregir/rechazar) + decisiones tomadas |
| **Maestro CSV** | Tabla completa del maestro; filas creadas/modificadas por aprobaciones resaltadas; descarga del CSV |
| **Chat** | Agente conversacional (recomienda, no aprueba) |

## Endpoints principales

| Método | Ruta | Uso |
|--------|------|-----|
| GET | `/v1/buzon` | Contadores + `correos[]` con estado por correo |
| GET | `/v1/buzon/:id` | Correo completo, propuesta, extracción original, timeline y auditoría |
| POST | `/v1/buzon/:id/procesar` | El agente analiza y deja recomendación |
| GET | `/v1/propuestas` · POST `/v1/propuestas/:id/aprobar\|rechazar` | Human-in-the-loop |
| GET | `/v1/contratos` · `/v1/contratos.csv` | Maestro (JSON / descarga CSV) |

## Grafos Studio

| Grafo | Uso |
|-------|-----|
| `pipeline` | El agente recomienda `{ "msgId": "msg-001" }` |
| `resolucion` | El humano decide `{ "msgId": "msg-006", "accion": "aprobar" }` |
| `chat` | ReAct + tools (pestaña Chat) |

Guía: [STUDIO.md](./STUDIO.md)
