# syntax=docker/dockerfile:1
# Imagen única: compila web/ y sirve API + front con `bun run start`. Con LANGGRAPH_URL (por defecto) levanta además
# el servidor de LangGraph de studio/ bajo Node y la API lo publica en /langgraph (ver docker-entrypoint.sh).
# El contexto lo filtra `.dockerignore`.

FROM oven/bun:1 AS dependencias
WORKDIR /app
COPY package.json bun.lock ./
COPY api/package.json api/package.json
COPY web/package.json web/package.json
COPY studio/package.json studio/package.json
RUN bun install --frozen-lockfile

FROM dependencias AS front
COPY api/src/http/types.ts api/src/http/types.ts
COPY web web
RUN bun run build

FROM node:22-bookworm-slim AS node

FROM oven/bun:1-slim AS ejecucion
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    LANGGRAPH_URL=http://127.0.0.1:2024
# El servidor de LangGraph de Studio corre bajo Node 22 (el CLI de LangGraph.js no soporta Bun).
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY package.json bun.lock ./
COPY api/package.json api/package.json
COPY web/package.json web/package.json
COPY studio/package.json studio/package.json
RUN bun install --frozen-lockfile --production
COPY api/src api/src
COPY agent agent
COPY fixtures fixtures
COPY studio/langgraph.json studio/tsconfig.json studio/.gitignore studio/
COPY studio/src studio/src
COPY --from=front /app/web/dist web/dist
COPY --chmod=755 docker-entrypoint.sh ./
# out/ y studio/ (hilos de LangGraph en .langgraph_api/) son los únicos directorios en los que escribe la imagen.
RUN mkdir -p out && chown -R bun:bun out studio
USER bun
EXPOSE 3000
CMD ["./docker-entrypoint.sh"]
