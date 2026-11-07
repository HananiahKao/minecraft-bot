#!/bin/bash

# Minecraft Server Auto-Restart Wrapper
# - Runs java in the foreground (via `wait`) so its console/TUI stdin stays
#   attached to this pane — you can type server commands directly.
# - Restarts on crash (detected the instant `wait` returns, no polling).
# - Restarts when server.properties changes (hash recorded AFTER server
#   finishes loading so the server's own startup writes don't false-trigger).
# - Refuses to run two copies of itself: if a previous instance (even an
#   orphaned one with no terminal, e.g. left over from a killed tmux
#   session) is still alive, it is killed before this one takes over.

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_FILE="$REPO_DIR/minecraft-server.log"
HASH_FILE="$REPO_DIR/.mc-props-hash"
LOCK_FILE="$REPO_DIR/.restart-minecraft.pid"
JAVA_PID_FILE="$REPO_DIR/.mc-java.pid"
RESTARTING_FLAG="$REPO_DIR/.mc-restarting"

MC_PID=""

echo "[STARTUP] Minecraft Server Wrapper Started"

# --- Singleton guard ---------------------------------------------------
# Two of these running at once is what caused the original restart loop:
# each one's kill_port()/session.lock cleanup fought the other's java
# process. Killing a tmux session doesn't reach a copy that already got
# reparented to init, so check by PID/lock file instead.
if [ -f "$LOCK_FILE" ]; then
    old_pid=$(cat "$LOCK_FILE" 2>/dev/null)
    if [ -n "$old_pid" ] && kill -0 "$old_pid" 2>/dev/null && \
       ps -p "$old_pid" -o command= 2>/dev/null | grep -q "restart-minecraft.sh"; then
        echo "[$(date '+%H:%M:%S')] [LOCK] Killing previous watchdog (PID: $old_pid)"
        kill -9 "$old_pid" 2>/dev/null || true
    fi
fi
echo $$ > "$LOCK_FILE"

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

    # Block config_watcher's comparisons until the hash is resynced below.
    # The server rewrites server.properties (new timestamp, etc.) early in
    # every boot, well before "Done" — without this flag, config_watcher's
    # independent 3s poll sees that self-inflicted rewrite as an external
    # change and kills the server mid-boot, every single cycle, forever.
    touch "$RESTARTING_FLAG"

    # Any previous java for this repo should already be dead by the time
    # we get here (the main loop only calls start_minecraft after `wait`
    # returns), but clean up defensively in case something external is
    # still squatting on the port.
    kill_port

    rm -f "$REPO_DIR/world/session.lock" 2>/dev/null || true
    sleep 1

    cd "$REPO_DIR"
    # Process substitution (not a pipe) for the tee, so $! below captures
    # java's own PID, not tee's. `tee` only ever sees java's stdout/stderr
    # here — it is never on the stdin path either way.
    #
    # The explicit `< /dev/tty` matters for a different reason: bash
    # redirects a backgrounded command's stdin to /dev/null whenever job
    # control is off (the default in a non-interactive script) UNLESS the
    # command has its own explicit input redirection. Backgrounding java
    # with `&` is required so we can capture $! and `wait` on it, but
    # without this it silently cuts java off from the pane's tty, so
    # nothing you type ever reaches the server console.
    java -Xmx1024M -Xms512M -jar server.jar nogui < /dev/tty &> >(tee -a "$LOG_FILE") &
    MC_PID=$!
    echo "$MC_PID" > "$JAVA_PID_FILE"
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
    rm -f "$RESTARTING_FLAG"
    echo "[$(date '+%H:%M:%S')] [WATCH] Watching server.properties for changes"
}

# Runs alongside the foreground server and nudges it to restart when
# server.properties changes, by signaling the PID in JAVA_PID_FILE. This
# is the only other thing allowed to touch the running java process —
# everything else just waits on it.
config_watcher() {
    while true; do
        sleep 3
        [ -f "$RESTARTING_FLAG" ] && continue
        [ -f "$HASH_FILE" ] && [ -f "$JAVA_PID_FILE" ] || continue

        local cur stored pid
        cur=$(md5 -q "$REPO_DIR/server.properties" 2>/dev/null || \
              md5sum "$REPO_DIR/server.properties" 2>/dev/null | cut -d' ' -f1)
        stored=$(cat "$HASH_FILE")
        if [ -n "$cur" ] && [ "$cur" != "$stored" ]; then
            pid=$(cat "$JAVA_PID_FILE" 2>/dev/null)
            echo "[$(date '+%H:%M:%S')] [CONFIG] server.properties changed — restarting..."
            [ -n "$pid" ] && kill "$pid" 2>/dev/null
        fi
    done
}

cleanup() {
    echo "[SHUTDOWN] Stopping..."
    [ -n "$MC_PID" ] && kill "$MC_PID" 2>/dev/null
    [ -n "$CONFIG_WATCHER_PID" ] && kill "$CONFIG_WATCHER_PID" 2>/dev/null
    rm -f "$HASH_FILE" "$LOCK_FILE" "$JAVA_PID_FILE" "$RESTARTING_FLAG"
    exit 0
}
trap cleanup SIGINT SIGTERM

start_minecraft

config_watcher &
CONFIG_WATCHER_PID=$!

while true; do
    wait "$MC_PID"
    echo "[$(date '+%H:%M:%S')] [EXIT] Minecraft server process exited, restarting in 3s..."
    sleep 3
    start_minecraft RESTART
done
