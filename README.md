# Minecraft Rendering Client

A custom 3D Minecraft rendering client built with Three.js, a mineflayer bridge bot, and an autonomous AI agent system powered by Claude.

## Features

### Implemented
- **3D chunk rendering** — Three.js geometry built from server chunk data, using real per-block models/textures (`block_models.json`, baked from vanilla assets) with flat procedural colors only as a fallback before that data loads or for unmapped blocks
- **Fluid rendering** — water, glass, ice, and similar blocks render as real translucent geometry (not invisible gaps), in a separate transparent render pass
- **Camera-synced movement** — WASD + mouse look; client predicts instantly, bot walks to match
- **Block interaction** — voxel-grid DDA raycasting crosshair (deterministic, no triangle-seam flicker), with liquid pass-through and real per-block selection shapes (e.g. ladders) instead of full-cube approximation; survival hold-to-break with crack-stage overlay, creative instant-break, placement; all four gamemodes (creative, survival, adventure, spectator)
- **Block name HUD** — targeted block name + coordinates shown in status bar
- **Vitals HUD** — health, hunger/food, armor, air/bubble bar (shown while in water), and XP bar, built from vanilla's own GUI sprites
- **Entity rendering** — other players and mobs rendered with real bone/box models and extracted vanilla textures (falls back to a plain colored box body+head when a mob has no usable texture)
- **Entity interaction** — attacking mobs; trading with villagers/wandering traders via a real trade-selection UI
- **Inventory / chest / window screens** — open/close, move items between slots, real item icons, tool durability bar on slots (see Known issues below for one gap)
- **Item entity rendering** — floating rotating cubes for dropped items, textured when an icon is available
- **Mobile/touch controls** — on-screen D-pad, look-drag, and action buttons on touch devices (iPad/phone)
- **Chunk unloading** — chunks outside render radius are freed, not just accumulated
- **Autonomous AI agents** — Claude Haiku-powered bots that navigate, dig, and build from a natural language goal
- **Multi-agent manager UI** — spawn, monitor, message, and remove agents at `http://localhost:3001`
- **Agent process isolation** — each agent runs as a detached OS process; restarting the manager does not kill running bots
- **Follow-up messaging** — send mid-goal instructions to a running agent from the UI
- **Goal completion detection** — agent signals when done; UI shows banner + browser notification

### Not Implemented (TODOs)
These are standard Minecraft client elements not yet built, or built incompletely:

| Feature | Notes |
|---|---|
| 🗺️ Minimap | No overhead map |
| 🌊 Fluid overlay | No blue tint when the camera is underwater / orange tint in lava — fluids render, but there's no screen-space overlay for being inside one |
| 🤚 First-person hand | No arm/held-item model in view |
| 🔊 Sound | No audio at all |
| 🌓 Day/night sky | Sky is a static sky-blue color + fog; no sun/moon/stars or day/night cycle |
| 🔧 Tool durability bar (partial) | Shown on hotbar/inventory/chest slots, but not on the item while it's being dragged (held on the cursor between clicks) — `makeItemVisual()` in `item-icon.js` only draws the icon/name, the durability overlay is added separately by each slot's own render code, and the cursor-drag render path never adds it |

---

## Known issues

- **Camera faces a fixed direction on every page load/reconnect**, regardless of which way the bot was actually facing. This is a rendering-client bug, not a Minecraft-server artifact: `InputHandler` (`rendering-client/src/input.js`) always constructs with `_yaw = 0, _pitch = 0`, and the bridge never sends the bot's current look direction for the client to sync against on connect — there's simply no code path that reads the bot's actual yaw/pitch into the camera. Fixing this means having the bridge include `bot.entity.yaw`/`pitch` in its spawn/connect message and having `main.js` apply it to `inputHandler` before the first frame.

---

## Architecture

```
┌─────────────────────┐       WebSocket :8080      ┌──────────────────────┐
│  Minecraft Server   │◄─────────────────────────► │  Bridge (mineflayer) │
│  vanilla 1.21.9     │       port 25565           │  server-bridge.js    │
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
| Minecraft server | `java -jar server.jar nogui` | 25565 | Vanilla 1.21.9, offline mode |
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
| 0 | `minecraft` | Vanilla Minecraft 1.21.9 server |
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
│   ├── chunk-worker.js     # Worker thread: BFS visibility flood-fill
│   ├── agent-manager.js    # HTTP+WS manager for AI agents
│   ├── agent-runner.js     # per-agent detached process
│   └── agent-bot.js        # AgentBot class (mineflayer + Claude loop)
├── rendering-client/
│   ├── server.js           # static HTTP server
│   └── src/
│       ├── main.js            # Three.js scene, input, HUD wiring
│       ├── renderer.js        # chunk/entity rendering + block raycast (DDA)
│       ├── chunk-worker.js    # Web Worker: chunk mesh building
│       ├── block-model.js     # resolves vanilla block_models.json variants
│       ├── block-shapes.js    # liquid/selection-shape data for raycasting
│       ├── entity-manager.js  # mob/player/item entity rendering
│       ├── mob-model.js       # real bone/box mob models + UV unwrap
│       ├── input.js           # keyboard/mouse/touch input → controls
│       ├── mobile.js          # touch control overlay
│       ├── connection.js      # WebSocket client to the bridge
│       ├── inventory.js       # player inventory screen
│       ├── window-screen.js   # chest/villager/other window screens
│       ├── item-icon.js       # shared item icon/durability helpers
│       └── vitals-hud.js      # health/food/armor/air/XP HUD
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
