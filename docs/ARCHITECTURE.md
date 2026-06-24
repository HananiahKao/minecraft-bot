# Architecture

## System Overview

Three-tier architecture:
1. **Minecraft Server** — Authoritative state (blocks, physics, rules)
2. **Mineflayer Bridge** — Bot entity + chunk streamer (ws://8080)
3. **Rendering Client** — Three.js viewer (http://3000)

```
┌─────────────────────┐
│  Minecraft Server   │ (port 25565)
│   (Authoritative)   │
└──────────┬──────────┘
           │
     (Java protocol)
           │
┌──────────▼──────────────────────┐
│   Mineflayer Bridge              │ (port 8080)
│  - Manages bot entity             │
│  - Loads chunks from server       │
│  - Broadcasts chunk data (WebSocket)
│  - Handles bot movement          │
│  - Respawns on death             │
└──────────┬──────────────────────┘
           │
    (JSON over WebSocket)
           │
┌──────────▼──────────────────────┐
│  Rendering Client (Three.js)     │ (port 3000)
│  - Displays chunks               │
│  - WASD camera movement          │
│  - Sends camera position → bridge│
└──────────────────────────────────┘
```

## Phase 2.5: Synchronized Movement

### Problem Solved
Official Minecraft client sends player position continuously, server validates physics, blocks breaking/placement. Previous attempts:
- **Instant teleport**: Server rejects as too-fast movement (anti-cheat)
- **Paused bridge**: Client waiting for chunks while bridge waiting for position (circular dependency)

### Solution: Client Prediction + Server Validation
1. **Camera**: Moves instantly (client-side prediction)
2. **Bot**: Walks gradually to camera position (server validates physics)
3. **Chunks**: Only requested when chunk coordinate changes (not every 100ms)
4. **Respawn**: On death, bot respawns at spawn (prevents infinite drowning)

### Communication Flow

#### Initialization
```
[Bot spawns on server]
       ↓
[Bridge broadcasts bot_ready + position]
       ↓
[Client receives bot_ready]
       ↓
[Bridge requests chunks around spawn]
       ↓
[Client receives chunks, syncs camera to bot position]
       ↓
[Camera sync complete → NOW send position updates]
```

#### Continuous Exploration
```
[User moves camera with WASD]
       ↓
[Camera position updated instantly (client)]
       ↓
[Every 100ms: send camera position to bridge]
       ↓
[Bridge calculates distance]
       ↓
IF distance > 0.5 blocks:
  - bot.lookAt(cameraPos)
  - bot.setControlState('forward', true)
  - Server validates movement physics
       ↓
IF chunk coordinate changed:
  - Request new chunks around camera
  - Bridge broadcasts chunk data
       ↓
[Client renders new chunks]
```

#### Death Recovery
```
[Bot enters lava/water and drowns]
       ↓
[Bridge's death event handler fires]
       ↓
[botReady = false, client disconnects]
       ↓
[Bridge reconnects to server (auto-reconnect)]
       ↓
[Bot respawns at world spawn]
       ↓
[Bridge broadcasts bot_ready again]
       ↓
[Client re-syncs camera to spawn, resumes exploration]
```

## Key Files

### Bridge
- `server-bridge.js` — Mineflayer bot + WebSocket server
  - `initBot()` — Connects to Minecraft server
  - `broadcastChunk(x, z, data)` — Sends block data to clients
  - `requestChunksAround(pos)` — Loads chunks from server
  - Message handlers: `request_chunks`, respawn logic
  
- `package.json` — Dependencies: mineflayer, vec3, ws

### Client
- `main.js` — Update loop, camera sync logic
  - `onBotReady()` — Waits for chunks before moving camera
  - `cameraSyncedWithBot` flag — Prevents position sends before sync
  - Sends position every 100ms after sync
  
- `connection.js` — WebSocket client
  - `requestChunks(pos)` — Sends camera position to bridge
  - Handles `chunk_data`, `bot_ready`, `error` messages
  
- `renderer.js` — Three.js chunk rendering
  - Face culling — Only renders visible faces
  - Block colors — Basic palette (stone, dirt, etc.)
  - Dynamic chunk loading/unloading
  
- `input.js` — Camera control
  - WASD movement with quaternion-based look
  - Mouse lock + pointer movement for free look
  - Space/Shift for vertical movement
  
- `index.html` + `server.js` — HTTP server (port 3000)

## Constants & Defaults

| Setting | Value | Purpose |
|---------|-------|---------|
| Bridge port | 8080 | WebSocket server |
| Client port | 3000 | HTTP server |
| Chunk radius | 4 | Load 9×9 = 81 chunks |
| Position update rate | 100ms | Balance responsiveness + bandwidth |
| Y bounds | 40–120 | Vertical render range |
| Camera height offset | 1.6 | Eye level above bot feet |
| Bot movement distance threshold | 0.5 blocks | When to stop walking |
| Max movement distance | 1000 blocks | Sanity check for position updates |

## Error Handling

- **Bot dies** → `botReady = false` → reconnect + respawn at spawn
- **Client disconnects** → Bridge keeps running, resends chunks on reconnect
- **Chunk not loaded** → Gracefully skip (logged, not crashed)
- **Message parse error** → Log + continue (malformed JSON ignored)
- **Vec3 type error** → All position updates use `new Vec3(x, y, z)` not plain objects

## Next Phases

### Phase 3: Block Interaction
- Raycasting for block selection
- Breaking blocks (survival mode)
- Placing blocks (creative mode)
- Server validation (respects gamemode)

### Phase 4: Polish
- Entity rendering (other players, mobs)
- Inventory UI
- Health/hunger display
- Adaptive UI per gamemode
