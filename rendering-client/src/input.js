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
    this._breakHeld = false;      // held state: left button held → mine targeted block
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

  // Called by mobile overlay buttons to set movement/action state
  setControl(name, active) {
    if (name in this.controls) { this.controls[name] = active; return; }
    if (name === 'breakBlock') { this._breakHeld = active; return; }
    if (name === 'placePending' && active) { this._placePending = true; return; }
    if (name === 'pickPending'  && active) { this._pickPending  = true; return; }
    if (name === 'flyToggle'    && active) { this._flyToggle    = true; return; }
  }

  // Sets up touch-based camera look for mobile (pointer lock unavailable on iOS).
  // A touch starting on the right 60% of the screen becomes the look touch.
  // Separate from the D-pad which lives on the left 40%.
  setupTouchLook() {
    let lookId = null, lastX = 0, lastY = 0;
    const canvas = document.getElementById('canvas');
    const LOOK_THRESHOLD = 0.4; // touches starting left of this fraction go to D-pad

    canvas.addEventListener('touchstart', (e) => {
      for (const t of e.changedTouches) {
        if (lookId === null && t.clientX / window.innerWidth > LOOK_THRESHOLD) {
          lookId = t.identifier; lastX = t.clientX; lastY = t.clientY;
        }
      }
      e.preventDefault();
    }, { passive: false });

    canvas.addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === lookId) {
          this._pendingDX += t.clientX - lastX;
          this._pendingDY += t.clientY - lastY;
          lastX = t.clientX; lastY = t.clientY;
          this.lastMouseMoveTime = performance.now();
        }
      }
      e.preventDefault();
    }, { passive: false });

    canvas.addEventListener('touchend', (e) => {
      for (const t of e.changedTouches) if (t.identifier === lookId) lookId = null;
    });
    canvas.addEventListener('touchcancel', (e) => {
      for (const t of e.changedTouches) if (t.identifier === lookId) lookId = null;
    });
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
      if (e.button === 0) this._breakHeld = true;
      if (e.button === 1) { e.preventDefault(); this._pickPending = true; }
      if (e.button === 2) { console.log('[input] right-click → placePending'); this._placePending = true; }
    });

    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) this._breakHeld = false;
    });

    document.addEventListener('contextmenu', (e) => e.preventDefault());

    this._lastScrollMs = 0;
    document.addEventListener('wheel', (e) => {
      if (!this.isPointerLocked) return;
      if (Math.abs(e.deltaY) < 20) return; // dead zone — Magic Mouse is too sensitive
      const now = performance.now();
      if (now - this._lastScrollMs < 300) return; // max one slot change per 300ms
      this._lastScrollMs = now;
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
      if (e.key.toLowerCase() === 'f' && !e.repeat) this._pickPending = true;
    });

    document.addEventListener('click', (e) => {
      if (e.target.closest('#metrics')) return;
      if (!this.isPointerLocked) document.body.requestPointerLock();
    });

    document.addEventListener('pointerlockchange', () => {
      this.isPointerLocked = document.pointerLockElement === document.body;
      // Clear all controls on any pointer lock change to prevent stuck keys
      if (!this.isPointerLocked) { this.clearControls(); this._breakHeld = false; }
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
    const breakBlock = this._breakHeld;
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
