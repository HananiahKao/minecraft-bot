#!/bin/bash

# Minecraft Bot - All-in-One Server Starter
# Starts: Minecraft Server, Bridge Server, Rendering Client
# Features: Auto-restart on config changes, separate logs for each server

set -e

REPO_DIR="/Users/hananiah/Desktop/minecraft-bot"
BRIDGE_DIR="$REPO_DIR/bridge"
CLIENT_DIR="$REPO_DIR/rendering-client"

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Process IDs
MC_PID=""
BRIDGE_PID=""
CLIENT_PID=""
MONITOR_PID=""

echo -e "${GREEN}=== Minecraft Bot - Multi-Server Manager ===${NC}"
echo ""

# Cleanup function
cleanup() {
    echo -e "${RED}Shutting down all servers...${NC}"
    kill $MC_PID 2>/dev/null || true
    kill $BRIDGE_PID 2>/dev/null || true
    kill $CLIENT_PID 2>/dev/null || true
    kill $MONITOR_PID 2>/dev/null || true
    echo -e "${RED}All servers stopped.${NC}"
    exit 0
}

trap cleanup SIGINT SIGTERM

# Start Minecraft Server
start_minecraft() {
    echo -e "${BLUE}[Minecraft] Starting server...${NC}"
    cd "$REPO_DIR"
    java -Xmx1024M -Xms512M -jar server.jar nogui > minecraft-server.log 2>&1 &
    MC_PID=$!
    echo -e "${GREEN}[Minecraft] Started (PID: $MC_PID)${NC}"
}

# Start Bridge Server
start_bridge() {
    echo -e "${BLUE}[Bridge] Starting server...${NC}"
    cd "$BRIDGE_DIR"
    npm run dev > "$REPO_DIR/bridge-server.log" 2>&1 &
    BRIDGE_PID=$!
    echo -e "${GREEN}[Bridge] Started (PID: $BRIDGE_PID)${NC}"
}

# Start Rendering Client
start_client() {
    echo -e "${BLUE}[Client] Starting server...${NC}"
    cd "$CLIENT_DIR"
    npm run dev > "$REPO_DIR/rendering-client.log" 2>&1 &
    CLIENT_PID=$!
    echo -e "${GREEN}[Client] Started (PID: $CLIENT_PID)${NC}"
}

# Monitor and restart on config changes
monitor_changes() {
    while true; do
        sleep 2

        # Check if Minecraft config changed
        if [ -f "$REPO_DIR/.minecraft-config-hash" ]; then
            CURRENT_HASH=$(md5 -q "$REPO_DIR/server.properties" 2>/dev/null || echo "")
            STORED_HASH=$(cat "$REPO_DIR/.minecraft-config-hash")
            if [ "$CURRENT_HASH" != "$STORED_HASH" ] && [ -n "$CURRENT_HASH" ]; then
                echo -e "${YELLOW}[Monitor] Minecraft config changed, restarting...${NC}"
                kill $MC_PID 2>/dev/null || true
                sleep 1
                start_minecraft
                echo "$CURRENT_HASH" > "$REPO_DIR/.minecraft-config-hash"
            fi
        else
            md5 -q "$REPO_DIR/server.properties" > "$REPO_DIR/.minecraft-config-hash" 2>/dev/null || true
        fi

        # Check if Bridge config changed
        if [ -f "$BRIDGE_DIR/package.json" ] && [ -f "$REPO_DIR/.bridge-config-hash" ]; then
            CURRENT_HASH=$(md5 -q "$BRIDGE_DIR/server-bridge.js" 2>/dev/null || echo "")
            STORED_HASH=$(cat "$REPO_DIR/.bridge-config-hash")
            if [ "$CURRENT_HASH" != "$STORED_HASH" ] && [ -n "$CURRENT_HASH" ]; then
                echo -e "${YELLOW}[Monitor] Bridge config changed, restarting...${NC}"
                kill $BRIDGE_PID 2>/dev/null || true
                sleep 1
                start_bridge
                echo "$CURRENT_HASH" > "$REPO_DIR/.bridge-config-hash"
            fi
        else
            md5 -q "$BRIDGE_DIR/server-bridge.js" > "$REPO_DIR/.bridge-config-hash" 2>/dev/null || true
        fi

        # Check if Client config changed
        if [ -f "$CLIENT_DIR/src/renderer.js" ] && [ -f "$REPO_DIR/.client-config-hash" ]; then
            CURRENT_HASH=$(md5 -q "$CLIENT_DIR/src/renderer.js" 2>/dev/null || echo "")
            STORED_HASH=$(cat "$REPO_DIR/.client-config-hash")
            if [ "$CURRENT_HASH" != "$STORED_HASH" ] && [ -n "$CURRENT_HASH" ]; then
                echo -e "${YELLOW}[Monitor] Client config changed, restarting...${NC}"
                kill $CLIENT_PID 2>/dev/null || true
                sleep 1
                start_client
                echo "$CURRENT_HASH" > "$REPO_DIR/.client-config-hash"
            fi
        else
            md5 -q "$CLIENT_DIR/src/renderer.js" > "$REPO_DIR/.client-config-hash" 2>/dev/null || true
        fi

        # Check if processes are still running
        if ! kill -0 $MC_PID 2>/dev/null; then
            echo -e "${YELLOW}[Monitor] Minecraft process died, restarting...${NC}"
            start_minecraft
        fi
        if ! kill -0 $BRIDGE_PID 2>/dev/null; then
            echo -e "${YELLOW}[Monitor] Bridge process died, restarting...${NC}"
            start_bridge
        fi
        if ! kill -0 $CLIENT_PID 2>/dev/null; then
            echo -e "${YELLOW}[Monitor] Client process died, restarting...${NC}"
            start_client
        fi
    done
}

# Show logs in real-time (in separate panes if using tmux)
show_logs() {
    echo -e "${GREEN}=== Server Logs ===${NC}"
    echo -e "${BLUE}Minecraft Server: $REPO_DIR/minecraft-server.log${NC}"
    echo -e "${BLUE}Bridge Server:    $REPO_DIR/bridge-server.log${NC}"
    echo -e "${BLUE}Rendering Client: $REPO_DIR/rendering-client.log${NC}"
    echo ""
    echo -e "${YELLOW}To view logs in real-time:${NC}"
    echo "  tail -f $REPO_DIR/minecraft-server.log"
    echo "  tail -f $REPO_DIR/bridge-server.log"
    echo "  tail -f $REPO_DIR/rendering-client.log"
    echo ""
    echo -e "${YELLOW}To stop all servers:${NC}"
    echo "  Press Ctrl+C"
}

# Main execution
echo -e "${GREEN}Starting all servers...${NC}"
echo ""

start_minecraft
sleep 2
start_bridge
sleep 2
start_client

echo ""
show_logs
echo ""
echo -e "${GREEN}All servers are running! Monitoring for config changes...${NC}"
echo ""

monitor_changes
