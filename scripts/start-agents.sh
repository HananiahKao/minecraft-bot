#!/usr/bin/env bash
# Start the Agent Manager server.
# Agents use the local `claude` CLI (OAuth) for reasoning.
#
# Usage:
#   ./scripts/start-agents.sh
#   PORT=3001 MC_HOST=localhost MC_PORT=25565 CLAUDE_MODEL=sonnet ./scripts/start-agents.sh

set -e

cd "$(dirname "$0")/.."

PORT="${PORT:-3001}"
MC_HOST="${MC_HOST:-localhost}"
MC_PORT="${MC_PORT:-25565}"
CLAUDE_BIN="${CLAUDE_BIN:-claude}"
CLAUDE_MODEL="${CLAUDE_MODEL:-haiku}"

# Verify claude CLI is available
if ! command -v "$CLAUDE_BIN" &>/dev/null; then
  echo "❌ claude CLI not found at '$CLAUDE_BIN'. Make sure Claude Code is installed."
  exit 1
fi

echo "Using claude CLI: $CLAUDE_BIN (model: $CLAUDE_MODEL)"
echo "Starting Agent Manager on http://localhost:${PORT} ..."
PORT="$PORT" MC_HOST="$MC_HOST" MC_PORT="$MC_PORT" \
  CLAUDE_BIN="$CLAUDE_BIN" CLAUDE_MODEL="$CLAUDE_MODEL" \
  node bridge/agent-manager.js
