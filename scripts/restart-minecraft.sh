#!/bin/bash

# Minecraft Server Auto-Restart Wrapper
# - Restarts on crash
# - Restarts when server.properties changes (hash recorded AFTER server
#   finishes loading so the server's own startup writes don't false-trigger)

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_FILE="$REPO_DIR/minecraft-server.log"
HASH_FILE="$REPO_DIR/.mc-props-hash"

MC_PID=""

echo "[STARTUP] Minecraft Server Wrapper Started"

kill_port() {
    local pids
    pids=$(lsof -ti :25565 2>/dev/null)
    if [ -n "$pids" ]; then
        echo "[$(date '+%H:%M:%S')] [CLEAN] Killing stale processes on port 25565: $pids"
        echo "$pids" | xargs kill -9 2>/dev/null
        sleep 0.5
    fi
}

start_minecraft() {
    local label="${1:-STARTUP}"

    echo ""
    echo "=========================================="
    echo "[$(date '+%H:%M:%S')] [$label] Starting Minecraft Server..."
    echo "=========================================="

    # Gracefully stop existing process if running
    if [ -n "$MC_PID" ] && kill -0 "$MC_PID" 2>/dev/null; then
        echo "[$(date '+%H:%M:%S')] [STOP] Stopping server (SIGTERM)..."
        kill "$MC_PID" 2>/dev/null || true
        local waited=0
        while kill -0 "$MC_PID" 2>/dev/null && [ $waited -lt 15 ]; do
            sleep 1; waited=$((waited+1))
        done
        # Force-kill if still running after 15s
        kill -9 "$MC_PID" 2>/dev/null || true
    fi
    kill_port

    rm -f "$REPO_DIR/world/session.lock" 2>/dev/null || true
    sleep 1

    cd "$REPO_DIR"
    java -Xmx1024M -Xms512M -jar server.jar nogui 2>&1 | tee -a "$LOG_FILE" &
    MC_PID=$!
    echo "[$(date '+%H:%M:%S')] [OK] Minecraft Server started (PID: $MC_PID)"

    # Wait until server finishes loading before snapshotting server.properties.
    # The server rewrites server.properties during startup — if we snapshot too
    # early we'll get a false-positive change on the next poll.
    echo "[$(date '+%H:%M:%S')] [WATCH] Waiting for server ready..."
    local waited=0
    while [ $waited -lt 60 ]; do
        if tail -n 20 "$LOG_FILE" 2>/dev/null | grep -q "Done ("; then
            break
        fi
        sleep 2; waited=$((waited+2))
    done
    md5 -q "$REPO_DIR/server.properties" > "$HASH_FILE" 2>/dev/null || \
        md5sum "$REPO_DIR/server.properties" | cut -d' ' -f1 > "$HASH_FILE" 2>/dev/null || true
    echo "[$(date '+%H:%M:%S')] [WATCH] Watching server.properties for changes"
}

monitor() {
    while true; do
        sleep 3

        # Crash detection
        if [ -n "$MC_PID" ] && ! kill -0 "$MC_PID" 2>/dev/null; then
            echo "[$(date '+%H:%M:%S')] [CRASH] Minecraft died, restarting in 3s..."
            sleep 3
            start_minecraft RESTART
            continue
        fi

        # server.properties change detection
        if [ -f "$HASH_FILE" ]; then
            local cur
            cur=$(md5 -q "$REPO_DIR/server.properties" 2>/dev/null || \
                  md5sum "$REPO_DIR/server.properties" 2>/dev/null | cut -d' ' -f1)
            local stored
            stored=$(cat "$HASH_FILE")
            if [ -n "$cur" ] && [ "$cur" != "$stored" ]; then
                echo "[$(date '+%H:%M:%S')] [CONFIG] server.properties changed — restarting..."
                start_minecraft RESTART
            fi
        fi
    done
}

trap "echo '[SHUTDOWN] Stopping...'; kill $MC_PID 2>/dev/null; rm -f '$HASH_FILE'; exit 0" SIGINT SIGTERM

start_minecraft
monitor
