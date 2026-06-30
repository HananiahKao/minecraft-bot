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
    this.lastMouseMoveTime = 0;
    this._pendingDX = 0;   // accumulated mouse delta since last applyMouseLook()
    this._pendingDY = 0;

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
      this.lastMouseMoveTime = performance.now();
      this._pendingDX += e.movementX || e.mozMovementX || 0;
      this._pendingDY += e.movementY || e.mozMovementY || 0;
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

  // Call once per rAF frame — applies all accumulated mouse deltas in one trig pass
  applyMouseLook() {
    if (this._pendingDX === 0 && this._pendingDY === 0) return;
    this.euler.setFromQuaternion(this.camera.quaternion);
    this.euler.y -= this._pendingDX * 0.003;
    this.euler.x -= this._pendingDY * 0.003;
    this.euler.x = Math.max(-this.pi2, Math.min(this.pi2, this.euler.x));
    this.camera.quaternion.setFromEuler(this.euler);
    this._pendingDX = 0;
    this._pendingDY = 0;
  }

  clearControls() {
    Object.keys(this.controls).forEach(k => this.controls[k] = false);
  }

  getControls() { return this.controls; }

  getMCYaw() {
    this.euler.setFromQuaternion(this.camera.quaternion);
    return this.euler.y;
  }

  getMCPitch() {
    this.euler.setFromQuaternion(this.camera.quaternion);
    return -this.euler.x;
  }
}
