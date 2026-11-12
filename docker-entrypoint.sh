#!/bin/sh
# Arranque de la imagen. Con LANGGRAPH_URL, además de la API levanta el servidor de LangGraph de studio/ escuchando
# solo en la interfaz local (en el puerto de esa URL); la API lo publica en /langgraph. Si ese servidor se cae, la app
# sigue atendiendo y /langgraph responde 502. Con LANGGRAPH_URL vacío, solo arranca la API.
set -eu

if [ -n "${LANGGRAPH_URL:-}" ]; then
  puerto="${LANGGRAPH_URL%/}"
  puerto="${puerto##*:}"
  LANGGRAPH_CLI_NO_ANALYTICS=1 BROWSER=none \
    bun run --cwd studio studio --host 127.0.0.1 --port "$puerto" --no-browser --no-reload &
fi

exec bun run start
