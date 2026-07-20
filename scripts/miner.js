#!/usr/bin/env node
/**
 * Autonomous miner bot — strict floor-based horizontal mining.
 *
 * Rules:
 *  - Mines ONLY horizontally on each floor. Never digs the floor itself.
 *  - Before stepping to any position, checks the floor block (Y-1).
 *    If missing (cave below), fills it with dirt before proceeding.
 *  - Skips any column whose horizontal neighbors contain lava or water.
 *  - Never digs into lava or water.
 *  - Uses the bot's full chunk X-ray to look one block ahead before acting.
 *  - Each floor is 2 blocks tall (feet + head). Ceiling is never touched.
 *
 * Usage:
 *   node scripts/miner.js
 *
 * Required env vars:
 *   MINE_ENTRANCE_X/Y/Z  Where to teleport/pathfind to start mining
 *                        Y is the FLOOR level (bot stands on this, never digs it)
 *
 * Optional env vars:
 *   MINE_DEPTH      Length of each branch tunnel   (default 20)
 *   MINE_FLOORS     Number of floors               (default 3)
 *   MC_HOST / MC_PORT / BOT_NAME
 */

const mineflayer = require('../bridge/node_modules/mineflayer');
const { pathfinder, Movements, goals: { GoalBlock } } =
  require('../bridge/node_modules/mineflayer-pathfinder');
const Vec3 = require('../bridge/node_modules/vec3');

// ── Config ────────────────────────────────────────────────────────────────────
const MC_HOST    = process.env.MC_HOST    || 'localhost';
const MC_PORT    = parseInt(process.env.MC_PORT    || '25565');
const BOT_NAME   = process.env.BOT_NAME   || 'MinerBot';

const ENTRANCE_X = process.env.MINE_ENTRANCE_X != null ? parseInt(process.env.MINE_ENTRANCE_X) : null;
const ENTRANCE_Y = process.env.MINE_ENTRANCE_Y != null ? parseInt(process.env.MINE_ENTRANCE_Y) : null;
const ENTRANCE_Z = process.env.MINE_ENTRANCE_Z != null ? parseInt(process.env.MINE_ENTRANCE_Z) : null;

const BRANCH_DEPTH   = parseInt(process.env.MINE_DEPTH  || '20');
const FLOORS         = parseInt(process.env.MINE_FLOORS || '3');
const BRANCH_SPACING = 4;  // main tunnel blocks between each branch pair
const FLOOR_GAP      = 3;  // vertical distance between floors

// ── Helpers ───────────────────────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log   = (...a) => console.log(`[${BOT_NAME}]`, ...a);

const DANGEROUS  = new Set(['lava', 'flowing_lava', 'water', 'flowing_water']);
const NEVER_DIG  = new Set(['bedrock', 'air']);

function blockName(bot, pos) {
  return bot.blockAt(pos)?.name ?? 'air';
}

// Returns true if any of the 4 horizontal neighbours at pos are dangerous
function horizontalDanger(bot, pos) {
  for (const [dx, dz] of [[1,0],[-1,0],[0,1],[0,-1]]) {
    const n = blockName(bot, pos.offset(dx, 0, dz));
    if (DANGEROUS.has(n)) return true;
  }
  return false;
}

async function digBlock(bot, pos) {
  const b = bot.blockAt(pos);
  if (!b || NEVER_DIG.has(b.name) || DANGEROUS.has(b.name)) return;
  try { await bot.dig(b); } catch (e) { log(`dig failed at ${pos}: ${e.message}`); }
}

// Place dirt at pos using one from inventory
async function placeDirt(bot, pos) {
  const dirt = bot.inventory.items().find(i =>
    ['dirt', 'gravel', 'sand', 'cobblestone', 'stone', 'netherrack'].includes(i.name));
  if (!dirt) { log('⚠️  No fill material — cannot patch hole at', pos); return false; }
  try {
    await bot.equip(dirt, 'hand');
    // Place on the block below (needs a reference surface)
    const below = bot.blockAt(pos.offset(0, -1, 0));
    if (below && below.name !== 'air') {
      await bot.placeBlock(below, new Vec3(0, 1, 0));
    }
    return true;
  } catch (e) {
    log(`place failed at ${pos}: ${e.message}`);
    return false;
  }
}

// Ensure the floor block at (x, floorY, z) exists. Fill with dirt if not.
// Returns false if unsafe to proceed (dangerous block found).
async function ensureFloor(bot, x, floorY, z) {
  const floorPos = new Vec3(x, floorY, z);
  const name = blockName(bot, floorPos);

  if (DANGEROUS.has(name)) {
    log(`⚠️  Dangerous floor at ${floorPos} (${name}) — skipping column`);
    return false;
  }
  if (name === 'air') {
    log(`🧱 Patching hole at floor ${floorPos}`);
    const ok = await placeDirt(bot, floorPos);
    if (!ok) return false;
  }
  return true;
}

// Dig a 2-tall tunnel cell at (x, floorY+1, z) and (x, floorY+2, z).
// Checks floor at floorY first. Skips if dangerous neighbours.
// Returns true if cell was cleared.
async function clearCell(bot, x, floorY, z) {
  // X-ray check before touching anything
  const feetPos = new Vec3(x, floorY + 1, z);
  const headPos = new Vec3(x, floorY + 2, z);

  // Skip if horizontal danger at either height
  if (horizontalDanger(bot, feetPos) || horizontalDanger(bot, headPos)) {
    log(`⚠️  Horizontal danger adjacent to ${x},${floorY+1},${z} — skipping`);
    return false;
  }

  // Ensure floor is solid
  const floorOk = await ensureFloor(bot, x, floorY, z);
  if (!floorOk) return false;

  // Now safe to dig the 2-tall cell
  await digBlock(bot, feetPos);
  await digBlock(bot, headPos);
  return true;
}

async function goTo(bot, x, y, z) {
  try {
    await bot.pathfinder.goto(new GoalBlock(x, y, z));
  } catch (e) {
    log(`pathfinder could not reach ${x},${y},${z}: ${e.message}`);
  }
}

// Scan nearby for a chest
function findNearbyChest(bot) {
  const pos = bot.entity.position;
  for (let dx = -10; dx <= 10; dx++) {
    for (let dy = -5; dy <= 5; dy++) {
      for (let dz = -10; dz <= 10; dz++) {
        const b = bot.blockAt(pos.offset(dx, dy, dz));
        if (b && b.name === 'chest') return b.position;
      }
    }
  }
  return null;
}

async function depositToChest(bot, chestPos) {
  log('📦 Heading to chest...');
  await goTo(bot, chestPos.x, chestPos.y + 1, chestPos.z);
  try {
    const chest = await bot.openChest(bot.blockAt(chestPos));
    const keep = new Set(['ladder', 'torch', 'dirt', 'gravel', 'pickaxe',
      'cobblestone', 'stone', 'iron_pickaxe', 'diamond_pickaxe',
      'golden_pickaxe', 'wooden_pickaxe', 'stone_pickaxe']);
    for (const item of bot.inventory.items()) {
      if ([...keep].some(k => item.name.includes(k))) continue;
      try { await chest.deposit(item.type, null, item.count); } catch (_) {}
    }
    chest.close();
    log('✅ Deposit done');
  } catch (e) { log('chest error:', e.message); }
}

function inventoryAlmostFull(bot) {
  return bot.inventory.emptySlotCount() <= 4;
}

// ── Main ──────────────────────────────────────────────────────────────────────
const bot = mineflayer.createBot({
  host: MC_HOST, port: MC_PORT,
  username: BOT_NAME, auth: 'offline', version: '1.19.4',
});
bot.loadPlugin(pathfinder);

bot.once('spawn', async () => {
  log(`✅ Spawned at ${bot.entity.position}`);

  const moves = new Movements(bot);
  moves.allowSprinting = true;
  moves.canDig = true;
  bot.pathfinder.setMovements(moves);

  // Determine starting floor Y
  let startX, startFloorY, startZ;

  if (ENTRANCE_X != null && ENTRANCE_Y != null && ENTRANCE_Z != null) {
    startX      = ENTRANCE_X;
    startFloorY = ENTRANCE_Y;  // Y of the floor blocks (bot stands one above)
    startZ      = ENTRANCE_Z;
    log(`Pathfinding to mine entrance at ${startX},${startFloorY},${startZ}`);
    await goTo(bot, startX, startFloorY + 1, startZ);
  } else {
    // Use current position
    const p = bot.entity.position.floored();
    startX      = p.x;
    startFloorY = p.y - 1;  // floor is one below feet
    startZ      = p.z;
    log(`No entrance given — mining from current position. Floor Y=${startFloorY}`);
  }

  // ── Mine floors ────────────────────────────────────────────────────────────
  for (let floor = 0; floor < FLOORS; floor++) {
    const floorY = startFloorY - floor * FLOOR_GAP;
    log(`\n🏗️  Floor ${floor + 1}/${FLOORS} — floor blocks at Y=${floorY}, tunnels at Y=${floorY+1}`);

    // Navigate to this floor's start
    await goTo(bot, startX, floorY + 1, startZ);

    // Main tunnel eastward (+X)
    for (let step = 1; step <= BRANCH_DEPTH; step++) {
      const mx = startX + step;

      // Deposit if full
      if (inventoryAlmostFull(bot)) {
        const chest = findNearbyChest(bot);
        if (chest) {
          await depositToChest(bot, chest);
          await goTo(bot, mx - 1, floorY + 1, startZ);
        } else {
          log('⚠️  Inventory almost full but no chest found nearby');
        }
      }

      // Clear this cell in the main tunnel
      const cleared = await clearCell(bot, mx, floorY, startZ);
      if (cleared) await goTo(bot, mx, floorY + 1, startZ);

      // Branch pair every BRANCH_SPACING steps
      if (step % BRANCH_SPACING === 0) {
        // North branch (-Z)
        log(`  ↑ Branch north from x=${mx}`);
        for (let b = 1; b <= BRANCH_DEPTH; b++) {
          await clearCell(bot, mx, floorY, startZ - b);
          await sleep(30);
        }
        await goTo(bot, mx, floorY + 1, startZ);

        // South branch (+Z)
        log(`  ↓ Branch south from x=${mx}`);
        for (let b = 1; b <= BRANCH_DEPTH; b++) {
          await clearCell(bot, mx, floorY, startZ + b);
          await sleep(30);
        }
        await goTo(bot, mx, floorY + 1, startZ);
      }
    }

    log(`✅ Floor ${floor + 1} done`);
  }

  // Final deposit and return
  const chest = findNearbyChest(bot);
  if (chest) await depositToChest(bot, chest);

  await goTo(bot, startX, startFloorY + 1, startZ);
  log('🏁 All floors mined. Returned to entrance.');
});

bot.on('error', e  => log('error:', e.message));
bot.on('end',   () => { log('disconnected'); process.exit(0); });
process.on('SIGINT', () => { bot.quit(); setTimeout(() => process.exit(0), 500); });
