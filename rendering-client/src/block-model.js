/**
 * Resolves a block (name + state properties) against the pre-baked vanilla
 * blockstate/model data in assets/block_models.json — the finished output
 * of prismarine-viewer's atlas-building + model-resolving build step
 * (copied directly from the prismarine-web-client npm package), not
 * something built or re-derived here.
 *
 * That file already has, per block, every face's atlas UV rectangle
 * (`texture.{u,v,su,sv}`, normalized 0-1) and real shape (`elements`,
 * cuboids in 0-16 local coordinates) baked in — no atlas math, no model
 * inheritance/merging, no per-element rotation needed at this end (the
 * dataset has zero uses of element.rotation and effectively none of
 * face.rotation either; this intentionally does not implement either).
 *
 * Face corner winding is ported from prismarine-viewer's viewer/lib/
 * models.js (`elemFaces` + `renderElement`), which is also the authority
 * for how `pos[3]/pos[4]` (the two UV-axis flags per corner) turn into
 * final UV: with no rotation, that reduces to `u = pos[3]*su + u0`,
 * `v = pos[4]*sv + v0` directly.
 */

// Each face: direction vector + 4 corners, each [x, y, z, uFlag, vFlag]
// (x/y/z pick `to` when 1, `from` when 0; uFlag/vFlag pick which UV corner).
export const FACE_TABLE = {
  up:    { dir: [0, 1, 0],  corners: [[0,1,1,0,1],[1,1,1,1,1],[0,1,0,0,0],[1,1,0,1,0]] },
  down:  { dir: [0, -1, 0], corners: [[1,0,1,0,1],[0,0,1,1,1],[1,0,0,0,0],[0,0,0,1,0]] },
  east:  { dir: [1, 0, 0],  corners: [[1,1,1,0,0],[1,0,1,0,1],[1,1,0,1,0],[1,0,0,1,1]] },
  west:  { dir: [-1, 0, 0], corners: [[0,1,0,0,0],[0,0,0,0,1],[0,1,1,1,0],[0,0,1,1,1]] },
  north: { dir: [0, 0, -1], corners: [[1,0,0,0,1],[0,0,0,1,1],[1,1,0,0,0],[0,1,0,1,0]] },
  south: { dir: [0, 0, 1],  corners: [[0,0,1,0,1],[1,0,1,1,1],[0,1,1,0,0],[1,1,1,1,0]] }
};

// A handful of blocks are biome-tinted in vanilla (grass top, leaves, vines,
// redstone wire, ...). Real per-biome tinting needs biome data we don't
// have per-block; this applies one fixed approximate green instead of
// leaving tinted faces at their raw (deliberately grayscale) texture
// color. Not real tinting — a visible, documented approximation.
const APPROX_TINT = [0.49, 0.72, 0.38];
const NO_TINT = [1, 1, 1];

function pickModel(entry) {
  // Some variants are a single {model}, others a weighted-random array of
  // {model, weight} (visual variety, e.g. grass tuft texture) — always
  // take the first rather than picking randomly, for determinism.
  if (Array.isArray(entry)) entry = entry[0];
  return entry && entry.model;
}

function parseVariantKey(key) {
  const props = {};
  if (key === '') return props;
  for (const pair of key.split(',')) {
    const eq = pair.indexOf('=');
    props[pair.slice(0, eq)] = pair.slice(eq + 1);
  }
  return props;
}

function variantKeyMatches(key, props) {
  const want = parseVariantKey(key);
  for (const k in want) {
    if (String(props[k]) !== want[k]) return false;
  }
  return true;
}

function whenMatches(when, props) {
  if (!when) return true;
  for (const key in when) {
    if (key === 'OR') {
      if (!when.OR.some(sub => whenMatches(sub, props))) return false;
      continue;
    }
    const options = String(when[key]).split('|');
    if (!options.includes(String(props[key]))) return false;
  }
  return true;
}

// Returns an array of resolved `model` objects ({textures, elements}) that
// apply to this block+props, or null if the block isn't in the data at all.
export function resolveModels(blockModelsData, name, props) {
  const entry = blockModelsData[name];
  if (!entry) return null;

  if (entry.variants) {
    for (const key in entry.variants) {
      if (variantKeyMatches(key, props)) {
        const model = pickModel(entry.variants[key]);
        return model ? [model] : null;
      }
    }
    // No key matched this block's actual props (e.g. props were missing
    // entirely because an upstream message omitted them) — fall back to the
    // variant closest to vanilla's default rather than whichever happens to
    // be first in the data (which for axis blocks like logs is 'axis=x',
    // i.e. horizontal, not the common vertical default).
    const fallbackKey = '' in entry.variants ? ''
      : 'axis=y' in entry.variants ? 'axis=y'
      : Object.keys(entry.variants)[0];
    const first = pickModel(entry.variants[fallbackKey]);
    return first ? [first] : null;
  }

  if (entry.multipart) {
    const models = [];
    for (const part of entry.multipart) {
      if (whenMatches(part.when, props)) {
        const model = pickModel(part.apply);
        if (model) models.push(model);
      }
    }
    return models.length ? models : null;
  }

  return null;
}

// Flattens resolved models' elements into a simple list the chunk mesher can
// consume directly: one entry per cuboid, local 0-1 box + per-direction
// face data (uv rect + whether to cull against a solid neighbor + tint).
// Returns [] if the block has models but no elements (shouldn't happen in
// this dataset, but never throws on it).
export function flattenElements(models) {
  const out = [];
  for (const model of models) {
    for (const element of model.elements || []) {
      const box = {
        x0: element.from[0] / 16, y0: element.from[1] / 16, z0: element.from[2] / 16,
        x1: element.to[0] / 16,   y1: element.to[1] / 16,   z1: element.to[2] / 16
      };
      const faces = {};
      for (const dir in element.faces) {
        const f = element.faces[dir];
        if (!f.texture) continue;
        faces[dir] = {
          u: f.texture.u, v: f.texture.v, su: f.texture.su, sv: f.texture.sv,
          cull: !!f.cullface,
          tint: f.tintindex !== undefined ? APPROX_TINT : NO_TINT
        };
      }
      out.push({ box, faces });
    }
  }
  return out;
}
