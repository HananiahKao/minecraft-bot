#!/bin/bash

# Rendering Client Auto-Restart Wrapper

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLIENT_DIR="$REPO_DIR/rendering-client"
LOG_FILE="$REPO_DIR/rendering-client.log"

CLIENT_PID=""

echo "[STARTUP] Rendering Client Wrapper Started"

kill_port() {
    local pids
    pids=$(lsof -ti :3000 2>/dev/null)
    if [ -n "$pids" ]; then
        echo "[$(date '+%H:%M:%S')] [CLEAN] Killing stale processes on port 3000: $pids"
        echo "$pids" | xargs kill -9 2>/dev/null
        sleep 0.5
    fi
}

restart_client() {
    local is_restart=$1
    local label="STARTUP"
    [ "$is_restart" = "true" ] && label="RESTART"

    echo ""
    echo "=========================================="
    echo "[$(date '+%H:%M:%S')] [$label] Starting Rendering Client..."
    echo "=========================================="

    if [ -n "$CLIENT_PID" ] && kill -0 "$CLIENT_PID" 2>/dev/null; then
        echo "[$(date '+%H:%M:%S')] [STOP] Stopping Client (PID: $CLIENT_PID)..."
        kill "$CLIENT_PID" 2>/dev/null
        sleep 1
    fi
    kill_port

    cd "$CLIENT_DIR"
    npm run dev 2>&1 | tee -a "$LOG_FILE" &
    CLIENT_PID=$!
    echo "[$(date '+%H:%M:%S')] [OK] Rendering Client started (PID: $CLIENT_PID)"
}

monitor_files() {
    local files=(
        "$CLIENT_DIR/src/main.js"
        "$CLIENT_DIR/src/renderer.js"
        "$CLIENT_DIR/src/connection.js"
        "$CLIENT_DIR/src/input.js"
        "$CLIENT_DIR/server.js"
        "$CLIENT_DIR/index.html"
    )

    for file in "${files[@]}"; do
        if [ -f "$file" ]; then
            eval "HASH_$(basename "$file" | tr '.' '_')=$(md5 -q "$file" 2>/dev/null || echo '')"
        fi
    done

    while true; do
        sleep 2

        if [ -n "$CLIENT_PID" ] && ! kill -0 "$CLIENT_PID" 2>/dev/null; then
            echo "[$(date '+%H:%M:%S')] [CRASH] Client died, restarting..."
            restart_client true
        fi

        for file in "${files[@]}"; do
            if [ -f "$file" ]; then
                CURRENT_HASH=$(md5 -q "$file" 2>/dev/null || echo "")
                FILE_NAME=$(basename "$file")
                VAR_NAME="HASH_$(echo "$FILE_NAME" | tr '.' '_')"
                LAST_HASH="${!VAR_NAME}"

                if [ -z "$LAST_HASH" ]; then
                    eval "$VAR_NAME='$CURRENT_HASH'"
                elif [ -n "$CURRENT_HASH" ] && [ "$CURRENT_HASH" != "$LAST_HASH" ]; then
                    echo "[$(date '+%H:%M:%S')] [CHANGE] $FILE_NAME modified, restarting..."
                    eval "$VAR_NAME='$CURRENT_HASH'"
                    restart_client true
                    break
                fi
            fi
        done
    done
}

trap "kill $CLIENT_PID 2>/dev/null; echo '[SHUTDOWN] Client stopped'; exit 0" SIGINT SIGTERM

restart_client
monitor_files
