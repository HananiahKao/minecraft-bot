#!/bin/bash

# Bridge Server Auto-Restart Wrapper
# Monitors for file changes and restarts gracefully

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BRIDGE_DIR="$REPO_DIR/bridge"
LOG_FILE="$REPO_DIR/bridge-server.log"

BRIDGE_PID=""
LAST_HASH=""

echo "[STARTUP] Bridge Server Wrapper Started"

restart_bridge() {
    local is_restart=$1
    local label="STARTUP"
    [ "$is_restart" = "true" ] && label="RESTART"

    echo ""
    echo "=========================================="
    echo "[$(date '+%H:%M:%S')] [$label] Starting Bridge Server..."
    echo "=========================================="

    cd "$BRIDGE_DIR"
    npm run dev 2>&1 | tee -a "$LOG_FILE" &
    BRIDGE_PID=$!
    echo "[$(date '+%H:%M:%S')] [OK] Bridge Server started (PID: $BRIDGE_PID)"
}

monitor_files() {
    local file_to_watch="$BRIDGE_DIR/server-bridge.js"

    while true; do
        sleep 2

        # Check if bridge crashed
        if [ -n "$BRIDGE_PID" ] && ! kill -0 $BRIDGE_PID 2>/dev/null; then
            echo "[$(date '+%H:%M:%S')] [CRASH] Bridge died, restarting..."
            restart_bridge true
        fi

        # Check if file changed
        if [ -f "$file_to_watch" ]; then
            CURRENT_HASH=$(md5 -q "$file_to_watch" 2>/dev/null || echo "")

            # First run: initialize hash (no restart)
            if [ -z "$LAST_HASH" ]; then
                LAST_HASH="$CURRENT_HASH"
                echo "[$(date '+%H:%M:%S')] [INIT] Initialized hash: ${LAST_HASH:0:8}..."
            # File actually changed: restart
            elif [ -n "$CURRENT_HASH" ] && [ "$CURRENT_HASH" != "$LAST_HASH" ]; then
                echo "[$(date '+%H:%M:%S')] [CHANGE] server-bridge.js modified, restarting..."
                LAST_HASH="$CURRENT_HASH"

                # Graceful stop
                if [ -n "$BRIDGE_PID" ] && kill -0 $BRIDGE_PID 2>/dev/null; then
                    echo "[$(date '+%H:%M:%S')] [STOP] Stopping Bridge (PID: $BRIDGE_PID)..."
                    kill $BRIDGE_PID 2>/dev/null
                    sleep 1
                fi

                restart_bridge true
            fi
        fi
    done
}

trap "kill $BRIDGE_PID 2>/dev/null; echo '[SHUTDOWN] Bridge stopped'; exit 0" SIGINT SIGTERM

restart_bridge
monitor_files
