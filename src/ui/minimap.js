// v0.5.0 HUD minimap: north-up top-down canvas of the arena. The static world
// layer (arena ring, runway, pond, buildings, trees, helipad) bakes ONCE to an
// offscreen canvas and re-bakes only on day/night flips; gates, mission markers,
// the drone heading arrow and a 20-point trail redraw on top at a 20 Hz cap.
// No per-frame allocations: fixed ring buffer, primitive math, static style
// strings + globalAlpha instead of interpolated rgba.

import { CFG, deg2rad } from '../core/config.js';

const SIZE = 300;          // backing store px (2x the 150 px CSS size)
const TAU = Math.PI * 2;
const TICK = 0.05;         // 20 Hz redraw cap
const SAMPLE = 0.15;       // trail sampling interval (play only)
const TRAIL = 20;          // ring buffer length

const GATE_ACTIVE = '#ff8a2a';
const GATE_PULSE = 'rgba(255, 138, 42, 0.9)';
const GATE_DONE = 'rgba(61, 220, 132, 0.55)';
const GATE_TODO = 'rgba(255, 138, 42, 0.5)';
const TRAIL_COL = '#34e2ff';
const ARROW_COL = '#34e2ff';
const MARK_COLORS = { pickup: '#34e2ff', drop: '#ffc21f', hover: '#7c5cff', beacon: '#ff4d6d' };

export class Minimap {
  constructor(canvas, world) {
    this.canvas = canvas;
    this.wrap = canvas.parentElement;
    this.world = world;
    this.ctx = canvas.getContext('2d');
    this.off = document.createElement('canvas');
    this.off.width = this.off.height = SIZE;
    this.octx = this.off.getContext('2d');
    this.scale = (SIZE / 2 - 7) / CFG.arenaR;
    this.c = SIZE / 2;
    this._t = 0;
    this._acc = TICK;
    this._sacc = 0;
    this._shown = null;
    this._dim = null;
    this._trail = new Float32Array(TRAIL * 2);
    this._trailN = 0;
    this._trailHead = 0;
    this.rebuildStatic();
  }

  reset() { this._trailN = 0; this._trailHead = 0; this._sacc = 0; }

  // ---------- static world layer (rebuilt on night flip only) ----------
  rebuildStatic() {
    const c = this.octx, s = this.scale, w = this.world, night = w.night;
    c.clearRect(0, 0, SIZE, SIZE);

    c.beginPath(); c.arc(this.c, this.c, CFG.arenaR * s, 0, TAU);
    c.fillStyle = night ? 'rgba(7, 12, 22, 0.88)' : 'rgba(14, 22, 35, 0.88)';
    c.fill();
    c.lineWidth = 3; c.strokeStyle = 'rgba(242, 183, 5, 0.7)'; c.stroke();

    // runway strip: 11 x 120 centered at (-30, 0)
    c.fillStyle = night ? '#151b25' : '#232b38';
    c.fillRect(this.c - 35.5 * s, this.c - 60 * s, 11 * s, 120 * s);

    // pond
    const p = w.pondPos;
    if (p) {
      c.beginPath(); c.arc(this.c + p.x * s, this.c + p.z * s, 29 * s, 0, TAU);
      c.fillStyle = night ? 'rgba(10, 37, 49, 0.95)' : 'rgba(20, 85, 94, 0.95)';
      c.fill();
      c.lineWidth = 1.5;
      c.strokeStyle = night ? 'rgba(90, 140, 155, 0.28)' : 'rgba(120, 180, 195, 0.38)';
      c.stroke();
    }

    // buildings as rotated OBB footprints
    c.fillStyle = night ? '#0b101a' : '#1c2533';
    for (const col of w.colliders) {
      if (col.t !== 'b') continue;
      if (Math.hypot(col.x, col.z) > CFG.arenaR + 10) continue;
      c.save();
      c.translate(this.c + col.x * s, this.c + col.z * s);
      c.rotate(-Math.atan2(col.sin, col.cos));
      c.fillRect(-col.hx * s, -col.hz * s, col.hx * 2 * s, col.hz * 2 * s);
      c.restore();
    }

    // trees / cylinders as faint dots
    c.fillStyle = night ? 'rgba(70, 98, 78, 0.5)' : 'rgba(118, 162, 116, 0.45)';
    for (const col of w.colliders) {
      if (col.t !== 'c') continue;
      c.beginPath(); c.arc(this.c + col.x * s, this.c + col.z * s, 2.2, 0, TAU);
      c.fill();
    }

    // helipad: green disc + H
    const pad = w.padPos;
    c.beginPath(); c.arc(this.c + pad.x * s, this.c + pad.z * s, 5.5, 0, TAU);
    c.fillStyle = 'rgba(61, 220, 132, 0.9)'; c.fill();
    c.fillStyle = '#05130c';
    c.font = '700 9px "JetBrains Mono", monospace';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('H', this.c + pad.x * s, this.c + pad.z * s + 0.5);

    // north label (north-up)
    c.fillStyle = night ? 'rgba(126, 156, 192, 0.65)' : 'rgba(140, 172, 208, 0.75)';
    c.font = '700 15px "JetBrains Mono", monospace';
    c.fillText('N', this.c, 16);
  }

  // ---------- per-frame (gated internally to 20 Hz + visibility) ----------
  tick(dt, x, z, heading, state, off) {
    const show = (state === 'play' || state === 'pause') && !off;
    if (this._shown !== show) { this._shown = show; this.wrap.classList.toggle('show', show); }
    if (!show) return;
    const dim = state !== 'play';
    if (this._dim !== dim) { this._dim = dim; this.wrap.classList.toggle('dim', dim); }
    this._t += dt;
    if (state === 'play') {
      this._sacc += dt;
      if (this._sacc >= SAMPLE) {
        this._sacc -= SAMPLE;
        const h = this._trailHead;
        this._trail[h * 2] = x;
        this._trail[h * 2 + 1] = z;
        this._trailHead = (h + 1) % TRAIL;
        if (this._trailN < TRAIL) this._trailN++;
      }
    }
    this._acc += dt;
    if (this._acc < TICK) return;
    this._acc = 0;
    this._draw(x, z, heading);
  }

  _draw(x, z, heading) {
    const c = this.ctx, s = this.scale, w = this.world, cx = this.c;

    c.clearRect(0, 0, SIZE, SIZE);
    c.drawImage(this.off, 0, 0);

    // course gates: passed dim, next bright + pulse ring, remaining faint
    const defs = w._gateDefs;
    if (defs.length) {
      const nx = w.nextGate();
      for (let i = 0; i < defs.length; i++) {
        const g = defs[i];
        const gx = cx + g.pos.x * s, gy = cx + g.pos.z * s;
        c.beginPath();
        if (g.passed) {
          c.arc(gx, gy, 4.5, 0, TAU);
          c.fillStyle = GATE_DONE;
        } else if (g === nx) {
          c.arc(gx, gy, 5.5, 0, TAU);
          c.fillStyle = GATE_ACTIVE;
        } else {
          c.arc(gx, gy, 4.5, 0, TAU);
          c.fillStyle = GATE_TODO;
        }
        c.fill();
        if (g === nx && !g.passed) {
          const p = 0.5 + 0.5 * Math.sin(this._t * 4.2);
          c.beginPath(); c.arc(gx, gy, 7 + p * 8, 0, TAU);
          c.lineWidth = 2; c.strokeStyle = GATE_PULSE;
          c.globalAlpha = 0.1 + 0.4 * (1 - p);
          c.stroke();
          c.globalAlpha = 1;
        }
      }
    }

    // mission markers (cargo pickup/drop, hover zone)
    const marks = w._markers;
    for (let i = 0; i < marks.length; i++) {
      const m = marks[i];
      const mx = cx + m.pos.x * s, my = cx + m.pos.z * s;
      const col = MARK_COLORS[m.type] || '#ffffff';
      c.globalAlpha = m.active ? 0.95 : 0.3;
      c.beginPath(); c.arc(mx, my, Math.max(6, m.r * s), 0, TAU);
      c.lineWidth = 2.5; c.strokeStyle = col; c.stroke();
      c.beginPath(); c.arc(mx, my, 2.8, 0, TAU);
      c.fillStyle = col; c.fill();
      c.globalAlpha = 1;
    }

    // drone trail (oldest -> newest)
    const n = this._trailN;
    if (n > 1) {
      const t0 = (this._trailHead - n + TRAIL) % TRAIL;
      c.beginPath();
      c.moveTo(cx + this._trail[t0 * 2] * s, cx + this._trail[t0 * 2 + 1] * s);
      for (let k = 1; k < n; k++) {
        const idx = (t0 + k) % TRAIL;
        c.lineTo(cx + this._trail[idx * 2] * s, cx + this._trail[idx * 2 + 1] * s);
      }
      c.lineWidth = 2; c.strokeStyle = TRAIL_COL;
      c.globalAlpha = 0.32; c.stroke(); c.globalAlpha = 1;
    }

    // drone arrow, rotated to compass heading (clockwise from north-up)
    c.save();
    c.translate(cx + x * s, cx + z * s);
    c.rotate(heading * deg2rad);
    c.beginPath();
    c.moveTo(0, -8.5); c.lineTo(5.8, 6.5); c.lineTo(0, 3.2); c.lineTo(-5.8, 6.5);
    c.closePath();
    c.fillStyle = ARROW_COL; c.fill();
    c.lineWidth = 1.2; c.strokeStyle = 'rgba(4, 18, 28, 0.9)'; c.stroke();
    c.restore();
  }
}
