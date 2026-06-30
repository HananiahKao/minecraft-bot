/**
 * Input handling - captures WASD/mouse and exposes state for the bridge
 * Camera rotation is applied locally (responsive), controls are sent to server
 */

import * as THREE from 'three';

export class InputHandler {
  constructor(camera) {
    this.camera = camera;
    this.euler = new THREE.Euler(0, 0, 0, 'YXZ');
    this.pi2 = Math.PI / 2;
    this.isPointerLocked = false;

    this.controls = {
      forward: false,
      back: false,
      left: false,
      right: false,
      jump: false,
      sneak: false,
      sprint: false,
    };

    this.registerEventListeners();
  }

  registerEventListeners() {
    const keyMap = {
      'w': 'forward', 'arrowup': 'forward',
      's': 'back',    'arrowdown': 'back',
      'a': 'left',    'arrowleft': 'left',
      'd': 'right',   'arrowright': 'right',
      ' ': 'jump',
      'shift': 'sneak',
      'control': 'sprint',
    };

    document.addEventListener('keydown', (e) => {
      const control = keyMap[e.key.toLowerCase()];
      if (control) {
        this.controls[control] = true;
        e.preventDefault();
      }
    });

    document.addEventListener('keyup', (e) => {
      const control = keyMap[e.key.toLowerCase()];
      if (control) this.controls[control] = false;
    });

    document.addEventListener('mousemove', (e) => {
      if (!this.isPointerLocked) return;
      const movementX = e.movementX || e.mozMovementX || 0;
      const movementY = e.movementY || e.mozMovementY || 0;
      this.euler.setFromQuaternion(this.camera.quaternion);
      this.euler.y -= movementX * 0.003;
      this.euler.x -= movementY * 0.003;
      this.euler.x = Math.max(-this.pi2, Math.min(this.pi2, this.euler.x));
      this.camera.quaternion.setFromEuler(this.euler);
    });

    document.addEventListener('click', (e) => {
      if (e.target.closest('#metrics')) return;
      document.body.requestPointerLock();
    });

    document.addEventListener('pointerlockchange', () => {
      this.isPointerLocked = document.pointerLockElement === document.body;
      // Clear all controls on any pointer lock change to prevent stuck keys
      if (!this.isPointerLocked) this.clearControls();
    });

    window.addEventListener('blur', () => this.clearControls());
  }

  clearControls() {
    Object.keys(this.controls).forEach(k => this.controls[k] = false);
  }

  getControls() {
    return this.controls;
  }

  // Three.js euler.y → Mineflayer yaw
  // Both use: facing direction = (-sin(angle), 0, -cos(angle))
  // Mineflayer internal: yaw=0=north(-Z), yaw=π=south(+Z)  [see conversions.js toNotchianYaw]
  getMCYaw() {
    this.euler.setFromQuaternion(this.camera.quaternion);
    return this.euler.y;
  }

  // Three.js: negative euler.x = looking down. Minecraft: positive pitch = looking down
  getMCPitch() {
    this.euler.setFromQuaternion(this.camera.quaternion);
    return -this.euler.x;
  }
}
