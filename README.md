# Minecraft Rendering Client

A custom 3D Minecraft rendering client built with Three.js, a mineflayer bridge bot, and an autonomous AI agent system powered by Claude.

## Features

### Implemented
- **3D chunk rendering** — Three.js geometry built from server chunk data, textured with procedural colors
- **Camera-synced movement** — WASD + mouse look; client predicts instantly, bot walks to match
- **Block interaction** — raycasting crosshair, survival hold-to-break, creative instant-break, placement; all four gamemodes (creative, survival, adventure, spectator)
- **Block name HUD** — targeted block name + coordinates shown in status bar
- **Entity rendering** — other players and mobs as colored box models (body + head)
- **Inventory screen** — open/close bag, move items between slots
- **Item entity rendering** — floating rotating cubes for dropped items
- **Autonomous AI agents** — Claude Haiku-powered bots that navigate, dig, and build from a natural language goal
- **Multi-agent manager UI** — spawn, monitor, message, and remove agents at `http://localhost:3001`
- **Agent process isolation** — each agent runs as a detached OS process; restarting the manager does not kill running bots
- **Follow-up messaging** — send mid-goal instructions to a running agent from the UI
- **Goal completion detection** — agent signals when done; UI shows banner + browser notification

### Not Implemented (TODOs)
These are standard Minecraft HUD elements present in the official client but not yet built:

| Feature | Notes |
|---|---|
| ❤️ Health bar | No HP display; bot respawns on death silently |
| 🍗 Hunger/food bar | Food level not shown |
| 🛡️ Armor bar | Equipped armor value not displayed |
| 🫧 Air/bubble bar | Appears when underwater in official client; not implemented |
| 📊 XP bar | Experience points not shown |
| 🗺️ Minimap | No overhead map |
| 💧 Fluid rendering | Water and lava blocks are invisible (transparent) |
| 🌊 Fluid overlay | Blue tint when underwater / orange in lava not rendered |
| ⛏️ Block break animation | No crack-overlay while mining in survival |
| 🌓 Day/night sky | Sky is a static dark blue; no sun/moon/stars cycle |
| 🔊 Sound | No audio at all |
| 🤚 First-person hand | No arm/item model in view |
| 🔧 Tool durability bar | No decay bar on hotbar items |

---

## Architecture

```
┌─────────────────────┐       WebSocket :8080      ┌──────────────────────┐
│  Minecraft Server   │◄─────────────────────────► │  Bridge (mineflayer) │
│  vanilla 1.19.4     │       port 25565           │  server-bridge.js    │
│  offline mode       │                            └──────────┬───────────┘
└─────────────────────┘                                       │ WebSocket :8080
                                                              │
                                              ┌───────────────▼──────────────┐
                                              │  Rendering Client            │
                                              │  Three.js + plain JS         │
                                              │  http://localhost:3000       │
                                              └──────────────────────────────┘

┌─────────────────────┐     HTTP push / proxy      ┌──────────────────────┐
│  Agent Manager      │◄──────────────────────────►│  Agent Runners       │
│  agent-manager.js   │                            │  agent-runner.js ×N  │
│  http://localhost:  │                            │  detached processes  │
│  3001               │                            │  random ports        │
└──────────┬──────────┘                            └──────────────────────┘
           │ WebSocket (live updates)                        │
           │                                     Claude CLI subprocess
    Browser UI                                   (claude --print --model haiku)
    agent-ui/index.html
```

### Components

| Component | Entry point | Port | Description |
|---|---|---|---|
| Minecraft server | `java -jar server.jar nogui` | 25565 | Vanilla 1.19.4, offline mode |
| Bridge | `bridge/server-bridge.js` | 8080 (WS) | mineflayer bot; streams chunks, relays input |
| Rendering client | `rendering-client/server.js` | 3000 (HTTP) | Three.js 3D view in the browser |
| Agent manager | `bridge/agent-manager.js` | 3001 (HTTP+WS) | Spawn/monitor AI agent bots |
| Agent runner | `bridge/agent-runner.js` | random | One per bot; isolated OS process |

### Agent system

Each agent is a separate detached `node` process running `agent-runner.js`. The runner:
1. Connects a second mineflayer bot to the Minecraft server under the agent's name
2. Runs a reasoning loop: observe surroundings → call Claude Haiku → parse tool calls → act
3. Pushes state snapshots to the manager via HTTP POST
4. Exposes a small HTTP API (`GET /state`, `POST /stop`, `POST /message`)

The manager can restart freely — running bots are unaffected. On restart the manager reads `.agents-registry.json` and reconnects to survivors.

Tool calls use a `<tool_call>{...}</tool_call>` text format instructed in the system prompt and parsed by the runner. Available tools: `move_to`, `find_block`, `dig_block`, `place_block`, `get_surroundings`, `chat`, `run_command`.

---

## Prerequisites

- **Java 17+** (for the Minecraft server)
- **Node.js 18+**
- **tmux** (`brew install tmux`)
- **Claude Code CLI** (`claude` in PATH, logged in via OAuth — `claude login`)
- npm packages installed: `cd bridge && npm install` and `cd rendering-client && npm install`

---

## Starting Everything

The canonical way is a single `tmux` session with four windows:

```bash
bash run-tmux.sh
```

Then attach:

```bash
tmux attach-session -t minecraft-bot
```

### tmux window layout

| Window | Name | What runs |
|---|---|---|
| 0 | `minecraft` | Vanilla Minecraft 1.19.4 server |
| 1 | `bridge` | mineflayer bridge bot (port 8080) |
| 2 | `client` | Three.js rendering client (port 3000) |
| 3 | `agents` | Agent Manager (port 3001) |

### tmux keyboard shortcuts

| Keys | Action |
|---|---|
| `Ctrl+B, 0–3` | Switch window |
| `Ctrl+B, d` | Detach (servers keep running) |
| `Ctrl+B, [` | Scroll mode (Page Up/Down, `q` to exit) |

### Starting components individually

```bash
# Minecraft server
java -Xmx2G -Xms512M -jar server.jar nogui

# Bridge (port 8080)
cd bridge && npm run dev

# Rendering client (port 3000)
cd rendering-client && npm run dev
# open http://localhost:3000

# Agent manager (port 3001)
bash scripts/start-agents.sh
# open http://localhost:3001
```

### Agent manager environment variables

```bash
PORT=3001           # HTTP port for manager API + UI
MC_HOST=localhost   # Minecraft server host
MC_PORT=25565       # Minecraft server port
CLAUDE_BIN=claude   # Path to claude CLI binary
CLAUDE_MODEL=haiku  # Claude model (haiku / sonnet / opus)
```

---

## Using the Agent UI

Open `http://localhost:3001` in a browser.

- **Spawn agent** — enter a name (alphanumeric, ≤16 chars) and a natural-language goal, click Spawn
- **Send message** — click an agent card, type in the message bar at the bottom, press Send or Enter
- **Remove agent** — click the × button; the bot disconnects and its process exits
- **Goal complete** — the card shows a ✅ banner and a browser notification fires

---

## Caveats

- **Offline mode only** — the Minecraft server runs without authentication. Real Minecraft accounts are not verified.
- **Single bridge bot** — the rendering client shares one mineflayer bot (username `RenderBot`). Agents each connect as a separate named bot.
- **Agent costs** — each reasoning step calls Claude via your API account. Expect roughly $0.01–0.05 per agent task with Haiku.
- **Agent respawn** — agents do not handle death gracefully; they respawn but may lose context.
- **No chunk unloading** — the renderer accumulates chunks and never frees them; very long sessions use more memory.
- **Fluid blocks invisible** — water and lava render as transparent gaps.
- **Ladders** — bot physics on ladders can be unreliable due to mineflayer edge cases.
- **server.properties** — committed for convenience; adjust `level-seed`, `max-players`, `online-mode`, etc. as needed.
- **Registry file** — `bridge/.agents-registry.json` is runtime state (gitignored). Delete it if stale entries prevent agents from starting.

---

## Log files

| File | Source |
|---|---|
| `minecraft-server.log` | Minecraft server stdout |
| `bridge-server.log` | Bridge bot stdout |
| `rendering-client.log` | Rendering client HTTP server stdout |

---

## Project structure

```
minecraft-bot/
├── bridge/
│   ├── server-bridge.js    # mineflayer bridge (rendering bot)
│   ├── agent-manager.js    # HTTP+WS manager for AI agents
│   ├── agent-runner.js     # per-agent detached process
│   └── agent-bot.js        # AgentBot class (mineflayer + Claude loop)
├── rendering-client/
│   ├── server.js           # static HTTP server
│   └── src/
│       ├── main.js         # Three.js scene, input, HUD
│       ├── renderer.js     # chunk/entity rendering
│       └── worker.js       # Web Worker: chunk mesh building
├── agent-ui/
│   └── index.html          # Agent manager browser UI
├── scripts/
│   ├── restart-minecraft.sh
│   ├── restart-bridge.sh
│   ├── restart-client.sh
│   └── start-agents.sh
├── run-tmux.sh             # canonical start script (tmux session)
├── server.properties       # Minecraft server config
└── goal.md                 # Phase roadmap
```
