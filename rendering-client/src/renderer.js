/**
 * Three.js renderer for Minecraft chunks
 *
 * Geometry is built off-thread in chunk-worker.js. The main thread only
 * calls applyChunkGeometry() to create a BufferGeometry from pre-built
 * typed arrays — that part is fast (<1ms per chunk).
 */

import * as THREE from 'three';

const CHUNK_MATERIAL = new THREE.MeshLambertMaterial({
  vertexColors: true,
  side: THREE.FrontSide,
});

const HIGHLIGHT_MATERIAL = new THREE.LineBasicMaterial({ color: 0x000000, linewidth: 2 });
// Unit cube edges (12 lines × 2 vertices)
const _BOX_EDGES = (() => {
  const geo = new THREE.BoxGeometry(1.002, 1.002, 1.002);
  return new THREE.EdgesGeometry(geo);
})();

export class MinecraftRenderer {
  constructor(container) {
    this.container = container;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x87ceeb);
    this.scene.fog = new THREE.Fog(0x87ceeb, 100, 500);

    this.camera = new THREE.PerspectiveCamera(90, window.innerWidth / window.innerHeight, 0.1, 1000);
    this.camera.position.set(0, 70, 0);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.shadowMap.enabled = false;
    container.appendChild(this.renderer.domElement);

    this.setupLighting();

    // key "x,z" → THREE.Mesh (loaded chunks)
    this.chunkMeshes = new Map();
    // key "x,z" → in-flight to worker (initial load or update)
    this._pending = new Set();
    // key "x,z" → THREE.Mesh being replaced — stays in scene until applyChunkGeometry swaps it
    this._updating = new Map();

    this._raycaster = new THREE.Raycaster();
    this._raycaster.near = 0.1;
    this._raycaster.far = 5; // updated by setReach()
    this._raycaster.firstHitOnly = true;
    this._centerNDC = new THREE.Vector2(0, 0);

    this._highlightMesh = new THREE.LineSegments(_BOX_EDGES, HIGHLIGHT_MATERIAL);
    this._highlightMesh.visible = false;
    this.scene.add(this._highlightMesh);
    this.targetedBlock = null; // { x, y, z } or null

    window.addEventListener('resize', () => this.onWindowResize());
  }

  setupLighting() {
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.9));
    const sun = new THREE.DirectionalLight(0xffffff, 0.6);
    sun.position.set(100, 200, 100);
    sun.castShadow = false;
    this.scene.add(sun);
  }

  // Returns true if chunk is new (not loaded and not in-flight). Marks it pending.
  reserveChunk(chunkX, chunkZ) {
    const key = `${chunkX},${chunkZ}`;
    if (this.chunkMeshes.has(key) || this._pending.has(key)) return false;
    this._pending.add(key);
    return true;
  }

  // Queue a live update for an already-loaded chunk. Old mesh stays visible until swap.
  // Returns false if an update is already in flight for this chunk.
  reserveUpdate(chunkX, chunkZ) {
    const key = `${chunkX},${chunkZ}`;
    if (this._pending.has(key)) return false; // already rebuilding
    const existing = this.chunkMeshes.get(key);
    if (existing) {
      this._updating.set(key, existing); // keep visible in scene
      this.chunkMeshes.delete(key);
    }
    this._pending.add(key);
    return true;
  }

  // Called from worker onmessage — creates mesh from pre-built typed arrays.
  applyChunkGeometry(chunkX, chunkZ, positions, normals, colors) {
    const key = `${chunkX},${chunkZ}`;
    this._pending.delete(key);

    // Remove old mesh — either a live-update placeholder or a stale loaded mesh
    const old = this._updating.get(key) || this.chunkMeshes.get(key);
    if (old) { this.scene.remove(old); old.geometry.dispose(); this._updating.delete(key); }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('normal',   new THREE.BufferAttribute(normals,   3));
    geo.setAttribute('color',    new THREE.BufferAttribute(colors,    3));
    const mesh = new THREE.Mesh(geo, CHUNK_MATERIAL);
    this.scene.add(mesh);
    this.chunkMeshes.set(key, mesh);
  }

  removeChunk(chunkX, chunkZ) {
    const key = `${chunkX},${chunkZ}`;
    this._pending.delete(key);
    const mesh = this.chunkMeshes.get(key);
    if (!mesh) return;
    this.scene.remove(mesh);
    mesh.geometry.dispose();
    this.chunkMeshes.delete(key);
  }

  get totalVertices() {
    let n = 0;
    for (const mesh of this.chunkMeshes.values())
      n += mesh.geometry.attributes.position.count;
    return n;
  }

  // Call once per frame (before render). Updates targetedBlock and highlight box.
  updateRaycast() {
    this._raycaster.setFromCamera(this._centerNDC, this.camera);
    const meshes = Array.from(this.chunkMeshes.values());
    const hits = this._raycaster.intersectObjects(meshes, false);
    if (hits.length === 0) {
      this._highlightMesh.visible = false;
      this.targetedBlock = null;
      return;
    }
    const hit = hits[0];
    // Step slightly inside the hit face to land in the correct block
    const n = hit.face.normal;
    const px = hit.point.x - n.x * 0.5;
    const py = hit.point.y - n.y * 0.5;
    const pz = hit.point.z - n.z * 0.5;
    const bx = Math.floor(px);
    const by = Math.floor(py);
    const bz = Math.floor(pz);
    this.targetedBlock = { x: bx, y: by, z: bz };
    this._highlightMesh.position.set(bx + 0.5, by + 0.5, bz + 0.5);
    this._highlightMesh.visible = true;
  }

  setReach(blocks) { this._raycaster.far = blocks; }

  setCameraPosition(x, y, z) { this.camera.position.set(x, y, z); }
  getCameraPosition() { return { x: this.camera.position.x, y: this.camera.position.y, z: this.camera.position.z }; }

  setPixelRatio(ratio) { this.renderer.setPixelRatio(ratio); }

  render() { this.renderer.render(this.scene, this.camera); }

  onWindowResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }
}
