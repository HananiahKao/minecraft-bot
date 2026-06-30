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
    this._flyToggle = false;     // one-shot: true for one send cycle after double-tap Space
    this._lastSpaceTap = 0;      // timestamp of last Space keydown leading edge
    this._breakPending = false;  // one-shot: left-click while locked → break targeted block
    this._pickPending = false;   // one-shot: middle-click → pick block into hotbar
    this._placePending = false;  // one-shot: right-click → place held block
    this.selectedSlot = 0;       // 0–8, mirrored locally for immediate UI feedback
    this._slotChanged = false;   // one-shot: slot selection changed

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
      // Double-tap Space detection on leading edge (keydown only fires once until keyup)
      if (e.key === ' ' && !e.repeat) {
        const now = performance.now();
        if (now - this._lastSpaceTap < 300) this._flyToggle = true;
        this._lastSpaceTap = now;
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

    document.addEventListener('mousedown', (e) => {
      if (e.target.closest('#metrics')) return;
      if (!this.isPointerLocked) {
        document.body.requestPointerLock();
        return;
      }
      if (e.button === 0) this._breakPending = true;
      if (e.button === 1) { e.preventDefault(); this._pickPending = true; }
      if (e.button === 2) this._placePending = true;
    });

    document.addEventListener('contextmenu', (e) => e.preventDefault());

    document.addEventListener('wheel', (e) => {
      if (!this.isPointerLocked) return;
      const dir = e.deltaY > 0 ? 1 : -1;
      this.selectedSlot = (this.selectedSlot + dir + 9) % 9;
      this._slotChanged = true;
    }, { passive: true });

    document.addEventListener('keydown', (e) => {
      const n = parseInt(e.key);
      if (n >= 1 && n <= 9) {
        this.selectedSlot = n - 1;
        this._slotChanged = true;
      }
    });

    document.addEventListener('click', (e) => {
      if (e.target.closest('#metrics')) return;
      if (!this.isPointerLocked) document.body.requestPointerLock();
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

  getControls() {
    const flyToggle = this._flyToggle;
    this._flyToggle = false;
    if (flyToggle) this.controls.jump = false;
    const breakBlock = this._breakPending;
    this._breakPending = false;
    const pickBlock = this._pickPending;
    this._pickPending = false;
    const placeBlock = this._placePending;
    this._placePending = false;
    const slotChanged = this._slotChanged;
    this._slotChanged = false;
    return { ...this.controls, flyToggle, breakBlock, pickBlock, placeBlock, slotChanged, selectedSlot: this.selectedSlot };
  }

  getMCYaw() {
    this.euler.setFromQuaternion(this.camera.quaternion);
    return this.euler.y;
  }

  getMCPitch() {
    this.euler.setFromQuaternion(this.camera.quaternion);
    return -this.euler.x;
  }
}
