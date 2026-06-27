#!/bin/bash

# Minecraft Bot - TMux Multi-Server Manager
# Runs three servers in separate tmux windows with logging and auto-restart

REPO_DIR="/Users/hananiah/Desktop/minecraft-bot"
SESSION_NAME="minecraft-bot"

# Kill existing session if it exists
tmux kill-session -t $SESSION_NAME 2>/dev/null || true
sleep 1

# Create new tmux session with 3 windows
echo "Creating tmux session: $SESSION_NAME"

# Window 0: Minecraft Server
tmux new-session -d -s $SESSION_NAME -n "minecraft" -c "$REPO_DIR"
tmux send-keys -t $SESSION_NAME:minecraft "while true; do echo '=== Starting Minecraft Server ===' && java -Xmx1024M -Xms512M -jar server.jar nogui 2>&1 | tee -a minecraft-server.log; echo '!!! Minecraft crashed, restarting in 5s...' && sleep 5; done" Enter

# Window 1: Bridge Server
tmux new-window -t $SESSION_NAME -n "bridge" -c "$REPO_DIR/bridge"
tmux send-keys -t $SESSION_NAME:bridge "while true; do echo '=== Starting Bridge Server ===' && npm run dev 2>&1 | tee -a ../bridge-server.log; echo '!!! Bridge crashed, restarting in 5s...' && sleep 5; done" Enter

# Window 2: Rendering Client
tmux new-window -t $SESSION_NAME -n "client" -c "$REPO_DIR/rendering-client"
tmux send-keys -t $SESSION_NAME:client "while true; do echo '=== Starting Rendering Client ===' && npm run dev 2>&1 | tee -a ../rendering-client.log; echo '!!! Client crashed, restarting in 5s...' && sleep 5; done" Enter

echo ""
echo "=========================================="
echo "✅ TMux session created: $SESSION_NAME"
echo "=========================================="
echo ""
echo "WINDOWS:"
echo "  tmux attach-session -t $SESSION_NAME:minecraft  # Minecraft Server"
echo "  tmux attach-session -t $SESSION_NAME:bridge     # Bridge Server"
echo "  tmux attach-session -t $SESSION_NAME:client     # Rendering Client"
echo ""
echo "OR attach to full session:"
echo "  tmux attach-session -t $SESSION_NAME"
echo ""
echo "KEYBOARD SHORTCUTS (when attached):"
echo "  Ctrl+B, 0  →  Window 0 (Minecraft)"
echo "  Ctrl+B, 1  →  Window 1 (Bridge)"
echo "  Ctrl+B, 2  →  Window 2 (Client)"
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
