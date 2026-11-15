// Multi-view camera rig with speed-reactive FOV + trauma shake (v0.9.0).

import * as THREE from 'three';
import { deg2rad } from './config.js';

const V = THREE.Vector3;
const CAMERA_MODES = ['CHASE', 'FPV', 'ORBIT', 'TOP', 'SIDE', 'CINEMATIC'];
const damp = (a, b, l, dt) => b + (a - b) * Math.exp(-l * dt);
const TRAUMA_DECAY = 1.6; // trauma/sec (classic: trauma linear decay, shake = trauma^2)

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.index = 0;
    this.orbit = Math.PI * 0.25;
    this.cine = 0;
    this._pos = new V(); this._look = new V(); this._fov = camera.fov;
    this._init = true;
    this._f = new V(); this._u = new V(); this._hf = new V();
    this._desired = new V(); this._desiredLook = new V(); this._desiredUp = new V(0, 1, 0);
    this._perp = new V(); this._off = new V();
    // v0.9.0 trauma shake: add via addTrauma(), decays exponentially.
    this.trauma = 0;
    this._shakeT = 0;
    this._shake = new V();
  }

  addTrauma(v) { this.trauma = Math.min(1, this.trauma + v); }

  get name() { return CAMERA_MODES[this.index]; }
  setMode(i) { this.index = ((i % CAMERA_MODES.length) + CAMERA_MODES.length) % CAMERA_MODES.length; this._init = true; }
  next() { this.setMode(this.index + 1); }

  update(dt, ctx) {
    this.orbit += dt * 0.35; this.cine += dt * 0.2;
    const q = ctx.quat, p = ctx.pos, spd = Math.hypot(ctx.vel.x, ctx.vel.z);
    this._f.set(0, 0, -1).applyQuaternion(q);
    this._u.set(0, 1, 0).applyQuaternion(q);
    this._hf.set(this._f.x, 0, this._f.z);
    if (this._hf.lengthSq() < 1e-4) this._hf.set(0, 0, -1);
    this._hf.normalize();

    let kPos = 6, kLook = 6, fov = 60;
    switch (CAMERA_MODES[this.index]) {
      case 'CHASE':
        this._desired.copy(p).addScaledVector(this._hf, -5.4); this._desired.y += 2.3;
        this._desiredLook.copy(p).addScaledVector(this._hf, 3.5); this._desiredLook.y += 0.5;
        this._desiredUp.set(0, 1, 0);
        fov = 64 + spd * 0.5; kPos = 7; kLook = 9; break;
      case 'FPV':
        this._desired.copy(p).addScaledVector(this._f, 0.28).addScaledVector(this._u, 0.12);
        this._desiredLook.copy(p).addScaledVector(this._f, 12).addScaledVector(ctx.vel, 0.25);
        this._desiredUp.copy(this._u);
        fov = 84 + spd * 0.9; kPos = 34; kLook = 40; break;
      case 'ORBIT': {
        const r = 7.2, h = 3.2;
        this._desired.set(p.x + Math.cos(this.orbit) * r, p.y + h, p.z + Math.sin(this.orbit) * r);
        this._desiredLook.copy(p); this._desiredUp.set(0, 1, 0);
        fov = 55; kPos = 5; kLook = 8; break;
      }
      case 'TOP':
        this._desired.set(p.x + 0.001, p.y + 26, p.z + 0.5);
        this._desiredLook.copy(p); this._desiredUp.set(0, 0, -1);
        fov = 48; kPos = 6; kLook = 10; break;
      case 'SIDE':
        this._perp.set(this._hf.z, 0, -this._hf.x).normalize();
        this._desired.copy(p).addScaledVector(this._perp, 9.5); this._desired.y += 3.4;
        this._desiredLook.copy(p); this._desiredUp.set(0, 1, 0);
        fov = 52; kPos = 6; kLook = 9; break;
      case 'CINEMATIC': {
        const r = 12, h = 2.2 + Math.sin(this.cine * 1.3) * 1.3;
        this._desired.set(p.x + Math.cos(this.cine) * r, p.y + h, p.z + Math.sin(this.cine) * r);
        this._desiredLook.copy(p); this._desiredLook.y += 0.6; this._desiredUp.set(0, 1, 0);
        fov = 44 + Math.sin(this.cine * 0.8) * 8; kPos = 3.4; kLook = 3.2; break;
      }
    }

    if (this._init) {
      this._pos.copy(this._desired); this._look.copy(this._desiredLook); this._fov = fov; this._init = false;
    } else {
      this._pos.lerp(this._desired, 1 - Math.exp(-kPos * dt));
      this._look.lerp(this._desiredLook, 1 - Math.exp(-kLook * dt));
      this._fov = damp(this._fov, fov, 5, dt);
    }
    // keep camera above terrain
    if (this._pos.y < 0.6) this._pos.y = 0.6;

    this.camera.position.copy(this._pos);
    this.camera.up.copy(this._desiredUp);
    this.camera.lookAt(this._look);
    if (Math.abs(this.camera.fov - this._fov) > 0.001) { this.camera.fov = this._fov; this.camera.updateProjectionMatrix(); }

    this._applyTrauma(dt, spd);
  }

  // Trauma shake + FPV speed rumble, applied AFTER the rig's normal transform
  // (camera-local translate/rotate post-offset) so it affects every view incl.
  // FPV. Classic trauma^2 envelope with exponential decay; noise from layered
  // irrational-frequency sines. translateX/Y/Z + rotateZ use three's module
  // scratch vectors, so this is allocation-free.
  _applyTrauma(dt, spd) {
    const isFpv = CAMERA_MODES[this.index] === 'FPV';
    let rumble = 0;
    if (isFpv && spd > 18) rumble = Math.min(1, (spd - 18) / 22) * 0.06;
    if (this.trauma <= 0.0001 && rumble <= 0.0001) { this.trauma = 0; return; }
    this._shakeT += dt;
    const t = this._shakeT;
    // three incommensurate octaves -> perlin-ish smooth noise in ~[-1,1]
    const nx = Math.sin(t * 47.3) * 0.6 + Math.sin(t * 113.7 + 1.7) * 0.3 + Math.sin(t * 271.1 + 4.2) * 0.1;
    const ny = Math.sin(t * 53.9 + 2.1) * 0.6 + Math.sin(t * 127.3 + 0.6) * 0.3 + Math.sin(t * 259.7 + 3.3) * 0.1;
    const nr = Math.sin(t * 61.1 + 0.9) * 0.6 + Math.sin(t * 139.3 + 2.8) * 0.3 + Math.sin(t * 233.9 + 5.1) * 0.1;
    const tr2 = this.trauma * this.trauma;
    const posAmp = tr2 * 0.35 + rumble;
    this.camera.translateX(nx * posAmp);
    this.camera.translateY(ny * posAmp);
    this.camera.translateZ(nr * posAmp * 0.4);
    this.camera.rotateZ(tr2 * 1.2 * deg2rad * nr + rumble * 0.05 * deg2rad * nx);
    // decay ~1.6/s (classic exponential trauma *= exp(-1.6*dt))
    this.trauma = this.trauma * Math.exp(-1.6 * dt);
    if (this.trauma < 0.0005) this.trauma = 0;
  }
}
