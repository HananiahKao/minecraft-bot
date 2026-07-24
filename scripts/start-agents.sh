#!/usr/bin/env bash
# Start the Agent Manager server.
# Agents connect to the same MC server as the bridge.
#
# Usage:
#   ./scripts/start-agents.sh
#   PORT=3001 MC_HOST=localhost MC_PORT=25565 ./scripts/start-agents.sh

set -e

cd "$(dirname "$0")/.."

PORT="${PORT:-3001}"
MC_HOST="${MC_HOST:-localhost}"
MC_PORT="${MC_PORT:-25565}"
OMLX_URL="${OMLX_URL:-http://localhost:8000}"
OMLX_MODEL="${OMLX_MODEL:-lmstudio-community/Qwen2.5-Coder-7B-Instruct-MLX-4bit}"

echo "Starting omlx serve in background..."
/opt/homebrew/bin/omlx serve --model "$OMLX_MODEL" &
OMLX_PID=$!
echo "  omlx PID: $OMLX_PID"

# Give omlx a moment to start
sleep 2

echo "Starting Agent Manager on http://localhost:${PORT} ..."
PORT="$PORT" MC_HOST="$MC_HOST" MC_PORT="$MC_PORT" \
  OMLX_URL="$OMLX_URL" OMLX_MODEL="$OMLX_MODEL" \
  node bridge/agent-manager.js &
MANAGER_PID=$!
echo "  Manager PID: $MANAGER_PID"

echo ""
echo "Agent UI: http://localhost:${PORT}"
echo "Press Ctrl+C to stop."

trap "kill $OMLX_PID $MANAGER_PID 2>/dev/null; exit 0" INT TERM
wait $MANAGER_PID
