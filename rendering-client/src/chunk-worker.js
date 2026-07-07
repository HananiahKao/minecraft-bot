// Standalone Web Worker — no imports, runs on a separate thread.
// Receives {x, z, blocks}, builds geometry arrays, returns via transferable.

const BLOCK_COLORS = {
  stone: 0x808080, granite: 0x917066, diorite: 0xb3b3b3, andesite: 0x8f8f8f,
  cobblestone: 0x707070, mossy_cobblestone: 0x5c7066, bedrock: 0x1a1a1a,
  dirt: 0x8b7355, grass_block: 0x2d8659, sand: 0xdfc55a, red_sand: 0xc56c2b,
  gravel: 0x757575, clay: 0xa8a8a8,
  deepslate: 0x515154, deepslate_coal_ore: 0x3f3f42, deepslate_iron_ore: 0x6b5c4c,
  deepslate_copper_ore: 0x8b6b5c, deepslate_gold_ore: 0x9b7b5b,
  deepslate_diamond_ore: 0x2b6b83, deepslate_emerald_ore: 0x1b8b7b,
  deepslate_lapis_ore: 0x2b3b7f, deepslate_redstone_ore: 0x6b2b2b,
  oak_log: 0x6b4423, spruce_log: 0x4a3728, birch_log: 0xd4af8f,
  jungle_log: 0x5c3c1f, acacia_log: 0x8b6f47, dark_oak_log: 0x3d2817,
  mangrove_log: 0x7a3f2a, cherry_log: 0x9b7b6b,
  crimson_stem: 0x8b3a3a, warped_stem: 0x3a6e6e,
  oak_planks: 0x8b6f47, spruce_planks: 0x5a4a3a, birch_planks: 0xd4c5a8,
  jungle_planks: 0x7a5c2b, acacia_planks: 0xb8860b, dark_oak_planks: 0x4a3a2a,
  mangrove_planks: 0x9b5c3c, cherry_planks: 0xd4a8a0,
  crimson_planks: 0x9b4f4f, warped_planks: 0x4b7f7f,
  oak_sapling: 0x2d8b22, spruce_sapling: 0x1a5c1a, birch_sapling: 0x4d7d2d,
  jungle_sapling: 0x2d6b2d, acacia_sapling: 0x4d7d1a, dark_oak_sapling: 0x1a4d1a,
  spawner: 0x2a2a4a,
  oak_leaves: 0x228b22, spruce_leaves: 0x1a4d1a, birch_leaves: 0x4d7d4d,
  jungle_leaves: 0x2d5c2d, acacia_leaves: 0x3d6d2d, dark_oak_leaves: 0x1f4d1f,
  mangrove_leaves: 0x4b6b3b, cherry_leaves: 0xc97b8b,
  coal_ore: 0x505050, iron_ore: 0x8b7355, copper_ore: 0xa8826b,
  gold_ore: 0xb8860b, diamond_ore: 0x33ebcb, emerald_ore: 0x20c997,
  lapis_ore: 0x3a5fbf, redstone_ore: 0x8b3a3a,
  nether_quartz_ore: 0xd4c4b4, nether_gold_ore: 0x8b6b2b,
  iron_block: 0xc8c8c8, gold_block: 0xffd700, diamond_block: 0x5bebff,
  emerald_block: 0x20c997, lapis_block: 0x3a5fbf, copper_block: 0xa8826b,
  raw_iron_block: 0x9a8878, raw_copper_block: 0xb8956b, raw_gold_block: 0xd4a045,
  exposed_copper: 0x9b9b7b, weathered_copper: 0x7b9b7b, oxidized_copper: 0x6b9b8b,
  waxed_copper_block: 0xa8826b,
  obsidian: 0x0a0a0a, crying_obsidian: 0x2a2a6a, bricks: 0xa85c3c,
  red_nether_brick: 0x5c2a3a, deepslate_bricks: 0x4a4a5a, blackstone: 0x2a2a3a,
  stone_bricks: 0x7a7a7a, mossy_stone_bricks: 0x6a7a6a, cracked_stone_bricks: 0x6a6a6a,
  tuff: 0x7a7a6a, prismarine: 0x4b9b9b, dark_prismarine: 0x2b6b6b,
  prismarine_bricks: 0x6b9b8b,
  white_concrete: 0xe8e8e8, orange_concrete: 0xf07e1e, magenta_concrete: 0xbd3e9a,
  light_blue_concrete: 0x3aacdb, yellow_concrete: 0xfed835, lime_concrete: 0x6abe2e,
  pink_concrete: 0xf28bac, gray_concrete: 0x757575, light_gray_concrete: 0x9a9a9a,
  cyan_concrete: 0x169c9c, purple_concrete: 0x7a3e9d, blue_concrete: 0x3a5fbf,
  brown_concrete: 0x705d37, green_concrete: 0x4a7c3a, red_concrete: 0xb52a2a,
  black_concrete: 0x1a1a1a,
  white_terracotta: 0xd4c4b4, orange_terracotta: 0xd4854b, magenta_terracotta: 0xa8636b,
  light_blue_terracotta: 0x9b8b7b, yellow_terracotta: 0xd4b84b, lime_terracotta: 0x9b9b5b,
  pink_terracotta: 0xc4917b, gray_terracotta: 0x7a6a5a, light_gray_terracotta: 0xa89a8a,
  cyan_terracotta: 0x7a9b9b, purple_terracotta: 0x9b7a8b, blue_terracotta: 0x6b7a9b,
  brown_terracotta: 0x7a5a4a, green_terracotta: 0x7a8b5a, red_terracotta: 0xa8593a,
  black_terracotta: 0x3a3a2a,
  white_wool: 0xf0f0f0, orange_wool: 0xf5a623, magenta_wool: 0xef5350,
  light_blue_wool: 0x64b5f6, yellow_wool: 0xfdd835, lime_wool: 0x81c784,
  pink_wool: 0xf48fb1, gray_wool: 0x757575, light_gray_wool: 0xbdbdbd,
  cyan_wool: 0x26c6da, purple_wool: 0xab47bc, blue_wool: 0x42a5f5,
  brown_wool: 0xa1887f, green_wool: 0x558b2f, red_wool: 0xd32f2f, black_wool: 0x212121,
  white_stained_glass: 0xf0f0ff, orange_stained_glass: 0xff9900,
  magenta_stained_glass: 0xff3399, light_blue_stained_glass: 0x6699ff,
  yellow_stained_glass: 0xffff00, lime_stained_glass: 0x99ff00,
  pink_stained_glass: 0xff99cc, gray_stained_glass: 0x999999,
  light_gray_stained_glass: 0xcccccc, cyan_stained_glass: 0x00ffff,
  purple_stained_glass: 0xcc00ff, blue_stained_glass: 0x0066ff,
  brown_stained_glass: 0x996633, green_stained_glass: 0x00cc00,
  red_stained_glass: 0xff0000, black_stained_glass: 0x000000,
  glass: 0xc0e8ff, bookshelf: 0x6b5c3c, furnace: 0x5c5c5c,
  crafting_table: 0x6b5c3c, chest: 0x8b6f47, barrel: 0x8b6f47,
  smithing_table: 0x6b5c3c, dispenser: 0x6b5c5c, dropper: 0x6b5c5c,
  piston: 0x9b7a5a, sticky_piston: 0xa8845a,
  water: 0x2e6fa8, bubble_column: 0x3a7ab8, seagrass: 0x2d8659,
  tall_seagrass: 0x2d8659, sea_pickle: 0x4b8b3b, kelp_plant: 0x1a6b3a,
  kelp: 0x1a6b3a, lava: 0xff3300,
  grass: 0x3d7d2d, tall_grass: 0x4d8d3d, glow_lichen: 0x6b9b3b,
  poppy: 0xff3a3a, dandelion: 0xffeb3b, blue_orchid: 0x6b7bff,
  allium: 0x9b7bff, azure_bluet: 0xc0e8ff, red_tulip: 0xff5c3a,
  orange_tulip: 0xff9a3a, white_tulip: 0xf5f5f5, pink_tulip: 0xff9bbb,
  oxeye_daisy: 0xf0f0f0, cornflower: 0x3a7bff, lily_of_the_valley: 0xe8e8e8,
  wither_rose: 0x3a3a3a, sunflower: 0xffeb3b, lilac: 0xbb6bff,
  rose_bush: 0xff5c3a, peony: 0xff9bbb,
  netherrack: 0x6b3a2a, soul_sand: 0x5c4a3a, soul_soil: 0x6b5a4a,
  magma_block: 0xaa4a2a, nether_wart_block: 0x8b2a2a, warped_wart_block: 0x2a8b8b,
  nether_brick: 0x3a2a2a, red_nether_bricks: 0x7a3a2a,
  end_stone: 0xd4c56a, purpur_block: 0x9d6ba8, purpur_pillar: 0x9d6ba8,
  end_rod: 0xc8c8ff, cave_air: 0x808080,
  // amethyst
  amethyst_block: 0x9b59b6, budding_amethyst: 0x7b3f9e,
  small_amethyst_bud: 0xb39bd3, medium_amethyst_bud: 0x9b7bc3,
  large_amethyst_bud: 0x8b5bb3, amethyst_cluster: 0xc39bd3,
  calcite: 0xe8e8e0, smooth_basalt: 0x3a3a4a,
  // oak wood family
  oak_slab: 0xa0782a, oak_stairs: 0xa0782a, oak_fence: 0xa0782a,
  oak_fence_gate: 0xa0782a, oak_door: 0xa0782a, oak_trapdoor: 0xa0782a,
  oak_pressure_plate: 0xa0782a, stripped_oak_wood: 0xc8a868,
  // spruce wood family
  spruce_slab: 0x5a4a3a, spruce_stairs: 0x5a4a3a, spruce_fence: 0x5a4a3a,
  spruce_fence_gate: 0x5a4a3a, spruce_door: 0x5a4a3a, spruce_trapdoor: 0x5a4a3a,
  spruce_pressure_plate: 0x5a4a3a,
  // jungle wood family
  jungle_slab: 0x7a5c2b, jungle_stairs: 0x7a5c2b, jungle_fence: 0x7a5c2b,
  jungle_fence_gate: 0x7a5c2b, jungle_door: 0x7a5c2b, jungle_trapdoor: 0x7a5c2b,
  jungle_pressure_plate: 0x7a5c2b,
  // misc blocks seen in the wild
  cobweb: 0xd0d0d0,
  chain: 0x4a4a5a,
  rail: 0x8b7355, powered_rail: 0x8b7355, detector_rail: 0x8b7355, activator_rail: 0x8b7355,
  // crops & plants
  wheat: 0xd4a820, carrots: 0xff8c00, potatoes: 0xd4b460,
  beetroots: 0x8b1a1a, sugar_cane: 0x5ba85b,
  fern: 0x2d8a2d, large_fern: 0x2d8a2d,
  hay_block: 0xe8c84a, pumpkin: 0xe87818,
  cactus: 0x3d6e2d, dead_bush: 0x8b6914,
  bone_block: 0xe8e0d0,
  farmland: 0x6b4226,
  // utility blocks
  composter: 0x6b3a2a, brewing_stand: 0x4a4a4a,
  cartography_table: 0x8b6914, lectern: 0x8b6f47,
  torch: 0xe8a820, wall_torch: 0xe8a820,
  ladder: 0x8b6914,
  // beds & carpets — full colour set
  white_bed: 0xf0f0f0, orange_bed: 0xf5a623, magenta_bed: 0xef5350,
  light_blue_bed: 0x64b5f6, yellow_bed: 0xfdd835, lime_bed: 0x81c784,
  pink_bed: 0xf48fb1, gray_bed: 0x757575, light_gray_bed: 0xbdbdbd,
  cyan_bed: 0x26c6da, purple_bed: 0xab47bc, blue_bed: 0x3a5fbf,
  brown_bed: 0xa1887f, green_bed: 0x558b2f, red_bed: 0xd32f2f, black_bed: 0x212121,
  white_carpet: 0xf0f0f0, orange_carpet: 0xf5a623, magenta_carpet: 0xef5350,
  light_blue_carpet: 0x64b5f6, yellow_carpet: 0xfdd835, lime_carpet: 0x81c784,
  pink_carpet: 0xf48fb1, gray_carpet: 0x757575, light_gray_carpet: 0xbdbdbd,
  cyan_carpet: 0x26c6da, purple_carpet: 0xab47bc, blue_carpet: 0x3a5fbf,
  brown_carpet: 0xa1887f, green_carpet: 0x558b2f, red_carpet: 0xd32f2f, black_carpet: 0x212121,
  // ice & snow
  ice: 0xa8d8f0, frosted_ice: 0x90c8e8, packed_ice: 0x78b8e8, blue_ice: 0x5098d0,
  snow: 0xf0f4f0, snow_block: 0xf0f4f0, powder_snow: 0xe8eef8,
  // light sources
  lantern: 0xffbb55, soul_lantern: 0x55bbff,
  glowstone: 0xffcc77, shroomlight: 0xff9944,
  // fire
  fire: 0xff7733, soul_fire: 0x3399ff,
  // deep dark / sculk
  sculk: 0x0d2233, sculk_catalyst: 0x151f28, sculk_sensor: 0x0d3045,
  sculk_shrieker: 0x1a2a3a, sculk_vein: 0x0d2a3a,
  // more wood variants
  stripped_spruce_wood: 0x9b7d5a, stripped_birch_wood: 0xd4c090,
  stripped_oak_log: 0xb8904a, stripped_spruce_log: 0x9b7d5a,
  stripped_birch_log: 0xd4c090, stripped_jungle_log: 0xa07840,
  stripped_acacia_log: 0xb8784a, stripped_dark_oak_log: 0x6a4a2a,
  stripped_mangrove_log: 0xa06050, stripped_cherry_log: 0xc09090,
  // village
  bee_nest: 0xc8a951, bell: 0xffd700,
};

// Blocks that don't occlude neighbors — faces adjacent to these are always rendered.
// Also rendered with transparency in a separate mesh pass.
const TRANSPARENT_BLOCKS = new Set([
  'water', 'flowing_water', 'bubble_column',
  'glass', 'glass_pane',
  'white_stained_glass', 'orange_stained_glass', 'magenta_stained_glass',
  'light_blue_stained_glass', 'yellow_stained_glass', 'lime_stained_glass',
  'pink_stained_glass', 'gray_stained_glass', 'light_gray_stained_glass',
  'cyan_stained_glass', 'purple_stained_glass', 'blue_stained_glass',
  'brown_stained_glass', 'green_stained_glass', 'red_stained_glass',
  'black_stained_glass', 'white_stained_glass_pane', 'orange_stained_glass_pane',
  'ice', 'frosted_ice', 'packed_ice', 'blue_ice',
  'fire', 'soul_fire',
  'ladder', 'vine', 'scaffolding',
]);

const colorCache = new Map();

const _unknownBlocks = new Set(); // reported back to main thread

function getBlockRGB(name) {
  if (colorCache.has(name)) return colorCache.get(name);
  let hex = BLOCK_COLORS[name];
  if (hex === undefined) {
    for (const [key, val] of Object.entries(BLOCK_COLORS)) {
      if (name.includes(key)) { hex = val; break; }
    }
    if (hex === undefined) {
      hex = 0xff00ff;
      _unknownBlocks.add(name);
    }
  }
  const rgb = [((hex >> 16) & 0xff) / 255, ((hex >> 8) & 0xff) / 255, (hex & 0xff) / 255];
  colorCache.set(name, rgb);
  return rgb;
}

const _mask = new Uint16Array(16 * 256);
const _used = new Uint8Array(16 * 256);

// edges: { nx, px, nz, pz } — each a Map<"y,local" → blockId> for the adjacent chunk's facing slice
function buildChunkArrays(chunkX, chunkZ, blocks, edges) {
  if (!blocks || blocks.length === 0) return null;

  const nameList = [''];
  const nameIndex = new Map([['', 0]]);
  let yMin = Infinity, yMax = -Infinity;
  for (const { y } of blocks) {
    if (y < yMin) yMin = y;
    if (y > yMax) yMax = y;
  }
  const yRange = yMax - yMin + 1;
  // Grid indexed by (x, z, y-yMin) so negative Y works without remapping
  const grid = new Uint16Array(16 * 16 * yRange);
  // Track which block IDs are transparent for culling
  const transparentIds = new Set(); // non-air transparent block ids (water, glass, etc.)
  for (const { x, y, z, name } of blocks) {
    let id = nameIndex.get(name);
    if (id === undefined) { id = nameList.length; nameList.push(name); nameIndex.set(name, id); }
    if (TRANSPARENT_BLOCKS.has(name)) transparentIds.add(id);
    grid[x + z * 16 + (y - yMin) * 16 * 16] = id;
  }

  const positions = [];      // opaque geometry
  const normals = [];
  const colors = [];
  const tPositions = [];     // transparent geometry
  const tNormals = [];
  const tColors = [];
  const bxBase = chunkX * 16;
  const bzBase = chunkZ * 16;

  function greedy(W, H, cb) {
    _used.fill(0, 0, W * H);
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        const base = i + j * W;
        if (_used[base] || _mask[base] === 0) continue;
        const t = _mask[base];
        let w = 1;
        while (i + w < W && !_used[i + w + j * W] && _mask[i + w + j * W] === t) w++;
        let h = 1;
        scan: while (j + h < H) {
          for (let di = 0; di < w; di++) {
            const c = i + di + (j + h) * W;
            if (_used[c] || _mask[c] !== t) break scan;
          }
          h++;
        }
        for (let dj = 0; dj < h; dj++)
          for (let di = 0; di < w; di++)
            _used[i + di + (j + dj) * W] = 1;
        cb(i, j, w, h, t);
      }
    }
  }

  function pushFace(isTransparent, nx, ny, nz, r, g, b,
    ax, ay, az, bx, by, bz, cx, cy, cz,
    dx, dy, dz, ex, ey, ez, fx, fy, fz) {
    const pos = isTransparent ? tPositions : positions;
    const nor = isTransparent ? tNormals   : normals;
    const col = isTransparent ? tColors    : colors;
    pos.push(ax,ay,az, bx,by,bz, cx,cy,cz, dx,dy,dz, ex,ey,ez, fx,fy,fz);
    for (let i = 0; i < 6; i++) { nor.push(nx,ny,nz); col.push(r,g,b); }
  }

  function nameToId(name) {
    if (!name) return 0;
    let id = nameIndex.get(name);
    if (id === undefined) {
      id = nameList.length;
      nameList.push(name);
      nameIndex.set(name, id);
      if (TRANSPARENT_BLOCKS.has(name)) transparentIds.add(id);
    }
    return id;
  }

  function gi(x, y, z) {
    if (y < yMin || y > yMax) return 0;
    if (x < 0)  return nameToId(edges?.nx?.get(`${y},${z}`));
    if (x > 15) return nameToId(edges?.px?.get(`${y},${z}`));
    if (z < 0)  return nameToId(edges?.nz?.get(`${y},${x}`));
    if (z > 15) return nameToId(edges?.pz?.get(`${y},${x}`));
    return grid[x + z * 16 + (y - yMin) * 16 * 16];
  }

  // A neighbor blocks a face only if it is solid (non-zero and not transparent)
  function isSolid(id) { return id !== 0 && !transparentIds.has(id); }
  // Suppress internal faces between two transparent blocks of the same kind (e.g. water-water)
  function suppressTransparent(bt, neighbor) { return neighbor !== 0 && transparentIds.has(bt) && transparentIds.has(neighbor); }

  // TOP +Y
  for (let y = yMin; y <= yMax; y++) {
    for (let z = 0; z < 16; z++)
      for (let x = 0; x < 16; x++) {
        const bt = gi(x, y, z);
        const neighbor = y < yMax ? gi(x, y+1, z) : 0;
        _mask[x + z*16] = (bt && !isSolid(neighbor) && !suppressTransparent(bt, neighbor)) ? bt : 0;
      }
    greedy(16, 16, (i0, j0, w, h, t) => {
      const [r,g,b] = getBlockRGB(nameList[t]);
      const X0=bxBase+i0, Y=y+1, Z0=bzBase+j0;
      pushFace(transparentIds.has(t), 0,1,0, r,g,b,
        X0,Y,Z0+h, X0+w,Y,Z0, X0,Y,Z0,
        X0,Y,Z0+h, X0+w,Y,Z0+h, X0+w,Y,Z0);
    });
  }

  // BOTTOM -Y
  for (let y = yMin; y <= yMax; y++) {
    for (let z = 0; z < 16; z++)
      for (let x = 0; x < 16; x++) {
        const bt = gi(x, y, z);
        const neighbor = y > yMin ? gi(x, y-1, z) : 0;
        _mask[x + z*16] = (bt && !isSolid(neighbor) && !suppressTransparent(bt, neighbor)) ? bt : 0;
      }
    greedy(16, 16, (i0, j0, w, h, t) => {
      const [r,g,b] = getBlockRGB(nameList[t]);
      const X0=bxBase+i0, Y=y, Z0=bzBase+j0;
      pushFace(transparentIds.has(t), 0,-1,0, r,g,b,
        X0,Y,Z0, X0+w,Y,Z0, X0,Y,Z0+h,
        X0+w,Y,Z0, X0+w,Y,Z0+h, X0,Y,Z0+h);
    });
  }

  // FRONT +Z
  for (let z = 0; z < 16; z++) {
    for (let y = yMin; y <= yMax; y++)
      for (let x = 0; x < 16; x++) {
        const bt = gi(x, y, z);
        const neighbor = gi(x, y, z+1);
        _mask[x + (y-yMin)*16] = (bt && !isSolid(neighbor) && !suppressTransparent(bt, neighbor)) ? bt : 0;
      }
    greedy(16, yRange, (i0, j0, w, h, t) => {
      const [r,g,b] = getBlockRGB(nameList[t]);
      const X0=bxBase+i0, Y0=yMin+j0, Z=bzBase+z+1;
      pushFace(transparentIds.has(t), 0,0,1, r,g,b,
        X0,Y0,Z, X0+w,Y0,Z, X0,Y0+h,Z,
        X0+w,Y0,Z, X0+w,Y0+h,Z, X0,Y0+h,Z);
    });
  }

  // BACK -Z
  for (let z = 0; z < 16; z++) {
    for (let y = yMin; y <= yMax; y++)
      for (let x = 0; x < 16; x++) {
        const bt = gi(x, y, z);
        const neighbor = gi(x, y, z-1);
        _mask[x + (y-yMin)*16] = (bt && !isSolid(neighbor) && !suppressTransparent(bt, neighbor)) ? bt : 0;
      }
    greedy(16, yRange, (i0, j0, w, h, t) => {
      const [r,g,b] = getBlockRGB(nameList[t]);
      const X0=bxBase+i0, Y0=yMin+j0, Z=bzBase+z;
      pushFace(transparentIds.has(t), 0,0,-1, r,g,b,
        X0+w,Y0,Z, X0,Y0,Z, X0+w,Y0+h,Z,
        X0,Y0,Z, X0,Y0+h,Z, X0+w,Y0+h,Z);
    });
  }

  // RIGHT +X
  for (let x = 0; x < 16; x++) {
    for (let y = yMin; y <= yMax; y++)
      for (let z = 0; z < 16; z++) {
        const bt = gi(x, y, z);
        const neighbor = gi(x+1, y, z);
        _mask[z + (y-yMin)*16] = (bt && !isSolid(neighbor) && !suppressTransparent(bt, neighbor)) ? bt : 0;
      }
    greedy(16, yRange, (i0, j0, w, h, t) => {
      const [r,g,b] = getBlockRGB(nameList[t]);
      const X=bxBase+x+1, Y0=yMin+j0, Z0=bzBase+i0;
      pushFace(transparentIds.has(t), 1,0,0, r,g,b,
        X,Y0,Z0+w, X,Y0,Z0, X,Y0+h,Z0,
        X,Y0,Z0+w, X,Y0+h,Z0, X,Y0+h,Z0+w);
    });
  }

  // LEFT -X
  for (let x = 0; x < 16; x++) {
    for (let y = yMin; y <= yMax; y++)
      for (let z = 0; z < 16; z++) {
        const bt = gi(x, y, z);
        const neighbor = gi(x-1, y, z);
        _mask[z + (y-yMin)*16] = (bt && !isSolid(neighbor) && !suppressTransparent(bt, neighbor)) ? bt : 0;
      }
    greedy(16, yRange, (i0, j0, w, h, t) => {
      const [r,g,b] = getBlockRGB(nameList[t]);
      const X=bxBase+x, Y0=yMin+j0, Z0=bzBase+i0;
      pushFace(transparentIds.has(t), -1,0,0, r,g,b,
        X,Y0,Z0, X,Y0,Z0+w, X,Y0+h,Z0+w,
        X,Y0,Z0, X,Y0+h,Z0+w, X,Y0+h,Z0);
    });
  }

  if (positions.length === 0 && tPositions.length === 0) return null;
  return {
    positions:  positions.length  ? new Float32Array(positions)  : null,
    normals:    normals.length     ? new Float32Array(normals)    : null,
    colors:     colors.length      ? new Float32Array(colors)     : null,
    tPositions: tPositions.length  ? new Float32Array(tPositions) : null,
    tNormals:   tNormals.length    ? new Float32Array(tNormals)   : null,
    tColors:    tColors.length     ? new Float32Array(tColors)    : null,
  };
}

self.onmessage = ({ data: { x, z, blocks, edges } }) => {
  const result = buildChunkArrays(x, z, blocks, edges);
  if (!result) {
    self.postMessage({ x, z, empty: true });
    return;
  }
  const unknown = _unknownBlocks.size > 0 ? Array.from(_unknownBlocks) : null;
  const transferable = [];
  if (result.positions)  transferable.push(result.positions.buffer);
  if (result.normals)    transferable.push(result.normals.buffer);
  if (result.colors)     transferable.push(result.colors.buffer);
  if (result.tPositions) transferable.push(result.tPositions.buffer);
  if (result.tNormals)   transferable.push(result.tNormals.buffer);
  if (result.tColors)    transferable.push(result.tColors.buffer);
  self.postMessage({ x, z, ...result, unknown }, transferable);
};
