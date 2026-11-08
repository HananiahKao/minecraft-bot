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
- [x] Tool durability bar in hotbar and inventory/chest slots (still missing on the item while it's being dragged on the cursor — see README's "Known issues")
- [ ] Camera fluid overlay: blue tint when underwater, orange when in lava
- [x] Water/lava/glass/ice block rendering (real translucent geometry, not invisible)
- [x] Block breaking animation (crack-stage overlay while mining)
- [ ] First-person hand/arm model holding held item
- [x] Health & hunger HUD (survival mode), plus armor, air/bubble, and XP bars
- [x] Entity rendering: other players, mobs — real bone/box models with extracted vanilla textures (falls back to a colored box body+head when no texture is available)
- [x] Inventory screen (open/close bag, move items), plus chest/villager window screens
- [x] Entity interaction: attacking mobs, trading with villagers/wandering traders
- [ ] Minimap
- [ ] Sound/audio
- [ ] Day/night sky cycle (sun/moon/stars) — sky is currently a static color + fog
- [ ] Spectator: inside-block visual (official client shows darkness/fog, we show chunk void)

Known bug from this phase: the camera defaults to a fixed look direction on every page load/reconnect instead of the bot's actual facing — see README's "Known issues" for the root cause (client never receives or applies the bot's real yaw/pitch).

### Phase 5 ✅ (achieved via a different architecture than originally planned)
Autonomous worker bots — the *goal* (independent bot processes that take on tasks from a natural-language instruction) is done, but the design that shipped diverges from what was originally sketched below. Built instead:
- `bridge/agent-manager.js` — HTTP+WS manager (port 3001) that spawns/monitors/messages/removes agents, with a browser UI (`agent-ui/index.html`) instead of a CLI tool
- `bridge/agent-runner.js` — each agent is a detached OS process (not just a registered name on the shared bridge connection), so restarting the manager never kills running bots
- `bridge/agent-bot.js` — each runner connects its own independent Mineflayer bot under its own name and runs an observe → call Claude Haiku → parse `<tool_call>` → act loop
- Natural-language goals instead of fixed worker types — there's no dedicated tree-chopper/porter/farmer; a single general agent takes any goal and improvises via `move_to`, `find_block`, `dig_block`, `place_block`, `get_surroundings`, `chat`, `run_command`
- Claude Haiku (via the `claude` CLI, your own API account) instead of a local Ollama endpoint — no hand-coded-script fallback was built
- No spectator POV-switching to watch an agent's view yet — the original plan's bot-selector UI never got built

The items below are the original plan, kept for history — most are superseded by the above rather than literally done:

**Original architecture (superseded)**
- Bridge server refactored to support multiple simultaneous bot connections (one per named identity) — *superseded: each agent is its own detached process with its own bot connection, not a multiplexed shared bridge*
- Rendering client can switch spectator view to any bot — camera locks to that bot's position/yaw/pitch — *not built*
- Worker bots expose a task API over WebSocket so the CLI tool or an AI agent can issue jobs — *superseded by the HTTP+WS agent-manager API*

**Worker tasks (planned, not built as such)**
- [ ] Tree chopper, Porter, Farmer as dedicated named worker types — general agents can attempt these via natural-language goals instead

**AI agent integration (superseded)**
- ~~Separate CLI tool (`bot-agent`)~~ → built as a manager + browser UI instead
- ~~Local Ollama endpoint~~ → uses Claude Haiku via the `claude` CLI instead
- ~~Hand-coded task scripts fallback~~ → not built; no-LLM fallback doesn't exist

**Spectator mode (not built)**
- [ ] Rendering client: bot selector UI (switch which bot's POV you see)

## "Fully Playable" Definition
Everything the official client offers that applies to the current gamemode:
- Viewing/exploring (all modes) ✅
- Walking with physics (all modes) ✅
- Flying (creative/spectator only) ✅
- Block breaking/placing (creative/survival/adventure) ✅
- Inventory management ✅
- Combat/interaction ✅
- All server rules respected ✅

## Decision Framework
When ambiguity arises:
1. Check this goal
2. Ask: "Does this align with respecting server authority?"
3. If unclear, update the goal to clarify vision
4. Make the decision based on the refined goal
