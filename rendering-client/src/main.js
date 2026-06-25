/**
 * Main rendering client - Phase 2.5
 * Client prediction (instant camera) + Server validation (bot walks)
 */

import * as THREE from 'three';
import { MinecraftRenderer } from './renderer.js';
import { InputHandler } from './input.js';
import { BridgeConnection } from './connection.js';

let renderer = null;
let inputHandler = null;
let connection = null;
let lastChunkRequestTime = 0;
let botReadyPosition = null;
let chunksLoadedCount = 0;
let totalChunksLoaded = 0;
let cameraSyncedWithBot = false;
const CHUNKS_BEFORE_CAMERA_MOVE = 5;

function init() {
  const container = document.getElementById('canvas');
  renderer = new MinecraftRenderer(container);
  inputHandler = new InputHandler(renderer.camera);

  connection = new BridgeConnection(
    onChunkReceived,
    onBotReady,
    onError
  );

  connection.connect().catch((err) => {
    console.error('Failed to connect:', err.message);
    updateStatus('Connection failed. Retrying...');
  });

  startUpdateLoop();
}

function onBotReady(data) {
  console.log('🤖 Bot ready:', data.position);
  botReadyPosition = {
    x: data.position[0],
    y: data.position[1],
    z: data.position[2]
  };
  chunksLoadedCount = 0;
  cameraSyncedWithBot = false;
  updateStatus('Waiting for chunks...');
}

function onChunkReceived(chunkData) {
  try {
    const chunkAdded = renderer.addChunk(chunkData.x, chunkData.z, chunkData.blocks);
    if (chunkAdded) {
      totalChunksLoaded++;
      console.log(`📦 Chunk ${chunkData.x},${chunkData.z} loaded (total: ${totalChunksLoaded})`);
      if (!cameraSyncedWithBot && botReadyPosition) {
        chunksLoadedCount++;
        updateStatus(`Loading chunks (${chunksLoadedCount}/${CHUNKS_BEFORE_CAMERA_MOVE})`);
      }
    }
    if (cameraSyncedWithBot) {
      updateStatus(`🎮 Playing | Chunks: ${totalChunksLoaded}`);
    }
  } catch (e) {
    console.error('Failed to render chunk:', e.message);
  }
}

function onError(error) {
  console.error('Bridge error:', error.message);
  updateStatus(`Error: ${error.message}`);
}

function startUpdateLoop() {
  const loop = () => {
    requestAnimationFrame(loop);

    inputHandler.update();
    renderer.render();

    // Phase 2.5: Sync camera to bot position, then send position updates
    if (botReadyPosition && chunksLoadedCount >= CHUNKS_BEFORE_CAMERA_MOVE && !cameraSyncedWithBot) {
      renderer.setCameraPosition(
        botReadyPosition.x,
        botReadyPosition.y + 1.6,
        botReadyPosition.z
      );
      updateStatus('🎮 Playing | Chunks: ' + totalChunksLoaded);
      console.log(`🎥 Camera teleported to bot at (${botReadyPosition.x.toFixed(1)}, ${botReadyPosition.y.toFixed(1)}, ${botReadyPosition.z.toFixed(1)})`);
      botReadyPosition = null;
      cameraSyncedWithBot = true;
    }

    // Send camera position periodically (only after sync)
    const now = Date.now();
    if (cameraSyncedWithBot && now - lastChunkRequestTime > 100) {
      const pos = renderer.getCameraPosition();
      if (connection && connection.isConnected) {
        connection.requestChunks(pos);
        lastChunkRequestTime = now;
      }
    }
  };

  requestAnimationFrame(loop);
}

function updateStatus(message) {
  const statusEl = document.getElementById('status');
  if (statusEl) {
    statusEl.textContent = message;
  }
}

window.addEventListener('DOMContentLoaded', init);
