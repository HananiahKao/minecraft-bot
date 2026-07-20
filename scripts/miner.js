#!/usr/bin/env node
/**
 * Autonomous miner bot.
 *
 * Behaviour:
 *   1. Digs a vertical entry shaft at its spawn position, placing ladders as it goes.
 *   2. At the target Y level it starts a main east tunnel.
 *   3. Every BRANCH_SPACING blocks it digs branch tunnels north and south.
 *   4. When inventory is full it climbs back up the ladder shaft and deposits
 *      into the designated chest, then returns and resumes.
 *   5. Avoids lava and water — reroutes or skips branch if blocked.
 *   6. Never breaks the ladder shaft column.
 *
 * Usage:
 *   node scripts/miner.js [options]
 *
 * Options (env vars):
 *   MINE_Y        Target Y level to mine at           (default: 11)
 *   MINE_DEPTH    Max depth of each branch (blocks)   (default: 20)
 *   MINE_FLOORS   Number of floors to mine            (default: 3)
 *   CHEST_X/Y/Z   Chest position for deposits         (required for auto-deposit)
 */

const mineflayer  = require('../bridge/node_modules/mineflayer');
const { pathfinder, Movements, goals: { GoalBlock, GoalNear, GoalXZ } } =
  require('../bridge/node_modules/mineflayer-pathfinder');
const Vec3 = require('../bridge/node_modules/vec3');

// ── Config ───────────────────────────────────────────────────────────────────
const MC_HOST   = process.env.MC_HOST   || 'localhost';
const MC_PORT   = parseInt(process.env.MC_PORT   || '25565');
const BOT_NAME  = process.env.BOT_NAME  || 'MinerBot';
const TARGET_Y  = parseInt(process.env.MINE_Y    || '11');
const BRANCH_DEPTH    = parseInt(process.env.MINE_DEPTH  || '20');
const FLOORS          = parseInt(process.env.MINE_FLOORS || '3');
const BRANCH_SPACING  = 4; // blocks between each branch pair along the main tunnel
const MAIN_LENGTH     = BRANCH_DEPTH; // main tunnel same length as branches

const CHEST = (process.env.CHEST_X != null) ? new Vec3(
  parseInt(process.env.CHEST_X),
  parseInt(process.env.CHEST_Y),
  parseInt(process.env.CHEST_Z),
) : null;

// ── Helpers ──────────────────────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));

const log = (...args) => console.log(`[${BOT_NAME}]`, ...args);

// Danger blocks we will not dig into
const DANGEROUS = new Set(['lava', 'flowing_lava', 'water', 'flowing_water']);

function isDangerous(bot, pos) {
  for (const offset of [[0,0,0],[0,1,0],[1,0,0],[-1,0,0],[0,0,1],[0,0,-1]]) {
    const b = bot.blockAt(pos.offset(...offset));
    if (b && DANGEROUS.has(b.name)) return true;
  }
  return false;
}

async function digIfSafe(bot, pos, shaftX, shaftZ) {
  // Never break the ladder shaft column
  if (pos.x === shaftX && pos.z === shaftZ) return false;

  if (isDangerous(bot, pos)) {
    log(`⚠️  Skipping dangerous block at ${pos}`);
    return false;
  }
  const block = bot.blockAt(pos);
  if (!block || block.name === 'air' || block.name === 'bedrock') return true;

  try {
    await bot.dig(block);
    return true;
  } catch (e) {
    log(`dig failed at ${pos}: ${e.message}`);
    return false;
  }
}

// Dig a 2-tall column at pos (floor + ceiling)
async function digColumn(bot, pos, shaftX, shaftZ) {
  await digIfSafe(bot, pos, shaftX, shaftZ);
  await digIfSafe(bot, pos.offset(0, 1, 0), shaftX, shaftZ);
}

async function goTo(bot, x, y, z) {
  try {
    await bot.pathfinder.goto(new GoalBlock(x, y, z));
  } catch (e) {
    log(`pathfinder failed to reach ${x},${y},${z}: ${e.message}`);
  }
}

// Place a ladder on the wall behind the bot in the shaft
async function placeLadder(bot, pos) {
  const ladderItem = bot.inventory.items().find(i => i.name === 'ladder');
  if (!ladderItem) return;
  try {
    // Equip and place on the north wall of the shaft (z-1 face)
    await bot.equip(ladderItem, 'hand');
    const ref = bot.blockAt(pos.offset(0, 0, -1));
    if (ref && ref.name !== 'air') await bot.placeBlock(ref, new Vec3(0, 0, 1));
  } catch (_) {}
}

// Deposit all non-essential items into chest
async function depositToChest(bot, chestPos) {
  log('📦 Heading to chest to deposit...');
  await goTo(bot, chestPos.x, chestPos.y, chestPos.z);
  try {
    const chest = await bot.openChest(bot.blockAt(chestPos));
    for (const item of bot.inventory.items()) {
      if (['ladder', 'torch'].includes(item.name)) continue; // keep tools
      try { await chest.deposit(item.type, null, item.count); } catch (_) {}
    }
    chest.close();
    log('✅ Deposit complete');
  } catch (e) {
    log('chest error:', e.message);
  }
}

function inventoryFull(bot) {
  return bot.inventory.emptySlotCount() <= 2;
}

// ── Main ─────────────────────────────────────────────────────────────────────
const bot = mineflayer.createBot({
  host: MC_HOST, port: MC_PORT,
  username: BOT_NAME, auth: 'offline',
  version: '1.19.4',
});

bot.loadPlugin(pathfinder);

bot.once('spawn', async () => {
  log(`✅ Spawned at ${bot.entity.position}`);

  const moves = new Movements(bot);
  moves.allowSprinting = true;
  moves.canDig = true;
  moves.avoid = []; // pathfinder avoids lava/water automatically
  bot.pathfinder.setMovements(moves);

  // Record the shaft position (where we start)
  const spawn = bot.entity.position.floored();
  const shaftX = spawn.x;
  const shaftZ = spawn.z;

  log(`⛏️  Starting shaft at x=${shaftX} z=${shaftZ}, digging to Y=${TARGET_Y}`);

  // ── Phase 1: Dig down the entry shaft with ladders ──────────────────────
  let currentY = spawn.y - 1;
  while (currentY >= TARGET_Y) {
    const pos = new Vec3(shaftX, currentY, shaftZ);
    if (isDangerous(bot, pos)) {
      log(`⚠️  Danger at Y=${currentY}, stopping shaft`);
      break;
    }
    const block = bot.blockAt(pos);
    if (block && block.name !== 'air' && block.name !== 'bedrock') {
      try { await bot.dig(block); } catch (_) {}
    }
    // Also clear the block above for a 2-tall shaft
    const above = bot.blockAt(pos.offset(0, 1, 0));
    if (above && above.name !== 'air') {
      try { await bot.dig(above); } catch (_) {}
    }
    await placeLadder(bot, pos);
    currentY--;
    await sleep(50);
  }

  // Navigate down to mining level
  await goTo(bot, shaftX, TARGET_Y, shaftZ);
  log(`✅ Reached mining level Y=${TARGET_Y}`);

  // ── Phase 2: Mine floors ────────────────────────────────────────────────
  for (let floor = 0; floor < FLOORS; floor++) {
    const floorY = TARGET_Y - floor * 3; // 3 blocks between floors
    log(`\n🏗️  Floor ${floor + 1}/${FLOORS} at Y=${floorY}`);

    // Navigate to this floor's origin (back at shaft)
    await goTo(bot, shaftX, floorY, shaftZ);

    // Main tunnel goes east (+X direction)
    for (let step = 1; step <= MAIN_LENGTH; step++) {
      const mainPos = new Vec3(shaftX + step, floorY, shaftZ);

      if (inventoryFull(bot) && CHEST) {
        await depositToChest(bot, CHEST);
        await goTo(bot, shaftX + step - 1, floorY, shaftZ);
      }

      await digColumn(bot, mainPos, shaftX, shaftZ);
      await goTo(bot, mainPos.x, floorY, mainPos.z);

      // Every BRANCH_SPACING blocks, dig branches north and south
      if (step % BRANCH_SPACING === 0) {
        // North branch (-Z)
        log(`  ↑ North branch at x=${mainPos.x}`);
        for (let b = 1; b <= BRANCH_DEPTH; b++) {
          const bp = new Vec3(mainPos.x, floorY, shaftZ - b);
          if (isDangerous(bot, bp)) { log('    ⚠️  Danger, stopping north branch'); break; }
          await digColumn(bot, bp, shaftX, shaftZ);
        }
        // Return to main tunnel
        await goTo(bot, mainPos.x, floorY, shaftZ);

        // South branch (+Z)
        log(`  ↓ South branch at x=${mainPos.x}`);
        for (let b = 1; b <= BRANCH_DEPTH; b++) {
          const bp = new Vec3(mainPos.x, floorY, shaftZ + b);
          if (isDangerous(bot, bp)) { log('    ⚠️  Danger, stopping south branch'); break; }
          await digColumn(bot, bp, shaftX, shaftZ);
        }
        // Return to main tunnel
        await goTo(bot, mainPos.x, floorY, shaftZ);
      }
    }

    log(`✅ Floor ${floor + 1} complete`);
  }

  // ── Phase 3: Done — climb back up ──────────────────────────────────────
  if (CHEST) await depositToChest(bot, CHEST);
  await goTo(bot, shaftX, spawn.y, shaftZ);
  log('🏁 Mining complete! Bot returned to surface.');
});

bot.on('error',  e  => log('error:', e.message));
bot.on('end',    ()  => { log('disconnected'); process.exit(0); });
process.on('SIGINT', () => { bot.quit(); setTimeout(() => process.exit(0), 500); });
