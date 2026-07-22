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
const { pathfinder, Movements, goals: { GoalBlock, GoalNear, GoalXZ } } =
  require('../bridge/node_modules/mineflayer-pathfinder');
const Vec3 = require('../bridge/node_modules/vec3');

// ── Config ────────────────────────────────────────────────────────────────────
const HOST    = process.env.MC_HOST   || 'localhost';
const PORT    = parseInt(process.env.MC_PORT   || '25565');
const NAME    = process.env.BOT_NAME  || 'MinerBot';

const ENT_X   = parseInt(process.env.ENTRANCE_X || '215');
const ENT_Y   = parseInt(process.env.ENTRANCE_Y || '70');
const ENT_Z   = parseInt(process.env.ENTRANCE_Z || '-281');

const FLOOR_Y = parseInt(process.env.FLOOR_Y   || '54');  // existing mine floor; tunnel is FLOOR_Y+1 to FLOOR_Y+3

const CHEST_X = parseInt(process.env.CHEST_X   || '212');
const CHEST_Y = parseInt(process.env.CHEST_Y   || '71');
const CHEST_Z = parseInt(process.env.CHEST_Z   || '-286');

const AREA_SIZE = parseInt(process.env.AREA_SIZE || '100');
const AREA_CX   = parseInt(process.env.AREA_CX  || String(ENT_X));
const AREA_CZ   = parseInt(process.env.AREA_CZ  || String(ENT_Z));

// Area starts at the entrance corner (AREA_CX, AREA_CZ) and expands +X / +Z.
// Both the outer (X) and inner (Z) loops advance one block at a time from the
// entrance, so every column is always adjacent to already-cleared space.
// The bot never needs to pathfind more than 1 block at a time.
const X_MIN = AREA_CX;
const X_MAX = X_MIN + AREA_SIZE - 1;
const Z_MIN = AREA_CZ;
const Z_MAX = Z_MIN + AREA_SIZE - 1;

const TUNNEL_HEIGHT = 3; // blocks of clearance above floor

// ── Helpers ───────────────────────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ts    = () => new Date().toTimeString().slice(0,8);
const log   = (...a) => console.log(`[${ts()}]`, ...a);
const pos   = (bot) => { const p = bot.entity.position; return `(${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)})`; };

const LIQUID   = new Set(['water','flowing_water','lava','flowing_lava']);
// glass is a hole-patch marker — never dig it, so patched holes stay visible
const NO_DIG   = new Set(['air','bedrock','water','flowing_water','lava','flowing_lava','glass']);
const KEEP     = (name) => name.includes('pickaxe') || name.includes('shovel') ||
                            name.includes('axe') || name === 'ladder' || name === 'torch' ||
                            name === 'glass' || name.includes('sword');

function bname(bot, pos) { return bot.blockAt(pos)?.name ?? 'air'; }

// If the bot spawns below FLOOR_Y (fell to cave bottom), climb the ladder shaft
// by walking into it and holding jump until we reach surface level.
// Pathfinder can't handle a 130-block vertical climb in one GoalBlock call.
async function climbToSurface(bot) {
  if (bot.entity.position.y >= FLOOR_Y) return; // already above floor
  log(`⚠ Bot is at Y=${bot.entity.position.y.toFixed(1)} — below floor. Climbing ladder shaft...`);

  // Face the ladder shaft entrance and walk toward it
  const shaftX = ENT_X + 0.5, shaftZ = ENT_Z + 0.5;
  // First try to get horizontally into the shaft column
  try {
    await bot.pathfinder.goto(new GoalXZ(ENT_X, ENT_Z));
  } catch(e) { /* may fail if obstructed — still try climbing */ }

  // Hold jump + forward (toward ladder wall) to climb
  bot.setControlState('jump', true);
  bot.setControlState('forward', true);
  const climbStart = Date.now();
  await new Promise(resolve => {
    const check = setInterval(() => {
      if (bot.entity.position.y >= ENT_Y - 2 || Date.now() - climbStart > 60000) {
        clearInterval(check);
        resolve();
      }
    }, 200);
  });
  bot.setControlState('jump', false);
  bot.setControlState('forward', false);
  log(`✅ Climbed to Y=${bot.entity.position.y.toFixed(1)}`);
}

function horizontalDanger(bot, pos) {
  for (const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]) {
    if (LIQUID.has(bname(bot, pos.offset(dx,0,dz)))) return true;
  }
  return false;
}

async function digOne(bot, blockPos) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const b = bot.blockAt(blockPos);
    if (!b || NO_DIG.has(b.name)) return; // air or protected — done
    if (attempt === 1) log(`  ⛏  dig ${b.name} at ${blockPos}`);
    else               log(`  ↺  retry ${attempt} dig ${b.name} at ${blockPos}`);
    try {
      await bot.dig(b);
    } catch(e) {
      log(`  ✗ dig err (attempt ${attempt}): ${e.message}`);
    }
    await sleep(100);
    // If the block is gone, we're done regardless of whether dig threw
    const after = bot.blockAt(blockPos);
    if (!after || after.name === 'air') return;
  }
  log(`  ✗ gave up on ${blockPos} after 3 attempts`);
}

// Place a fill block at floorPos (Y=FLOOR_Y) by clicking the bottom face of
// the solid block at floorPos+1 (which is still undig at call time).
// This works even over deep caves — no need for a solid block below.
async function placeFill(bot, floorPos) {
  const glass = bot.inventory.items().find(i => i.name === 'glass');
  const fill  = glass ?? bot.inventory.items().find(i =>
    ['dirt','cobblestone','stone','gravel'].includes(i.name));
  if (!fill) { log(`  ✗ No fill material — cannot patch hole at ${floorPos}`); return false; }
  if (!glass) log(`  ⚠ No glass — patching with ${fill.name}`);
  try {
    await bot.equip(fill, 'hand');
    // The block at floorPos+1 (Y=FLOOR_Y+1) is still solid here — click its
    // bottom face to place the fill block at floorPos (Y=FLOOR_Y).
    const blockAbove = bot.blockAt(floorPos.offset(0, 1, 0));
    if (blockAbove && !NO_DIG.has(blockAbove.name) && blockAbove.name !== 'air') {
      await bot.placeBlock(blockAbove, new Vec3(0, -1, 0));
      log(`  🔳 Placed ${fill.name} at ${floorPos} (clicked bottom of ${blockAbove.name} above)`);
      return true;
    }
    // Fallback: try placing on top of block below
    const blockBelow = bot.blockAt(floorPos.offset(0, -1, 0));
    if (blockBelow && blockBelow.name !== 'air') {
      await bot.placeBlock(blockBelow, new Vec3(0, 1, 0));
      log(`  🔳 Placed ${fill.name} at ${floorPos} (clicked top of ${blockBelow.name} below)`);
      return true;
    }
    log(`  ✗ No surface to place against at ${floorPos}`);
  } catch(e) { log(`  ✗ place err at ${floorPos}: ${e.message}`); }
  return false;
}

async function goTo(bot, x, y, z) {
  log(`🚶 Walking to (${x}, ${y}, ${z}) from ${pos(bot)}`);
  try { await bot.pathfinder.goto(new GoalBlock(x, y, z)); }
  catch(e) {
    log(`  ✗ nav fail → (${x},${y},${z}): ${e.message}`);
    log(`  ✗ Bot is at ${pos(bot)} after failure`);
    return false;
  }
  return true;
}

async function deposit(bot) {
  const empty = bot.inventory.emptySlotCount();
  const items = bot.inventory.items().map(i => `${i.name}×${i.count}`).join(', ');
  log(`📦 Inventory full (${empty} slots left) — going to chest`);
  log(`   Carrying: ${items || '(nothing)'}`);
  await goTo(bot, CHEST_X, CHEST_Y, CHEST_Z);
  try {
    const chestBlock = bot.blockAt(new Vec3(CHEST_X, CHEST_Y, CHEST_Z));
    const chest = await bot.openChest(chestBlock);
    await sleep(300);
    let deposited = 0;
    for (const item of [...bot.inventory.items()]) {
      if (KEEP(item.name)) { log(`   keep: ${item.name}×${item.count}`); continue; }
      try {
        await chest.deposit(item.type, null, item.count);
        log(`   deposited: ${item.name}×${item.count}`);
        deposited++;
        await sleep(100);
      } catch(e) { log(`   ✗ deposit err (${item.name}): ${e.message}`); }
    }
    await chest.close();
    log(`✅ Deposited ${deposited} stacks — ${bot.inventory.emptySlotCount()} slots free`);
  } catch(e) { log(`✗ chest err: ${e.message}`); }
}

function inventoryAlmostFull(bot) {
  return bot.inventory.emptySlotCount() <= 4;
}

// ── Core: clear one column (floor at floorY, 3 blocks above) ─────────────────
async function clearColumn(bot, x, z) {
  const floorPos = new Vec3(x, FLOOR_Y, z);
  log(`── col (${x}, ${z})  floor=${bname(bot, floorPos)}`);

  // Check danger in all tunnel rows and horizontal neighbours
  for (let dy = 1; dy <= TUNNEL_HEIGHT; dy++) {
    const p = floorPos.offset(0, dy, 0);
    const name = bname(bot, p);
    if (LIQUID.has(name)) {
      log(`  ⚠ Liquid (${name}) IN tunnel at Y=${FLOOR_Y+dy} — skipping column`);
      return false;
    }
    for (const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const nb = bname(bot, p.offset(dx,0,dz));
      if (LIQUID.has(nb)) {
        log(`  ⚠ Liquid (${nb}) NEXT TO tunnel at Y=${FLOOR_Y+dy} (${dx>0?'+X':dx<0?'-X':dz>0?'+Z':'-Z'}) — skipping column`);
        return false;
      }
    }
  }

  // Ensure floor block exists BEFORE digging the tunnel above it.
  // We place against the bottom face of floorPos+1 (still solid at this point).
  // If we dug first, there would be nothing to place against.
  const floorName = bname(bot, floorPos);
  if (LIQUID.has(floorName)) {
    log(`  ⚠ Liquid (${floorName}) at floor — skipping column`);
    return false;
  }
  if (floorName === 'glass' || floorName === 'dirt' || floorName === 'cobblestone') {
    log(`  🔳 Floor already patched (${floorName}) — clearing tunnel above`);
  } else if (floorName === 'air') {
    log(`  🕳  Cave below — placing floor before digging tunnel`);
    const ok = await placeFill(bot, floorPos);
    if (!ok) return false;
  } else {
    log(`  ✓ Floor is ${floorName}`);
  }

  // Dig the 3 tunnel blocks
  let dug = 0;
  for (let dy = 1; dy <= TUNNEL_HEIGHT; dy++) {
    const p = floorPos.offset(0, dy, 0);
    const n = bname(bot, p);
    if (!NO_DIG.has(n)) dug++;
    await digOne(bot, p);
  }
  log(`  ✅ Column done — dug ${dug} block(s)`);
  return true;
}

// ── Main ──────────────────────────────────────────────────────────────────────
const bot = mineflayer.createBot({ host:HOST, port:PORT, username:NAME, auth:'offline', version:'1.19.4' });
bot.loadPlugin(pathfinder);

bot.once('spawn', async () => {
  log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  log(`MinerBot starting`);
  log(`  Spawned at   : ${pos(bot)}`);
  log(`  Mine entrance: (${ENT_X}, ${ENT_Y}, ${ENT_Z})`);
  log(`  Floor Y      : ${FLOOR_Y}  → tunnels at Y ${FLOOR_Y+1}–${FLOOR_Y+TUNNEL_HEIGHT}`);
  log(`  Mining area  : X ${X_MIN}→${X_MAX},  Z ${Z_MIN}→${Z_MAX}  (${AREA_SIZE}×${AREA_SIZE} = ${AREA_SIZE*AREA_SIZE} columns)`);
  log(`  Deposit chest: (${CHEST_X}, ${CHEST_Y}, ${CHEST_Z})`);
  log(`  Inventory    : ${bot.inventory.emptySlotCount()} empty slots`);
  log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

  const moves = new Movements(bot);
  moves.allowSprinting = true;
  moves.canDig = true;
  bot.pathfinder.setMovements(moves);

  // If bot spawned below the mine floor (fell to cave bottom), climb out first
  await climbToSurface(bot);

  // ── Step 0: Pick up fill material from chest ───────────────────────────────
  log(`\n▶ STEP 0 — Stock up on fill material from chest`);
  await goTo(bot, CHEST_X, CHEST_Y, CHEST_Z);
  try {
    const chestBlock = bot.blockAt(new Vec3(CHEST_X, CHEST_Y, CHEST_Z));
    const chest = await bot.openChest(chestBlock);
    await sleep(300);
    // Withdraw up to 2 stacks of glass, then up to 2 stacks of dirt as fallback
    for (const wantName of ['glass', 'dirt', 'cobblestone']) {
      const already = bot.inventory.items().filter(i => i.name === wantName)
        .reduce((s, i) => s + i.count, 0);
      if (already >= 64) { log(`  already have ${already} ${wantName}`); continue; }
      const inChest = chest.containerItems().find(i => i.name === wantName);
      if (inChest) {
        const take = Math.min(inChest.count, 128 - already);
        try {
          await chest.withdraw(inChest.type, null, take);
          log(`  withdrew ${take}× ${wantName}`);
          await sleep(150);
        } catch(e) { log(`  ✗ withdraw ${wantName}: ${e.message}`); }
      } else {
        log(`  no ${wantName} in chest`);
      }
    }
    await chest.close();
    const inv = bot.inventory.items().map(i => `${i.name}×${i.count}`).join(', ');
    log(`  Inventory after stocking: ${inv || '(empty)'}`);
  } catch(e) { log(`✗ chest err at startup: ${e.message}`); }

  // ── Step 1: Pathfind to mine entrance ──────────────────────────────────────
  log(`\n▶ STEP 1 — Travel to mine entrance`);
  await goTo(bot, ENT_X, ENT_Y, ENT_Z);
  log(`✅ Arrived at entrance ${pos(bot)}`);

  // ── Step 2: Descend to floor level via ladder (pathfinder handles it) ──────
  log(`\n▶ STEP 2 — Descend ladder to floor Y=${FLOOR_Y+1}`);
  await goTo(bot, ENT_X, FLOOR_Y + 1, ENT_Z);
  log(`✅ At mining level ${pos(bot)}`);

  // ── Step 3: Snake-pattern excavation ───────────────────────────────────────
  // Outer loop: X slices starting at the entrance and advancing outward (+X).
  // Each new X-slice is adjacent to the previously cleared one, so the bot
  // always walks into open space — never needs to path through solid stone.
  // Inner loop: Z rows snaking back and forth within each X-slice.
  log(`\n▶ STEP 3 — Begin excavation`);
  let totalCleared = 0;
  let totalSkipped = 0;
  const totalColumns = AREA_SIZE * AREA_SIZE;

  for (let xi = 0; xi <= X_MAX - X_MIN; xi++) {
    const x = X_MIN + xi;
    const zStart = xi % 2 === 0 ? Z_MIN : Z_MAX;
    const zEnd   = xi % 2 === 0 ? Z_MAX : Z_MIN;
    const zStep  = xi % 2 === 0 ? 1 : -1;
    log(`\n── Slice ${xi+1}/${AREA_SIZE}  X=${x}  sweeping Z ${zStart}→${zEnd}`);

    for (let z = zStart; z !== zEnd + zStep; z += zStep) {
      // Never dig the entrance shaft — it's the only way in/out
      if (x === ENT_X && z === ENT_Z) {
        log(`  ⚠ Skipping entrance shaft column (${x}, ${z})`);
        totalSkipped++;
        continue;
      }

      if (inventoryAlmostFull(bot)) {
        log(`\n⚠ Inventory low (${bot.inventory.emptySlotCount()} slots) — going to deposit`);
        await deposit(bot);
        log(`↩ Returning to work position`);
        await goTo(bot, ENT_X, ENT_Y, ENT_Z);
        await goTo(bot, ENT_X, FLOOR_Y + 1, ENT_Z);
        // After returning, re-navigate to current column
        await goTo(bot, x, FLOOR_Y + 1, z - zStep); // last cleared column
      }

      // Dig the column first (bot reaches 1 block ahead without moving),
      // then step into the cleared air. Never pathfind into solid stone.
      // If the column is skipped (danger/hole), stay put — don't step in.
      const cleared = await clearColumn(bot, x, z);
      if (cleared) {
        totalCleared++;
        await goTo(bot, x, FLOOR_Y + 1, z);
        // Safety: if we fell, climb back before continuing
        const curY = Math.floor(bot.entity.position.y);
        if (curY < FLOOR_Y) {
          log(`  ⚠ Fell to Y=${curY} — climbing back to entrance`);
          await goTo(bot, ENT_X, ENT_Y, ENT_Z);
          await goTo(bot, x, FLOOR_Y + 1, z);
        }
      } else {
        totalSkipped++;
        // Don't move — stay at current position and try next column
      }

      const done = totalCleared + totalSkipped;
      if (done % 50 === 0 && done > 0) {
        const pct = Math.round(done / totalColumns * 100);
        log(`\n📊 Progress: ${done}/${totalColumns} (${pct}%) — ${totalCleared} cleared, ${totalSkipped} skipped — ${bot.inventory.emptySlotCount()} inv slots free`);
      }

      await sleep(20);
    }

    const done = totalCleared + totalSkipped;
    log(`── Slice X=${x} complete — ${totalCleared} cleared, ${totalSkipped} skipped so far (${Math.round(done/totalColumns*100)}% overall)`);
  }

  // ── Step 4: Final deposit and surface ────────────────────────────────────
  log(`\n▶ STEP 4 — Wrapping up`);
  log(`Final tally: ${totalCleared} columns cleared, ${totalSkipped} skipped`);
  if (!bot.inventory.items().every(i => KEEP(i.name))) await deposit(bot);
  log('🏁 Floor complete — climbing back to surface...');
  await goTo(bot, ENT_X, ENT_Y, ENT_Z);
  log(`✅ Done. Floor Y=${FLOOR_Y} finished.`);
});

bot.on('error', e  => { log('error:', e.message); });
bot.on('end',   () => { log('disconnected'); process.exit(0); });
process.on('SIGINT', () => { bot.quit(); setTimeout(() => process.exit(0), 500); });
