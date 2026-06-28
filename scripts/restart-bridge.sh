#!/bin/bash

# Bridge Server Auto-Restart Wrapper

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BRIDGE_DIR="$REPO_DIR/bridge"
LOG_FILE="$REPO_DIR/bridge-server.log"

BRIDGE_PID=""
LAST_HASH=""

echo "[STARTUP] Bridge Server Wrapper Started"

kill_port() {
    local pids
    pids=$(lsof -ti :8080 2>/dev/null)
    if [ -n "$pids" ]; then
        echo "[$(date '+%H:%M:%S')] [CLEAN] Killing stale processes on port 8080: $pids"
        echo "$pids" | xargs kill -9 2>/dev/null
        sleep 0.5
    fi
}

restart_bridge() {
    local is_restart=$1
    local label="STARTUP"
    [ "$is_restart" = "true" ] && label="RESTART"

    echo ""
    echo "=========================================="
    echo "[$(date '+%H:%M:%S')] [$label] Starting Bridge Server..."
    echo "=========================================="

    if [ -n "$BRIDGE_PID" ] && kill -0 "$BRIDGE_PID" 2>/dev/null; then
        echo "[$(date '+%H:%M:%S')] [STOP] Stopping Bridge (PID: $BRIDGE_PID)..."
        kill "$BRIDGE_PID" 2>/dev/null
        sleep 1
    fi
    kill_port

    cd "$BRIDGE_DIR"
    npm run dev 2>&1 | tee -a "$LOG_FILE" &
    BRIDGE_PID=$!
    echo "[$(date '+%H:%M:%S')] [OK] Bridge Server started (PID: $BRIDGE_PID)"
}

monitor_files() {
    local file_to_watch="$BRIDGE_DIR/server-bridge.js"

    while true; do
        sleep 2

        if [ -n "$BRIDGE_PID" ] && ! kill -0 "$BRIDGE_PID" 2>/dev/null; then
            echo "[$(date '+%H:%M:%S')] [CRASH] Bridge died, restarting..."
            restart_bridge true
        fi

        if [ -f "$file_to_watch" ]; then
            CURRENT_HASH=$(md5 -q "$file_to_watch" 2>/dev/null || echo "")

            if [ -z "$LAST_HASH" ]; then
                LAST_HASH="$CURRENT_HASH"
                echo "[$(date '+%H:%M:%S')] [INIT] Initialized hash: ${LAST_HASH:0:8}..."
            elif [ -n "$CURRENT_HASH" ] && [ "$CURRENT_HASH" != "$LAST_HASH" ]; then
                echo "[$(date '+%H:%M:%S')] [CHANGE] server-bridge.js modified, restarting..."
                LAST_HASH="$CURRENT_HASH"
                restart_bridge true
            fi
        fi
    done
}

trap "kill $BRIDGE_PID 2>/dev/null; echo '[SHUTDOWN] Bridge stopped'; exit 0" SIGINT SIGTERM

restart_bridge
monitor_files
