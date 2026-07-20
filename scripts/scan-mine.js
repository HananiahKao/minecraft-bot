#!/usr/bin/env node
/**
 * Mine scanner — connects, waits for chunks to load, then scans a volume
 * around the spawn point for air pockets that look like mine tunnels.
 *
 * Outputs:
 *  - Which Y levels contain significant horizontal air (tunnel floors)
 *  - Bounding box of air at each Y level
 *  - Water/lava locations
 *  - Suggested MINE_ENTRANCE coordinates for miner.js
 *
 * Usage:
 *   node scripts/scan-mine.js
 *
 * Env:
 *   SCAN_X / SCAN_Y / SCAN_Z   Centre of scan (default: bot spawn position)
 *   SCAN_RADIUS                 Horizontal radius to scan (default: 40)
 *   SCAN_Y_MIN / SCAN_Y_MAX    Vertical range            (default: -64 to 80)
 */

const mineflayer = require('../bridge/node_modules/mineflayer');
const Vec3 = require('../bridge/node_modules/vec3');

const MC_HOST = process.env.MC_HOST || 'localhost';
const MC_PORT = parseInt(process.env.MC_PORT || '25565');
const RADIUS  = parseInt(process.env.SCAN_RADIUS || '40');
const Y_MIN   = parseInt(process.env.SCAN_Y_MIN  || '-64');
const Y_MAX   = parseInt(process.env.SCAN_Y_MAX  || '80');

const bot = mineflayer.createBot({
  host: MC_HOST, port: MC_PORT,
  username: 'ScanBot', auth: 'offline', version: '1.19.4',
});

bot.once('spawn', async () => {
  const spawnPos = bot.entity.position.floored();
  const cx = process.env.SCAN_X != null ? parseInt(process.env.SCAN_X) : spawnPos.x;
  const cy = process.env.SCAN_Y != null ? parseInt(process.env.SCAN_Y) : spawnPos.y;
  const cz = process.env.SCAN_Z != null ? parseInt(process.env.SCAN_Z) : spawnPos.z;

  console.log(`ScanBot spawned at ${spawnPos}`);
  console.log(`Scanning ${RADIUS*2}×${Y_MAX-Y_MIN}×${RADIUS*2} volume centred on ${cx},${cy},${cz}`);
  console.log('Waiting 5s for chunks to load...\n');

  await new Promise(r => setTimeout(r, 5000));

  const LIQUID = new Set(['water','flowing_water','lava','flowing_lava']);

  // floorY → { airCells: Set<"x,z">, minX, maxX, minZ, maxZ, liquids: [] }
  const floors = new Map();
  const liquids = [];

  for (let y = Y_MIN; y <= Y_MAX; y++) {
    let airCount = 0;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    const airCells = new Set();

    for (let dx = -RADIUS; dx <= RADIUS; dx++) {
      for (let dz = -RADIUS; dz <= RADIUS; dz++) {
        const x = cx + dx, z = cz + dz;
        const b     = bot.blockAt(new Vec3(x, y, z));
        const above = bot.blockAt(new Vec3(x, y+1, z));
        const name  = b?.name ?? 'air';
        const aboveName = above?.name ?? 'air';

        if (LIQUID.has(name)) {
          liquids.push({ x, y, z, type: name });
          continue;
        }

        // A tunnel cell: both this block AND block above are air
        if (name === 'air' && aboveName === 'air') {
          // Check it has a solid floor below
          const below = bot.blockAt(new Vec3(x, y-1, z));
          const belowName = below?.name ?? 'air';
          if (belowName !== 'air' && !LIQUID.has(belowName)) {
            airCount++;
            airCells.add(`${x},${z}`);
            minX = Math.min(minX, x); maxX = Math.max(maxX, x);
            minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
          }
        }
      }
    }

    // A floor is interesting if it has at least 10 tunnel cells
    if (airCount >= 10) {
      floors.set(y, { airCount, airCells, minX, maxX, minZ, maxZ });
    }
  }

  // ── Report ────────────────────────────────────────────────────────────────
  console.log('═══════════════════════════════════════════');
  console.log('MINE SCAN RESULTS');
  console.log('═══════════════════════════════════════════\n');

  if (floors.size === 0) {
    console.log('No mine tunnels found in scanned volume.');
    console.log('Try adjusting SCAN_RADIUS or SCAN_Y_MIN/SCAN_Y_MAX.');
  } else {
    // Sort floors by Y descending (top to bottom)
    const sorted = [...floors.entries()].sort((a,b) => b[0] - a[0]);

    console.log(`Found ${sorted.length} floor level(s):\n`);
    for (const [y, info] of sorted) {
      const w = info.maxX - info.minX + 1;
      const d = info.maxZ - info.minZ + 1;
      console.log(`  Floor Y=${y}  (tunnels at Y=${y} and Y=${y+1})`);
      console.log(`    Air cells : ${info.airCount}`);
      console.log(`    X range   : ${info.minX} → ${info.maxX}  (${w} blocks wide)`);
      console.log(`    Z range   : ${info.minZ} → ${info.maxZ}  (${d} blocks deep)`);

      // Find the "origin" — leftmost, nearest-to-centre point
      // Good candidate for MINE_ENTRANCE
      const entranceX = info.minX;
      const entranceZ = Math.round((info.minZ + info.maxZ) / 2);
      console.log(`    Suggested entrance: MINE_ENTRANCE_X=${entranceX} MINE_ENTRANCE_Y=${y-1} MINE_ENTRANCE_Z=${entranceZ}`);
      console.log();
    }

    // Liquid report
    if (liquids.length > 0) {
      console.log(`Liquids found (${liquids.length} blocks):`);
      // Group by type
      const byType = {};
      for (const l of liquids) {
        (byType[l.type] = byType[l.type] || []).push(l);
      }
      for (const [type, blocks] of Object.entries(byType)) {
        const ys = [...new Set(blocks.map(b => b.y))].sort((a,b)=>a-b);
        console.log(`  ${type}: ${blocks.length} blocks at Y=${ys.join(',')}`);
      }
    } else {
      console.log('No liquids found in scan area.');
    }

    // Pattern analysis — try to detect branch spacing
    console.log('\nPattern analysis:');
    for (const [y, info] of sorted) {
      // Find which X columns have air and look for repeating Z patterns
      const xCols = new Map();
      for (const key of info.airCells) {
        const [x, z] = key.split(',').map(Number);
        if (!xCols.has(x)) xCols.set(x, []);
        xCols.get(x).push(z);
      }
      // Look for Z values that appear at many X columns (= main tunnel)
      const zFreq = new Map();
      for (const zList of xCols.values()) {
        for (const z of zList) {
          zFreq.set(z, (zFreq.get(z) || 0) + 1);
        }
      }
      const mainTunnelZs = [...zFreq.entries()]
        .filter(([,c]) => c >= Math.min(10, xCols.size * 0.5))
        .map(([z]) => z).sort((a,b)=>a-b);

      if (mainTunnelZs.length > 0) {
        console.log(`  Floor Y=${y}: main tunnel runs along Z=${mainTunnelZs.join(',')}`);
      }

      // Look for repeating branch X positions
      const branchXs = [...xCols.entries()]
        .filter(([, zs]) => zs.length >= 3)
        .map(([x]) => x).sort((a,b)=>a-b);
      if (branchXs.length >= 2) {
        const gaps = [];
        for (let i = 1; i < branchXs.length; i++) gaps.push(branchXs[i] - branchXs[i-1]);
        const commonGap = gaps.sort((a,b) =>
          gaps.filter(g=>g===a).length - gaps.filter(g=>g===b).length
        ).pop();
        console.log(`  Floor Y=${y}: branches at X=${branchXs.join(',')} (most common gap: ${commonGap})`);
      }
    }
  }

  console.log('\n═══════════════════════════════════════════');
  bot.quit();
});

bot.on('error', e => { console.error('error:', e.message); process.exit(1); });
bot.on('end',   () => process.exit(0));
