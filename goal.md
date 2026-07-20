# Project Goal: Minecraft Rendering Client

## Ultimate Vision
Build a 3D Minecraft rendering client that behaves like the official Minecraft client — respecting server authority for all gameplay rules.

## Core Principle
**Server is authoritative. Client is responsive.**
- Server decides gamemode, allowed actions, physics
- Client displays the world and sends player input
- Client adapts UI/behavior based on server's gamemode

## Four-Phase Roadmap

### Phase 1 ✅
Three.js rendering foundation with test cube

### Phase 2 ✅  
WebSocket bridge to Mineflayer bot for chunk streaming

### Phase 2.5 ✅
Bot movement synchronized with camera
- Camera moves instantly (client prediction)
- Bot walks to catch up (server validation)
- Respawns at spawn if it dies
- Goal: Infinite exploration that works on survival AND creative servers

### Phase 3 ✅
Block interaction (breaking/placing)
- Raycasting for selection
- Server-validated placement/breaking
- Respects gamemode rules (survival hold-to-mine, creative instant, adventure/spectator blocked)
- All four gamemodes functional: creative, survival, adventure, spectator (no-clip)

### Phase 4
Polish & visual completeness — make it feel like the official client
- [x] Item entity rendering (floating rotating cubes when blocks are broken)
- [ ] Tool durability bar in hotbar and inventory slots (green→yellow→red decay bar)
- [ ] Camera fluid overlay: blue tint when underwater, orange when in lava
- [ ] Water/lava block rendering (transparent, currently invisible)
- [ ] Block breaking animation (crack overlay while mining)
- [ ] First-person hand/arm model holding held item
- [ ] Health & hunger HUD (survival mode)
- [ ] Entity rendering: other players, mobs
- [x] Inventory screen (open/close bag, move items)
- [ ] Spectator: inside-block visual (official client shows darkness/fog, we show chunk void)

### Phase 5
Autonomous worker bots — separate agent processes that connect to the same bridge server as additional named bots, each appearing as a distinct player entity in the world.

**Architecture**
- Bridge server refactored to support multiple simultaneous bot connections (one per named identity)
- Each bot is an independent Mineflayer instance registered with the bridge under a name (e.g. `woodcutter`, `porter`)
- Rendering client can switch spectator view to any bot — camera locks to that bot's position/yaw/pitch
- Worker bots expose a task API over WebSocket so the CLI tool or an AI agent can issue jobs

**Worker tasks (planned)**
- [ ] Tree chopper: watches saplings planted by the player, waits for growth, fells the tree, collects logs
- [ ] Porter: moves items from a designated drop zone into labeled chests
- [ ] Farmer: plants, tends, and harvests crops in a designated area

**AI agent integration**
- Separate CLI tool (`bot-agent`) that connects to the bridge and issues task commands
- Uses a local Ollama endpoint (no API key required) for natural-language task planning
- Agent decides which worker bot to assign, breaks the goal into primitive bridge commands
- Fallback: hand-coded task scripts usable without any LLM

**Spectator mode**
- [ ] Bridge refactor: multi-bot support, named bot registry
- [ ] Rendering client: bot selector UI (switch which bot's POV you see)
- [ ] Worker bot scaffold: connect, navigate, interact loop
- [ ] Tree chopper implementation
- [ ] Porter implementation
- [ ] Ollama task-planning integration (optional, requires local Ollama install)

## "Fully Playable" Definition
Everything the official client offers that applies to the current gamemode:
- Viewing/exploring (all modes) ✅
- Walking with physics (all modes)
- Flying (creative/spectator only)
- Block breaking/placing (creative/survival/adventure)
- Inventory management
- Combat/interaction
- All server rules respected

## Decision Framework
When ambiguity arises:
1. Check this goal
2. Ask: "Does this align with respecting server authority?"
3. If unclear, update the goal to clarify vision
4. Make the decision based on the refined goal
