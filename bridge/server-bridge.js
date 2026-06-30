/**
 * WebSocket Bridge Server
 * Puppets a Mineflayer bot from client input — mimics the official Minecraft client:
 * - Client sends WASD control states + yaw/pitch every tick
 * - Bridge calls bot.setControlState() + bot.look() (server physics runs)
 * - Bridge streams back bot's authoritative position + chunk data
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
let positionBroadcastInterval = null;


function initBot() {
  console.log(`🤖 Connecting to ${MINECRAFT_HOST}:${MINECRAFT_PORT} as "${BOT_USERNAME}"...`);

  bot = mineflayer.createBot({
    host: MINECRAFT_HOST,
    port: MINECRAFT_PORT,
    username: BOT_USERNAME,
    logErrors: true,
    skipValidation: true
  });

  // Log every server→client abilities packet so we can confirm the server accepted our flying state
  bot._client.on('abilities', (packet) => {
    const flying    = !!(packet.flags & 0x02);
    const canFly    = !!(packet.flags & 0x04);
    const instabuild = !!(packet.flags & 0x08);
    console.log(`[abilities←server] flags=0x${packet.flags.toString(16).padStart(2,'0')} flying=${flying} canFly=${canFly} instabuild=${instabuild} flySpeed=${packet.flyingSpeed} walkSpeed=${packet.walkingSpeed}`);
  });

  bot.on('spawn', () => {
    console.log('✅ Bot spawned!');
    console.log(`📍 Position: ${bot.entity.position.toString()}`);
    botReady = true;

    broadcastMessage({
      type: 'bot_ready',
      position: bot.entity.position.toArray(),
      dimension: bot.game.dimension,
      gameMode: bot.game.gameMode,
    });

    // Send already-loaded chunks around spawn
    requestChunksAround(bot.entity.position);
    broadcastHotbar();

    // Stream bot position and trigger chunk updates as bot crosses chunk boundaries
    if (positionBroadcastInterval) clearInterval(positionBroadcastInterval);
    positionBroadcastInterval = setInterval(() => {
      if (!bot || !bot.entity) return;
      if (connectedClients.length > 0) {
        broadcastMessage({
          type: 'bot_position',
          position: bot.entity.position.toArray()
        });
      }
    }, 50);
  });

  bot.on('chunkColumnLoad', (chunk) => {
    if (!connectedClients.length) return;
    try {
      const chunkData = bot.world.getColumn(chunk.x, chunk.z);
      if (chunkData) broadcastChunk(chunk.x, chunk.z, chunkData);
    } catch (e) {
      // Chunk not ready yet
    }
  });

  // Re-broadcast the affected chunk column when a block changes.
  // Debounced per chunk key — rapid world ticks (grass, physics) collapse into one send.
  const _blockUpdateTimers = new Map();
  bot.on('blockUpdate', (oldBlock, newBlock) => {
    if (!connectedClients.length) return;
    const pos = newBlock.position;
    const cx = Math.floor(pos.x / 16);
    const cz = Math.floor(pos.z / 16);
    const key = `${cx},${cz}`;
    if (_blockUpdateTimers.has(key)) return;
    _blockUpdateTimers.set(key, setTimeout(() => {
      _blockUpdateTimers.delete(key);
      if (!connectedClients.length) return;
      try {
        const col = bot.world.getColumn(cx, cz);
        if (col) broadcastChunk(cx, cz, col);
      } catch (e) {}
    }, 100));
  });

  bot.on('playerCollect', () => broadcastHotbar());
  bot.on('heldItemChanged', () => broadcastHotbar());

  bot.on('death', () => {
    console.log('💀 Bot died! Respawning...');
    botReady = false;
    // Stop all movement on death and reset flight state
    stopAllControls();
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
    broadcastMessage({ type: 'error', message: err.message || 'Unknown error' });
  });

  bot.on('end', (reason) => {
    console.log('Bot disconnected:', reason);
    botReady = false;
    if (positionBroadcastInterval) {
      clearInterval(positionBroadcastInterval);
      positionBroadcastInterval = null;
    }
    setTimeout(() => {
      console.log('Attempting to reconnect...');
      initBot();
    }, 5000);
  });
}

function stopAllControls() {
  if (!bot) return;
  ['forward', 'back', 'left', 'right', 'jump', 'sneak', 'sprint'].forEach(c => {
    try { bot.setControlState(c, false); } catch (e) {}
  });
}

function requestChunksAround(position) {
  if (!bot || !bot.world) return;
  const chunkX = Math.floor(position.x / 16);
  const chunkZ = Math.floor(position.z / 16);
  const radius = 8;

  // Build the list of coords first, then broadcast one per event-loop tick
  // so incoming player_input messages aren't blocked during the burst.
  const coords = [];
  for (let x = chunkX - radius; x <= chunkX + radius; x++) {
    for (let z = chunkZ - radius; z <= chunkZ + radius; z++) {
      coords.push([x, z]);
    }
  }

  let i = 0;
  function sendNext() {
    if (!bot || !bot.world || connectedClients.length === 0) return;
    const end = Math.min(i + 4, coords.length); // 4 chunks per tick
    for (; i < end; i++) {
      const [x, z] = coords[i];
      try {
        const chunkData = bot.world.getColumn(x, z);
        if (chunkData) broadcastChunk(x, z, chunkData);
      } catch (e) {}
    }
    if (i < coords.length) setImmediate(sendNext);
  }
  setImmediate(sendNext);
}

function broadcastMessage(message) {
  try {
    const data = JSON.stringify(message);
    connectedClients.forEach(client => {
      if (client.readyState === 1) {
        try { client.send(data); } catch (e) {}
      }
    });
  } catch (e) {
    console.error(`Failed to broadcast:`, e.message);
  }
}

function broadcastHotbar() {
  if (!bot || !bot.inventory) return;
  const slots = [];
  for (let i = 0; i < 9; i++) {
    const item = bot.inventory.slots[36 + i]; // hotbar is slots 36–44 in Minecraft protocol
    slots.push(item ? { name: item.name, count: item.count } : null);
  }
  broadcastMessage({ type: 'hotbar', slots, heldSlot: bot.quickBarSlot });
}

function broadcastChunk(chunkX, chunkZ, chunkData) {
  try {
    const blocks = [];
    const Y_MIN = -64;
    const Y_MAX = 256;

    for (let x = 0; x < 16; x++) {
      for (let z = 0; z < 16; z++) {
        for (let y = Y_MIN; y < Y_MAX; y++) {
          try {
            const block = chunkData.getBlock({ x, y, z });
            if (block && block.name && block.name !== 'air') {
              blocks.push({ x, y, z, name: String(block.name) });
            }
          } catch (e) {}
        }
      }
    }

    if (blocks.length > 0) {
      console.log(`📦 Chunk ${chunkX},${chunkZ}: ${blocks.length} blocks`);
      broadcastMessage({ type: 'chunk_data', x: chunkX, z: chunkZ, blocks });
    }
  } catch (e) {
    console.error(`Failed to process chunk ${chunkX},${chunkZ}:`, e.message);
  }
}

wss.on('connection', (ws) => {
  console.log('🔗 Client connected');
  connectedClients.push(ws);

  try {
    if (botReady) {
      ws.send(JSON.stringify({
        type: 'bot_ready',
        position: bot.entity.position.toArray(),
        dimension: bot.game.dimension,
        gameMode: bot.game.gameMode,
      }));
      requestChunksAround(bot.entity.position);
      broadcastHotbar();
    }
  } catch (e) {
    console.error('Failed to send init:', e.message);
  }

  let _pickInProgress = false;
  let _placeLastMs = 0;

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data);

      if (message.type === 'held_slot_change' && botReady && bot) {
        const slot = message.slot;
        if (slot >= 0 && slot <= 8) {
          bot.setQuickBarSlot(slot);
        }
      } else if (message.type === 'pick_block' && botReady && bot) {
        if (!_pickInProgress) {
          _pickInProgress = true;
          const { x, y, z } = message.block;
          const block = bot.blockAt(new Vec3(x, y, z));
          if (block && block.name !== 'air') {
            const item = bot.registry.itemsByName[block.name];
            if (item) {
              bot.creative.setInventorySlot(36 + bot.quickBarSlot, { type: item.id, count: 1, metadata: 0 })
                .then(() => broadcastHotbar())
                .catch(e => console.warn('pick_block failed:', e.message))
                .finally(() => { _pickInProgress = false; });
            } else {
              _pickInProgress = false;
            }
          } else {
            _pickInProgress = false;
          }
        }
      } else if (message.type === 'place_block' && botReady && bot) {
        const now = Date.now();
        if (now - _placeLastMs < 250) return; // 250ms cooldown between placements
        _placeLastMs = now;
        const { x, y, z } = message.block;
        const face = message.face || { x: 0, y: 1, z: 0 };
        // Map face normal to Minecraft direction index
        // 0=bottom(-Y), 1=top(+Y), 2=north(-Z), 3=south(+Z), 4=west(-X), 5=east(+X)
        let dir = 1;
        if (face.y < 0) dir = 0;
        else if (face.y > 0) dir = 1;
        else if (face.z < 0) dir = 2;
        else if (face.z > 0) dir = 3;
        else if (face.x < 0) dir = 4;
        else if (face.x > 0) dir = 5;
        try {
          bot._client.write('use_item_on', {
            hand: 0,
            location: { x, y, z },
            direction: dir,
            cursorX: 0.5, cursorY: 0.5, cursorZ: 0.5,
            insideBlock: false,
            sequence: 0
          });
          console.log(`🧱 Place block at (${x},${y},${z}) face=${dir}`);
        } catch (e) {
          console.warn('place_block failed:', e.message);
        }
      } else if (message.type === 'request_chunks' && botReady && bot && bot.world) {
        // Spread chunk processing over event-loop ticks so player_input messages
        // are not blocked behind a bulk chunk send (4 chunks per setImmediate tick).
        const coords = message.chunks.slice();
        let i = 0;
        function sendNext() {
          if (!bot || !bot.world || connectedClients.length === 0) return;
          const end = Math.min(i + 4, coords.length);
          for (; i < end; i++) {
            try {
              const col = bot.world.getColumn(coords[i].x, coords[i].z);
              if (col) broadcastChunk(coords[i].x, coords[i].z, col);
            } catch (e) {}
          }
          if (i < coords.length) setImmediate(sendNext);
        }
        setImmediate(sendNext);
      } else if (message.type === 'player_input' && botReady && bot && bot.entity) {
        const { controls, yaw, pitch, targetedBlock } = message;

        if (controls.breakBlock && targetedBlock) {
          const pos = new Vec3(targetedBlock.x, targetedBlock.y, targetedBlock.z);
          const block = bot.blockAt(pos);
          if (block && block.name !== 'air') {
            console.log(`⛏️  Breaking ${block.name} at ${pos}`);
            bot.dig(block).catch(e => console.warn('dig failed:', e.message));
          }
        }
        const isCreative = bot.game && bot.game.gameMode === 'creative';

        if (isCreative) {
          // flyToggle is a one-shot signal from the client, set on double-tap Space.
          // In 1.19.4 the client→server abilities packet only has a flags byte (i8).
          // Bit layout: 0x01=invulnerable, 0x02=flying, 0x04=canFly, 0x08=instabuild.
          // When enabling flight we must set both flying (0x02) AND canFly (0x04) = 0x06,
          // otherwise the server ignores the flying flag.

          if (controls.flyToggle) {
            const nowFlying = !bot.entity.isFlying;
            console.log(`[fly] toggle → nowFlying=${nowFlying}`);
            // abilities packet: flags i8 only (1.19.4 client→server direction).
            // 0x02=flying, 0x04=canFly — both required to enable flight.
            bot._client.write('abilities', { flags: nowFlying ? 0x06 : 0x00 });
            bot.entity.isFlying = nowFlying;
            // bot.creative.startFlying/stopFlying zero bot.physics.gravity so
            // prismarine-physics stops applying gravity on subsequent ticks.
            if (nowFlying) {
              bot.creative.startFlying();
              // Zero vertical velocity so any upward momentum from the jump that
              // triggered the double-tap doesn't carry over into flight.
              bot.entity.velocity.y = 0;
            } else {
              bot.creative.stopFlying();
            }
          }

          // While flying: Space = ascend (jump), Shift = descend (sneak).
          // Horizontal controls and sprint work the same as on the ground.
          if (bot.entity.isFlying) {
            const flyControls = ['forward', 'back', 'left', 'right', 'sprint'];
            for (const control of flyControls) {
              if (control in controls) bot.setControlState(control, !!controls[control]);
            }
            // prismarine-physics with gravity=0 does NOT apply vertical velocity for
            // jump/sneak control states — those branches only trigger on-ground.
            // Drive vertical velocity directly, matching Minecraft creative-flight speed.
            // The physics tick will then translate this velocity into position movement.
            const FLY_SPEED_Y = 0.25; // blocks/tick — matches vanilla creative ascend/descend
            if (controls.jump && !controls.sneak) {
              bot.entity.velocity.y = FLY_SPEED_Y;
            } else if (controls.sneak && !controls.jump) {
              bot.entity.velocity.y = -FLY_SPEED_Y;
            } else {
              bot.entity.velocity.y = 0;
            }
            // Still set the control states so any physics plugin that does read them stays
            // consistent, but the velocity above is what actually moves the bot.
            bot.setControlState('jump',  !!controls.jump);
            bot.setControlState('sneak', !!controls.sneak);
          } else {
            // Not flying — apply all controls normally (walking/jumping in creative)
            const valid = ['forward', 'back', 'left', 'right', 'jump', 'sneak', 'sprint'];
            for (const control of valid) {
              if (control in controls) bot.setControlState(control, !!controls[control]);
            }
          }
        } else {
          // Survival / adventure / spectator — apply controls unchanged
          const valid = ['forward', 'back', 'left', 'right', 'jump', 'sneak', 'sprint'];
          for (const control of valid) {
            if (control in controls) {
              bot.setControlState(control, !!controls[control]);
            }
          }
        }

        // Apply look direction
        if (typeof yaw === 'number' && typeof pitch === 'number') {
          bot.look(yaw, pitch, true);
        }
      }
    } catch (e) {
      console.error('Error handling message:', e.message);
    }
  });

  ws.on('close', (code, reason) => {
    console.log(`🔌 Client disconnected (code: ${code})`);
    connectedClients = connectedClients.filter(c => c !== ws);
    // Stop bot movement when no clients are connected
    if (connectedClients.length === 0) stopAllControls();
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
  stopAllControls();
  if (bot) bot.end();
  wss.clients.forEach(client => client.close());
  server.close();
  process.exit(0);
});

initBot();
