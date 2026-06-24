# Minecraft Rendering Client

A 3D Minecraft rendering client that respects server authority for all gameplay rules. Built with Mineflayer + Three.js + WebSocket bridge.

## Quick Start

### Prerequisites
- Node.js 16+
- Minecraft Java Edition server (local or remote)

### Setup

#### 1. Create .gitignore (do this first!)
```bash
# Already created — prevents committing runtime data
cat .gitignore
```

#### 2. Download Minecraft Server
```bash
# This should already be downloading in the background
# Wait for server.jar to complete (21GB for latest version)
ls -lh server.jar
```

#### 3. Start Minecraft Server
```bash
cd ~/Desktop/minecraft-bot
java -Xmx1024M -Xms512M -jar server.jar nogui

# On first run: edit eula.txt, change eula=false → eula=true, restart
```

#### 4. Install Bridge Dependencies
```bash
cd ~/Desktop/minecraft-bot/bridge
npm install
```

#### 5. Start Bridge
```bash
npm run dev
# Output: 🌉 Bridge listening on ws://0.0.0.0:8080
```

#### 6. Install Client Dependencies
```bash
cd ~/Desktop/minecraft-bot/rendering-client
npm install
```

#### 7. Start Client
```bash
npm run dev
# Output: 🌐 Rendering client at http://localhost:3000
```

#### 8. Open Browser
```
http://localhost:3000
```

## Architecture

```
Minecraft Server (port 25565)
    ↓ (Mineflayer bot)
Bridge (port 8080, WebSocket)
    ↓ (chunk data)
Rendering Client (port 3000, Three.js)
```

See `docs/ARCHITECTURE.md` for detailed design.

## Project Goal

**Build a 3D Minecraft rendering client that behaves like the official Minecraft client — respecting server authority for all gameplay rules.**

### Core Principle
- Server is authoritative (decides gamemode, physics, block breaking rules)
- Client is responsive (displays world, sends input, adapts to server rules)

### Phases

| Phase | Status | Goal |
|-------|--------|------|
| 1 | ✅ | Three.js foundation |
| 2 | ✅ | WebSocket bridge + chunk streaming |
| 2.5 | 🚀 | Synchronized bot/camera movement |
| 3 | 📋 | Block interaction (break/place) |
| 4 | 📋 | Polish (entities, UI, adaptation) |

See `goal.md` for complete vision.

## Controls

| Key | Action |
|-----|--------|
| W/A/S/D | Move camera |
| Space | Move up |
| Shift | Move down |
| Mouse | Look around |
| Click | Lock/unlock pointer |
| ESC | Unlock pointer |

## Environment Variables

### Bridge
```bash
MC_HOST=localhost       # Minecraft server host
MC_PORT=25565          # Minecraft server port
BOT_USER=RenderBot     # Bot username
```

### Client
Bridge URL is hardcoded to `ws://localhost:8080` in connection.js.

## Troubleshooting

### "RenderBot moved too quickly" warnings
Bot is walking to catch up with camera. This is normal and expected.

### Chunks not loading
1. Check bridge is running: `nc -zv localhost 8080`
2. Check client console for connection errors
3. Restart all three servers

### Camera stuck at spawn
Camera waits for 5+ chunks to load before moving. Give it ~5 seconds.

### Bot drowns and doesn't respawn
Death handler respawns at world spawn. Check bridge logs for errors.

### Git repo is huge
Never commit `node_modules/`, `world/`, `logs/`. See `.gitignore`.

## Contributing

Keep Phase 2.5 in mind: client prediction (instant camera) + server validation (bot walks). Don't break this pattern.

---

Built with 🦞 by Mishael Elitan
