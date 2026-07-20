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
  console.log('Bot is online — press Ctrl+C to disconnect');

  // Walk in a small square using control keys
  const sequence = [
    ['forward', 1500],
    ['forward', false],
    ['right', 1500],
    ['right', false],
    ['back', 1500],
    ['back', false],
    ['left', 1500],
    ['left', false],
  ];

  let i = 0;
  const step = () => {
    if (i >= sequence.length) { i = 0; }
    const [key, val] = sequence[i++];
    if (val === false) {
      bot.clearControlStates();
      setTimeout(step, 300);
    } else {
      bot.setControlState(key, true);
      setTimeout(step, val);
    }
  };
  setTimeout(step, 1000);
});

bot.on('error', (err) => console.error('Bot error:', err.message));
bot.on('end', () => { console.log('TestPlayer disconnected'); process.exit(0); });

process.on('SIGINT', () => { bot.quit(); setTimeout(() => process.exit(0), 500); });
