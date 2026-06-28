#!/bin/bash

# Minecraft Server Auto-Restart Wrapper
# Only restarts on crashes (config monitoring disabled due to file mutation)

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_FILE="$REPO_DIR/minecraft-server.log"

MC_PID=""

echo "[STARTUP] Minecraft Server Wrapper Started"

restart_minecraft() {
    local is_restart=$1
    local label="STARTUP"
    [ "$is_restart" = "true" ] && label="RESTART"

    echo ""
    echo "=========================================="
    echo "[$(date '+%H:%M:%S')] [$label] Starting Minecraft Server..."
    echo "=========================================="

    # Clean up old session lock if it exists
    rm -f "$REPO_DIR/world/session.lock" 2>/dev/null || true
    sleep 1

    cd "$REPO_DIR"
    java -Xmx1024M -Xms512M -jar server.jar nogui 2>&1 | tee -a "$LOG_FILE" &
    MC_PID=$!
    echo "[$(date '+%H:%M:%S')] [OK] Minecraft Server started (PID: $MC_PID)"
}

monitor_crashes() {
    while true; do
        sleep 5

        # Check if server crashed
        if [ -n "$MC_PID" ] && ! kill -0 $MC_PID 2>/dev/null; then
            echo "[$(date '+%H:%M:%S')] [CRASH] Minecraft died, restarting in 3s..."
            sleep 3
            restart_minecraft true
        fi
    done
}

trap "kill $MC_PID 2>/dev/null; echo '[SHUTDOWN] Minecraft stopped'; exit 0" SIGINT SIGTERM

restart_minecraft
monitor_crashes
