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
      stone: 0x808080,
      dirt: 0x8b7355,
      grass_block: 0x2d8659,
      sand: 0xdfc55a,
      gravel: 0x757575,
      oak_log: 0x6b4423,
      oak_leaves: 0x228b22,
      water: 0x4da6ff,
      lava: 0xff6600,
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
