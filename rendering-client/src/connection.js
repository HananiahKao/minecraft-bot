/**
 * WebSocket client for communication with bridge server
 */

export class BridgeConnection {
  constructor(onChunk, onBotReady, onError) {
    this.ws = null;
    this.isConnected = false;
    this.onChunk = onChunk;
    this.onBotReady = onBotReady;
    this.onError = onError;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
  }

  connect(url = 'ws://localhost:8080') {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(url);

        this.ws.onopen = () => {
          console.log('🔗 Connected to bridge');
          this.isConnected = true;
          this.reconnectAttempts = 0;
          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);
            this.handleMessage(message);
          } catch (e) {
            console.error('Failed to parse message:', e.message);
          }
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
        if (this.onBotReady) {
          this.onBotReady({
            position: message.position,
            dimension: message.dimension
          });
        }
        break;

      case 'chunk_data':
        if (this.onChunk) {
          this.onChunk({
            x: message.x,
            z: message.z,
            blocks: message.blocks
          });
        }
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

  requestChunks(position) {
    const msg = {
      type: 'request_chunks',
      position: [position.x, position.y, position.z]
    };
    console.log(`📤 Requesting chunks:`, {
      x: position.x.toFixed(1),
      y: position.y.toFixed(1),
      z: position.z.toFixed(1),
      connected: this.isConnected
    });
    this.send(msg);
  }

  close() {
    if (this.ws) {
      this.ws.close();
      this.isConnected = false;
    }
  }
}
