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
  andesite: 0x8f8f8f, granite: 0x917066, diorite: 0xb3b3b3, magma_block: 0x8b3a0a,
  ladder: 0x8b6914, stripped_oak_log: 0xb8894a,
  raw_copper: 0xc87941, raw_iron: 0xa07060, raw_gold: 0xd4a030,
  egg: 0xf0e0c0, glow_ink_sac: 0x00e87a, ink_sac: 0x202020,
  torch: 0xffdd88, crafting_table: 0xb08040, furnace: 0x888888,
  chest: 0xb08040, bookshelf: 0xa08060, tnt: 0xff3333,
  water_bucket: 0x4080ff, lava_bucket: 0xff6600, bucket: 0xb0b0b0,
  bone: 0xe8e0d0, bone_meal: 0xfffff0, string: 0xf0f0f0,
  feather: 0xf8f8f8, leather: 0xa06030, wool: 0xf0f0f0,
};

const DEFAULT_ITEM_COLOR = 0xff88ff; // magenta for unknowns — easy to spot

const SIZE = 0.25; // item cube side length

// Shared geometry for item cubes
const _geo = new THREE.BoxGeometry(SIZE, SIZE, SIZE);
_geo.computeBoundingSphere();

// Mob colors
const MOB_COLORS = {
  // Passive
  pig: 0xf0a0a0,
  cow: 0x4a3020,
  sheep: 0xe0e0e0,
  chicken: 0xf8f8e0,
  rabbit: 0xc09060,
  horse: 0x8b6330,
  donkey: 0x7a5a30,
  mule: 0x6a4a20,
  wolf: 0x888888,
  cat: 0xe0c080,
  ocelot: 0xe0c040,
  parrot: 0x40c040,
  fox: 0xe06820,
  bee: 0xf8c820,
  goat: 0xd0c0a0,
  axolotl: 0xff88aa,
  frog: 0x80b840,
  allay: 0x80c8ff,
  sniffer: 0x4a7a50,
  armadillo: 0xa07850,
  camel: 0xd4aa60,
  // Hostile
  zombie: 0x507050,
  skeleton: 0xe8e8e8,
  creeper: 0x40a040,
  spider: 0x303030,
  enderman: 0x202020,
  witch: 0x503070,
  slime: 0x80c840,
  ghast: 0xf8f8f8,
  zombie_piglin: 0xa06050,
  blaze: 0xffa020,
  magma_cube: 0x882200,
  // Aquatic
  cod: 0xe0b060,
  salmon: 0xe06040,
  tropical_fish: 0xff8820,
  pufferfish: 0xe0c020,
  squid: 0x607080,
  glow_squid: 0x20d0b0,
  dolphin: 0x607090,
  turtle: 0x40a060,
  guardian: 0x50a080,
  elder_guardian: 0x80c0a0,
  drowned: 0x407060,
  // Ambient
  bat: 0x303030,
  // NPCs
  villager: 0xd0a870,
  wandering_trader: 0x4060c0,
  iron_golem: 0xc0b0a0,
  snow_golem: 0xf0f8ff,
  // Player — light blue
  player: 0x4488cc,
};

const DEFAULT_MOB_COLOR = 0xaa44aa;

// Mob body dimensions [body_w, body_h, body_d, head_size] — very approximate
const MOB_DIMS = {
  player: [0.6, 1.5, 0.3, 0.5],
  // quadrupeds
  pig:    [0.9, 0.9, 0.6, 0.45],
  cow:    [0.9, 1.2, 0.6, 0.5],
  sheep:  [0.9, 1.1, 0.6, 0.45],
  chicken:[0.4, 0.7, 0.4, 0.3],
  rabbit: [0.4, 0.5, 0.4, 0.3],
  horse:  [1.4, 1.4, 0.6, 0.6],
  // Aquatic / small
  cod:           [0.5, 0.3, 0.2, 0.0],
  salmon:        [0.7, 0.35, 0.2, 0.0],
  tropical_fish: [0.4, 0.3, 0.15, 0.0],
  pufferfish:    [0.4, 0.4, 0.4, 0.0],
  squid:         [0.8, 0.8, 0.8, 0.0],
  glow_squid:    [0.8, 0.8, 0.8, 0.0],
  dolphin:       [0.9, 0.5, 0.5, 0.0],
  turtle:        [1.2, 0.4, 1.2, 0.0],
  bat:           [0.3, 0.3, 0.3, 0.0],
  // etc. — anything not listed falls back to generic
};
const DEFAULT_DIMS = [0.6, 1.0, 0.6, 0.5];

function makeNameplate(label) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const font = 'bold 24px sans-serif';
  ctx.font = font;
  const textW = ctx.measureText(label).width;
  const pad = 8;
  canvas.width = textW + pad * 2;
  canvas.height = 36;
  // Background pill
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.beginPath();
  ctx.roundRect(0, 0, canvas.width, canvas.height, 6);
  ctx.fill();
  // Text
  ctx.font = font;
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, pad, canvas.height / 2);

  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
  const sprite = new THREE.Sprite(mat);
  // Scale so 1 canvas pixel ≈ 1/64 world unit (keeps text readable but not huge)
  const scale = canvas.width / 64;
  sprite.scale.set(scale, canvas.height / 64, 1);
  return sprite;
}

function makeMobMesh(mobType) {
  const [bw, bh, bd, hs] = MOB_DIMS[mobType] || DEFAULT_DIMS;
  const color = MOB_COLORS[mobType] ?? DEFAULT_MOB_COLOR;
  const mat = new THREE.MeshLambertMaterial({ color });

  const group = new THREE.Group();

  const bodyGeo = new THREE.BoxGeometry(bw, bh, bd);
  bodyGeo.computeBoundingSphere();
  const body = new THREE.Mesh(bodyGeo, mat);
  body.position.y = bh / 2;
  group.add(body);

  let topY = bh;
  if (hs > 0) {
    // Head sits on top of body, slightly brighter
    const headColor = new THREE.Color(color).multiplyScalar(1.15);
    const headMat = new THREE.MeshLambertMaterial({ color: headColor });
    const headGeo = new THREE.BoxGeometry(hs, hs, hs);
    headGeo.computeBoundingSphere();
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.y = bh + hs / 2;
    group.add(head);
    topY = bh + hs;
  }

  // Nameplate floats 0.3 blocks above the top of the model
  const nameplate = makeNameplate(mobType.replace(/_/g, ' '));
  nameplate.position.y = topY + 0.3 + nameplate.scale.y / 2;
  group.add(nameplate);

  return group;
}

export class EntityManager {
  constructor(scene) {
    this._scene = scene;
    // id → { mesh, itemName }
    this._items = new Map();
    // id → { group, mobType }
    this._mobs = new Map();
    // item names that had no entry in ITEM_COLORS
    this.unknownItems = new Set();
    // mob types that had no entry in MOB_COLORS
    this.unknownMobs = new Set();
  }

  spawnItem(id, x, y, z, itemName) {
    if (this._items.has(id)) this.destroy(id);

    const color = ITEM_COLORS[itemName] ?? DEFAULT_ITEM_COLOR;
    if (!(itemName in ITEM_COLORS)) this.unknownItems.add(itemName);
    const mat = new THREE.MeshLambertMaterial({ color });
    const mesh = new THREE.Mesh(_geo, mat);
    // Float 0.1 blocks above ground centre
    mesh.position.set(x, y + 0.1, z);
    this._scene.add(mesh);
    this._items.set(id, { mesh, itemName });
  }

  moveItem(id, x, y, z) {
    const entry = this._items.get(id);
    if (!entry) return false;
    entry.mesh.position.set(x, y + 0.1, z);
    return true;
  }

  spawnMob(id, mobType, x, y, z, yaw) {
    if (this._mobs.has(id)) this.destroyMob(id);
    if (!(mobType in MOB_COLORS)) this.unknownMobs.add(mobType);
    const group = makeMobMesh(mobType);
    group.position.set(x, y, z);
    group.rotation.y = yaw || 0;
    this._scene.add(group);
    this._mobs.set(id, { group, mobType });
  }

  moveMob(id, x, y, z, yaw) {
    const entry = this._mobs.get(id);
    if (!entry) return;
    entry.group.position.set(x, y, z);
    if (yaw != null) entry.group.rotation.y = yaw;
  }

  destroyMob(id) {
    const entry = this._mobs.get(id);
    if (!entry) return;
    this._scene.remove(entry.group);
    entry.group.traverse(obj => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (obj.material.map) obj.material.map.dispose();
        obj.material.dispose();
      }
    });
    this._mobs.delete(id);
  }

  destroy(id) {
    // Try item first, then mob
    const item = this._items.get(id);
    if (item) {
      this._scene.remove(item.mesh);
      item.mesh.material.dispose();
      this._items.delete(id);
      return;
    }
    this.destroyMob(id);
  }

  // Call once per frame with elapsed seconds
  tick(dt) {
    const ROT = Math.PI * 0.8 * dt;
    for (const { mesh } of this._items.values()) {
      mesh.rotation.y += ROT;
    }
  }

  // Remove all entities (e.g. on bot reconnect / dimension change)
  clear() {
    for (const id of [...this._items.keys()]) {
      const item = this._items.get(id);
      this._scene.remove(item.mesh);
      item.mesh.material.dispose();
      this._items.delete(id);
    }
    for (const id of [...this._mobs.keys()]) this.destroyMob(id);
  }
}
