import * as THREE from 'three';

// Item color lookup — same palette as chunk-worker BLOCK_COLORS, just a subset
const ITEM_COLORS = {
  dirt: 0x8B6914, grass: 0x5a8a2a, stone: 0x888888, sand: 0xe8d8a0,
  gravel: 0x9b8b7b, cobblestone: 0x7a7a7a, oak_log: 0x7a5c2e,
  oak_planks: 0xc8a870, oak_leaves: 0x3a7a2a, birch_log: 0xc8c0a0,
  spruce_log: 0x5a4020, jungle_log: 0x8a6830, acacia_log: 0xa05030,
  dark_oak_log: 0x3a2810, iron_ore: 0xc07050, gold_ore: 0xe8c040,
  diamond_ore: 0x40c8c8, coal_ore: 0x404040, redstone_ore: 0xc04040,
  lapis_ore: 0x4060c0, emerald_ore: 0x40c870, iron_ingot: 0xd0b090,
  gold_ingot: 0xffd700, diamond: 0x40e0d0, coal: 0x303030,
  redstone: 0xff2020, lapis_lazuli: 0x2244cc, emerald: 0x30c060,
  apple: 0xff4444, bread: 0xd4a050, beef: 0xa03020, chicken: 0xe0b880,
  porkchop: 0xd07060, salmon: 0xe08060, cod: 0xe0c080,
  wheat: 0xe0c060, wheat_seeds: 0xc8b840, carrot: 0xff8820,
  potato: 0xe8d880, melon_slice: 0x70c840, pumpkin: 0xe07820,
  stick: 0xb08040, bow: 0xb08040, arrow: 0xc0c0c0,
  wooden_sword: 0xc8a870, stone_sword: 0x888888, iron_sword: 0xd0d0d0,
  golden_sword: 0xffd700, diamond_sword: 0x40e0d0,
  wooden_pickaxe: 0xc8a870, stone_pickaxe: 0x888888, iron_pickaxe: 0xd0d0d0,
  glass: 0xc0e8f8, glass_pane: 0xc0e8f8,
  oak_sapling: 0x2d8b22, spruce_sapling: 0x1a5c1a, birch_sapling: 0x4d7d2d,
  jungle_sapling: 0x2d6b2d, acacia_sapling: 0x4d7d1a, dark_oak_sapling: 0x1a4d1a,
  torch: 0xffdd88, crafting_table: 0xb08040, furnace: 0x888888,
  chest: 0xb08040, bookshelf: 0xa08060, tnt: 0xff3333,
  water_bucket: 0x4080ff, lava_bucket: 0xff6600, bucket: 0xb0b0b0,
  bone: 0xe8e0d0, bone_meal: 0xfffff0, string: 0xf0f0f0,
  feather: 0xf8f8f8, leather: 0xa06030, wool: 0xf0f0f0,
};

const DEFAULT_ITEM_COLOR = 0xff88ff; // magenta for unknowns — easy to spot

const SIZE = 0.25; // item cube side length

// Shared geometry and material for all item cubes (instancing would be overkill here)
const _geo = new THREE.BoxGeometry(SIZE, SIZE, SIZE);
_geo.computeBoundingSphere();

export class EntityManager {
  constructor(scene) {
    this._scene = scene;
    // id (number) → { mesh, itemName }
    this._items = new Map();
  }

  spawnItem(id, x, y, z, itemName) {
    if (this._items.has(id)) this.destroy(id);

    const color = ITEM_COLORS[itemName] ?? DEFAULT_ITEM_COLOR;
    const mat = new THREE.MeshLambertMaterial({ color });
    const mesh = new THREE.Mesh(_geo, mat);
    // Float 0.1 blocks above ground centre
    mesh.position.set(x, y + 0.1, z);
    this._scene.add(mesh);
    this._items.set(id, { mesh, itemName });
  }

  moveItem(id, x, y, z) {
    const entry = this._items.get(id);
    if (entry) entry.mesh.position.set(x, y + 0.1, z);
  }

  destroy(id) {
    const entry = this._items.get(id);
    if (!entry) return;
    this._scene.remove(entry.mesh);
    entry.mesh.material.dispose();
    this._items.delete(id);
  }

  // Call once per frame with elapsed seconds
  tick(dt) {
    const ROT = Math.PI * 0.8 * dt; // ~0.8π rad/s
    for (const { mesh } of this._items.values()) {
      mesh.rotation.y += ROT;
    }
  }

  // Remove all items (e.g. on bot reconnect / dimension change)
  clear() {
    for (const id of this._items.keys()) this.destroy(id);
  }
}
