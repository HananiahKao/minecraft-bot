#!/usr/bin/env node
// Spawns a second Mineflayer bot as a visible player for testing entity rendering.
// Usage: node scripts/test-player-bot.js
// Ctrl+C to disconnect.

const mineflayer = require('../bridge/node_modules/mineflayer');

const bot = mineflayer.createBot({
  host: 'localhost',
  port: 25565,
  username: 'TestPlayer',
  auth: 'offline',
  version: '1.19.4',
});

bot.once('spawn', () => {
  console.log(`✅ TestPlayer spawned at ${bot.entity.position}`);

  setTimeout(async () => {
    // Find the nearest log block within 5 blocks
    const pos = bot.entity.position;
    let target = null;
    for (let dx = -5; dx <= 5 && !target; dx++) {
      for (let dy = -2; dy <= 5 && !target; dy++) {
        for (let dz = -5; dz <= 5 && !target; dz++) {
          const b = bot.blockAt(pos.offset(dx, dy, dz));
          if (b && b.name.includes('log')) target = b;
        }
      }
    }

    if (target) {
      console.log(`🪓 Found ${target.name} at ${target.position} — digging...`);
      try {
        await bot.dig(target);
        console.log('✅ Dug the log!');
      } catch (e) {
        console.log('dig error:', e.message);
      }
    } else {
      // No tree found — dig the block below feet instead
      const below = bot.blockAt(pos.offset(0, -1, 0));
      console.log(`⛏️  No log nearby — digging ground block: ${below?.name}`);
      if (below && below.name !== 'air' && below.name !== 'bedrock') {
        try {
          await bot.dig(below);
          console.log('✅ Dug the ground!');
        } catch (e) {
          console.log('dig error:', e.message);
        }
      }
    }
  }, 2000);
});

bot.on('error', (err) => console.error('Bot error:', err.message));
bot.on('end', () => { console.log('TestPlayer disconnected'); process.exit(0); });

process.on('SIGINT', () => { bot.quit(); setTimeout(() => process.exit(0), 500); });
