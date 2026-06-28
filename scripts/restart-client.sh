#!/bin/bash

# Rendering Client Auto-Restart Wrapper
# Monitors for file changes and restarts gracefully

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLIENT_DIR="$REPO_DIR/rendering-client"
LOG_FILE="$REPO_DIR/rendering-client.log"

CLIENT_PID=""

echo "[STARTUP] Rendering Client Wrapper Started"

restart_client() {
    local is_restart=$1
    local label="STARTUP"
    [ "$is_restart" = "true" ] && label="RESTART"

    echo ""
    echo "=========================================="
    echo "[$(date '+%H:%M:%S')] [$label] Starting Rendering Client..."
    echo "=========================================="

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

    # Initialize all hashes first (use _ suffix to avoid conflicts)
    for file in "${files[@]}"; do
        if [ -f "$file" ]; then
            eval "HASH_$(basename "$file" | tr '.' '_')=$(md5 -q "$file" 2>/dev/null || echo '')"
        fi
    done

    while true; do
        sleep 2

        # Check if client crashed
        if [ -n "$CLIENT_PID" ] && ! kill -0 $CLIENT_PID 2>/dev/null; then
            echo "[$(date '+%H:%M:%S')] [CRASH] Client died, restarting..."
            restart_client true
        fi

        # Check if any file changed
        for file in "${files[@]}"; do
            if [ -f "$file" ]; then
                CURRENT_HASH=$(md5 -q "$file" 2>/dev/null || echo "")
                FILE_NAME=$(basename "$file")
                VAR_NAME="HASH_$(echo "$FILE_NAME" | tr '.' '_')"
                LAST_HASH="${!VAR_NAME}"

                # First run: initialize hash (no restart)
                if [ -z "$LAST_HASH" ]; then
                    eval "$VAR_NAME='$CURRENT_HASH'"
                    echo "[$(date '+%H:%M:%S')] [INIT] $FILE_NAME: ${CURRENT_HASH:0:8}..."
                # File actually changed: restart
                elif [ -n "$CURRENT_HASH" ] && [ "$CURRENT_HASH" != "$LAST_HASH" ]; then
                    echo "[$(date '+%H:%M:%S')] [CHANGE] $FILE_NAME modified, restarting..."
                    eval "$VAR_NAME='$CURRENT_HASH'"

                    # Graceful stop
                    if [ -n "$CLIENT_PID" ] && kill -0 $CLIENT_PID 2>/dev/null; then
                        echo "[$(date '+%H:%M:%S')] [STOP] Stopping Client (PID: $CLIENT_PID)..."
                        kill $CLIENT_PID 2>/dev/null
                        sleep 1
                    fi

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
