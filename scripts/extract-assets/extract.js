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
const { PNG } = require('pngjs');
const { MC_VERSION } = require('./version.js');

// Mobs whose only resolvable texture is confirmed wrong, for reasons a
// generic dimension/opacity check either can't detect or would also wrongly
// flag on legitimately sparse sprites (bats, sticks, feathers, ... are
// "mostly transparent" on purpose, so a blanket opacity threshold isn't a
// safe general check — these two are hand-confirmed instead):
//  - horse/donkey/mule: Bedrock geometry declares a 128x128 texture layout
//    (old horse atlas), but their real 1.20.1 PNGs are 64x64 using a
//    completely different, incompatible layout — same width:height *ratio*
//    as declared, so the aspect-ratio check below can't see it either.
//  - villager: every available texture key is a profession *overlay*
//    (hat + apron only); there is no base-skin key in this data source.
const KNOWN_BAD_TEXTURE = new Set(['horse', 'donkey', 'mule', 'villager']);

function readPngSize(filePath) {
  const png = PNG.sync.read(fs.readFileSync(filePath));
  return { width: png.width, height: png.height };
}

// Same box-UV face table as rendering-client/src/mob-model.js's elemFaces,
// kept only for the u1/v1 (far-corner) vectors needed to compute how large
// a texture a cube's UV actually requires — must stay consistent with that
// file's addCube, since this is validating against the exact same math.
const FAR_UV_VECTORS = [
  { u1: [1, 0, 1], v1: [0, 0, 1] }, // up
  { u1: [2, 0, 1], v1: [0, 0, 1] }, // down
  { u1: [1, 0, 2], v1: [0, 1, 1] }, // east
  { u1: [0, 0, 1], v1: [0, 1, 1] }, // west
  { u1: [1, 0, 1], v1: [0, 1, 1] }, // north
  { u1: [2, 0, 2], v1: [0, 1, 1] } // south
];

function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }

// The minimum texture (width, height) a geometry's cubes actually sample
// into, in raw pixels — i.e. the real requirement, independent of whatever
// texturewidth/textureheight the geometry does or doesn't declare. A real
// PNG smaller than this in either dimension cannot be the right texture for
// this geometry, no matter how plausible its declared size looks (this is
// exactly how sheep's geometry — which declares no size at all — turned out
// to need a 64-tall sheet while its real "sheep_fur" PNG is only 32 tall).
function requiredTextureSize(bones) {
  let maxU = 0, maxV = 0;
  for (const bone of bones) {
    for (const cube of bone.cubes || []) {
      for (const { u1, v1 } of FAR_UV_VECTORS) {
        maxU = Math.max(maxU, cube.uv[0] + dot(u1, cube.size));
        maxV = Math.max(maxV, cube.uv[1] + dot(v1, cube.size));
      }
    }
  }
  return { width: maxU, height: maxV };
}
// npm-resolved, not a hardcoded path to a manually-cloned sibling repo —
// `npm install`/`npm update` is what keeps this current for a new MC
// version, same as any other dependency.
const VIEWER_ENTITIES_JSON = require.resolve('prismarine-viewer/viewer/lib/entity/entities.json');
const OUT_DIR = path.resolve(__dirname, '../../rendering-client/assets');

// Entity names that are projectiles/vehicles/misc, never spawned through
// this project's spawnMob path at all (server-bridge.js's entitySpawn
// handler already drops anything with mineflayer entity.type === 'object'
// before it reaches the bridge->client message, e.g. arrows, boats,
// minecarts, thrown items, fireballs). Extracting geometry for these would
// just be unused dead weight in the repo, not wrong — skip them on that
// basis alone.
const NON_MOB_ENTITIES = new Set([
  'arrow', 'boat', 'chest_minecart', 'command_block_minecart',
  'dragon_fireball', 'egg', 'ender_pearl', 'evoker_fangs',
  'experience_bottle', 'experience_orb', 'eye_of_ender', 'fireball',
  'firework_rocket', 'fishing_bobber', 'hopper_minecart', 'leash_knot',
  'llama_spit', 'minecart', 'potion', 'shulker_bullet', 'small_fireball',
  'snowball', 'tnt_minecart', 'trident', 'wither_skull'
]);

// Every real item in the game (minecraft-data's registry), not just the
// curated subset entity-manager.js's ITEM_COLORS table used for in-world
// dropped-item rendering — a chest/inventory can hold anything, so the
// hotbar/inventory UI needs much broader icon coverage. 'air' isn't a
// real item a player can hold; everything else is attempted, same
// validated pipeline (items/ then blocks/ fallback, below).
const ITEM_NAMES = require('minecraft-data')(MC_VERSION).itemsArray
  .map(i => i.name)
  .filter(name => name !== 'air');

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

  // `mobs`: real geometry + a validated, matching texture — full fidelity.
  // `mobsNoTexture`: real geometry, but no usable texture was found for it
  // (missing/overlay-only/wrong-layout/too-small) — still worth showing the
  // real shape for, with a flat "needs a texture" placeholder color at
  // runtime, rather than discarding correct shape data just because the
  // skin is missing. Anything in neither list keeps the legacy box.
  const manifest = { mobs: [], mobsNoTexture: [], items: [], mcVersion: MC_VERSION };
  const gaps = { mobsNoGeometry: [], mobsNoTexture: [], itemsNoTexture: [] };

  // Attempt every entity entities.json knows about — not a curated guess
  // at "common" mobs. The validation below (geometry presence, texture
  // size/ratio/existence) is what actually decides what's usable; nothing
  // here pre-filters based on how common or important a mob seems.
  const MOB_NAMES = Object.keys(entities).filter(name => !NON_MOB_ENTITIES.has(name));

  for (const name of MOB_NAMES) {
    const entry = entities[name];
    if (!entry || !entry.geometry || !entry.geometry.default) {
      gaps.mobsNoGeometry.push(name);
      continue;
    }
    const geo = entry.geometry.default;

    // Geometry is valid regardless of what happens to the texture below —
    // write it unconditionally so a texture-only failure still gets a real
    // shape instead of losing the geometry entirely.
    const texturewidthFallback = geo.texturewidth;
    const textureheightFallback = geo.textureheight;

    function writeGeometryOnly(reason) {
      gaps.mobsNoTexture.push(`${name} (${reason})`);
      fs.writeFileSync(
        path.join(OUT_DIR, 'mobs', `${name}.json`),
        JSON.stringify({
          // No validated real size available — 64x64 (Entity.js's own
          // historical default) is a reasonable guess; it only affects UV
          // scaling of a placeholder-colored mesh with no texture map.
          texturewidth: texturewidthFallback || 64,
          textureheight: textureheightFallback || 64,
          bones: geo.bones
        })
      );
      manifest.mobsNoTexture.push(name);
    }

    if (KNOWN_BAD_TEXTURE.has(name)) {
      writeGeometryOnly('hand-confirmed bad texture, see KNOWN_BAD_TEXTURE');
      continue;
    }

    // Many entries have no "default" texture key, only named variants
    // (e.g. cat/horse/rabbit/villager). Prefer, in order: a key matching
    // the mob name's qualifier segment — the part before the first "_" or
    // after the last "_" (catches elder_guardian -> its "elder" variant,
    // where "default" actually points at the plain guardian's texture
    // instead); a same-named key; the literal "default" key; else the
    // first variant listed.
    const textures = entry.textures || {};
    const prefix = name.includes('_') ? name.slice(0, name.indexOf('_')) : null;
    const suffix = name.includes('_') ? name.slice(name.lastIndexOf('_') + 1) : null;
    const texPath = (prefix && textures[prefix]) || (suffix && textures[suffix]) ||
      textures[name] || textures.default || Object.values(textures)[0];
    if (!texPath) {
      writeGeometryOnly('no texture key found');
      continue;
    }
    // entities.json's texture paths are sometimes flatter than
    // minecraft-assets' real resourcepack layout: "textures/entity/squid"
    // is really at entity/squid/squid.png (basename repeated as its own
    // subdirectory) — try that pattern before giving up. player/player_slim
    // use a different, hardcoded nesting (entity/player/<wide|slim>/) since
    // they're not simple basename-repeats; these are only fallback
    // defaults anyway — real connected players' actual skins are a
    // separate, per-player dynamic fetch not implemented here.
    const flatPath = path.join(assetsDir, texPath.replace(/^textures\//, '') + '.png');
    const basename = path.basename(flatPath, '.png');
    const nestedPath = path.join(path.dirname(flatPath), basename, basename + '.png');
    const srcPng = name === 'player'
      ? path.join(assetsDir, 'entity', 'player', 'wide', 'steve.png')
      : name === 'player_slim'
        ? path.join(assetsDir, 'entity', 'player', 'slim', 'alex.png')
        : fs.existsSync(flatPath) ? flatPath : nestedPath;
    if (!fs.existsSync(srcPng)) {
      writeGeometryOnly('resolved texture file does not exist');
      continue;
    }

    const info = readPngSize(srcPng);
    const required = requiredTextureSize(geo.bones);

    // The real PNG must actually be big enough to contain every UV region
    // the geometry's cubes reference — regardless of what texturewidth/
    // textureheight the geometry does or doesn't declare. If it isn't, the
    // real texture is the wrong one/wrong layout for this geometry (e.g.
    // zombie's declared-64x32-but-needs-64x64 skin, or sheep's undeclared
    // geometry that turns out to need a 64-tall sheet against a real
    // 64x32 sheep_fur.png).
    if (info.width < required.width - 0.5 || info.height < required.height - 0.5) {
      writeGeometryOnly(
        `geometry needs a texture at least ${Math.ceil(required.width)}x${Math.ceil(required.height)}, real texture is only ${info.width}x${info.height}`
      );
      continue;
    }
    // When the geometry also declares its own texture size, it must match
    // the real PNG's aspect *ratio* (a uniform up/downscale is fine — UVs
    // are normalized — but a different ratio means an incompatible layout
    // that the size check above can still miss, e.g. horse/donkey/mule are
    // excluded by name for exactly this reason already).
    if (geo.texturewidth && geo.textureheight) {
      const declaredRatio = geo.texturewidth / geo.textureheight;
      const actualRatio = info.width / info.height;
      if (Math.abs(declaredRatio - actualRatio) / declaredRatio > 0.01) {
        writeGeometryOnly(`declared ${geo.texturewidth}x${geo.textureheight} vs real ${info.width}x${info.height} — incompatible aspect ratio`);
        continue;
      }
    }

    const trimmed = {
      // Use the geometry's declared size when present; otherwise the real
      // texture's own pixel size, which the check above just confirmed is
      // large enough to contain every cube's UV region.
      texturewidth: geo.texturewidth || info.width,
      textureheight: geo.textureheight || info.height,
      bones: geo.bones
    };
    fs.writeFileSync(
      path.join(OUT_DIR, 'mobs', `${name}.json`),
      JSON.stringify(trimmed)
    );
    fs.copyFileSync(srcPng, path.join(OUT_DIR, 'textures', 'entity', `${name}.png`));
    manifest.mobs.push(name);
  }

  // Block textures that are biome-tinted at render time in vanilla (grass,
  // leaves, ...) — the raw texture file is deliberately greyscale/flat and
  // only looks right with a tint we don't implement; using it untinted
  // regresses from today's flat ITEM_COLORS green. Keep these on the
  // legacy color fallback instead.
  const TINT_DEPENDENT_BLOCKS = new Set(['grass', 'oak_leaves']);

  // --- Items: try true item-icon textures first, then block textures
  // (dropped/held blocks like dirt/stone/oak_log render as a textured
  // cube using the block's own face texture — there is no separate
  // "item icon" for these in minecraft-assets, only a block texture). ---
  for (const name of ITEM_NAMES) {
    if (TINT_DEPENDENT_BLOCKS.has(name)) {
      gaps.itemsNoTexture.push(`${name} (biome-tinted, needs tint we don't implement)`);
      continue;
    }

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

  // --- Block-break crack overlay (destroy_stage_0..9) — vanilla's own
  // generic, tiling crack-progress textures, same for every block type.
  // Not biome/tool-specific, just 10 fixed PNGs to copy once. ---
  ensureDir(path.join(OUT_DIR, 'textures', 'break'));
  let breakStages = 0;
  for (let stage = 0; stage <= 9; stage++) {
    const src = path.join(assetsDir, 'blocks', `destroy_stage_${stage}.png`);
    if (!fs.existsSync(src)) continue;
    fs.copyFileSync(src, path.join(OUT_DIR, 'textures', 'break', `destroy_stage_${stage}.png`));
    breakStages++;
  }
  manifest.breakStages = breakStages;

  fs.writeFileSync(
    path.join(OUT_DIR, 'manifest.json'),
    JSON.stringify(manifest, null, 2)
  );

  console.log(`mcAssets resolved to: ${assetsDir}`);
  console.log(`Mobs with real shape + texture: ${manifest.mobs.length}/${MOB_NAMES.length}`);
  console.log(`Mobs with real shape, no texture (placeholder color): ${manifest.mobsNoTexture.length}/${MOB_NAMES.length}`);
  console.log(`Items extracted: ${manifest.items.length}/${ITEM_NAMES.length}`);
  console.log('Gaps (kept on legacy fallback):', JSON.stringify(gaps, null, 2));
}

main();
