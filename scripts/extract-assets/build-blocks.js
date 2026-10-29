#!/usr/bin/env node
/**
 * Rebuilds rendering-client/assets/block_models.json + textures/blocks/atlas.png
 * ourselves, instead of copying prismarine-web-client's published copy.
 *
 * Why: prismarine-viewer's own pipeline is actually two stages — build time
 * (viewer/lib/modelsBuilder.js) bakes textures/UV into each variant's
 * model but deliberately leaves `x`/`y` rotation untouched as a sibling of
 * `model` (e.g. ladder's "facing=east" variant is literally
 * `{ model: {...baked...}, y: 90 }`), and their RUNTIME renderer
 * (viewer/lib/models.js's getSectionGeometry) reads that leftover `x`/`y`
 * separately and applies it live via a rotation matrix. That's a
 * deliberate, reasonable design when you also ship their runtime — but our
 * block-model.js only ever reads `model.elements` and never looked at
 * `variant.x`/`variant.y` at all, so every direction rendered identically.
 *
 * Rather than add runtime rotation (matching their split exactly), this
 * takes the simpler alternative: bake the rotation into the geometry once,
 * here, at build time, so no rotation logic is needed anywhere at runtime.
 * Measured cost of that choice: about 8% larger block_models.json than
 * leaving rotation for runtime would produce (11.46MB vs ~10.6MB) — most of
 * a resolved variant's size is the per-face texture/UV data either way,
 * which has to be stored once per variant regardless of whether its
 * numbers happen to be rotated.
 *
 * atlas.js (texture packing) is reused unmodified from the installed
 * prismarine-viewer package — that part was never involved in this at all,
 * only the model-resolving step needed reimplementing.
 *
 * Rotation convention (verified against real vanilla data, not guessed):
 *  - Y rotation (around the vertical axis, pivot (8,8) in 0-16 element
 *    space): verified against ladder (facing=north -> y unset, facing=east
 *    -> y:90 , ...). One 90-degree step maps north->east->south->west->north.
 *  - X rotation (pivot (8,8) in the Y-Z plane): verified against piston
 *    (facing=north -> x unset, facing=down -> x:90, facing=up -> x:270).
 *    One 90-degree step maps north->down->south->up->north; east/west are
 *    unaffected (X-rotation spins the Y-Z plane only).
 *  - Combined x+y (rare): vanilla applies x first, then y — matched here.
 *
 * Usage: node build-blocks.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { MC_VERSION } = require('./version.js');
const mcAssets = require('minecraft-assets')(MC_VERSION);
// npm-resolved, not a hardcoded path to a manually-cloned sibling repo.
const { makeTextureAtlas } = require('prismarine-viewer/viewer/lib/atlas.js');

const OUT_DIR = path.resolve(__dirname, '../../rendering-client/assets');

// ---- ported from prismarine-viewer's modelsBuilder.js (not buggy, kept as-is) ----

function cleanupBlockName(name) {
  if (name.startsWith('block') || name.startsWith('minecraft:block')) return name.split('/')[1];
  return name;
}

function getModel(name, blocksModels) {
  name = cleanupBlockName(name);
  const data = blocksModels[name];
  if (!data) return null;

  let model = { textures: {}, elements: [], ao: true };
  if (data.parent) {
    model = getModel(data.parent, blocksModels);
  }
  if (data.textures) {
    Object.assign(model.textures, JSON.parse(JSON.stringify(data.textures)));
  }
  if (data.elements) {
    model.elements = JSON.parse(JSON.stringify(data.elements));
  }
  if (data.ambientocclusion !== undefined) {
    model.ao = data.ambientocclusion;
  }
  return model;
}

function unwrapTexture(ref) {
  return typeof ref === 'object' && ref !== null ? ref.sprite : ref;
}

function prepareModel(model, texturesJson) {
  for (const tex in model.textures) {
    let root = unwrapTexture(model.textures[tex]);
    while (root.charAt(0) === '#') {
      root = unwrapTexture(model.textures[root.substr(1)]);
    }
    model.textures[tex] = root;
  }
  for (const tex in model.textures) {
    let name = model.textures[tex];
    name = cleanupBlockName(name);
    model.textures[tex] = texturesJson[name];
  }
  for (const elem of model.elements) {
    for (const sideName of Object.keys(elem.faces)) {
      const face = elem.faces[sideName];
      if (face.texture.charAt(0) === '#') {
        face.texture = JSON.parse(JSON.stringify(model.textures[face.texture.substr(1)]));
      } else if (
        !(cleanupBlockName(face.texture) in texturesJson) &&
        face.texture in model.textures
      ) {
        face.texture = JSON.parse(JSON.stringify(model.textures[face.texture]));
      } else {
        let name = face.texture;
        name = cleanupBlockName(name);
        face.texture = JSON.parse(JSON.stringify(texturesJson[name]));
      }

      let uv = face.uv;
      if (!uv) {
        const _from = elem.from;
        const _to = elem.to;
        uv = {
          north: [_to[0], 16 - _to[1], _from[0], 16 - _from[1]],
          east: [_from[2], 16 - _to[1], _to[2], 16 - _from[1]],
          south: [_from[0], 16 - _to[1], _to[0], 16 - _from[1]],
          west: [_from[2], 16 - _to[1], _to[2], 16 - _from[1]],
          up: [_from[0], _from[2], _to[0], _to[2]],
          down: [_to[0], _from[2], _from[0], _to[2]]
        }[sideName];
      }

      const su = (uv[2] - uv[0]) * face.texture.su / 16;
      const sv = (uv[3] - uv[1]) * face.texture.sv / 16;
      face.texture.bu = face.texture.u + 0.5 * face.texture.su;
      face.texture.bv = face.texture.v + 0.5 * face.texture.sv;
      face.texture.u += uv[0] * face.texture.su / 16;
      face.texture.v += uv[1] * face.texture.sv / 16;
      face.texture.su = su;
      face.texture.sv = sv;
    }
  }
}

// ---- the fix: apply a variant's x/y rotation to its model's elements ----
// BEFORE prepareModel bakes UVs, so the UV-fallback projection (which reads
// elem.from/elem.to) sees the already-rotated box, matching vanilla.

const Y_CYCLE = ['north', 'east', 'south', 'west']; // one 90-deg Y step, in order
const X_CYCLE = ['north', 'down', 'south', 'up'];   // one 90-deg X step, in order

function rotateYElement(elem, steps) {
  if (steps === 0) return elem;
  const [x0, y0, z0] = elem.from, [x1, y1, z1] = elem.to;
  // Rotate both corners' (x,z) around pivot (8,8); axis-aligned box stays
  // axis-aligned, so take min/max of the two transformed corners.
  const rot = (x, z) => {
    for (let i = 0; i < steps; i++) { const nx = 8 - (z - 8), nz = 8 + (x - 8); x = nx; z = nz; }
    return [x, z];
  };
  const [rx0, rz0] = rot(x0, z0);
  const [rx1, rz1] = rot(x1, z1);
  elem.from = [Math.min(rx0, rx1), y0, Math.min(rz0, rz1)];
  elem.to = [Math.max(rx0, rx1), y1, Math.max(rz0, rz1)];

  const newFaces = {};
  for (const dir in elem.faces) {
    if (dir === 'up' || dir === 'down') { newFaces[dir] = elem.faces[dir]; continue; }
    const idx = Y_CYCLE.indexOf(dir);
    newFaces[Y_CYCLE[(idx + steps) % 4]] = elem.faces[dir];
  }
  elem.faces = newFaces;
  return elem;
}

function rotateXElement(elem, steps) {
  if (steps === 0) return elem;
  const [x0, y0, z0] = elem.from, [x1, y1, z1] = elem.to;
  const rot = (y, z) => {
    for (let i = 0; i < steps; i++) { const ny = 8 + (z - 8), nz = 8 - (y - 8); y = ny; z = nz; }
    return [y, z];
  };
  const [ry0, rz0] = rot(y0, z0);
  const [ry1, rz1] = rot(y1, z1);
  elem.from = [x0, Math.min(ry0, ry1), Math.min(rz0, rz1)];
  elem.to = [x1, Math.max(ry0, ry1), Math.max(rz0, rz1)];

  const newFaces = {};
  for (const dir in elem.faces) {
    if (dir === 'east' || dir === 'west') { newFaces[dir] = elem.faces[dir]; continue; }
    const idx = X_CYCLE.indexOf(dir);
    newFaces[X_CYCLE[(idx + steps) % 4]] = elem.faces[dir];
  }
  elem.faces = newFaces;
  return elem;
}

function resolveModel(variant, blocksModels, texturesJson) {
  const model = getModel(variant.model, blocksModels);
  if (!model) return null;
  const xSteps = Math.round(((variant.x || 0) % 360) / 90);
  const ySteps = Math.round(((variant.y || 0) % 360) / 90);
  // Vanilla applies x rotation, then y.
  for (const elem of model.elements) {
    rotateXElement(elem, xSteps);
    rotateYElement(elem, ySteps);
  }
  prepareModel(model, texturesJson.textures);
  return model;
}

function prepareBlocksStatesFixed(assets, atlas) {
  const blocksStates = assets.blocksStates;
  for (const block of Object.values(blocksStates)) {
    if (!block) continue;
    if (block.variants) {
      for (const variant of Object.values(block.variants)) {
        const list = Array.isArray(variant) ? variant : [variant];
        for (const v of list) v.model = resolveModel(v, assets.blocksModels, atlas.json);
      }
    }
    if (block.multipart) {
      for (const part of block.multipart) {
        const list = Array.isArray(part.apply) ? part.apply : [part.apply];
        for (const v of list) v.model = resolveModel(v, assets.blocksModels, atlas.json);
      }
    }
  }
  return blocksStates;
}

function main() {
  const atlas = makeTextureAtlas(mcAssets);
  const blocksStates = prepareBlocksStatesFixed(mcAssets, atlas);

  fs.mkdirSync(path.join(OUT_DIR, 'textures', 'blocks'), { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'block_models.json'), JSON.stringify(blocksStates));

  const out = fs.createWriteStream(path.join(OUT_DIR, 'textures', 'blocks', 'atlas.png'));
  const stream = atlas.canvas.pngStream();
  stream.on('data', (chunk) => out.write(chunk));
  stream.on('end', () => {
    console.log('Wrote block_models.json and textures/blocks/atlas.png');
  });
}

main();
