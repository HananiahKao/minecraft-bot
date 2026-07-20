#!/usr/bin/env node
/**
 * Autonomous miner — full 100×100 floor excavation.
 *
 * Behaviour:
 *  1. Pathfinds from spawn to the mine entrance (ladder top).
 *  2. Descends ladder shaft to the target floor Y level.
 *  3. Excavates the full AREA_SIZE×AREA_SIZE area in a snake pattern.
 *     Each column is 3 blocks tall (floor block is never touched).
 *     Before every column: X-ray-checks the floor block and 4 horizontal
 *     neighbours — fills holes with dirt, skips lava/water.
 *  4. When inventory has ≤ 4 empty slots, walks to the chest, deposits
 *     everything except tools/ladders, then pathfinds back to resume.
 *  5. Stops when the full area is cleared. Climbs back to surface.
 *
 * Config (env vars — all optional, defaults match current mine):
 *   ENTRANCE_X/Y/Z   Ladder top coords     (default 215 70 -281)
 *   FLOOR_Y          Y of the floor blocks (default 51 — one floor below existing)
 *   CHEST_X/Y/Z      Chest to deposit into (default 212 71 -286)
 *   AREA_CX/CZ       Centre of mining area (default entrance X/Z)
 *   AREA_SIZE        Side length in blocks (default 100)
 *   MC_HOST/MC_PORT/BOT_NAME
 */

const mineflayer = require('../bridge/node_modules/mineflayer');
const { pathfinder, Movements, goals: { GoalBlock, GoalNear } } =
  require('../bridge/node_modules/mineflayer-pathfinder');
const Vec3 = require('../bridge/node_modules/vec3');

// ── Config ────────────────────────────────────────────────────────────────────
const HOST    = process.env.MC_HOST   || 'localhost';
const PORT    = parseInt(process.env.MC_PORT   || '25565');
const NAME    = process.env.BOT_NAME  || 'MinerBot';

const ENT_X   = parseInt(process.env.ENTRANCE_X || '215');
const ENT_Y   = parseInt(process.env.ENTRANCE_Y || '70');
const ENT_Z   = parseInt(process.env.ENTRANCE_Z || '-281');

const FLOOR_Y = parseInt(process.env.FLOOR_Y   || '51');  // floor blocks sit here

const CHEST_X = parseInt(process.env.CHEST_X   || '212');
const CHEST_Y = parseInt(process.env.CHEST_Y   || '71');
const CHEST_Z = parseInt(process.env.CHEST_Z   || '-286');

const AREA_SIZE = parseInt(process.env.AREA_SIZE || '100');
const AREA_CX   = parseInt(process.env.AREA_CX  || String(ENT_X));
const AREA_CZ   = parseInt(process.env.AREA_CZ  || String(ENT_Z));

// Derived area bounds
const X_MIN = AREA_CX - Math.floor(AREA_SIZE / 2);
const X_MAX = X_MIN + AREA_SIZE - 1;
const Z_MIN = AREA_CZ - Math.floor(AREA_SIZE / 2);
const Z_MAX = Z_MIN + AREA_SIZE - 1;

const TUNNEL_HEIGHT = 3; // blocks of clearance above floor

// ── Helpers ───────────────────────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log   = (...a) => console.log(`[${NAME}]`, ...a);

const LIQUID   = new Set(['water','flowing_water','lava','flowing_lava']);
const NO_DIG   = new Set(['air','bedrock','water','flowing_water','lava','flowing_lava']);
const KEEP     = (name) => name.includes('pickaxe') || name.includes('shovel') ||
                            name.includes('axe') || name === 'ladder' || name === 'torch' ||
                            name.includes('dirt') || name.includes('sword');

function bname(bot, pos) { return bot.blockAt(pos)?.name ?? 'air'; }

function horizontalDanger(bot, pos) {
  for (const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]) {
    if (LIQUID.has(bname(bot, pos.offset(dx,0,dz)))) return true;
  }
  return false;
}

async function digOne(bot, pos) {
  const b = bot.blockAt(pos);
  if (!b || NO_DIG.has(b.name)) return;
  try { await bot.dig(b); } catch(e) { log(`dig err at ${pos}: ${e.message}`); }
}

async function placeFill(bot, pos) {
  const fill = bot.inventory.items().find(i =>
    ['dirt','gravel','cobblestone','stone','sand'].includes(i.name));
  if (!fill) { log('⚠ No fill material for hole at', pos); return false; }
  try {
    await bot.equip(fill, 'hand');
    const below = bot.blockAt(pos.offset(0,-1,0));
    if (below && below.name !== 'air') {
      await bot.placeBlock(below, new Vec3(0,1,0));
      return true;
    }
  } catch(e) { log(`place err at ${pos}: ${e.message}`); }
  return false;
}

async function goTo(bot, x, y, z) {
  try { await bot.pathfinder.goto(new GoalBlock(x, y, z)); }
  catch(e) { log(`nav fail → ${x},${y},${z}: ${e.message}`); }
}

async function deposit(bot) {
  log('📦 Going to chest...');
  await goTo(bot, CHEST_X, CHEST_Y, CHEST_Z);
  try {
    const chestBlock = bot.blockAt(new Vec3(CHEST_X, CHEST_Y, CHEST_Z));
    const chest = await bot.openChest(chestBlock);
    await sleep(300);
    for (const item of [...bot.inventory.items()]) {
      if (KEEP(item.name)) continue;
      try { await chest.deposit(item.type, null, item.count); await sleep(100); }
      catch(_) {}
    }
    await chest.close();
    log('✅ Deposited');
  } catch(e) { log('chest err:', e.message); }
}

function inventoryAlmostFull(bot) {
  return bot.inventory.emptySlotCount() <= 4;
}

// ── Core: clear one column (floor at floorY, 3 blocks above) ─────────────────
async function clearColumn(bot, x, z) {
  const floorPos = new Vec3(x, FLOOR_Y, z);

  // Check danger in all tunnel rows and horizontal neighbours
  for (let dy = 1; dy <= TUNNEL_HEIGHT; dy++) {
    const p = floorPos.offset(0, dy, 0);
    if (LIQUID.has(bname(bot, p))) { log(`⚠ Liquid in tunnel at ${p} — skip`); return false; }
    if (horizontalDanger(bot, p)) { log(`⚠ Liquid neighbour at ${p} — skip`); return false; }
  }

  // Ensure floor block exists (fill hole if cave below)
  const floorName = bname(bot, floorPos);
  if (LIQUID.has(floorName)) { log(`⚠ Liquid floor at ${floorPos} — skip`); return false; }
  if (floorName === 'air') {
    log(`🧱 Hole at floor ${floorPos} — patching`);
    const ok = await placeFill(bot, floorPos);
    if (!ok) return false;
  }

  // Dig the 3 tunnel blocks
  for (let dy = 1; dy <= TUNNEL_HEIGHT; dy++) {
    await digOne(bot, floorPos.offset(0, dy, 0));
  }
  return true;
}

// ── Main ──────────────────────────────────────────────────────────────────────
const bot = mineflayer.createBot({ host:HOST, port:PORT, username:NAME, auth:'offline', version:'1.19.4' });
bot.loadPlugin(pathfinder);

bot.once('spawn', async () => {
  log(`Spawned at ${bot.entity.position}`);
  log(`Mine entrance: ${ENT_X},${ENT_Y},${ENT_Z}`);
  log(`Floor Y: ${FLOOR_Y}  (tunnels at Y=${FLOOR_Y+1}–${FLOOR_Y+TUNNEL_HEIGHT})`);
  log(`Area: X ${X_MIN}→${X_MAX}, Z ${Z_MIN}→${Z_MAX} (${AREA_SIZE}×${AREA_SIZE})`);
  log(`Chest: ${CHEST_X},${CHEST_Y},${CHEST_Z}`);

  const moves = new Movements(bot);
  moves.allowSprinting = true;
  moves.canDig = true;
  bot.pathfinder.setMovements(moves);

  // ── Step 1: Pathfind to mine entrance ──────────────────────────────────────
  log('🚶 Pathfinding to mine entrance...');
  await goTo(bot, ENT_X, ENT_Y, ENT_Z);
  log('✅ At entrance');

  // ── Step 2: Descend to floor level via ladder (pathfinder handles it) ──────
  log(`⬇ Descending to floor Y=${FLOOR_Y+1}...`);
  await goTo(bot, ENT_X, FLOOR_Y + 1, ENT_Z);
  log(`✅ At mining level`);

  // ── Step 3: Snake-pattern excavation ───────────────────────────────────────
  let totalCleared = 0;
  const totalColumns = AREA_SIZE * AREA_SIZE;

  for (let zi = 0; zi <= Z_MAX - Z_MIN; zi++) {
    const z = Z_MIN + zi;
    // Alternate X direction each row (snake)
    const xStart = zi % 2 === 0 ? X_MIN : X_MAX;
    const xEnd   = zi % 2 === 0 ? X_MAX : X_MIN;
    const xStep  = zi % 2 === 0 ? 1 : -1;

    for (let x = xStart; x !== xEnd + xStep; x += xStep) {
      // Deposit if inventory almost full, then return to current spot
      if (inventoryAlmostFull(bot)) {
        await deposit(bot);
        // Return to current position after deposit
        await goTo(bot, ENT_X, ENT_Y, ENT_Z);          // back to entrance
        await goTo(bot, ENT_X, FLOOR_Y + 1, ENT_Z);    // down the ladder
        await goTo(bot, x, FLOOR_Y + 1, z);            // back to work position
      }

      const cleared = await clearColumn(bot, x, z);
      if (cleared) {
        totalCleared++;
        // Move bot to cleared position
        try { await bot.pathfinder.goto(new GoalBlock(x, FLOOR_Y + 1, z)); }
        catch(_) {}
      }

      if (totalCleared % 100 === 0 && totalCleared > 0) {
        log(`Progress: ${totalCleared}/${totalColumns} columns (${Math.round(totalCleared/totalColumns*100)}%)`);
      }

      await sleep(20); // slight yield to avoid CPU spike
    }

    log(`Row Z=${z} done (${totalCleared} columns cleared so far)`);
  }

  // ── Step 4: Final deposit and surface ────────────────────────────────────
  if (!bot.inventory.items().every(i => KEEP(i.name))) await deposit(bot);
  log('🏁 Floor complete — climbing back to surface...');
  await goTo(bot, ENT_X, ENT_Y, ENT_Z);
  log(`✅ Done. ${totalCleared} columns cleared on floor Y=${FLOOR_Y}.`);
});

bot.on('error', e  => { log('error:', e.message); });
bot.on('end',   () => { log('disconnected'); process.exit(0); });
process.on('SIGINT', () => { bot.quit(); setTimeout(() => process.exit(0), 500); });
