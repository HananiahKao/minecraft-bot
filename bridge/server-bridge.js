/**
 * WebSocket Bridge Server - Phase 2 & 2.5
 * Runs a Mineflayer bot and bridges chunk data to the rendering client
 *
 * Phase 2.5: Bot walks to camera position (respects server physics)
 */

import http from 'http';
import { WebSocketServer } from 'ws';
import mineflayer from 'mineflayer';
import pkg from 'prismarine-chunk';
import Vec3 from 'vec3';
const { Chunk } = pkg;

const BRIDGE_PORT = 8080;
const MINECRAFT_HOST = process.env.MC_HOST || 'localhost';
const MINECRAFT_PORT = parseInt(process.env.MC_PORT || '25565');
const BOT_USERNAME = process.env.BOT_USER || 'RenderBot';

const server = http.createServer((req, res) => {
  res.writeHead(400, { 'Content-Type': 'text/plain' });
  res.end('WebSocket server - upgrade required');
});

const wss = new WebSocketServer({
  server,
  clientTracking: true,
  perMessageDeflate: false
});

let bot = null;
let connectedClients = [];
let botReady = false;
let lastCameraPosition = null;

function initBot() {
  console.log(`🤖 Connecting to ${MINECRAFT_HOST}:${MINECRAFT_PORT} as "${BOT_USERNAME}"...`);

  bot = mineflayer.createBot({
    host: MINECRAFT_HOST,
    port: MINECRAFT_PORT,
    username: BOT_USERNAME,
    logErrors: true,
    skipValidation: true
  });

  bot.on('spawn', () => {
    console.log('✅ Bot spawned!');
    console.log(`📍 Position: ${bot.entity.position.toString()}`);
    botReady = true;

    broadcastMessage({
      type: 'bot_ready',
      position: bot.entity.position.toArray(),
      dimension: bot.game.dimension
    });

    // Request chunks around spawn
    console.log(`📦 Requesting initial chunks...`);
    requestChunksAround(bot.entity.position);

    // Continuous chunk maintenance
    const maintainChunksInterval = setInterval(() => {
      if (connectedClients.length > 0 && bot && bot.entity) {
        const targetPos = lastCameraPosition || bot.entity.position;
        if (lastCameraPosition) {
          requestChunksAround(bot.entity.position);
        }
      }
    }, 2000);
  });

  bot.on('chunkColumnLoad', (chunk) => {
    if (!connectedClients.length) return;
    try {
      const chunkData = bot.world.getColumn(chunk.x, chunk.z);
      if (chunkData) {
        broadcastChunk(chunk.x, chunk.z, chunkData);
      }
    } catch (e) {
      // Chunk not ready yet
    }
  });

  bot.on('death', () => {
    console.log('💀 Bot died! Respawning at spawn...');
    botReady = false;
    setTimeout(() => {
      try {
        bot.respawn();
        console.log('✅ Bot respawned!');
        botReady = true;
      } catch (e) {
        console.warn('Respawn failed:', e.message);
      }
    }, 1000);
  });

  bot.on('error', (err) => {
    console.error('❌ Bot error:', err.message);
    botReady = false;
    broadcastMessage({
      type: 'error',
      message: err.message || 'Unknown error'
    });
  });

  bot.on('end', (reason) => {
    console.log('Bot disconnected:', reason);
    botReady = false;
    setTimeout(() => {
      console.log('Attempting to reconnect...');
      initBot();
    }, 5000);
  });
}

function broadcastMessage(message) {
  try {
    const data = JSON.stringify(message);
    connectedClients.forEach(client => {
      if (client.readyState === 1) { // WebSocket.OPEN = 1
        try {
          client.send(data);
        } catch (e) {
          // Client send failed
        }
      }
    });
  } catch (e) {
    console.error(`Failed to broadcast:`, e.message);
  }
}

function broadcastChunk(chunkX, chunkZ, chunkData) {
  try {
    const blocks = [];
    const Y_MIN = 40;
    const Y_MAX = 120;

    for (let x = 0; x < 16; x++) {
      for (let z = 0; z < 16; z++) {
        for (let y = Y_MIN; y < Y_MAX; y++) {
          try {
            const block = chunkData.getBlock({ x, y, z });
            if (block && block.name && block.name !== 'air') {
              blocks.push({
                x, y, z,
                name: String(block.name)
              });
            }
          } catch (e) {
            // Block unreadable
          }
        }
      }
    }

    if (blocks.length > 0) {
      console.log(`📦 Chunk ${chunkX},${chunkZ}: ${blocks.length} blocks`);
      broadcastMessage({
        type: 'chunk_data',
        x: chunkX,
        z: chunkZ,
        blocks: blocks
      });
    }
  } catch (e) {
    console.error(`Failed to process chunk ${chunkX},${chunkZ}:`, e.message);
  }
}

function requestChunksAround(position) {
  if (!bot || !bot.world) return;

  const chunkX = Math.floor(position.x / 16);
  const chunkZ = Math.floor(position.z / 16);
  const radius = 4;

  console.log(`📡 Requesting chunks around (${chunkX}, ${chunkZ})...`);

  for (let x = chunkX - radius; x <= chunkX + radius; x++) {
    for (let z = chunkZ - radius; z <= chunkZ + radius; z++) {
      try {
        const chunkData = bot.world.getColumn(x, z);
        if (chunkData) {
          broadcastChunk(x, z, chunkData);
        }
      } catch (e) {
        // Chunk not loaded yet
      }
    }
  }
}

wss.on('connection', (ws) => {
  console.log('🔗 Client connected');
  connectedClients.push(ws);

  try {
    ws.send(JSON.stringify({
      type: 'init',
      botReady,
      position: botReady ? bot.entity.position.toArray() : [0, 70, 0],
      dimension: botReady ? bot.game.dimension : 'minecraft:overworld'
    }));

    if (botReady) {
      ws.send(JSON.stringify({
        type: 'bot_ready',
        position: bot.entity.position.toArray(),
        dimension: bot.game.dimension
      }));
      console.log(`📦 Re-requesting chunks for newly connected client...`);
      requestChunksAround(bot.entity.position);
    }
  } catch (e) {
    console.error('Failed to send init:', e.message);
  }

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data);

      switch (message.type) {
        case 'request_chunks':
          console.log(`[MOVE] Received position request: (${message.position[0].toFixed(1)}, ${message.position[1].toFixed(1)}, ${message.position[2].toFixed(1)})`);
          if (botReady && bot && bot.entity && message.position) {
            const cameraPos = {
              x: message.position[0],
              y: message.position[1],
              z: message.position[2]
            };

            const currentPos = bot.entity.position;
            const dx = cameraPos.x - currentPos.x;
            const dz = cameraPos.z - currentPos.z;
            const dist = Math.sqrt(dx * dx + dz * dz);

            console.log(`[MOVE] Distance to target: ${dist.toFixed(1)} blocks (current: ${currentPos.toString()}, target: ${cameraPos.x.toFixed(1)},${cameraPos.z.toFixed(1)})`);

            if (cameraPos.y >= 0 && cameraPos.y <= 256 && dist <= 1000) {
              lastCameraPosition = cameraPos;

              // Teleport bot to camera position for testing chunk streaming
              if (dist > 0.5) {
                console.log(`[MOVE] Teleporting bot to target (distance: ${dist.toFixed(1)})`);
                try {
                  bot.chat(`/tp ${cameraPos.x.toFixed(1)} ${cameraPos.y.toFixed(1)} ${cameraPos.z.toFixed(1)}`);
                  console.log(`[MOVE] Teleported to (${cameraPos.x.toFixed(1)}, ${cameraPos.y.toFixed(1)}, ${cameraPos.z.toFixed(1)})`);
                } catch (e) {
                  console.warn('Teleport failed:', e.message);
                }
              } else {
                console.log(`[MOVE] Already at target (distance: ${dist.toFixed(1)} <= 0.5)`);
              }

              // Request chunks only if chunk changed
              const lastChunkPos = lastCameraPosition || currentPos;
              const chunkMoveX = Math.abs(Math.floor(cameraPos.x / 16) - Math.floor(lastChunkPos.x / 16));
              const chunkMoveZ = Math.abs(Math.floor(cameraPos.z / 16) - Math.floor(lastChunkPos.z / 16));
              if (Math.max(chunkMoveX, chunkMoveZ) > 0) {
                requestChunksAround(cameraPos);
              }
            }
          }
          break;
      }
    } catch (e) {
      console.error('Error handling message:', e.message);
    }
  });

  ws.on('close', (code, reason) => {
    console.log(`🔌 Client disconnected (code: ${code}, reason: ${reason || 'none'})`);
    connectedClients = connectedClients.filter(c => c !== ws);
  });

  ws.on('error', (error) => {
    console.error('❌ WebSocket client error:', error.message || error);
  });
});

server.listen(BRIDGE_PORT, '0.0.0.0', () => {
  console.log(`🌉 Bridge listening on ws://0.0.0.0:${BRIDGE_PORT}`);
  console.log(`   Local: ws://127.0.0.1:${BRIDGE_PORT}`);
  console.log(`Minecraft: ${MINECRAFT_HOST}:${MINECRAFT_PORT}`);
});

process.on('SIGINT', () => {
  console.log('\n⏹️  Shutting down...');
  if (bot) bot.end();
  wss.clients.forEach(client => client.close());
  server.close();
  process.exit(0);
});

initBot();
