// Procedural WebAudio engine: motor bank, wind, SFX. No audio files.

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.enabled = true;
    this.volume = 0.7;
    this._started = false;
    this._lowBeepTimer = 0;
    this._envWindLevel = 0;
  }

  start() {
    if (this._started) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain();
    this.master.gain.value = this.enabled ? this.volume : 0;
    this.master.connect(ctx.destination);

    // motor: detewed saws + square through lowpass
    this._motorGain = ctx.createGain(); this._motorGain.gain.value = 0;
    this._motorLP = ctx.createBiquadFilter(); this._motorLP.type = 'lowpass'; this._motorLP.frequency.value = 700;
    this._motorGain.connect(this._motorLP); this._motorLP.connect(this.master);
    this._oscA = this._osc('sawtooth', 90); this._oscB = this._osc('sawtooth', 92.4); this._oscC = this._osc('square', 45);
    [this._oscA, this._oscB, this._oscC].forEach((o) => o.connect(this._motorGain));

    // rotor whine
    this._whineGain = ctx.createGain(); this._whineGain.gain.value = 0;
    this._whine = this._osc('sine', 640);
    this._whine.connect(this._whineGain); this._whineGain.connect(this.master);

    // wind: looping noise -> bandpass
    this._windGain = ctx.createGain(); this._windGain.gain.value = 0;
    this._windBP = ctx.createBiquadFilter(); this._windBP.type = 'bandpass'; this._windBP.frequency.value = 480; this._windBP.Q.value = 0.6;
    const noiseBuf = this._noiseBuffer(2);
    this._windSrc = ctx.createBufferSource(); this._windSrc.buffer = noiseBuf; this._windSrc.loop = true;
    this._windSrc.connect(this._windBP); this._windBP.connect(this._windGain); this._windGain.connect(this.master);
    this._windSrc.start();

    // ambient wind: independent noise bed driven by relative airspeed + gusts
    this._envWindGain = ctx.createGain(); this._envWindGain.gain.value = 0;
    this._envWindBP = ctx.createBiquadFilter(); this._envWindBP.type = 'bandpass'; this._envWindBP.frequency.value = 620; this._envWindBP.Q.value = 0.5;
    this._envWindSrc = ctx.createBufferSource(); this._envWindSrc.buffer = noiseBuf; this._envWindSrc.loop = true;
    this._envWindSrc.connect(this._envWindBP); this._envWindBP.connect(this._envWindGain); this._envWindGain.connect(this.master);
    this._envWindSrc.start();
    this._started = true;
  }

  _osc(type, freq) {
    const o = this.ctx.createOscillator(); o.type = type; o.frequency.value = freq; o.start(); return o;
  }

  _noiseBuffer(sec) {
    const ctx = this.ctx, buf = ctx.createBuffer(1, ctx.sampleRate * sec, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  setVolume(v) { this.volume = v; if (this.master) this.master.gain.value = this.enabled ? v : 0; }
  setEnabled(on) { this.enabled = on; if (this.master) this.master.gain.value = on ? this.volume : 0; }

  setWind(relSpeed, windStrength) {
    if (!this._started || !this.enabled || !this._envWindGain) return;
    const rs = relSpeed > 0 ? relSpeed : 0;
    const ws = windStrength > 0 ? windStrength : 0;
    let target = rs * 0.012 + ws * rs * 0.02;
    if (target > 0.35) target = 0.35;
    this._envWindLevel += (target - this._envWindLevel) * 0.12;
    this._envWindGain.gain.value = this._envWindLevel;
  }

  frame(dt, rpm, airspeed, armed) {
    if (!this._started || !this.enabled) return;
    const t = this.ctx.currentTime;
    const r = armed ? Math.max(0, Math.min(1.2, rpm)) : 0;
    const spinUp = r > 0.001 ? 1 : 0;
    const baseF = 60 + r * 300;
    this._oscA.frequency.setTargetAtTime(baseF, t, 0.08);
    this._oscB.frequency.setTargetAtTime(baseF * 1.012, t, 0.08);
    this._oscC.frequency.setTargetAtTime(baseF * 0.5, t, 0.1);
    this._motorGain.gain.setTargetAtTime(0.05 * r * spinUp, t, 0.12);
    this._motorLP.frequency.setTargetAtTime(400 + r * 2600, t, 0.1);
    this._whine.frequency.setTargetAtTime(420 + r * 1450, t, 0.1);
    this._whineGain.gain.setTargetAtTime(0.018 * r * spinUp, t, 0.15);
    const w = Math.min(0.12, Math.pow(Math.max(0, airspeed) / 32, 2) * 0.12);
    this._windGain.gain.setTargetAtTime(w, t, 0.2);
  }

  _blip(freq, dur, type = 'triangle', gain = 0.16, slideTo = 0, delay = 0) {
    if (!this._started || !this.enabled) return;
    const ctx = this.ctx, t = ctx.currentTime + delay;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(30, slideTo), t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.05);
  }

  gate(combo = 0) { this._blip(760 + Math.min(combo, 8) * 90, 0.16, 'triangle', 0.2); this._blip(1500 + combo * 120, 0.1, 'sine', 0.08, 0, 0.05); }
  // v0.9.0 crisp gate-threading confirmation: fast two-tone up-chirp (660->990Hz)
  gateBlip() { this._blip(660, 0.045, 'sine', 0.15, 820); this._blip(820, 0.06, 'sine', 0.15, 990, 0.045); }
  pickup() { this._blip(520, 0.12, 'sine', 0.18, 780); }
  deliver() { this._blip(660, 0.12, 'sine', 0.18); this._blip(880, 0.14, 'sine', 0.18, 0, 0.12); this._blip(1170, 0.2, 'sine', 0.18, 0, 0.24); }
  arm() { this._blip(440, 0.09, 'square', 0.1); this._blip(660, 0.09, 'square', 0.1, 0, 0.1); this._blip(880, 0.12, 'square', 0.1, 0, 0.2); }
  disarm() { this._blip(660, 0.1, 'square', 0.09); this._blip(330, 0.16, 'square', 0.09, 0, 0.1); }
  crash(strength = 1) {
    if (!this._started || !this.enabled) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this._noiseBuffer(0.4);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(1800, t); f.frequency.exponentialRampToValueAtTime(120, t + 0.3);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.5 * Math.min(1, strength), t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    src.connect(f); f.connect(g); g.connect(this.master); src.start(t);
    this._blip(70, 0.28, 'sine', 0.4, 40);
  }
  impact() { this._blip(160, 0.1, 'square', 0.1, 90); }
  click() { this._blip(1200, 0.05, 'square', 0.05); }
  countdown(go = false) { go ? this._blip(880, 0.5, 'square', 0.16) : this._blip(440, 0.15, 'square', 0.13); }
  lowBattery() { this._blip(1050, 0.09, 'square', 0.12); this._blip(1050, 0.09, 'square', 0.12, 0, 0.16); }
  success() { [660, 880, 1100, 1320].forEach((f, i) => this._blip(f, 0.22, 'sine', 0.16, 0, i * 0.13)); }
  fail() { this._blip(300, 0.3, 'sawtooth', 0.14, 120); }

  lowBatteryBeep(dt, battery) {
    if (battery > 0 && battery <= 0.25) {
      this._lowBeepTimer -= dt;
      if (this._lowBeepTimer <= 0) { this.lowBattery(); this._lowBeepTimer = battery <= 0.1 ? 0.7 : 2.2; }
    } else this._lowBeepTimer = 0;
  }
}
