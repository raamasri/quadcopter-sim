// TT ghost replays (v0.6.0): pose recorder ring buffer, localStorage
// persistence (quadsim.ghosts.v2) and translucent playback with a cached
// mesh per drone. Storage schema: { "<droneId>": { t, frames: [[t,x,y,z,
// qx,qy,qz,qw]...], gateTs: [sec,...] } } — times are run-start relative.

import * as THREE from 'three';
import { clamp } from '../core/config.js';
import { buildDrone } from '../scene/droneVisual.js';

const GHOST_KEY = 'quadsim.ghosts.v2';

function loadStore() { try { return JSON.parse(localStorage.getItem(GHOST_KEY)) || {}; } catch { return {}; } }

export function ghostFor(droneId) {
  const g = loadStore()[droneId];
  return g && Array.isArray(g.frames) && g.frames.length > 1 ? g : null;
}

export function ghostInfo(droneId) {
  const g = loadStore()[droneId];
  if (!g || !Array.isArray(g.frames)) return { exists: false, droneId, frames: 0, gateCount: 0, t: 0 };
  return { exists: true, droneId, frames: g.frames.length, gateCount: (g.gateTs || []).length, t: +((g.t || 0)).toFixed(2) };
}

export function saveGhost(droneId, ghost) {
  try {
    const s = loadStore();
    s[droneId] = ghost;
    localStorage.setItem(GHOST_KEY, JSON.stringify(s));
    return true;
  } catch { return false; }
}

// one entry per gate: frame time whose position is nearest that gate center
export function computeGateTs(frames, gates) {
  const out = [];
  for (let i = 0; i < gates.length; i++) {
    const gp = gates[i].pos;
    let best = -1, bd = Infinity;
    for (let f = 0; f < frames.length; f++) {
      const fr = frames[f];
      const dx = fr[1] - gp.x, dy = fr[2] - gp.y, dz = fr[3] - gp.z;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bd) { bd = d; best = f; }
    }
    out.push(best >= 0 ? frames[best][0] : 0);
  }
  return out;
}

const REC_DT = 1 / 20; // sample rate; saved pruned to ~10 Hz

export class GhostRecorder {
  constructor(prealloc = 2400) { // 20 Hz * 120 s headroom, growable
    this.cap = prealloc;
    this.buf = new Float32Array(prealloc * 8);
    this.count = 0;
    this.acc = 0;
  }
  reset() { this.count = 0; this.acc = 0; }
  tick(dt, t, m) {
    this.acc += dt;
    if (this.acc < REC_DT) return;
    this.acc = Math.min(this.acc - REC_DT, REC_DT); // drop backlog on lag spikes
    if (this.count >= this.cap) {
      const nb = new Float32Array(this.cap * 2 * 8);
      nb.set(this.buf);
      this.buf = nb;
      this.cap *= 2;
    }
    const b = this.buf, o = this.count * 8, p = m.pos, q = m.quat;
    b[o] = t; b[o + 1] = p.x; b[o + 2] = p.y; b[o + 3] = p.z;
    b[o + 4] = q.x; b[o + 5] = q.y; b[o + 6] = q.z; b[o + 7] = q.w;
    this.count++;
  }
  prune() {
    const b = this.buf;
    const r = (v) => Math.round(v * 1000) / 1000;
    const out = [];
    for (let i = 0; i < this.count; i += 2) {
      const o = i * 8;
      out.push([r(b[o]), r(b[o + 1]), r(b[o + 2]), r(b[o + 3]), r(b[o + 4]), r(b[o + 5]), r(b[o + 6]), r(b[o + 7])]);
    }
    const last = this.count - 1;
    if (last > 0 && (last & 1) === 1) {
      const o = last * 8;
      out.push([r(b[o]), r(b[o + 1]), r(b[o + 2]), r(b[o + 3]), r(b[o + 4]), r(b[o + 5]), r(b[o + 6]), r(b[o + 7])]);
    }
    return out;
  }
}

const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();

export class GhostReplay {
  constructor(scene) {
    this.scene = scene;
    this.cache = new Map(); // droneId -> translucent mesh (built once, reused)
    this.mesh = null;
    this.frames = null;
    this.total = 0;
    this.clock = -1; // <0: timeline not started (idle / pre-launch-pose)
    this._i = 0;
  }
  get active() { return !!this.frames; }
  _meshFor(spec) {
    let mesh = this.cache.get(spec.id);
    if (!mesh) {
      mesh = buildDrone(spec, { ghost: true }).group;
      mesh.visible = false;
      this.scene.add(mesh);
      this.cache.set(spec.id, mesh);
    }
    return mesh;
  }
  attach(spec, data) {
    this.detach();
    if (!spec || !data || !Array.isArray(data.frames) || data.frames.length < 2) return;
    this.frames = data.frames;
    this.total = data.t || this.frames[this.frames.length - 1][0];
    this.mesh = this._meshFor(spec);
    this.clock = 0;
    this._advance();
    this.mesh.visible = true;
  }
  detach() {
    if (this.mesh) this.mesh.visible = false;
    this.mesh = null;
    this.frames = null;
    this.total = 0;
    this.clock = -1;
    this._i = 0;
  }
  hide() { if (this.mesh) this.mesh.visible = false; }
  seek(t) { if (this.frames) { this.clock = Math.max(0, Math.min(t, this.total)); this._i = 0; this._advance(); } }
  // driven by mission.time so pause (frozen mission clock) freezes the ghost;
  // a fresh run restarts naturally at t=0
  tickTo(t) {
    if (!this.frames || !this.mesh) return;
    this.clock = t;
    if (t > this.total) { this.mesh.visible = false; return; }
    this._advance();
  }
  // pos lerp + quat slerp between frames, zero per-frame allocations
  _advance() {
    const f = this.frames;
    while (this._i < f.length - 2 && f[this._i + 1][0] <= this.clock) this._i++;
    const a = f[this._i];
    const b = f[Math.min(this._i + 1, f.length - 1)];
    const span = b[0] - a[0];
    const k = span > 1e-6 ? clamp((this.clock - a[0]) / span, 0, 1) : 1;
    const m = this.mesh;
    m.position.set(a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k, a[3] + (b[3] - a[3]) * k);
    _qa.set(a[4], a[5], a[6], a[7]);
    _qb.set(b[4], b[5], b[6], b[7]);
    m.quaternion.copy(_qa).slerp(_qb, k);
    m.visible = true;
  }
}
