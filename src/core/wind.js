// Deterministic smooth 3D wind field: layered sine octaves give a slowly
// rotating heading, an oscillating magnitude with a slow gust envelope folded
// into a faster flutter, and mild positional ripple. No three.js — sample()
// writes into any {x,y,z} target (THREE.Vector3 or a plain scratch object).

import { CFG, clamp } from './config.js';

const TAU = Math.PI * 2;
const deg2rad = Math.PI / 180;

// irrational-ish octave frequencies (Hz) + phase offsets, shared by all fields
const ENV_F = [0.071, 0.133, 0.045];
const FLUT_F = [0.63, 1.19, 2.11];
const HEAD_F = [0.039, 0.113, 0.211];

export class WindField {
  constructor(cfg = CFG) {
    this.cfg = cfg;
    this.levels = cfg.windLevels || { off: 0, calm: 0.22, breezy: 0.5, gusty: 0.95 };
    this._strength = this.levels.breezy;
    this.level = 'breezy';
    this._t = 0;
    this._gust = 1;
    this._speed = 0;
    this._heading = cfg.windHeading ?? 35;
    this.baseVel = { x: 0, y: 0, z: 0 };
    this._dirX = 0;
    this._dirZ = -1;
    this._updateScale();
    this._recompute();
  }

  get strength() { return this._strength; }
  get baseSpeed() { return this._speed; }
  get headingDeg() { return this._heading; }
  get gustFactor() { return this._gust; }

  _updateScale() {
    const b = (this.cfg.windBaseSpeed ?? 4.5) * this._strength;
    this._base = b;
  }

  setStrength(level) {
    if (typeof level === 'number') {
      this._strength = clamp(level, 0, 1.5);
      this.level = this._strength === 0 ? 'off' : level >= 0.9 ? 'gusty' : level >= 0.4 ? 'breezy' : 'calm';
    } else {
      const v = this.levels[level];
      this._strength = v == null ? this.levels.breezy : v;
      this.level = v == null ? 'breezy' : level;
    }
    this._updateScale();
    this._recompute();
  }

  update(dt) {
    this._t += dt;
    if (this._strength === 0) { this._gust = 1; this._speed = 0; this.baseVel.x = 0; this.baseVel.z = 0; return; }
    this._recompute();
  }

  _recompute() {
    const c = this.cfg;
    const t = this._t;

    const envAmp = c.windGustAmp ?? 0.55;
    let env = 0;
    env += Math.sin(t * ENV_F[0] * TAU) * 0.6;
    env += Math.sin(t * ENV_F[1] * TAU + 1.7) * 0.3;
    env += Math.sin(t * ENV_F[2] * TAU + 4.1) * 0.1;
    const envelope = 1 + env * envAmp;

    const flutAmp = c.windFlutterAmp ?? 0.22;
    let flut = 0;
    flut += Math.sin(t * FLUT_F[0] * TAU) * 0.55;
    flut += Math.sin(t * FLUT_F[1] * TAU + 2.3) * 0.3;
    flut += Math.sin(t * FLUT_F[2] * TAU + 5.2) * 0.15;
    const flutter = 1 + flut * flutAmp;

    this._gust = clamp(envelope * flutter, 0.15, 2.4);
    this._speed = this._base * this._gust;

    const headAmp = c.windDirWobbleAmp ?? 26;
    let hw = 0;
    hw += Math.sin(t * HEAD_F[0] * TAU) * 0.6;
    hw += Math.sin(t * HEAD_F[1] * TAU + 0.9) * 0.28;
    hw += Math.sin(t * HEAD_F[2] * TAU + 3.3) * 0.12;
    this._heading = ((c.windHeading ?? 35) + hw * headAmp + 360) % 360;

    const r = this._heading * deg2rad;
    this._dirX = Math.sin(r);
    this._dirZ = -Math.cos(r);
    this.baseVel.x = this._dirX * this._speed;
    this.baseVel.z = this._dirZ * this._speed;
    this.baseVel.y = 0;
  }

  // Fill `out` with spatially-varied air velocity at world point (px,py,pz).
  sample(px, py, pz, out) {
    if (this._strength === 0) { out.x = 0; out.y = 0; out.z = 0; return out; }
    const t = this._t;
    const ripple = (this.cfg.windRipple ?? 0.14) * this._base;
    const rx = Math.sin(px * 0.16 + pz * 0.11 + t * 0.9) + 0.5 * Math.sin(px * 0.37 - t * 1.3);
    const rz = Math.sin(pz * 0.15 - px * 0.09 - t * 0.7) + 0.5 * Math.sin(pz * 0.33 + t * 1.1);
    const ry = 0.35 * Math.sin(px * 0.21 + pz * 0.19 + t * 1.6);
    // ground shear: wind weaker near the deck
    const refH = this.cfg.windShearRefH ?? 12;
    const shear = Math.pow(clamp(py / refH, 0.15, 1), this.cfg.windShear ?? 0.35);
    out.x = (this._dirX * this._speed + rx * ripple) * shear;
    out.y = ry * ripple * 0.4 * shear;
    out.z = (this._dirZ * this._speed + rz * ripple) * shear;
    return out;
  }
}
