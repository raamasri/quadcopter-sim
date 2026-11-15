// Render quality presets. The preset ('auto'|'low'|'med'|'high') persists in
// settings; the resolved tier is runtime-only. Auto-degrade fires once per
// session when sustained fps drops below 40 in play.

export const TIERS = {
  low: { shadows: false, mapSize: 1024, pixelRatio: 1.0, reflector: false, bloom: false, envPx: 0, fogDensity: 0.0045 },
  med: { shadows: true, mapSize: 2048, pixelRatio: 1.5, reflector: false, bloom: true, envPx: 128, fogDensity: 0.0035 },
  high: { shadows: true, mapSize: 4096, pixelRatio: 2.0, reflector: true, bloom: true, envPx: 256, fogDensity: 0.0032 }
};

export function detectTier() {
  const mobile = /Android|iPhone|iPad|iPod|IEMobile|Mobile/i.test(navigator.userAgent || '');
  const cores = navigator.hardwareConcurrency || 2;
  const dpr = window.devicePixelRatio || 1;
  if (cores >= 8 && !mobile && dpr >= 1.5) return 'high';
  if (cores >= 4) return 'med';
  return 'low';
}

export class Quality {
  constructor(settings) {
    this.settings = settings;
    if (settings.quality !== 'auto' && !TIERS[settings.quality]) settings.quality = 'auto';
    this.preset = settings.quality;
    this.resolved = this.preset === 'auto' ? detectTier() : this.preset;
    this.degraded = false;
    this._slowT = 0;
  }

  get cfg() { return TIERS[this.resolved]; }

  setPreset(p) {
    if (p !== 'auto' && !TIERS[p]) return false;
    this.preset = p;
    this.settings.quality = p;
    this.resolved = p === 'auto' ? detectTier() : p;
    this.degraded = false;
    this._slowT = 0;
    return true;
  }

  // Returns true on the single call that degraded the tier (high→med→low).
  update(dt, fps, playing) {
    if (this.degraded || !playing || this.resolved === 'low' || !(fps > 0)) { this._slowT = 0; return false; }
    if (fps < 40) this._slowT += dt; else this._slowT = Math.max(0, this._slowT - dt * 2);
    if (this._slowT < 4) return false;
    this._slowT = 0;
    this.degraded = true;
    this.resolved = this.resolved === 'high' ? 'med' : 'low';
    return true;
  }
}
