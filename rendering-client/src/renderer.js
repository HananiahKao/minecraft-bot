/**
 * Three.js renderer for Minecraft chunks
 *
 * Geometry is built off-thread in chunk-worker.js. The main thread only
 * calls applyChunkGeometry() to create a BufferGeometry from pre-built
 * typed arrays — that part is fast (<1ms per chunk).
 */

import * as THREE from 'three';
import { isMobile } from './mobile.js';

const CHUNK_MATERIAL = new THREE.MeshLambertMaterial({
  vertexColors: true,
  side: THREE.FrontSide,
});

const CHUNK_TRANSPARENT_MATERIAL = new THREE.MeshLambertMaterial({
  vertexColors: true,
  side: THREE.DoubleSide, // render water faces from both above and below
  transparent: true,
  opacity: 0.55,
  depthWrite: true, // write depth so water correctly occludes things behind it
});

// Real block textures (atlas.js's pre-built output, copied verbatim — see
// scripts/extract-assets/'s block equivalent notes). Shared across every
// chunk, loaded once. vertexColors stays on: it carries the fixed
// biome-tint approximation (block-model.js's APPROX_TINT), white everywhere
// else, multiplying the sampled texture rather than replacing it.
const _blockAtlasTexture = new THREE.TextureLoader().load('/assets/textures/blocks/atlas.png', (tex) => {
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.flipY = false; // matches block-model.js's UV convention (ported from models.js, not three.js's default)
});
const CHUNK_TEXTURED_MATERIAL = new THREE.MeshLambertMaterial({
  map: _blockAtlasTexture,
  vertexColors: true,
  side: THREE.FrontSide,
  // Cutout alpha (leaves, grass_block's tinted side overlay, ...): discard
  // near-transparent texels instead of showing their raw RGB, which is
  // typically black in the source PNG. Deliberately NOT `transparent: true`
  // — these aren't translucent like glass/water, they're fully opaque
  // wherever alpha permits, so this stays in the opaque render queue (no
  // blending, no sorting cost) and just adds the discard.
  alphaTest: 0.1,
});
const CHUNK_TEXTURED_TRANSPARENT_MATERIAL = new THREE.MeshLambertMaterial({
  map: _blockAtlasTexture,
  vertexColors: true,
  side: THREE.DoubleSide,
  transparent: true,
  alphaTest: 0.1, // for blocks that are BOTH translucent AND cutout (e.g. stained glass panes)
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
    // Mobile: cap at 1.0 — Retina 2x would quadruple fragment work with 1.65M vertices
    this.renderer.setPixelRatio(isMobile() ? Math.min(window.devicePixelRatio, 1) : window.devicePixelRatio);
    this.renderer.shadowMap.enabled = false;
    container.appendChild(this.renderer.domElement);

    this.setupLighting();

    // key "x,z" → THREE.Mesh (loaded chunks, opaque, flat-colored fallback)
    this.chunkMeshes = new Map();
    // key "x,z" → THREE.Mesh (loaded chunks, transparent — water/glass, flat-colored fallback)
    this.chunkMeshesT = new Map();
    // key "x,z" → THREE.Mesh (loaded chunks, opaque, real block texture)
    this.chunkMeshesTex = new Map();
    // key "x,z" → THREE.Mesh (loaded chunks, transparent, real block texture)
    this.chunkMeshesTexT = new Map();
    // key "x,z" → in-flight to worker (initial load or update)
    this._pending = new Set();
    // key "x,z" → THREE.Mesh being replaced — stays in scene until applyChunkGeometry swaps it
    this._updating = new Map();
    this._updatingT = new Map();
    this._updatingTex = new Map();
    this._updatingTexT = new Map();

    this._raycaster = new THREE.Raycaster();
    this._raycaster.near = 0.1;
    this._raycaster.far = 5; // updated by setReach()
    this._raycaster.firstHitOnly = true;
    this._centerNDC = new THREE.Vector2(0, 0);

    this._highlightMesh = new THREE.LineSegments(_BOX_EDGES, HIGHLIGHT_MATERIAL);
    this._highlightMesh.visible = false;
    this.scene.add(this._highlightMesh);
    this.targetedBlock = null; // { x, y, z } or null
    this.targetedFace = null;  // { x, y, z } normal of the hit face

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

  // Queue a live update for an already-loaded or currently-rebuilding chunk.
  // Allows multiple worker messages in-flight for the same chunk — the last result wins.
  reserveUpdate(chunkX, chunkZ) {
    const key = `${chunkX},${chunkZ}`;
    const existing = this.chunkMeshes.get(key);
    if (existing) { this._updating.set(key, existing); this.chunkMeshes.delete(key); }
    const existingT = this.chunkMeshesT.get(key);
    if (existingT) { this._updatingT.set(key, existingT); this.chunkMeshesT.delete(key); }
    const existingTex = this.chunkMeshesTex.get(key);
    if (existingTex) { this._updatingTex.set(key, existingTex); this.chunkMeshesTex.delete(key); }
    const existingTexT = this.chunkMeshesTexT.get(key);
    if (existingTexT) { this._updatingTexT.set(key, existingTexT); this.chunkMeshesTexT.delete(key); }
    this._pending.add(key);
    return true;
  }

  // Swaps one mesh slot: removes the old mesh (if any), builds + adds a new
  // one from the given attributes (if any data), and updates the tracking
  // maps. Shared by all four mesh kinds (flat/textured × opaque/transparent).
  _swapMesh(loadedMap, updatingMap, key, material, attrs) {
    const old = updatingMap.get(key) || loadedMap.get(key);
    if (old) { this.scene.remove(old); old.geometry.dispose(); updatingMap.delete(key); }
    if (!attrs.position) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(attrs.position, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(attrs.normal, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(attrs.color, 3));
    const isTextured = !!attrs.uv;
    if (attrs.uv) geo.setAttribute('uv', new THREE.BufferAttribute(attrs.uv, 2));
    geo.computeBoundingSphere(); // pre-compute so Three.js frustum culling never stalls on render
    const mesh = new THREE.Mesh(geo, material);
    // Raycasting (updateRaycast) needs to know whether a hit came from real
    // block-model geometry (trust the normal unconditionally) or the
    // flat-colored fallback (may still include the old hand-written thick
    // ladder box, which needs the oblique-angle correction — see there).
    mesh.userData.isTextured = isTextured;
    this.scene.add(mesh);
    loadedMap.set(key, mesh);
  }

  // Called from worker onmessage — creates up to 4 meshes (flat-colored
  // fallback × opaque/transparent, real-textured × opaque/transparent) from
  // the worker's pre-built typed arrays. `data` is the worker's message
  // payload as-is (positions/normals/colors/tPositions/.../texPositions/...).
  applyChunkGeometry(chunkX, chunkZ, data) {
    const key = `${chunkX},${chunkZ}`;
    this._pending.delete(key);

    this._swapMesh(this.chunkMeshes, this._updating, key, CHUNK_MATERIAL,
      { position: data.positions, normal: data.normals, color: data.colors });
    this._swapMesh(this.chunkMeshesT, this._updatingT, key, CHUNK_TRANSPARENT_MATERIAL,
      { position: data.tPositions, normal: data.tNormals, color: data.tColors });
    this._swapMesh(this.chunkMeshesTex, this._updatingTex, key, CHUNK_TEXTURED_MATERIAL,
      { position: data.texPositions, normal: data.texNormals, color: data.texColors, uv: data.texUvs });
    this._swapMesh(this.chunkMeshesTexT, this._updatingTexT, key, CHUNK_TEXTURED_TRANSPARENT_MATERIAL,
      { position: data.texPositionsT, normal: data.texNormalsT, color: data.texColorsT, uv: data.texUvsT });
  }

  removeChunk(chunkX, chunkZ) {
    const key = `${chunkX},${chunkZ}`;
    this._pending.delete(key);
    for (const map of [this.chunkMeshes, this.chunkMeshesT, this.chunkMeshesTex, this.chunkMeshesTexT]) {
      const mesh = map.get(key);
      if (mesh) { this.scene.remove(mesh); mesh.geometry.dispose(); map.delete(key); }
    }
  }

  // True once a chunk's geometry has arrived from the worker, in ANY of the
  // 4 mesh kinds — a chunk made entirely of real-textured blocks (now very
  // plausible, with ~1004 blocks covered) may have nothing in chunkMeshes
  // at all, so callers that mean "is this chunk loaded" must check all of
  // them, not just chunkMeshes.has(key). Also true mid-rebuild (any
  // "_updating*" map), matching reserveUpdate's own join condition.
  isLoaded(key) {
    return this.chunkMeshes.has(key) || this.chunkMeshesT.has(key) ||
      this.chunkMeshesTex.has(key) || this.chunkMeshesTexT.has(key) ||
      this._updating.has(key) || this._updatingT.has(key) ||
      this._updatingTex.has(key) || this._updatingTexT.has(key);
  }

  // Every currently-loaded chunk key, across all 4 mesh kinds — for callers
  // that need to enumerate loaded chunks (e.g. to find out-of-range ones to
  // unload), not just check one.
  loadedKeys() {
    const keys = new Set();
    for (const map of [this.chunkMeshes, this.chunkMeshesT, this.chunkMeshesTex, this.chunkMeshesTexT]) {
      for (const key of map.keys()) keys.add(key);
    }
    return keys;
  }

  // Chunks that are fully in scene OR being rebuilt (old mesh still visible) — never drops during seam-fix rebuilds
  get loadedChunks() { return this.loadedKeys().size + this._updating.size; }

  get totalVertices() {
    let n = 0;
    for (const map of [this.chunkMeshes, this.chunkMeshesTex])
      for (const mesh of map.values())
        n += mesh.geometry.attributes.position.count;
    return n;
  }

  // Call once per frame (before render). Updates targetedBlock and highlight box.
  updateRaycast() {
    this._raycaster.setFromCamera(this._centerNDC, this.camera);
    const meshes = [
      ...this.chunkMeshes.values(),
      ...this.chunkMeshesT.values(),
      ...this.chunkMeshesTex.values(),
      ...this.chunkMeshesTexT.values(),
    ];
    const hits = this._raycaster.intersectObjects(meshes, false);
    if (hits.length === 0) {
      this._highlightMesh.visible = false;
      this.targetedBlock = null;
      this.targetedFace = null;
      return;
    }
    const hit = hits[0];
    const gn = hit.face.normal;

    // Block position: step a tiny amount inward along the face normal so we
    // land inside the block that owns this face. Use 0.01 (not 0.5) so it
    // works for both full-block faces (hit.point at integer boundary) AND
    // interior model-block faces (ladder front at z+0.8125, etc.). A 0.5
    // step overshoots interior faces and returns the wrong block.
    const E = 0.01;
    const bx = Math.floor(hit.point.x - gn.x * E);
    const by = Math.floor(hit.point.y - gn.y * E);
    const bz = Math.floor(hit.point.z - gn.z * E);
    this.targetedBlock = { x: bx, y: by, z: bz };

    // Face direction: the geometry normal from a real hit is always
    // geometrically correct and should be trusted directly — this used to
    // be unconditional, but a fallback was added for the OLD hand-written
    // flat-colored ladder box (thick, 3/16 deep, with real clickable side
    // surfaces): clicking that box's side edge could return its one visible
    // face's normal instead of the side you actually clicked. That fallback
    // used viewing angle (dot(normal, -ray) ≤ 0.5, i.e. >=60 degrees off
    // normal) as a proxy for "this might be an edge click" — but viewing
    // angle alone doesn't mean that at all: looking at any ordinary flat
    // top face from a shallow angle (e.g. looking down slightly while
    // walking) is >=60 degrees off normal very often, and the real block-
    // model geometry (now covering ~1000 blocks, not just a hand-written
    // special case) has no such ambiguity — a real ladder is now a
    // paper-thin plane with no meaningful side surface to misfire on.
    // Applying this correction to those hits was overriding perfectly
    // correct top-face hits with a wrong guessed side face whenever viewed
    // at anything but a steep angle — exactly the reported bug (sapling
    // placement failing when aiming at the ground from a shallow angle).
    // Scope the fallback to ONLY the flat-colored, non-textured meshes,
    // where the old thick hand-written box can still appear (pre-load
    // fallback window).
    let fn = { x: gn.x, y: gn.y, z: gn.z };
    if (!hit.object.userData.isTextured) {
      const rd = this._raycaster.ray.direction;
      const facesCamera = -(gn.x * rd.x + gn.y * rd.y + gn.z * rd.z) > 0.5;
      if (!facesCamera) {
        const ax = Math.abs(rd.x), ay = Math.abs(rd.y), az = Math.abs(rd.z);
        if (ax >= ay && ax >= az)      fn = { x: rd.x < 0 ? 1 : -1, y: 0, z: 0 };
        else if (ay >= ax && ay >= az) fn = { x: 0, y: rd.y < 0 ? 1 : -1, z: 0 };
        else                           fn = { x: 0, y: 0, z: rd.z < 0 ? 1 : -1 };
      }
    }
    this.targetedFace = fn;

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
