# syntax=docker/dockerfile:1
# Imagen única: compila web/ y sirve API + front con `bun run start` (un solo proceso).
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

FROM oven/bun:1-slim AS ejecucion
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000
COPY package.json bun.lock ./
COPY api/package.json api/package.json
COPY web/package.json web/package.json
COPY studio/package.json studio/package.json
RUN bun install --frozen-lockfile --production
COPY api/src api/src
COPY agent agent
COPY fixtures fixtures
COPY --from=front /app/web/dist web/dist
RUN mkdir -p out && chown -R bun:bun out
USER bun
EXPOSE 3000
CMD ["bun", "run", "start"]
