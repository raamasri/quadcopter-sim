// v0.4.0 touch overlay: dual virtual sticks (Mode 2) + ARM/CAM/MODE/PAUSE buttons.
// Pointer Events with per-zone capture so both sticks + buttons work at once.
// getAxes()/update() reuse one axes object; DOM writes happen only while a
// stick is engaged or easing back, and on visibility/enabled flips.

const R = 60;          // knob travel radius (px)
const DZ = 0.12;       // per-axis deadzone (normalized)
const HOLD_MS = 500;   // seconds touch keeps authority after release
const BASE = 128;      // visual base diameter (px)

const dz = (v) => (Math.abs(v) < DZ ? 0 : (v - Math.sign(v) * DZ) / (1 - DZ));
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export class TouchControls {
  constructor(doc, settings) {
    this.settings = settings;
    this.layer = doc.getElementById('touch-layer');
    this.capable = navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
    this._force = null; // __SIM.touch() override (null = follow settings)
    this.enabled = false;
    this._playing = false;
    this._shown = null;
    this._lastEngaged = -1e9;
    this.cb = {}; // { arm, cam, mode, pause }
    this.axes = { pitch: 0, roll: 0, yaw: 0, throttle: 0, active: false };

    this.zones = [doc.getElementById('tz-left'), doc.getElementById('tz-right')].map((el) => {
      const z = { el, base: el.querySelector('.t-base'), knob: el.querySelector('.t-knob'), id: -1, rect: null, cx: 0, cy: 0, kx: 0, ky: 0, releasing: false };
      z.onDown = (e) => this._onDown(z, e);
      z.onMove = (e) => this._onMove(z, e);
      z.onUp = (e) => this._onUp(z, e);
      el.addEventListener('pointerdown', z.onDown);
      el.addEventListener('pointermove', z.onMove);
      el.addEventListener('pointerup', z.onUp);
      el.addEventListener('pointercancel', z.onUp);
      return z;
    });

    this._onBtn = (e) => {
      e.preventDefault();
      const fn = this.cb[e.currentTarget.dataset.touch];
      if (fn) fn();
    };
    this.buttons = [...doc.querySelectorAll('#touch-layer [data-touch]')];
    for (const b of this.buttons) b.addEventListener('pointerdown', this._onBtn);

    this.refresh();
  }

  // ---------- enable rules: 'auto' = touch-capable devices, 'on'/'off' force ----------
  refresh() {
    const m = this.settings.touch || 'auto';
    this._setEnabled(m === 'off' ? false : m === 'on' ? true : this.capable);
  }

  force(on) {
    if (on === null || on === undefined) { this._force = null; this.refresh(); return; }
    this._force = !!on;
    this._setEnabled(this._force);
  }

  _setEnabled(on) {
    this.enabled = !!on;
    document.body.classList.toggle('touch-on', this.enabled);
    if (!this.enabled) this._releaseAll(true);
    this._syncVisible();
  }

  setPlaying(v) {
    this._playing = !!v;
    if (!this._playing) this._releaseAll(true);
    this._syncVisible();
  }

  setVisible(v) {
    if (this._shown === v) return;
    this._shown = v;
    this.layer.classList.toggle('on', v);
  }

  _syncVisible() { this.setVisible(this.enabled && this._playing); }

  // ---------- pointer handling (one pointer tracked per zone) ----------
  _onDown(z, e) {
    if (!this.enabled || !this._playing || z.id !== -1) return;
    e.preventDefault();
    try { z.el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    const r = z.el.getBoundingClientRect();
    z.rect = r;
    z.id = e.pointerId;
    const half = BASE / 2;
    z.cx = clamp(e.clientX - r.left, half, Math.max(half, r.width - half));
    z.cy = clamp(e.clientY - r.top, half, Math.max(half, r.height - half));
    z.kx = 0; z.ky = 0; z.releasing = false;
    z.knob.style.transform = 'translate(0px, 0px)';
    z.base.style.transform = `translate(${(z.cx - half).toFixed(1)}px, ${(z.cy - half).toFixed(1)}px)`;
    z.base.style.opacity = '1';
    this._lastEngaged = performance.now();
    this._compute();
  }

  _onMove(z, e) {
    if (e.pointerId !== z.id || !z.rect) return;
    let dx = e.clientX - z.rect.left - z.cx;
    let dy = e.clientY - z.rect.top - z.cy;
    const len = Math.hypot(dx, dy);
    if (len > R) { const s = R / len; dx *= s; dy *= s; }
    z.kx = dx; z.ky = dy;
    z.knob.style.transform = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px)`;
    this._lastEngaged = performance.now();
    this._compute();
  }

  _onUp(z, e) {
    if (e.pointerId !== z.id) return;
    z.id = -1;
    z.releasing = true;
    this._lastEngaged = performance.now();
  }

  // ---------- per-frame: ease released knobs back, refresh axes ----------
  update(dt) {
    const now = performance.now();
    let moving = false;
    for (const z of this.zones) {
      if (z.id !== -1) { moving = true; continue; }
      if (!z.releasing) continue;
      moving = true;
      const k = Math.exp(-18 * dt);
      z.kx *= k; z.ky *= k;
      if (Math.abs(z.kx) < 0.5 && Math.abs(z.ky) < 0.5) {
        z.kx = 0; z.ky = 0; z.releasing = false;
        z.knob.style.transform = 'translate(0px, 0px)';
        z.base.style.opacity = '0';
      } else {
        z.knob.style.transform = `translate(${z.kx.toFixed(1)}px, ${z.ky.toFixed(1)}px)`;
      }
    }
    if (moving) this._compute();
    const [l, r] = this.zones;
    const active = l.id !== -1 || r.id !== -1 || l.releasing || r.releasing || now - this._lastEngaged < HOLD_MS;
    const a = this.axes;
    if (active) a.active = true;
    else if (a.active || a.pitch || a.roll || a.yaw || a.throttle) {
      a.active = false; a.pitch = 0; a.roll = 0; a.yaw = 0; a.throttle = 0;
    }
    return a;
  }

  // Mode 2: left x -> yaw, left y -> throttle (absolute, up = hold);
  // right y -> pitch (forward), right x -> roll.
  _compute() {
    const [l, r] = this.zones;
    const a = this.axes;
    a.yaw = dz(l.kx / R);
    const nyL = -l.ky / R;
    a.throttle = nyL > DZ ? (nyL - DZ) / (1 - DZ) : 0;
    a.pitch = dz(-r.ky / R);
    a.roll = dz(r.kx / R);
  }

  getAxes() { return this.axes; }

  _releaseAll(hard) {
    for (const z of this.zones) {
      if (z.id !== -1) { try { z.el.releasePointerCapture(z.id); } catch { /* ignore */ } }
      z.id = -1; z.releasing = false; z.kx = 0; z.ky = 0;
      z.knob.style.transform = 'translate(0px, 0px)';
      z.base.style.opacity = '0';
    }
    if (hard) {
      const a = this.axes;
      a.active = false; a.pitch = 0; a.roll = 0; a.yaw = 0; a.throttle = 0;
    }
  }

  dispose() {
    for (const z of this.zones) {
      z.el.removeEventListener('pointerdown', z.onDown);
      z.el.removeEventListener('pointermove', z.onMove);
      z.el.removeEventListener('pointerup', z.onUp);
      z.el.removeEventListener('pointercancel', z.onUp);
    }
    for (const b of this.buttons) b.removeEventListener('pointerdown', this._onBtn);
    document.body.classList.remove('touch-on');
  }
}
