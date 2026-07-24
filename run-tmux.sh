#!/bin/bash

# Minecraft Bot - TMux Multi-Server Manager
# Runs three servers in separate tmux windows with file-change auto-restart

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SESSION_NAME="minecraft-bot"

# Check that scripts exist
if [ ! -d "$REPO_DIR/scripts" ] || [ ! -f "$REPO_DIR/scripts/restart-minecraft.sh" ]; then
    echo "❌ Error: Scripts directory or restart scripts not found"
    echo "   Expected: $REPO_DIR/scripts/{restart-minecraft.sh, restart-bridge.sh, restart-client.sh}"
    exit 1
fi

# Kill existing session if it exists
tmux kill-session -t $SESSION_NAME 2>/dev/null || true
sleep 1

# Create new tmux session with 3 windows
echo "Creating tmux session: $SESSION_NAME"

# Window 0: Minecraft Server (with file monitoring)
tmux new-session -d -s $SESSION_NAME -n "minecraft" -c "$REPO_DIR"
tmux send-keys -t $SESSION_NAME:minecraft "bash $REPO_DIR/scripts/restart-minecraft.sh" Enter

# Window 1: Bridge Server (with file monitoring)
tmux new-window -t $SESSION_NAME -n "bridge" -c "$REPO_DIR"
tmux send-keys -t $SESSION_NAME:bridge "bash $REPO_DIR/scripts/restart-bridge.sh" Enter

# Window 2: Rendering Client (with file monitoring)
tmux new-window -t $SESSION_NAME -n "client" -c "$REPO_DIR"
tmux send-keys -t $SESSION_NAME:client "bash $REPO_DIR/scripts/restart-client.sh" Enter

# Window 3: Agent Manager (omlx + agent HTTP/WS server on port 3001)
tmux new-window -t $SESSION_NAME -n "agents" -c "$REPO_DIR"
tmux send-keys -t $SESSION_NAME:agents "bash $REPO_DIR/scripts/start-agents.sh" Enter

echo ""
echo "=========================================="
echo "✅ TMux session created: $SESSION_NAME"
echo "=========================================="
echo ""
echo "WINDOWS:"
echo "  tmux attach-session -t $SESSION_NAME:minecraft  # Minecraft Server"
echo "  tmux attach-session -t $SESSION_NAME:bridge     # Bridge Server"
echo "  tmux attach-session -t $SESSION_NAME:client     # Rendering Client"
echo "  tmux attach-session -t $SESSION_NAME:agents     # Agent Manager (http://localhost:3001)"
echo ""
echo "OR attach to full session:"
echo "  tmux attach-session -t $SESSION_NAME"
echo ""
echo "KEYBOARD SHORTCUTS (when attached):"
echo "  Ctrl+B, 0  →  Window 0 (Minecraft)"
echo "  Ctrl+B, 1  →  Window 1 (Bridge)"
echo "  Ctrl+B, 2  →  Window 2 (Client)"
echo "  Ctrl+B, 3  →  Window 3 (Agents)"
echo "  Ctrl+B, d  →  Detach from session"
echo "  Ctrl+B, [  →  Scroll mode (Page Up/Down, then q to exit)"
echo ""
echo "LOG FILES:"
echo "  $REPO_DIR/minecraft-server.log"
echo "  $REPO_DIR/bridge-server.log"
echo "  $REPO_DIR/rendering-client.log"
echo ""
echo "To kill all servers:"
echo "  tmux kill-session -t $SESSION_NAME"
echo ""
