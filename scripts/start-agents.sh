#!/usr/bin/env bash
# Start the Agent Manager server.
# Uses the already-running omlx instance if available; starts it if not.
#
# Usage:
#   ./scripts/start-agents.sh
#   PORT=3001 MC_HOST=localhost MC_PORT=25565 ./scripts/start-agents.sh

set -e

cd "$(dirname "$0")/.."

PORT="${PORT:-3001}"
MC_HOST="${MC_HOST:-localhost}"
MC_PORT="${MC_PORT:-25565}"
OMLX_URL="${OMLX_URL:-http://localhost:10000}"
OMLX_KEY="${OMLX_KEY:-omlx}"
OMLX_MODEL="${OMLX_MODEL:-Qwen2.5-Coder-7B-Instruct-MLX-4bit}"

# Start omlx only if not already responding
if curl -sf -H "Authorization: Bearer $OMLX_KEY" "$OMLX_URL/v1/models" > /dev/null 2>&1; then
  echo "omlx already running at $OMLX_URL"
else
  echo "Starting omlx serve..."
  /opt/homebrew/bin/omlx serve &
  OMLX_PID=$!
  echo "  omlx PID: $OMLX_PID"
  # Wait for omlx to be ready
  for i in $(seq 1 30); do
    if curl -sf -H "Authorization: Bearer $OMLX_KEY" "$OMLX_URL/v1/models" > /dev/null 2>&1; then
      echo "  omlx ready."
      break
    fi
    sleep 1
  done
fi

echo "Starting Agent Manager on http://localhost:${PORT} ..."
PORT="$PORT" MC_HOST="$MC_HOST" MC_PORT="$MC_PORT" \
  OMLX_URL="$OMLX_URL" OMLX_KEY="$OMLX_KEY" OMLX_MODEL="$OMLX_MODEL" \
  node bridge/agent-manager.js
