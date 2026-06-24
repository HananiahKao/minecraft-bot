/**
 * Input handling for camera movement and mouse look
 */

import * as THREE from 'three';

export class InputHandler {
  constructor(camera) {
    this.camera = camera;
    this.keys = {};
    this.euler = new THREE.Euler(0, 0, 0, 'YXZ');
    this.pi2 = Math.PI / 2;
    this.moveVector = new THREE.Vector3();
    this.moveSpeed = 0.5;

    this.registerEventListeners();
  }

  registerEventListeners() {
    document.addEventListener('keydown', (e) => {
      this.keys[e.key.toLowerCase()] = true;
      if (['w', 'a', 's', 'd', ' '].includes(e.key.toLowerCase())) {
        e.preventDefault();
      }
    });

    document.addEventListener('keyup', (e) => {
      this.keys[e.key.toLowerCase()] = false;
    });

    document.addEventListener('mousemove', (e) => {
      this.onMouseMove(e);
    });

    document.addEventListener('click', () => {
      document.body.requestPointerLock =
        document.body.requestPointerLock || document.body.mozRequestPointerLock;
      document.body.requestPointerLock();
    });

    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement === document.body) {
        this.isPointerLocked = true;
      } else {
        this.isPointerLocked = false;
      }
    });
  }

  onMouseMove(e) {
    if (!this.isPointerLocked) return;

    const movementX = e.movementX || e.mozMovementX || 0;
    const movementY = e.movementY || e.mozMovementY || 0;

    this.euler.setFromQuaternion(this.camera.quaternion);
    this.euler.y -= movementX * 0.003;
    this.euler.x -= movementY * 0.003;

    this.euler.x = Math.max(-this.pi2, Math.min(this.pi2, this.euler.x));
    this.camera.quaternion.setFromEuler(this.euler);
  }

  update() {
    this.moveVector.set(0, 0, 0);

    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);

    if (this.keys['w'] || this.keys['arrowup']) {
      this.moveVector.addScaledVector(forward, this.moveSpeed);
    }
    if (this.keys['s'] || this.keys['arrowdown']) {
      this.moveVector.addScaledVector(forward, -this.moveSpeed);
    }
    if (this.keys['d'] || this.keys['arrowright']) {
      this.moveVector.addScaledVector(right, this.moveSpeed);
    }
    if (this.keys['a'] || this.keys['arrowleft']) {
      this.moveVector.addScaledVector(right, -this.moveSpeed);
    }
    if (this.keys[' ']) {
      this.moveVector.y += this.moveSpeed;
    }
    if (this.keys['shift']) {
      this.moveVector.y -= this.moveSpeed;
    }

    this.camera.position.add(this.moveVector);
  }
}
