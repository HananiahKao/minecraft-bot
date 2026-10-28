#!/usr/bin/env node
/**
 * One-off extraction: pull real mob geometry (from prismarine-viewer's
 * entities.json) and real PNG textures (from the minecraft-assets npm
 * package) into rendering-client/assets/, for Minecraft 1.20.1.
 *
 * Throwaway script — not part of the running app. Delete this directory
 * (or at least node_modules) once it's been run and the output committed.
 *
 * Usage: node extract.js
 */

'use strict';

const fs = require('fs');
const path = require('path');

const MC_VERSION = '1.20.1';
const VIEWER_ENTITIES_JSON = path.resolve(
  __dirname, '../../../prismarine-viewer/viewer/lib/entity/entities.json'
);
const OUT_DIR = path.resolve(__dirname, '../../rendering-client/assets');

// Every mob name currently in entity-manager.js's MOB_COLORS table — attempt
// extraction for all of them (strict superset of the curated survival-mob
// list from the plan); anything entities.json/minecraft-assets doesn't have
// simply stays on the existing colored-box fallback.
const MOB_NAMES = [
  'pig', 'cow', 'sheep', 'chicken', 'rabbit', 'horse', 'donkey', 'mule',
  'wolf', 'cat', 'ocelot', 'parrot', 'fox', 'bee', 'goat', 'axolotl',
  'frog', 'allay', 'sniffer', 'armadillo', 'camel',
  'zombie', 'skeleton', 'creeper', 'spider', 'enderman', 'witch', 'slime',
  'ghast', 'zombie_piglin', 'blaze', 'magma_cube',
  'cod', 'salmon', 'tropical_fish', 'pufferfish', 'squid', 'glow_squid',
  'dolphin', 'turtle', 'guardian', 'elder_guardian', 'drowned',
  'bat',
  'villager', 'wandering_trader', 'trader_llama', 'iron_golem', 'snow_golem',
  'player'
];

// Every item name currently in entity-manager.js's ITEM_COLORS table.
const ITEM_NAMES = [
  'dirt', 'grass', 'stone', 'sand', 'gravel', 'cobblestone', 'oak_log',
  'oak_planks', 'oak_leaves', 'birch_log', 'spruce_log', 'jungle_log',
  'acacia_log', 'dark_oak_log', 'iron_ore', 'gold_ore', 'diamond_ore',
  'coal_ore', 'redstone_ore', 'lapis_ore', 'emerald_ore', 'iron_ingot',
  'gold_ingot', 'diamond', 'coal', 'redstone', 'lapis_lazuli', 'emerald',
  'apple', 'bread', 'beef', 'chicken', 'porkchop', 'salmon', 'cod',
  'wheat', 'wheat_seeds', 'carrot', 'potato', 'melon_slice', 'pumpkin',
  'stick', 'bow', 'arrow', 'wooden_sword', 'stone_sword', 'iron_sword',
  'golden_sword', 'diamond_sword', 'wooden_pickaxe', 'stone_pickaxe',
  'iron_pickaxe', 'glass', 'glass_pane', 'oak_sapling', 'spruce_sapling',
  'birch_sapling', 'jungle_sapling', 'acacia_sapling', 'dark_oak_sapling',
  'andesite', 'granite', 'diorite', 'magma_block', 'ladder',
  'stripped_oak_log', 'raw_copper', 'raw_iron', 'raw_gold', 'egg',
  'glow_ink_sac', 'ink_sac', 'torch', 'crafting_table', 'furnace',
  'chest', 'bookshelf', 'tnt', 'water_bucket', 'lava_bucket', 'bucket',
  'bone', 'bone_meal', 'string', 'feather', 'leather', 'wool'
];

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function main() {
  const mcAssets = require('minecraft-assets')(MC_VERSION);
  const assetsDir = mcAssets.directory;
  const entities = JSON.parse(fs.readFileSync(VIEWER_ENTITIES_JSON, 'utf8'));

  ensureDir(path.join(OUT_DIR, 'mobs'));
  ensureDir(path.join(OUT_DIR, 'textures', 'entity'));
  ensureDir(path.join(OUT_DIR, 'textures', 'items'));

  const manifest = { mobs: [], items: [], mcVersion: MC_VERSION };
  const gaps = { mobsNoGeometry: [], mobsNoTexture: [], itemsNoTexture: [] };

  // --- Mobs: geometry + texture, both required to count as "real" ---
  for (const name of MOB_NAMES) {
    const entry = entities[name];
    if (!entry || !entry.geometry || !entry.geometry.default) {
      gaps.mobsNoGeometry.push(name);
      continue;
    }
    // Many entries have no "default" texture key, only named variants
    // (e.g. cat/horse/rabbit/villager) — prefer a same-named key, else
    // just take the first variant listed.
    const textures = entry.textures || {};
    const texPath = textures.default || textures[name] || Object.values(textures)[0];
    if (!texPath) {
      gaps.mobsNoTexture.push(name);
      continue;
    }
    const srcPng = path.join(assetsDir, texPath.replace(/^textures\//, '') + '.png');
    if (!fs.existsSync(srcPng)) {
      gaps.mobsNoTexture.push(name);
      continue;
    }

    const geo = entry.geometry.default;
    const trimmed = {
      texturewidth: geo.texturewidth,
      textureheight: geo.textureheight,
      bones: geo.bones
    };
    fs.writeFileSync(
      path.join(OUT_DIR, 'mobs', `${name}.json`),
      JSON.stringify(trimmed)
    );
    fs.copyFileSync(srcPng, path.join(OUT_DIR, 'textures', 'entity', `${name}.png`));
    manifest.mobs.push(name);
  }

  // --- Items: try true item-icon textures first, then block textures
  // (dropped/held blocks like dirt/stone/oak_log render as a textured
  // cube using the block's own face texture — there is no separate
  // "item icon" for these in minecraft-assets, only a block texture). ---
  for (const name of ITEM_NAMES) {
    const itemPng = path.join(assetsDir, 'items', `${name}.png`);
    const blockPng = path.join(assetsDir, 'blocks', `${name}.png`);
    let src = null;
    if (fs.existsSync(itemPng)) src = itemPng;
    else if (fs.existsSync(blockPng)) src = blockPng;

    if (!src) {
      gaps.itemsNoTexture.push(name);
      continue;
    }
    fs.copyFileSync(src, path.join(OUT_DIR, 'textures', 'items', `${name}.png`));
    manifest.items.push(name);
  }

  fs.writeFileSync(
    path.join(OUT_DIR, 'manifest.json'),
    JSON.stringify(manifest, null, 2)
  );

  console.log(`mcAssets resolved to: ${assetsDir}`);
  console.log(`Mobs extracted: ${manifest.mobs.length}/${MOB_NAMES.length}`);
  console.log(`Items extracted: ${manifest.items.length}/${ITEM_NAMES.length}`);
  console.log('Gaps (kept on legacy fallback):', JSON.stringify(gaps, null, 2));
}

main();
