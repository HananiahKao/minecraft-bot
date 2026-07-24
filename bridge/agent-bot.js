/**
 * AgentBot — a single autonomous Minecraft bot driven by an OMLX LLM.
 *
 * Lifecycle: create → start() → [running] → stop()
 * Each instance owns one mineflayer connection.
 * The reasoning loop runs every TICK_MS and calls the OMLX API to decide
 * the next action based on current bot state + the agent's goal.
 */

import mineflayer from 'mineflayer';
import { pathfinder, Movements, goals } from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';

const OMLX_BASE = process.env.OMLX_URL || 'http://localhost:8000';
const OMLX_MODEL = process.env.OMLX_MODEL || 'lmstudio-community/Qwen2.5-Coder-7B-Instruct-MLX-4bit';
const TICK_MS = 2000; // reasoning interval
const MAX_LOG = 100;  // log lines kept per agent

const ACTION_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'move_to',
      description: 'Pathfind to a target position (x, y, z). Use when you need to reach a specific location.',
      parameters: {
        type: 'object',
        properties: {
          x: { type: 'number' },
          y: { type: 'number' },
          z: { type: 'number' },
        },
        required: ['x', 'y', 'z'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'dig_block',
      description: 'Dig/mine the block at the given position. Bot must be within 4 blocks.',
      parameters: {
        type: 'object',
        properties: {
          x: { type: 'number' },
          y: { type: 'number' },
          z: { type: 'number' },
        },
        required: ['x', 'y', 'z'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'place_block',
      description: 'Place the currently held block adjacent to a reference block.',
      parameters: {
        type: 'object',
        properties: {
          ref_x: { type: 'number', description: 'Reference block x' },
          ref_y: { type: 'number', description: 'Reference block y' },
          ref_z: { type: 'number', description: 'Reference block z' },
          face: { type: 'string', enum: ['top', 'bottom', 'north', 'south', 'east', 'west'] },
        },
        required: ['ref_x', 'ref_y', 'ref_z', 'face'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'equip_item',
      description: 'Equip an item from inventory to main hand by item name.',
      parameters: {
        type: 'object',
        properties: {
          item_name: { type: 'string', description: 'e.g. "diamond_pickaxe", "oak_planks"' },
        },
        required: ['item_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'open_container',
      description: 'Open a chest, barrel, or other container at the given position.',
      parameters: {
        type: 'object',
        properties: {
          x: { type: 'number' },
          y: { type: 'number' },
          z: { type: 'number' },
        },
        required: ['x', 'y', 'z'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'deposit_to_chest',
      description: 'Open a chest and deposit items from inventory. Must be near the chest first.',
      parameters: {
        type: 'object',
        properties: {
          chest_x: { type: 'number' },
          chest_y: { type: 'number' },
          chest_z: { type: 'number' },
          item_name: { type: 'string' },
          count: { type: 'number', description: 'How many to deposit. 0 or omit = all.' },
        },
        required: ['chest_x', 'chest_y', 'chest_z', 'item_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'withdraw_from_chest',
      description: 'Open a chest and take items from it into inventory.',
      parameters: {
        type: 'object',
        properties: {
          chest_x: { type: 'number' },
          chest_y: { type: 'number' },
          chest_z: { type: 'number' },
          item_name: { type: 'string' },
          count: { type: 'number' },
        },
        required: ['chest_x', 'chest_y', 'chest_z', 'item_name', 'count'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'craft_item',
      description: 'Craft an item. Will use nearby crafting table if available, otherwise uses 2x2 inventory grid.',
      parameters: {
        type: 'object',
        properties: {
          item_name: { type: 'string', description: 'e.g. "crafting_table", "wooden_pickaxe"' },
          count: { type: 'number', description: 'How many to craft (default 1)' },
        },
        required: ['item_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'look_at',
      description: 'Turn the bot to look at a position.',
      parameters: {
        type: 'object',
        properties: {
          x: { type: 'number' },
          y: { type: 'number' },
          z: { type: 'number' },
        },
        required: ['x', 'y', 'z'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'attack_entity',
      description: 'Attack the nearest entity by name or the closest hostile mob.',
      parameters: {
        type: 'object',
        properties: {
          entity_name: { type: 'string', description: 'Entity type, e.g. "zombie", "skeleton". Use "nearest_hostile" for closest mob.' },
        },
        required: ['entity_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'wait_ticks',
      description: 'Wait/do nothing for a number of game ticks (20 ticks = 1 second).',
      parameters: {
        type: 'object',
        properties: {
          ticks: { type: 'number' },
        },
        required: ['ticks'],
      },
    },
  },
];

const FACE_VEC = {
  top:    new Vec3(0, 1, 0),
  bottom: new Vec3(0, -1, 0),
  north:  new Vec3(0, 0, -1),
  south:  new Vec3(0, 0, 1),
  east:   new Vec3(1, 0, 0),
  west:   new Vec3(-1, 0, 0),
};

export class AgentBot {
  constructor({ name, goal, mcHost, mcPort }) {
    this.name = name;
    this.goal = goal;
    this.mcHost = mcHost;
    this.mcPort = mcPort;

    this.bot = null;
    this.status = 'idle';   // idle | connecting | running | stopped | error
    this.logs = [];
    this._tickTimer = null;
    this._history = [];     // OMLX message history (system + conversation)
    this._openWindow = null;
    this._onUpdate = null;  // callback when state changes (for WS broadcast)
  }

  onUpdate(cb) { this._onUpdate = cb; }

  _emit() { if (this._onUpdate) this._onUpdate(this.snapshot()); }

  _log(msg, level = 'info') {
    const entry = { ts: Date.now(), level, msg };
    this.logs.push(entry);
    if (this.logs.length > MAX_LOG) this.logs.shift();
    console.log(`[${this.name}] ${msg}`);
    this._emit();
  }

  snapshot() {
    const pos = this.bot?.entity?.position;
    return {
      name: this.name,
      goal: this.goal,
      status: this.status,
      logs: this.logs,
      position: pos ? { x: Math.round(pos.x * 10) / 10, y: Math.round(pos.y * 10) / 10, z: Math.round(pos.z * 10) / 10 } : null,
      health: this.bot?.health ?? null,
      food: this.bot?.food ?? null,
      inventory: this._summarizeInventory(),
    };
  }

  _summarizeInventory() {
    if (!this.bot) return [];
    const counts = {};
    for (const item of this.bot.inventory.items()) {
      counts[item.name] = (counts[item.name] || 0) + item.count;
    }
    return Object.entries(counts).map(([name, count]) => ({ name, count }));
  }

  start() {
    if (this.status !== 'idle' && this.status !== 'error') return;
    this.status = 'connecting';
    this._log(`Connecting to ${this.mcHost}:${this.mcPort}...`);
    this._emit();

    this.bot = mineflayer.createBot({
      host: this.mcHost,
      port: this.mcPort,
      username: this.name,
      version: false,
      auth: 'offline',
    });

    this.bot.loadPlugin(pathfinder);

    this.bot.once('spawn', () => {
      this.status = 'running';
      this._log('Spawned. Starting reasoning loop.');
      this._initHistory();
      this._scheduleNext();
      this._emit();
    });

    this.bot.on('kicked', (reason) => {
      this._log(`Kicked: ${reason}`, 'error');
      this._stopLoop();
      this.status = 'error';
      this._emit();
    });

    this.bot.on('error', (err) => {
      this._log(`Bot error: ${err.message}`, 'error');
      this._stopLoop();
      this.status = 'error';
      this._emit();
    });

    this.bot.on('end', (reason) => {
      if (this.status === 'running') {
        this._log(`Disconnected: ${reason}`, 'warn');
        this._stopLoop();
        this.status = 'error';
        this._emit();
      }
    });

    this.bot.on('death', () => {
      this._log('I died! Waiting to respawn...', 'warn');
    });
  }

  stop() {
    this._stopLoop();
    this.bot?.quit('Agent stopped');
    this.status = 'stopped';
    this._log('Stopped.');
    this._emit();
  }

  _stopLoop() {
    if (this._tickTimer) { clearTimeout(this._tickTimer); this._tickTimer = null; }
  }

  _scheduleNext() {
    this._tickTimer = setTimeout(() => this._tick(), TICK_MS);
  }

  _initHistory() {
    const system = `You are an autonomous Minecraft agent named "${this.name}".
Your goal: ${this.goal}

Use the provided tools to interact with the Minecraft world. Each tool call takes some time — choose the most useful action for your current situation. Pursue your goal step by step.

Important:
- When mining, equip the right tool first (e.g. pickaxe for stone/ore, axe for wood).
- When pathfinding fails, try a nearby position instead.
- If you reach the goal, call wait_ticks with a long duration and describe completion in your message.
- Prefer crafting tables for recipes that require 3x3; use 2x2 for simple recipes.
- You are in survival mode — manage food/health if needed.`;

    this._history = [{ role: 'system', content: system }];
  }

  async _tick() {
    if (this.status !== 'running') return;
    try {
      await this._reasonAndAct();
    } catch (err) {
      this._log(`Tick error: ${err.message}`, 'error');
    }
    if (this.status === 'running') this._scheduleNext();
  }

  _buildObservation() {
    const bot = this.bot;
    const pos = bot.entity.position;
    const nearby = this._nearbyBlocks(5);
    const entities = this._nearbyEntities(16);
    const inv = this._summarizeInventory();

    return `=== Current State ===
Position: x=${pos.x.toFixed(1)} y=${pos.y.toFixed(1)} z=${pos.z.toFixed(1)}
Health: ${bot.health}/20  Food: ${bot.food}/20
Time: ${bot.time?.timeOfDay ?? '?'} (0=dawn, 6000=noon, 13000=dusk, 18000=night)
On ground: ${bot.entity.onGround}
Held item: ${bot.heldItem?.name ?? 'empty'}

Inventory (${inv.length} types):
${inv.length ? inv.map(i => `  ${i.name}: ${i.count}`).join('\n') : '  (empty)'}

Nearby blocks (within 5):
${nearby.length ? nearby.slice(0, 20).map(b => `  ${b.name} at (${b.x},${b.y},${b.z})`).join('\n') : '  (none notable)'}

Nearby entities (within 16):
${entities.length ? entities.map(e => `  ${e.name} at (${e.x.toFixed(0)},${e.y.toFixed(0)},${e.z.toFixed(0)})`).join('\n') : '  (none)'}

What action do you take next toward your goal?`;
  }

  _nearbyBlocks(radius) {
    const bot = this.bot;
    const pos = bot.entity.position.floored();
    const blocks = [];
    const skip = new Set(['air', 'cave_air', 'void_air', 'grass', 'short_grass', 'dirt', 'stone', 'water', 'lava']);
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dz = -radius; dz <= radius; dz++) {
          const b = bot.blockAt(pos.offset(dx, dy, dz));
          if (b && !skip.has(b.name)) {
            blocks.push({ name: b.name, x: b.position.x, y: b.position.y, z: b.position.z });
          }
        }
      }
    }
    return blocks;
  }

  _nearbyEntities(radius) {
    const bot = this.bot;
    const pos = bot.entity.position;
    return Object.values(bot.entities)
      .filter(e => e !== bot.entity && e.position.distanceTo(pos) <= radius)
      .map(e => ({
        name: e.name || e.type || 'unknown',
        x: e.position.x, y: e.position.y, z: e.position.z,
      }));
  }

  async _reasonAndAct() {
    const obs = this._buildObservation();
    this._history.push({ role: 'user', content: obs });

    // Trim history to last 10 exchanges (keep system prompt)
    if (this._history.length > 22) {
      this._history = [this._history[0], ...this._history.slice(-20)];
    }

    this._log('Thinking...');

    const resp = await fetch(`${OMLX_BASE}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OMLX_MODEL,
        messages: this._history,
        tools: ACTION_TOOLS,
        tool_choice: 'auto',
        temperature: 0.3,
        max_tokens: 512,
      }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`OMLX error ${resp.status}: ${text}`);
    }

    const data = await resp.json();
    const msg = data.choices?.[0]?.message;
    if (!msg) throw new Error('Empty OMLX response');

    this._history.push(msg);

    // Log any assistant text
    if (msg.content) this._log(`Agent: ${msg.content}`);

    // Execute tool calls
    if (msg.tool_calls?.length) {
      for (const tc of msg.tool_calls) {
        const fn = tc.function.name;
        let args;
        try { args = JSON.parse(tc.function.arguments); } catch { args = {}; }
        this._log(`Action: ${fn}(${JSON.stringify(args)})`);
        let result;
        try {
          result = await this._executeAction(fn, args);
        } catch (err) {
          result = `Error: ${err.message}`;
          this._log(`Action failed: ${err.message}`, 'warn');
        }
        this._history.push({ role: 'tool', tool_call_id: tc.id, content: result });
      }
    }
  }

  async _executeAction(fn, args) {
    const bot = this.bot;

    switch (fn) {
      case 'move_to': {
        const goal = new goals.GoalNear(args.x, args.y, args.z, 1);
        const mcData = bot.registry;
        const moves = new Movements(bot, mcData);
        bot.pathfinder.setMovements(moves);
        await bot.pathfinder.goto(goal);
        return 'Reached destination.';
      }

      case 'dig_block': {
        const block = bot.blockAt(new Vec3(args.x, args.y, args.z));
        if (!block || block.name === 'air') return 'No block there.';
        if (!bot.canDigBlock(block)) return `Cannot dig ${block.name}.`;
        await bot.dig(block);
        return `Dug ${block.name}.`;
      }

      case 'place_block': {
        const ref = bot.blockAt(new Vec3(args.ref_x, args.ref_y, args.ref_z));
        if (!ref) return 'No reference block.';
        const face = FACE_VEC[args.face] ?? FACE_VEC.top;
        await bot.placeBlock(ref, face);
        return 'Placed block.';
      }

      case 'equip_item': {
        const item = bot.inventory.items().find(i => i.name === args.item_name);
        if (!item) return `${args.item_name} not in inventory.`;
        await bot.equip(item, 'hand');
        return `Equipped ${args.item_name}.`;
      }

      case 'open_container': {
        const block = bot.blockAt(new Vec3(args.x, args.y, args.z));
        if (!block) return 'No block there.';
        this._openWindow = await bot.openContainer(block);
        await new Promise(r => setTimeout(r, 500));
        const contents = this._openWindow.containerItems().map(i => `${i.name}:${i.count}`).join(', ') || '(empty)';
        this._openWindow.close();
        this._openWindow = null;
        return `Container contents: ${contents}`;
      }

      case 'deposit_to_chest': {
        const block = bot.blockAt(new Vec3(args.chest_x, args.chest_y, args.chest_z));
        if (!block) return 'No chest there.';
        const chest = await bot.openContainer(block);
        await new Promise(r => setTimeout(r, 300));
        const items = chest.containerItems().concat(bot.inventory.items())
          .filter(i => i.name === args.item_name);
        const invItems = bot.inventory.items().filter(i => i.name === args.item_name);
        if (!invItems.length) { chest.close(); return `${args.item_name} not in inventory.`; }
        const toDeposit = args.count > 0 ? Math.min(args.count, invItems.reduce((s, i) => s + i.count, 0)) : invItems.reduce((s, i) => s + i.count, 0);
        await chest.deposit(invItems[0].type, null, toDeposit);
        chest.close();
        return `Deposited ${toDeposit}x ${args.item_name}.`;
      }

      case 'withdraw_from_chest': {
        const block = bot.blockAt(new Vec3(args.chest_x, args.chest_y, args.chest_z));
        if (!block) return 'No chest there.';
        const chest = await bot.openContainer(block);
        await new Promise(r => setTimeout(r, 300));
        const item = chest.containerItems().find(i => i.name === args.item_name);
        if (!item) { chest.close(); return `${args.item_name} not in chest.`; }
        await chest.withdraw(item.type, null, Math.min(args.count, item.count));
        chest.close();
        return `Withdrew ${args.count}x ${args.item_name}.`;
      }

      case 'craft_item': {
        const count = args.count ?? 1;
        const mcData = bot.registry;
        const recipes = bot.recipesFor(mcData.itemsByName[args.item_name]?.id, null, 1, null);
        if (!recipes?.length) return `No recipe for ${args.item_name}.`;
        // Try with crafting table nearby
        const ctPos = bot.findBlock({ matching: mcData.blocksByName['crafting_table']?.id, maxDistance: 4 });
        const table = ctPos ? bot.blockAt(ctPos) : null;
        if (table) {
          await bot.craft(recipes[0], count, table);
        } else {
          const r2x2 = bot.recipesFor(mcData.itemsByName[args.item_name]?.id, null, 1, null).find(r => r.inShape.length <= 2 && r.inShape.every(row => row.length <= 2));
          if (!r2x2) return `${args.item_name} needs a crafting table.`;
          await bot.craft(r2x2, count, null);
        }
        return `Crafted ${count}x ${args.item_name}.`;
      }

      case 'look_at': {
        await bot.lookAt(new Vec3(args.x, args.y, args.z));
        return 'Looked at position.';
      }

      case 'attack_entity': {
        const pos = bot.entity.position;
        let target;
        if (args.entity_name === 'nearest_hostile') {
          const hostile = ['zombie', 'skeleton', 'creeper', 'spider', 'enderman', 'witch', 'phantom'];
          target = Object.values(bot.entities)
            .filter(e => e !== bot.entity && hostile.includes(e.name))
            .sort((a, b) => a.position.distanceTo(pos) - b.position.distanceTo(pos))[0];
        } else {
          target = Object.values(bot.entities)
            .filter(e => e !== bot.entity && e.name === args.entity_name)
            .sort((a, b) => a.position.distanceTo(pos) - b.position.distanceTo(pos))[0];
        }
        if (!target) return `No ${args.entity_name} nearby.`;
        await bot.lookAt(target.position.offset(0, target.height ?? 1.6, 0));
        bot.attack(target);
        return `Attacked ${target.name}.`;
      }

      case 'wait_ticks': {
        await new Promise(r => setTimeout(r, (args.ticks ?? 20) * 50));
        return 'Done waiting.';
      }

      default:
        return `Unknown action: ${fn}`;
    }
  }
}
