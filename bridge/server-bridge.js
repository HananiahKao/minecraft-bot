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

// Blocks that open a GUI when right-clicked — activateBlock() instead of block_place
const INTERACTIVE_BLOCKS = new Set([
  'crafting_table',
  'chest', 'trapped_chest', 'ender_chest', 'barrel',
  'furnace', 'blast_furnace', 'smoker',
  'anvil', 'chipped_anvil', 'damaged_anvil',
  'enchanting_table', 'brewing_stand', 'beacon',
  'hopper', 'dispenser', 'dropper',
  'cartography_table', 'grindstone', 'lectern',
  'loom', 'stonecutter', 'smithing_table',
  'shulker_box', 'white_shulker_box', 'orange_shulker_box', 'magenta_shulker_box',
  'light_blue_shulker_box', 'yellow_shulker_box', 'lime_shulker_box', 'pink_shulker_box',
  'gray_shulker_box', 'light_gray_shulker_box', 'cyan_shulker_box', 'purple_shulker_box',
  'blue_shulker_box', 'brown_shulker_box', 'green_shulker_box', 'red_shulker_box',
  'black_shulker_box',
]);
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
let _pickInProgress = false;
let _digInProgress = false;
let _digTarget = null;
let _serverCanFly = false;
let _reconnectScheduled = false;
let _reconnectDelay = 2000; // grows on repeated failures, resets on successful spawn

function scheduleReconnect() {
  if (_reconnectScheduled) return;
  _reconnectScheduled = true;
  const delay = _reconnectDelay;
  _reconnectDelay = Math.min(_reconnectDelay * 2, 30000); // cap at 30s
  console.log(`Reconnecting in ${delay / 1000}s...`);
  setTimeout(() => {
    _reconnectScheduled = false;
    console.log('Attempting to reconnect...');
    initBot();
  }, delay);
}

function initBot() {
  console.log(`🤖 Connecting to ${MINECRAFT_HOST}:${MINECRAFT_PORT} as "${BOT_USERNAME}"...`);

  bot = mineflayer.createBot({
    host: MINECRAFT_HOST,
    port: MINECRAFT_PORT,
    username: BOT_USERNAME,
    logErrors: true,
    skipValidation: true
  });

  // mineflayer's digging plugin omits the `sequence` field added in 1.19.4.
  // Without it the server misreads the location as (0,0,0) and rejects the dig.
  // Wrap _client.write to inject sequence:0 for any block_dig packet missing it.
  const _origWrite = bot._client.write.bind(bot._client);
  bot._client.write = (name, params) => {
    if (name === 'block_dig' && params.sequence === undefined) {
      params = { ...params, sequence: 0 };
    }
    return _origWrite(name, params);
  };

  // Log every server→client abilities packet so we can confirm the server accepted our flying state
  bot._client.on('abilities', (packet) => {
    const flying    = !!(packet.flags & 0x02);
    const canFly    = !!(packet.flags & 0x04);
    const instabuild = !!(packet.flags & 0x08);
    _serverCanFly = canFly;
    if (bot.entity) bot.entity.isFlying = flying; // mirror server's flying state immediately
    console.log(`[abilities←server] flags=0x${packet.flags.toString(16).padStart(2,'0')} flying=${flying} canFly=${canFly} instabuild=${instabuild} flySpeed=${packet.flyingSpeed} walkSpeed=${packet.walkingSpeed}`);
  });

  bot.on('spawn', () => {
    console.log('✅ Bot spawned!');
    if (bot.entity) console.log(`📍 Position: ${bot.entity.position.toString()}`);
    _reconnectDelay = 2000; // reset backoff on successful connection
    botReady = true;
    _pickInProgress = false;

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

  // Send a lightweight block_update message for each block change.
  // The client stores block data per chunk and rebuilds only the affected chunk,
  // avoiding the cost of re-scanning and re-sending an entire chunk column.
  bot.on('blockUpdate', (oldBlock, newBlock) => {
    if (!connectedClients.length) return;
    const pos = newBlock.position;
    broadcastMessage({
      type: 'block_update',
      x: pos.x, y: pos.y, z: pos.z,
      name: newBlock.name || 'air'
    });
  });

  // Track pending item entity IDs — entitySpawn fires before the metadata packet arrives.
  const _pendingItems = new Set();

  bot.on('entitySpawn', (entity) => {
    if (entity.name !== 'item') return;
    _pendingItems.add(entity.id);
  });

  // entity_metadata arrives shortly after entitySpawn and carries the item stack.
  bot._client.on('entity_metadata', (packet) => {
    const entity = bot.entities[packet.entityId];
    if (!entity || entity.name !== 'item') return;
    if (!_pendingItems.has(packet.entityId)) return;
    _pendingItems.delete(packet.entityId);

    // Metadata is an array of { key, type, value } entries.
    // Item entities store the item stack at key 8 (type 'slot' / 'item').
    let itemName = 'unknown';
    for (const entry of packet.metadata) {
      if (entry.key === 8) {
        const slot = entry.value;
        // slot may be { itemId, itemCount, ... } or { type, count, ... }
        const id = slot && (slot.itemId ?? slot.type);
        if (id != null && id !== -1) {
          itemName = (bot.registry.items[id] || {}).name || 'unknown';
        }
        break;
      }
    }

    broadcastMessage({
      type: 'entity_spawn',
      id: entity.id,
      kind: 'item',
      x: entity.position.x,
      y: entity.position.y,
      z: entity.position.z,
      itemName,
    });
  });

  // All living entities (mobs, players) — spawn immediately, no metadata needed
  bot.on('entitySpawn', (entity) => {
    if (entity.name === 'item') return; // handled separately via metadata
    if (!entity.name || entity.type === 'object') return; // skip non-living objects
    broadcastMessage({
      type: 'entity_spawn',
      id: entity.id,
      kind: entity.type === 'player' ? 'player' : 'mob',
      mobType: entity.name,
      x: entity.position.x,
      y: entity.position.y,
      z: entity.position.z,
      yaw: entity.yaw || 0,
    });
  });

  // Throttle entity move broadcasts — mobs update at 20 tps, we only need ~10 fps for rendering.
  // Track last-broadcast time per entity id; skip if <100ms since last send.
  const _entityMoveTimes = new Map();
  bot.on('entityMoved', (entity) => {
    if (!entity.name) return;
    const now = Date.now();
    const last = _entityMoveTimes.get(entity.id) || 0;
    if (now - last < 100) return;
    _entityMoveTimes.set(entity.id, now);

    if (entity.name === 'item') {
      broadcastMessage({
        type: 'entity_move',
        id: entity.id,
        x: entity.position.x,
        y: entity.position.y,
        z: entity.position.z,
      });
    } else if (entity.type !== 'object') {
      broadcastMessage({
        type: 'entity_move',
        id: entity.id,
        x: entity.position.x,
        y: entity.position.y,
        z: entity.position.z,
        yaw: entity.yaw || 0,
      });
    }
  });

  bot.on('entityGone', (entity) => {
    if (!entity.name) return;
    _pendingItems.delete(entity.id);
    _entityMoveTimes.delete(entity.id);
    broadcastMessage({ type: 'entity_destroy', id: entity.id });
  });

  bot.on('playerCollect', () => { broadcastHotbar(); broadcastInventory(); });
  bot.on('heldItemChanged', () => broadcastHotbar());
  // inventory plugin is only available after spawn
  bot.once('spawn', () => {
    // Only schedule inventory broadcast here — window updates come from win.on('updateSlot')
    // to avoid sending stale win.slots data (inventory fires before win.slots is updated)
    bot.inventory.on('updateSlot', scheduleInventoryUpdate);
  });

  bot.on('windowOpen', (win) => {
    const mapItem = item => item ? { name: item.name, count: item.count, durabilityUsed: item.durabilityUsed || 0, maxDurability: item.maxDurability || 0 } : null;
    broadcastMessage({
      type: 'window_open',
      windowType: win.type,
      title: win.title || String(win.type),
      slots: win.slots.slice(0, win.inventoryStart).map(mapItem),
      // Player main inventory (27 slots) and hotbar (9 slots) shown below container
      playerSlots: win.slots.slice(win.inventoryStart, win.inventoryStart + 36).map(mapItem),
      inventoryStart: win.inventoryStart,
      id: win.id,
    });
    // Forward container slot changes — debounced so all set_slot packets in a batch settle first
    win.on('updateSlot', () => scheduleWindowUpdate(win));
    // Forward window properties (furnace burn/cook progress, etc.)
    // win.on('updateProperty') doesn't fire reliably in this mineflayer build.
    // Listen to the raw packet instead (called craft_progress_bar in mc-protocol).
    const onProp = (packet) => {
      if (packet.windowId !== win.id) return;
      broadcastMessage({ type: 'window_property', property: packet.property, value: packet.value });
    };
    bot._client.on('craft_progress_bar', onProp);
    // Clean up when this window closes so we don't accumulate listeners
    bot.once('windowClose', () => bot._client.removeListener('craft_progress_bar', onProp));
  });

  bot.on('windowClose', () => {
    broadcastMessage({ type: 'window_close' });
  });

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
    // 'end' fires after most errors, but some (e.g. ECONNREFUSED, ping ETIMEDOUT)
    // only fire 'error' — always schedule a reconnect here.
    scheduleReconnect();
  });

  bot.on('end', (reason) => {
    console.log('Bot disconnected:', reason);
    botReady = false;
    if (positionBroadcastInterval) {
      clearInterval(positionBroadcastInterval);
      positionBroadcastInterval = null;
    }
    scheduleReconnect();
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
    slots.push(item ? { name: item.name, count: item.count, durabilityUsed: item.durabilityUsed || 0, maxDurability: item.maxDurability || 0 } : null);
  }
  broadcastMessage({ type: 'hotbar', slots, heldSlot: bot.quickBarSlot });
}

function getCursorItem() {
  if (!bot) return null;
  const win = bot.currentWindow || bot.inventory;
  const sel = win && win.selectedItem;
  return sel ? { name: sel.name, count: sel.count } : null;
}

function broadcastInventory() {
  if (!bot || !bot.inventory) return;
  const slots = [];
  for (let i = 0; i <= 44; i++) {
    const item = bot.inventory.slots[i];
    slots.push(item ? { name: item.name, count: item.count, durabilityUsed: item.durabilityUsed || 0, maxDurability: item.maxDurability || 0 } : null);
  }
  broadcastMessage({ type: 'inventory', slots, cursorItem: getCursorItem() });
}

// Debounced window update — coalesces rapid-fire set_slot packets into one broadcast
let _windowUpdateTimer = null;
function scheduleWindowUpdate(win) {
  if (_windowUpdateTimer) clearTimeout(_windowUpdateTimer);
  _windowUpdateTimer = setTimeout(() => {
    _windowUpdateTimer = null;
    if (!win) return;
    const mapItem = item => item ? { name: item.name, count: item.count, durabilityUsed: item.durabilityUsed || 0, maxDurability: item.maxDurability || 0 } : null;
    broadcastMessage({
      type: 'window_update',
      slots: win.slots.slice(0, win.inventoryStart).map(mapItem),
      playerSlots: win.slots.slice(win.inventoryStart, win.inventoryStart + 36).map(mapItem),
      cursorItem: getCursorItem(),
    });
  }, 80);
}

// Debounced inventory update — same reason
let _inventoryUpdateTimer = null;
function scheduleInventoryUpdate() {
  if (_inventoryUpdateTimer) clearTimeout(_inventoryUpdateTimer);
  _inventoryUpdateTimer = setTimeout(() => {
    _inventoryUpdateTimer = null;
    broadcastHotbar();
    broadcastInventory();
  }, 80);
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

  let _placeLastMs = 0;

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data);

      if (message.type === 'use_item' && botReady && bot) {
        const gm = bot.game && bot.game.gameMode;
        if (gm === 'survival' || gm === 'creative') {
          bot.activateItem(false).catch(e => console.warn('use_item failed:', e.message));
        }
      } else if (message.type === 'open_inventory' && botReady && bot) {
        broadcastInventory();
      } else if (message.type === 'click_slot' && botReady && bot) {
        const { slot, button } = message;
        if (typeof slot === 'number' && slot >= 0 && slot <= 44) {
          bot.clickWindow(slot, button || 0, 0)
            .catch(e => console.warn('click_slot failed:', e.message));
        }
      } else if (message.type === 'held_slot_change' && botReady && bot) {
        const slot = message.slot;
        if (slot >= 0 && slot <= 8) {
          bot.setQuickBarSlot(slot);
        }
      } else if (message.type === 'pick_block' && botReady && bot && bot.game && bot.game.gameMode === 'creative') {
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
        const gm = bot.game && bot.game.gameMode;
        if (gm !== 'survival' && gm !== 'creative') return;
        const { x, y, z } = message.block;
        const targetBlock = bot.blockAt(new Vec3(x, y, z));
        // Interactive blocks open a GUI — activate them instead of placing on them
        if (targetBlock && INTERACTIVE_BLOCKS.has(targetBlock.name)) {
          bot.activateBlock(targetBlock).catch(e => console.warn('activateBlock failed:', e.message));
          return;
        }
        const now = Date.now();
        if (now - _placeLastMs < 250) return; // 250ms cooldown between placements
        _placeLastMs = now;
        const face = message.face || { x: 0, y: 1, z: 0 };
        let dir = 1;
        if (face.y < 0) dir = 0;
        else if (face.y > 0) dir = 1;
        else if (face.z < 0) dir = 2;
        else if (face.z > 0) dir = 3;
        else if (face.x < 0) dir = 4;
        else if (face.x > 0) dir = 5;
        try {
          bot._client.write('block_place', {
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
      } else if (message.type === 'window_click' && botReady && bot) {
        // bot.currentWindow is null when no container is open (player inventory only).
        // bot.clickWindow() throws "No window open" in that case, so use bot.inventory.
        if (!bot.currentWindow) bot.currentWindow = bot.inventory;
        const _clickWin = bot.currentWindow;
        bot.clickWindow(message.slot, message.mouseButton, message.mode || 0)
          .then(() => {
            // Force a broadcast after the click resolves so slot counts update immediately
            if (_clickWin === bot.inventory || _clickWin === bot.currentWindow) {
              scheduleInventoryUpdate();
            } else {
              scheduleWindowUpdate(_clickWin);
            }
          })
          .catch(e => console.warn('window_click failed:', e.message));
      } else if (message.type === 'close_window' && botReady && bot) {
        if (bot.currentWindow && bot.currentWindow !== bot.inventory) {
          bot.closeWindow(bot.currentWindow);
        } else {
          // Closing player inventory — just reset so next click can set it again
          bot.currentWindow = null;
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

        const gm = bot.game && bot.game.gameMode;
        const canBreak = gm === 'survival' || gm === 'creative';
        if (controls.breakBlock && targetedBlock && canBreak) {
          // Once a dig is in progress, never interrupt it due to raycaster flicker —
          // stick with the current block until it breaks or the button is released.
          if (!_digInProgress) {
            const pos = new Vec3(targetedBlock.x, targetedBlock.y, targetedBlock.z);
            const block = bot.blockAt(pos);
            if (block && block.name !== 'air') {
              _digInProgress = true;
              _digTarget = `${targetedBlock.x},${targetedBlock.y},${targetedBlock.z}`;
              console.log(`⛏️  Breaking ${block.name} at ${pos}`);
              const digPromise = bot.dig(block);
              if (digPromise && typeof digPromise.catch === 'function') {
                digPromise
                  .catch(e => { if (e.message !== 'Digging aborted') console.warn('dig failed:', e.message); })
                  .finally(() => { _digInProgress = false; _digTarget = null; });
              } else {
                _digInProgress = false; _digTarget = null;
              }
            }
          }
        } else if ((!controls.breakBlock || !canBreak) && _digInProgress) {
          try { bot.stopDigging(); } catch (e) {}
          _digInProgress = false;
          _digTarget = null;
        }
        const isCreative = bot.game && bot.game.gameMode === 'creative';
        const isSpectator = bot.game && bot.game.gameMode === 'spectator';

        if (isSpectator) {
          // Spectator: true no-clip by bypassing the physics engine entirely.
          // setControlState goes through collision detection; directly updating
          // bot.entity.position skips it, matching vanilla spectator behavior.
          bot.entity.isFlying = true;
          bot.physics.gravity = 0;
          bot.entity.velocity.set(0, 0, 0); // prevent physics engine from moving the bot

          // Clear all control states so the physics tick doesn't add its own movement
          ['forward', 'back', 'left', 'right', 'jump', 'sneak', 'sprint'].forEach(c => {
            try { bot.setControlState(c, false); } catch (_) {}
          });

          // Vanilla spectator: WASD moves horizontally in the direction you're facing,
          // Space/Shift move vertically. Sprint multiplies speed by 2 (vanilla approximation).
          const BASE_SPEED = 0.05; // blocks/tick, matches abilities flyingSpeed
          const speed = controls.sprint ? BASE_SPEED * 2 : BASE_SPEED;

          let dx = 0, dz = 0, dy = 0;
          if (controls.forward) { dx -= Math.sin(yaw) * speed; dz -= Math.cos(yaw) * speed; }
          if (controls.back)    { dx += Math.sin(yaw) * speed; dz += Math.cos(yaw) * speed; }
          if (controls.left)    { dx -= Math.cos(yaw) * speed; dz += Math.sin(yaw) * speed; }
          if (controls.right)   { dx += Math.cos(yaw) * speed; dz -= Math.sin(yaw) * speed; }
          if (controls.jump && !controls.sneak)      dy =  speed * 2;
          else if (controls.sneak && !controls.jump) dy = -speed * 2;

          bot.entity.position.x += dx;
          bot.entity.position.y += dy;
          bot.entity.position.z += dz;
        } else if (isCreative) {
          // flyToggle is a one-shot signal from the client, set on double-tap Space.
          // In 1.19.4 the client→server abilities packet only has a flags byte (i8).
          // Bit layout: 0x01=invulnerable, 0x02=flying, 0x04=canFly, 0x08=instabuild.
          // When enabling flight we must set both flying (0x02) AND canFly (0x04) = 0x06,
          // otherwise the server ignores the flying flag.

          if (controls.flyToggle && _serverCanFly) {
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
          // Survival / adventure — restore normal gravity if spectator left it zeroed
          if (bot.physics.gravity === 0) bot.creative.stopFlying();
          // Apply controls unchanged
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
