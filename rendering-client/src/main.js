/**
 * Main rendering client - Phase 3
 * Camera follows bot position (server-authoritative)
 * WASD/mouse sent as control states to bridge → server physics runs
 */

import { MinecraftRenderer } from './renderer.js';
import { InputHandler } from './input.js';
import { BridgeConnection } from './connection.js';

let renderer = null;
let inputHandler = null;
let connection = null;
let totalChunksLoaded = 0;
let lastInputSendTime = 0;
const INPUT_SEND_INTERVAL = 50; // one Minecraft tick
const CHUNK_RENDER_RADIUS = 8;  // keep chunks within this many chunks of bot
const CHUNKS_PER_FRAME = 4;     // max chunks to build geometry for per frame
let lastBotChunkX = null;
let lastBotChunkZ = null;
const rawChunkQueue = [];       // raw JSON strings — parsed lazily in frame loop
const chunkQueue = [];          // parsed chunk objects waiting to be added to scene
const unloadQueue = [];         // [chunkX, chunkZ] pairs waiting to be removed

function init() {
  const container = document.getElementById('canvas');
  renderer = new MinecraftRenderer(container);
  inputHandler = new InputHandler(renderer.camera);

  connection = new BridgeConnection(
    onChunkReceived,
    onBotReady,
    onBotPosition,
    onError
  );

  connection.onRawChunk = (raw) => rawChunkQueue.push(raw);

  connection.connect().catch((err) => {
    console.error('Failed to connect:', err.message);
    updateStatus('Connection failed. Retrying...');
  });

  startUpdateLoop();
}

function onBotReady(position) {
  console.log('🤖 Bot ready at', position);
  renderer.setCameraPosition(position[0], position[1] + 1.6, position[2]);
  updateStatus(`🎮 Playing | Chunks: ${totalChunksLoaded}`);
}

function onBotPosition(position) {
  renderer.setCameraPosition(position[0], position[1] + 1.6, position[2]);

  const cx = Math.floor(position[0] / 16);
  const cz = Math.floor(position[2] / 16);
  if (cx !== lastBotChunkX || cz !== lastBotChunkZ) {
    lastBotChunkX = cx;
    lastBotChunkZ = cz;
    scheduleUnloadDistantChunks(cx, cz);
  }
}

function scheduleUnloadDistantChunks(botChunkX, botChunkZ) {
  for (const key of renderer.chunkMeshes.keys()) {
    const [kx, kz] = key.split(',').map(Number);
    if (Math.abs(kx - botChunkX) > CHUNK_RENDER_RADIUS || Math.abs(kz - botChunkZ) > CHUNK_RENDER_RADIUS) {
      unloadQueue.push([kx, kz]);
    }
  }
}

function onChunkReceived(chunkData) {
  chunkQueue.push(chunkData);
}

function onError(error) {
  console.error('Bridge error:', error.message);
  updateStatus(`Error: ${error.message}`);
}

let _frameCount = 0;
let _frameBudgetViolations = 0;

function startUpdateLoop() {
  const loop = (timestamp) => {
    const _frameStart = performance.now();
    requestAnimationFrame(loop);

    // Parse raw chunk JSON (deferred from onmessage to avoid blocking input)
    const _t_parse = performance.now();
    for (let i = 0; i < CHUNKS_PER_FRAME && rawChunkQueue.length > 0; i++) {
      try {
        const msg = JSON.parse(rawChunkQueue.shift());
        chunkQueue.push({ x: msg.x, z: msg.z, blocks: msg.blocks });
      } catch (e) {}
    }
    const _dt_parse = performance.now() - _t_parse;

    // Drain unload queue first (cheap: just dispose + remove from scene)
    const _t_unload = performance.now();
    for (let i = 0; i < CHUNKS_PER_FRAME && unloadQueue.length > 0; i++) {
      const [kx, kz] = unloadQueue.shift();
      renderer.removeChunk(kx, kz);
      totalChunksLoaded--;
    }
    const _dt_unload = performance.now() - _t_unload;

    // Then add new chunks (expensive: builds geometry)
    const _t_add = performance.now();
    for (let i = 0; i < CHUNKS_PER_FRAME && chunkQueue.length > 0; i++) {
      const chunkData = chunkQueue.shift();
      try {
        const added = renderer.addChunk(chunkData.x, chunkData.z, chunkData.blocks);
        if (added) totalChunksLoaded++;
      } catch (e) {
        console.error('Failed to render chunk:', e.message);
      }
    }
    const _dt_add = performance.now() - _t_add;

    const _t_render = performance.now();
    renderer.render();
    const _dt_render = performance.now() - _t_render;

    const _dt_input = (() => {
      const t = performance.now();
      const now = Date.now();
      if (connection && connection.isConnected && now - lastInputSendTime >= INPUT_SEND_INTERVAL) {
        connection.sendPlayerInput(inputHandler.getControls(), inputHandler.getMCYaw(), inputHandler.getMCPitch());
        lastInputSendTime = now;
      }
      return performance.now() - t;
    })();

    const _frameTotal = performance.now() - _frameStart;
    _frameCount++;
    if (_frameTotal > 16) {
      _frameBudgetViolations++;
      if (_frameCount % 10 === 0 || _frameTotal > 50) {
        console.log(`[FRAME] total=${_frameTotal.toFixed(1)}ms parse=${_dt_parse.toFixed(1)} add=${_dt_add.toFixed(1)} unload=${_dt_unload.toFixed(1)} render=${_dt_render.toFixed(1)} input=${_dt_input.toFixed(1)} | v=${_frameBudgetViolations}/${_frameCount} raw=${rawChunkQueue.length} q=${chunkQueue.length}`);
      }
    }

    if (chunkQueue.length > 0 || unloadQueue.length > 0) {
      updateStatus(`🎮 Playing | Chunks: ${totalChunksLoaded} (+${chunkQueue.length} load, -${unloadQueue.length} unload)`);
    } else {
      updateStatus(`🎮 Playing | Chunks: ${totalChunksLoaded}`);
    }

  };

  requestAnimationFrame(loop);
}

function updateStatus(message) {
  const statusEl = document.getElementById('status');
  if (statusEl) statusEl.textContent = message;
}

window.addEventListener('DOMContentLoaded', init);
