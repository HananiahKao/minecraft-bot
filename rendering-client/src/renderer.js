/**
 * Three.js renderer for Minecraft chunks
 */

import * as THREE from 'three';

export class MinecraftRenderer {
  constructor(container) {
    this.container = container;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x87ceeb);
    this.scene.fog = new THREE.Fog(0x87ceeb, 100, 500);

    this.camera = new THREE.PerspectiveCamera(
      90,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    this.camera.position.set(0, 70, 0);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.shadowMap.enabled = true;
    container.appendChild(this.renderer.domElement);

    this.setupLighting();
    this.chunkMeshes = new Map();
    this.blockGeometries = new Map();

    window.addEventListener('resize', () => this.onWindowResize());
  }

  setupLighting() {
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
    this.scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.6);
    directionalLight.position.set(100, 200, 100);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = 2048;
    directionalLight.shadow.mapSize.height = 2048;
    directionalLight.shadow.camera.left = -200;
    directionalLight.shadow.camera.right = 200;
    directionalLight.shadow.camera.top = 200;
    directionalLight.shadow.camera.bottom = -200;
    this.scene.add(directionalLight);
  }

  addChunk(chunkX, chunkZ, blocks) {
    const chunkKey = `${chunkX},${chunkZ}`;

    if (this.chunkMeshes.has(chunkKey)) {
      const oldMesh = this.chunkMeshes.get(chunkKey);
      this.scene.remove(oldMesh);
      oldMesh.geometry.dispose();
      oldMesh.material.dispose();
    }

    const geometry = new THREE.BufferGeometry();
    const positions = [];
    const normals = [];
    const colors = [];

    const blockMap = new Map();
    for (const block of blocks) {
      const key = `${block.x},${block.y},${block.z}`;
      blockMap.set(key, block);
    }

    const blockSize = 1;
    const blockColors = {
      // Basic Earth & Stone
      stone: 0x808080,
      granite: 0x917066,
      diorite: 0xb3b3b3,
      andesite: 0x8f8f8f,
      cobblestone: 0x707070,
      mossy_cobblestone: 0x5c7066,
      bedrock: 0x1a1a1a,
      dirt: 0x8b7355,
      grass_block: 0x2d8659,
      sand: 0xdfc55a,
      red_sand: 0xc56c2b,
      gravel: 0x757575,
      clay: 0xa8a8a8,
      // Wood Logs
      oak_log: 0x6b4423,
      spruce_log: 0x4a3728,
      birch_log: 0xd4af8f,
      jungle_log: 0x5c3c1f,
      acacia_log: 0x8b6f47,
      dark_oak_log: 0x3d2817,
      mangrove_log: 0x7a3f2a,
      crimson_stem: 0x8b3a3a,
      warped_stem: 0x3a6e6e,
      // Wood Planks
      oak_planks: 0x8b6f47,
      spruce_planks: 0x5a4a3a,
      birch_planks: 0xd4c5a8,
      jungle_planks: 0x7a5c2b,
      acacia_planks: 0xb8860b,
      dark_oak_planks: 0x4a3a2a,
      // Leaves
      oak_leaves: 0x228b22,
      spruce_leaves: 0x1a4d1a,
      birch_leaves: 0x4d7d4d,
      jungle_leaves: 0x2d5c2d,
      acacia_leaves: 0x3d6d2d,
      dark_oak_leaves: 0x1f4d1f,
      // Ores
      coal_ore: 0x505050,
      iron_ore: 0x8b7355,
      copper_ore: 0x a8826b,
      gold_ore: 0xb8860b,
      diamond_ore: 0x33ebcb,
      emerald_ore: 0x20c997,
      lapis_ore: 0x3a5fbf,
      redstone_ore: 0x8b3a3a,
      // Metal Blocks
      iron_block: 0xc8c8c8,
      gold_block: 0xffd700,
      diamond_block: 0x5bebff,
      emerald_block: 0x20c997,
      lapis_block: 0x3a5fbf,
      copper_block: 0xa8826b,
      raw_iron_block: 0x9a8878,
      raw_copper_block: 0xb8956b,
      raw_gold_block: 0xd4a045,
      // Building & Decoration
      obsidian: 0x0a0a0a,
      crying_obsidian: 0x2a2a6a,
      brick: 0xa85c3c,
      bricks: 0xa85c3c,
      red_nether_brick: 0x5c2a3a,
      deepslate_bricks: 0x4a4a5a,
      blackstone: 0x2a2a3a,
      stone_bricks: 0x7a7a7a,
      mossy_stone_bricks: 0x6a7a6a,
      cracked_stone_bricks: 0x6a6a6a,
      // Concrete & Terracotta
      white_concrete: 0xe8e8e8,
      orange_concrete: 0xf07e1e,
      magenta_concrete: 0xbd3e9a,
      light_blue_concrete: 0x3aacdb,
      yellow_concrete: 0xfed835,
      lime_concrete: 0x6abe2e,
      pink_concrete: 0xf28bac,
      gray_concrete: 0x757575,
      light_gray_concrete: 0x9a9a9a,
      cyan_concrete: 0x169c9c,
      purple_concrete: 0x7a3e9d,
      blue_concrete: 0x3a5fbf,
      brown_concrete: 0x705d37,
      green_concrete: 0x4a7c3a,
      red_concrete: 0xb52a2a,
      black_concrete: 0x1a1a1a,
      // Wool (colored blocks)
      white_wool: 0xf0f0f0,
      orange_wool: 0xf5a623,
      magenta_wool: 0xef5350,
      light_blue_wool: 0x64b5f6,
      yellow_wool: 0xfdd835,
      lime_wool: 0x81c784,
      pink_wool: 0xf48fb1,
      gray_wool: 0x757575,
      light_gray_wool: 0xbdbdbd,
      cyan_wool: 0x26c6da,
      purple_wool: 0xab47bc,
      blue_wool: 0x42a5f5,
      brown_wool: 0xa1887f,
      green_wool: 0x558b2f,
      red_wool: 0xd32f2f,
      black_wool: 0x212121,
      // Special
      glass: 0xc0e8ff,
      bookshelf: 0x6b5c3c,
      furnace: 0x5c5c5c,
      crafting_table: 0x6b5c3c,
      chest: 0x8b6f47,
      barrel: 0x8b6f47,
      smithing_table: 0x6b5c3c,
      // Liquids (darker water)
      water: 0x1a4d7a,
      lava: 0xff3300,
      // Nether
      netherrack: 0x6b3a2a,
      soul_sand: 0x5c4a3a,
      soul_soil: 0x6b5a4a,
      magma_block: 0xaa4a2a,
      // End
      end_stone: 0xd4c56a,
      purpur_block: 0x9d6ba8,
      endrod: 0xc8c8ff,
      // Fallback
      default: 0xff00ff
    };

    const getBlockColor = (blockName) => {
      for (const [name, color] of Object.entries(blockColors)) {
        if (blockName.includes(name)) {
          return color;
        }
      }
      return blockColors.default;
    };

    const isBlockVisible = (x, y, z) => blockMap.has(`${x},${y},${z}`);
    const shouldRenderFace = (x, y, z, direction) => {
      switch (direction) {
        case 'top': return !isBlockVisible(x, y + 1, z);
        case 'bottom': return !isBlockVisible(x, y - 1, z);
        case 'front': return !isBlockVisible(x, y, z + 1);
        case 'back': return !isBlockVisible(x, y, z - 1);
        case 'right': return !isBlockVisible(x + 1, y, z);
        case 'left': return !isBlockVisible(x - 1, y, z);
      }
      return false;
    };

    for (const block of blocks) {
      const { x, y, z, name } = block;
      const color = getBlockColor(name);
      const rgb = new THREE.Color(color);
      const bx = chunkX * 16 + x;
      const by = y;
      const bz = chunkZ * 16 + z;

      // Top face (CCW from above)
      if (shouldRenderFace(x, y, z, 'top')) {
        positions.push(bx, by + 1, bz + 1, bx + 1, by + 1, bz + 1, bx + 1, by + 1, bz);
        positions.push(bx, by + 1, bz + 1, bx + 1, by + 1, bz, bx, by + 1, bz);
        for (let i = 0; i < 6; i++) { colors.push(rgb.r, rgb.g, rgb.b); normals.push(0, 1, 0); }
      }
      // Bottom face (CCW from below)
      if (shouldRenderFace(x, y, z, 'bottom')) {
        positions.push(bx, by, bz, bx + 1, by, bz, bx + 1, by, bz + 1);
        positions.push(bx, by, bz, bx + 1, by, bz + 1, bx, by, bz + 1);
        for (let i = 0; i < 6; i++) { colors.push(rgb.r, rgb.g, rgb.b); normals.push(0, -1, 0); }
      }
      // Front face +Z (CCW from front)
      if (shouldRenderFace(x, y, z, 'front')) {
        positions.push(bx + 1, by, bz + 1, bx, by, bz + 1, bx, by + 1, bz + 1);
        positions.push(bx + 1, by, bz + 1, bx, by + 1, bz + 1, bx + 1, by + 1, bz + 1);
        for (let i = 0; i < 6; i++) { colors.push(rgb.r, rgb.g, rgb.b); normals.push(0, 0, 1); }
      }
      // Back face -Z (CCW from back)
      if (shouldRenderFace(x, y, z, 'back')) {
        positions.push(bx, by, bz, bx + 1, by, bz, bx + 1, by + 1, bz);
        positions.push(bx, by, bz, bx + 1, by + 1, bz, bx, by + 1, bz);
        for (let i = 0; i < 6; i++) { colors.push(rgb.r, rgb.g, rgb.b); normals.push(0, 0, -1); }
      }
      // Right face +X (CCW from right)
      if (shouldRenderFace(x, y, z, 'right')) {
        positions.push(bx + 1, by, bz + 1, bx + 1, by, bz, bx + 1, by + 1, bz);
        positions.push(bx + 1, by, bz + 1, bx + 1, by + 1, bz, bx + 1, by + 1, bz + 1);
        for (let i = 0; i < 6; i++) { colors.push(rgb.r, rgb.g, rgb.b); normals.push(1, 0, 0); }
      }
      // Left face -X (CCW from left)
      if (shouldRenderFace(x, y, z, 'left')) {
        positions.push(bx, by, bz, bx, by, bz + 1, bx, by + 1, bz + 1);
        positions.push(bx, by, bz, bx, by + 1, bz + 1, bx, by + 1, bz);
        for (let i = 0; i < 6; i++) { colors.push(rgb.r, rgb.g, rgb.b); normals.push(-1, 0, 0); }
      }
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(normals), 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colors), 3));

    const material = new THREE.MeshPhongMaterial({
      vertexColors: true,
      flatShading: true,
      side: THREE.DoubleSide,
      wireframe: false
    });

    const mesh = new THREE.Mesh(geometry, material);
    this.scene.add(mesh);
    this.chunkMeshes.set(chunkKey, mesh);
  }

  removeChunk(chunkX, chunkZ) {
    const chunkKey = `${chunkX},${chunkZ}`;
    if (this.chunkMeshes.has(chunkKey)) {
      const mesh = this.chunkMeshes.get(chunkKey);
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
      this.chunkMeshes.delete(chunkKey);
    }
  }

  setCameraPosition(x, y, z) {
    this.camera.position.set(x, y, z);
  }

  getCameraPosition() {
    return {
      x: this.camera.position.x,
      y: this.camera.position.y,
      z: this.camera.position.z
    };
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  onWindowResize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }
}
