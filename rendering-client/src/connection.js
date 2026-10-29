/**
 * WebSocket client for communication with bridge server
 */

export class BridgeConnection {
  constructor(onChunk, onBotReady, onBotPosition, onError, onHotbar, onHeldSlot, onInventory, onWindowOpen, onWindowClose, onWindowUpdate, onEntitySpawn, onEntityMove, onEntityDestroy) {
    this.ws = null;
    this.isConnected = false;
    this.onChunk = onChunk;
    this.onRawChunk = null; // set by main.js to receive raw chunk strings for deferred parse
    this.onBotReady = onBotReady;
    this.onBotPosition = onBotPosition;
    this.onError = onError;
    this.onHotbar = onHotbar;
    this.onHeldSlot = onHeldSlot;
    this.onInventory = onInventory;
    this.onWindowOpen = onWindowOpen;
    this.onWindowClose = onWindowClose;
    this.onWindowUpdate = onWindowUpdate;
    this.onEntitySpawn = onEntitySpawn;
    this.onEntityMove = onEntityMove;
    this.onEntityDestroy = onEntityDestroy;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
  }

  connect(url = `ws://${window.location.hostname}:${new URLSearchParams(window.location.search).get('bridgePort') || 8080}`) {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(url);

        this.ws.onopen = () => {
          console.log('🔗 Connected to bridge');
          this.isConnected = true;
          this.reconnectAttempts = 0;
          resolve();
        };

        // All messages deferred to frame loop — never parse on the onmessage interrupt
        this.ws.onmessage = (event) => {
          if (this.onRawChunk) this.onRawChunk(event.data);
        };

        this.ws.onerror = (error) => {
          console.error('WebSocket error:', error);
          this.isConnected = false;
          if (this.onError) this.onError(error);
          reject(error);
        };

        this.ws.onclose = () => {
          console.log('🔌 Disconnected from bridge');
          this.isConnected = false;
          this.attemptReconnect(url);
        };
      } catch (e) {
        reject(e);
      }
    });
  }

  attemptReconnect(url) {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const delay = 1000 * Math.min(this.reconnectAttempts, 5);
      console.log(`⏳ Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
      setTimeout(() => this.connect(url).catch(() => {}), delay);
    } else {
      console.error('❌ Max reconnection attempts reached');
      if (this.onError) this.onError(new Error('Connection lost'));
    }
  }

  handleMessage(message) {
    switch (message.type) {
      case 'bot_ready':
        console.log('🤖 Bot ready at', message.position);
        if (this.onBotReady) this.onBotReady(message.position);
        break;

      case 'bot_position':
        if (this.onBotPosition) this.onBotPosition(message.position);
        break;

      case 'chunk_data':
        if (this.onChunk) {
          this.onChunk({ x: message.x, z: message.z, blocks: message.blocks });
        }
        break;

      case 'hotbar':
        if (this.onHotbar) this.onHotbar(message.slots, message.heldSlot);
        break;
      case 'held_slot':
        if (this.onHeldSlot) this.onHeldSlot(message.slot);
        break;
      case 'inventory':
        if (this.onInventory) this.onInventory(message.slots, message.cursorItem);
        break;
      case 'window_update':
        if (this.onWindowUpdate) this.onWindowUpdate(message);
        break;
      case 'entity_spawn':
        if (this.onEntitySpawn) this.onEntitySpawn(message);
        break;
      case 'entity_move':
        if (this.onEntityMove) this.onEntityMove(message);
        break;
      case 'entity_destroy':
        if (this.onEntityDestroy) this.onEntityDestroy(message.id);
        break;
      case 'error':
        console.error('Bridge error:', message.message);
        if (this.onError) this.onError(new Error(message.message));
        break;
    }
  }

  send(message) {
    if (this.ws && this.isConnected) {
      try {
        this.ws.send(JSON.stringify(message));
      } catch (e) {
        console.error('Failed to send message:', e.message);
      }
    }
  }

  sendPlayerInput(controls, yaw, pitch, targetedBlock, targetedFace) {
    this.send({ type: 'player_input', controls, yaw, pitch, targetedBlock });
    if (controls.pickBlock && targetedBlock)
      this.send({ type: 'pick_block', block: targetedBlock });
    if (controls.placeBlock && targetedBlock && targetedFace)
      this.send({ type: 'place_block', block: targetedBlock, face: targetedFace });
    if (controls.placeBlock && !targetedBlock)
      this.send({ type: 'use_item' });
  }

  sendClickSlot(slot, button) {
    this.send({ type: 'click_slot', slot, button });
  }

  close() {
    if (this.ws) {
      this.ws.close();
      this.isConnected = false;
    }
  }
}
