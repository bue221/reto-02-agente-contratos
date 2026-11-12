# syntax=docker/dockerfile:1
# Imagen única: compila el front y sirve API + front con `bun run start` (un solo proceso).
# El contexto lo filtra `Dockerfile.dockerignore` (BuildKit lo prefiere sobre `.dockerignore`).

FROM oven/bun:1 AS dependencias
WORKDIR /app
COPY package.json bun.lock ./
COPY web/package.json web/package.json
RUN bun install --frozen-lockfile

FROM dependencias AS front
COPY src/api/tipos.ts src/api/tipos.ts
COPY web web
RUN bun run build

FROM oven/bun:1-slim AS ejecucion
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000
COPY package.json bun.lock ./
COPY web/package.json web/package.json
RUN bun install --frozen-lockfile --production
COPY src src
COPY agent agent
COPY fixtures fixtures
COPY --from=front /app/web/dist web/dist
RUN mkdir -p out && chown -R bun:bun out
USER bun
EXPOSE 3000
CMD ["bun", "run", "start"]
