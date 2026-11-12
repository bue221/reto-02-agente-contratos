# Backend API (Bun + Hono). Build context = raíz del repo, porque la API lee fixtures/reto-02:
#   docker build -f langgraph_app/Dockerfile -t agente-contratos-api .

ARG BUN_VERSION=1.4.4

FROM oven/bun:${BUN_VERSION}-slim AS deps
WORKDIR /app/langgraph_app
COPY langgraph_app/package.json langgraph_app/bun.lock ./
RUN bun install --production --frozen-lockfile

FROM oven/bun:${BUN_VERSION}-slim AS runtime
ENV NODE_ENV=production \
    ROOT_DIR=/app \
    OUT_DIR=/app/data \
    API_PORT=8787 \
    LLM_PROVIDER=auto
WORKDIR /app/langgraph_app

COPY --chown=bun:bun fixtures/reto-02 /app/fixtures/reto-02
COPY --from=deps --chown=bun:bun /app/langgraph_app/node_modules ./node_modules
COPY --chown=bun:bun langgraph_app/package.json langgraph_app/tsconfig.json ./
COPY --chown=bun:bun langgraph_app/prompts ./prompts
COPY --chown=bun:bun langgraph_app/src ./src

# OUT_DIR guarda maestro, auditoría y propuestas; en AWS montar EFS aquí para que sobreviva a reinicios.
RUN mkdir -p /app/data && chown bun:bun /app/data
VOLUME ["/app/data"]

USER bun
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["bun", "-e", "fetch(`http://127.0.0.1:${process.env.API_PORT}/health`).then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]

CMD ["bun", "run", "src/api/server.ts"]
