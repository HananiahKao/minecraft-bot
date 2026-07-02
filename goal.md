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
- [ ] Item entity rendering (floating rotating cubes when blocks are broken)
- [ ] Camera fluid overlay: blue tint when underwater, orange when in lava
- [ ] Water/lava block rendering (transparent, currently invisible)
- [ ] Block breaking animation (crack overlay while mining)
- [ ] First-person hand/arm model holding held item
- [ ] Health & hunger HUD (survival mode)
- [ ] Entity rendering: other players, mobs
- [ ] Inventory screen (open/close bag, move items)
- [ ] Spectator: inside-block visual (official client shows darkness/fog, we show chunk void)

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
