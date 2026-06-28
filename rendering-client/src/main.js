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
  // Camera tracks bot — server is authoritative for position
  renderer.setCameraPosition(position[0], position[1] + 1.6, position[2]);
}

function onChunkReceived(chunkData) {
  try {
    const added = renderer.addChunk(chunkData.x, chunkData.z, chunkData.blocks);
    if (added) {
      totalChunksLoaded++;
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
    renderer.render();

    // Send player input at 20Hz (one MC tick)
    const now = Date.now();
    if (connection && connection.isConnected && now - lastInputSendTime >= INPUT_SEND_INTERVAL) {
      connection.sendPlayerInput(
        inputHandler.getControls(),
        inputHandler.getMCYaw(),
        inputHandler.getMCPitch()
      );
      lastInputSendTime = now;
    }
  };

  requestAnimationFrame(loop);
}

function updateStatus(message) {
  const statusEl = document.getElementById('status');
  if (statusEl) statusEl.textContent = message;
}

window.addEventListener('DOMContentLoaded', init);
