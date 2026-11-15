// Mission framework: game modes with objectives, scoring and records.

const STORE_KEY = 'quadsim.records.v2';

function loadStore() { try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch { return {}; } }
function saveStore(s) { try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch { /* ignore */ } }

export function bestOf(id) { return loadStore()[id] ?? null; }
function isBest(id, value, lower = true) {
  const b = bestOf(id);
  return b === null || (lower ? value < b : value > b);
}
function putBest(id, value) { const s = loadStore(); s[id] = value; saveStore(s); }

const fmtTime = (t) => {
  const m = Math.floor(t / 60), s = t - m * 60;
  return m > 0 ? `${m}:${s.toFixed(2).padStart(5, '0')}` : s.toFixed(2) + 's';
};

function circuitGates(n, R, seed = 1) {
  let s = seed;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const gates = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = R + (rnd() - 0.5) * 14;
    const y = 6 + 6 * Math.sin(a * 2 + 0.7) + (rnd() - 0.5) * 4;
    const tan = [-Math.sin(a), 0, Math.cos(a)];
    gates.push({ pos: [Math.cos(a) * r, Math.max(4, Math.min(20, y)), Math.sin(a) * r], normal: tan, radius: 3.6 });
  }
  return gates;
}

class MissionBase {
  constructor(ctx) {
    this.c = ctx;
    this.model = ctx.model;
    this.world = ctx.world;
    this.time = 0;
    this.finished = false;
    this.result = null;
    this.ended = false;
  }
  get objective() { return ''; }
  get progressText() { return ''; }
  get progressFrac() { return 0; }
  get bigStat() { return null; }
  update() {}
  onGate() {}
  onEvent() {}
  end(win, title, lines, score = null) {
    if (this.ended) return;
    this.ended = true; this.finished = true;
    this.result = { win, title, lines, score, id: this.id, best: null, newBest: false };
  }
}

class FreeFlight extends MissionBase {
  id = 'free';
  totalGates = 0;
  onStart() {
    this.world.buildCourse(circuitGates(12, 55, 7));
    this.c.toast('FREE FLIGHT · hold throttle down + yaw RIGHT to arm', 3500);
  }
  update() {
    const g = this.world.checkAnyGate(this.c.prevPos, this.model.pos);
    if (g) { this.totalGates++; this.c.audio.gate(0); this.c.toast(`GATE · ${this.totalGates}`, 900); }
    if (this.world.gateCount && this.world.gatesPassed >= this.world.gateCount) {
      this.world.resetCourse();
      this.c.toast('CIRCUIT COMPLETE · gates reset', 1400);
    }
  }
  get objective() { return 'Explore the arena · fly the gates'; }
  get bigStat() { return { value: String(this.totalGates), label: 'GATES', sub: fmtTime(this.time) }; }
}

class TimeTrial extends MissionBase {
  id = 'tt';
  started = false; elapsed = 0; penalties = 0;
  onStart() {
    this.world.buildCourse(circuitGates(14, 62, 3));
    this.c.toast(`TARGET · beat ${bestOf('tt') ? fmtTime(bestOf('tt')) : 'a first time'} · ${this.world.gateCount} gates`, 3200);
  }
  update() {
    if (this.model.armed && !this.started && this.model.pos.y > 1.2) this.started = true;
    if (this.started) this.elapsed = this.time;
    const g = this.world.checkGate(this.c.prevPos, this.model.pos);
    if (g) {
      if (this.world.gatesPassed >= this.world.gateCount) {
        const finalT = this.elapsed;
        const newBest = isBest('tt', finalT, true);
        if (newBest) putBest('tt', finalT);
        this.c.audio.success();
        this.end(true, 'COURSE COMPLETE', [
          ['Final time', fmtTime(finalT)],
          ['Penalties', fmtTime(this.penalties)],
          ['Battery left', Math.round(this.model.battery * 100) + '%'],
          ['Top speed', Math.round(this.c.maxSpeed * 3.6) + ' km/h']
        ], Math.round(finalT * 100));
        this.result.best = bestOf('tt'); this.result.newBest = newBest;
        this.result.statTime = fmtTime(finalT);
      } else {
        this.c.audio.gate(this.world.gatesPassed);
        this.c.toast(`GATE ${this.world.gatesPassed} / ${this.world.gateCount} · ${fmtTime(this.elapsed)}`, 1100);
        if (this.c.ghostDelta) this.c.ghostDelta(this.world.gatesPassed - 1, this.elapsed);
      }
    }
  }
  onEvent(e) {
    if (e.t === 'impact' && e.speed > 3.5) { this.penalties += 1; this.c.toast('+1s PENALTY', 900); }
    if (e.t === 'crash') {
      this.c.audio.fail();
      this.end(false, 'WRECKED', [['Gates cleared', `${this.world.gatesPassed} / ${this.world.gateCount}`], ['Penalty', '+8s'], ['Time', fmtTime(this.elapsed)]], 99999);
    }
  }
  get objective() { return `Ordered circuit · ${this.world.gatesPassed}/${this.world.gateCount} gates · +1s per impact`; }
  get bigStat() { return { value: fmtTime(this.started ? this.elapsed : 0), label: 'TIME', sub: 'BEST ' + (bestOf('tt') ? fmtTime(bestOf('tt')) : '—') }; }
  get progressFrac() { return this.world.gateCount ? this.world.gatesPassed / this.world.gateCount : 0; }
}

class GateRush extends MissionBase {
  id = 'rush';
  limit = 120; score = 0; combo = 1; lastGate = -99; bestCombo = 1;
  onStart() {
    this.world.buildCourse(circuitGates(10, 48, 11));
    this.c.toast(`GATE RUSH · ${this.limit}s · chain gates fast for combo`, 3200);
  }
  update(dt) {
    const left = this.limit - this.time;
    if (left <= 0) {
      this.c.audio.success();
      const newBest = isBest('rush', this.score, false);
      if (newBest) putBest('rush', this.score);
      this.end(true, 'TIME UP', [['Score', String(this.score)], ['Gates', String(this.world.gatesPassed)], ['Best combo', 'x' + this.bestCombo]], this.score);
      this.result.best = bestOf('rush'); this.result.newBest = newBest;
      return;
    }
    const g = this.world.checkAnyGate(this.c.prevPos, this.model.pos);
    if (g) {
      const dtSince = this.time - this.lastGate;
      this.combo = dtSince < 10 ? Math.min(5, this.combo + 1) : 1;
      this.bestCombo = Math.max(this.bestCombo || 1, this.combo);
      const pts = 100 * this.combo;
      this.score += pts;
      this.lastGate = this.time;
      this.c.audio.gate(this.combo);
      this.c.toast(`+${pts}${this.combo > 1 ? ' · x' + this.combo : ''}`, 900);
      if (this.world.gatesPassed >= this.world.gateCount) this.world.resetCourse();
    }
    if (this.limit - this.time < 10 && Math.floor(this.limit - this.time) !== Math.floor(this.limit - this.time + dt)) this.c.audio.countdown();
  }
  onEvent(e) {
    if (e.t === 'impact' && e.speed > 3.5 && this.combo > 1) { this.combo = 1; this.c.toast('COMBO LOST', 900); }
    if (e.t === 'crash') { this.c.audio.fail(); this.end(false, 'WRECKED', [['Score', String(this.score)], ['Gates', String(this.world.gatesPassed)]], this.score); }
  }
  get objective() { return 'Any order · chain gates within 10s to build combo'; }
  get bigStat() { return { value: String(this.score), label: 'SCORE', sub: Math.max(0, Math.ceil(this.limit - this.time)) + 's LEFT · x' + this.combo }; }
  get progressFrac() { return 1 - Math.max(0, this.limit - this.time) / this.limit; }
}

class CargoRun extends MissionBase {
  id = 'cargo';
  state = 'pickup'; delivered = 0; need = 3; hold = 0;
  onStart() {
    this.world.clearCourse();
    this.pickup = this.world.addMarker('pickup', [0, 0, -42], 2.6);
    this.drop = null;
    this.c.toast(`CARGO RUN · hold position inside the CYAN zone to load`, 3400);
  }
  nextDrop() {
    let x, z, tries = 0;
    do {
      const a = Math.random() * Math.PI * 2;
      const d = 45 + Math.random() * 75;
      x = Math.cos(a) * d; z = Math.sin(a) * d;
    } while (this.drop && Math.hypot(x - this.drop.pos.x, z - this.drop.pos.z) < 35 && ++tries < 20);
    this.drop = this.world.addMarker('drop', [x, 0, z], 3.0);
  }
  update(dt) {
    if (this.state === 'pickup') {
      if (this.world.insideMarker(this.pickup, this.model.pos)) {
        this.hold += dt;
        if (this.hold > 1.4) { this.state = 'deliver'; this.hold = 0; this.world.clearMarkers(); this.nextDrop(); this.c.audio.pickup(); this.c.toast('CARGO LOADED · deliver to the AMBER zone', 2600); }
      } else this.hold = Math.max(0, this.hold - dt * 2);
    } else if (this.state === 'deliver') {
      if (this.world.insideMarker(this.drop, this.model.pos)) {
        this.hold += dt;
        if (this.hold > 1.2) {
          this.delivered++; this.hold = 0;
          this.world.clearMarkers();
          this.c.audio.deliver();
          if (this.delivered >= this.need) {
            const score = this.delivered * 1000 + Math.round(this.model.battery * 600);
            const newBest = isBest('cargo', score, false);
            if (newBest) putBest('cargo', score);
            this.end(true, 'ALL CARGO DELIVERED', [['Deliveries', this.delivered + ' / ' + this.need], ['Battery left', Math.round(this.model.battery * 100) + '%'], ['Time', fmtTime(this.time)]], score);
            this.result.best = bestOf('cargo'); this.result.newBest = newBest;
          } else {
            this.state = 'pickup';
            this.pickup = this.world.addMarker('pickup', this.randomFieldPos(), 2.6);
            this.c.toast(`DELIVERED ${this.delivered}/${this.need} · return for next load`, 2400);
          }
        }
      } else this.hold = Math.max(0, this.hold - dt * 2);
    }
    if (this.model.battery <= 0.001 && !this.ended) {
      this.c.audio.fail();
      this.end(false, 'BATTERY DEPLETED', [['Deliveries', this.delivered + ' / ' + this.need], ['Score', String(this.delivered * 1000)]], this.delivered * 1000);
    }
  }
  randomFieldPos() {
    const a = Math.random() * Math.PI * 2;
    const d = 45 + Math.random() * 75;
    return [Math.cos(a) * d, 0, Math.sin(a) * d];
  }
  onEvent(e) { if (e.t === 'crash') { this.c.audio.fail(); this.end(false, 'CARGO LOST', [['Deliveries', this.delivered + ' / ' + this.need]], this.delivered * 1000); } }
  get target() { return this.state === 'pickup' ? this.pickup : this.drop; }
  get objective() {
    const t = this.target;
    if (!t) return 'Loading manifest...';
    const d = Math.hypot(this.model.pos.x - t.pos.x, this.model.pos.z - t.pos.z);
    return `${this.state === 'pickup' ? 'FLY TO PICKUP' : 'FLY TO DROP'} · ${Math.round(d)} m · hold inside zone`;
  }
  get bigStat() {
    const holdPct = this.hold > 0 ? ' · ' + Math.min(100, Math.round((this.hold / 1.4) * 100)) + '%' : '';
    return { value: `${this.delivered}/${this.need}`, label: 'DELIVERIES', sub: (this.state === 'pickup' ? 'PICKUP' : 'DELIVER') + holdPct };
  }
  get progressFrac() { return this.delivered / this.need; }
}

class PrecisionHover extends MissionBase {
  id = 'hover';
  limit = 90; acc = 0;
  onStart() {
    this.world.clearCourse();
    this.zone = this.world.addMarker('hover', [18, 9, -18], 2.1);
    this.c.toast(`PRECISION HOVER · 90s · stay inside the VIOLET zone, slow and level`, 3400);
  }
  update(dt) {
    const t = this.time;
    // slow lissajous drift for challenge
    this.zone.pos.set(18 + Math.sin(t * 0.23) * 6, 9 + Math.sin(t * 0.31) * 2, -18 + Math.cos(t * 0.19) * 6);
    this.zone.group.position.copy(this.zone.pos);
    const m = this.model;
    const inZone = Math.hypot(m.pos.x - this.zone.pos.x, m.pos.z - this.zone.pos.z) < this.zone.r && Math.abs(m.pos.y - (this.zone.pos.y + 1)) < this.zone.r;
    const stable = Math.hypot(m.vel.x, m.vel.z) < 1.6 && Math.abs(m.vel.y) < 0.8;
    if (inZone && stable) this.acc += dt;
    if (this.time >= this.limit) {
      const pct = (this.acc / this.limit) * 100;
      const score = Math.round(pct * 10);
      const newBest = isBest('hover', score, false);
      if (newBest) putBest('hover', score);
      this.c.audio.success();
      this.end(true, 'SESSION COMPLETE', [['Stability score', pct.toFixed(1) + '%'], ['Inside zone', this.acc.toFixed(1) + 's of ' + this.limit + 's']], score);
      this.result.best = bestOf('hover'); this.result.newBest = newBest;
    }
    if (this.limit - this.time < 10 && Math.floor(this.limit - this.time) !== Math.floor(this.limit - this.time + dt)) this.c.audio.countdown();
  }
  onEvent(e) { if (e.t === 'crash') { this.c.audio.fail(); this.end(false, 'WRECKED', [['Stability score', ((this.acc / this.limit) * 100).toFixed(1) + '%']], Math.round((this.acc / this.limit) * 100)); } }
  get objective() { return 'Hover inside the drifting zone · speed < 1.6 m/s'; }
  get bigStat() { return { value: ((this.acc / Math.max(1, Math.min(this.time, this.limit))) * 100).toFixed(0) + '%', label: 'STABILITY', sub: Math.max(0, Math.ceil(this.limit - this.time)) + 's LEFT' }; }
  get progressFrac() { return Math.min(1, this.time / this.limit); }
}

class Freestyle extends MissionBase {
  id = 'freestyle';
  limit = 90; score = 0; combo = 1; lastTrick = -99;
  rot = { x: 0, y: 0, z: 0 };
  onStart() {
    this.world.buildCourse(circuitGates(8, 40, 5));
    this.c.toast(`FREESTYLE · 90s · flips 360, rolls, spins and gates score points`, 3400);
  }
  update(dt) {
    const m = this.model;
    this.rot.x += m.omega.x * dt; this.rot.y += m.omega.y * dt; this.rot.z += m.omega.z * dt;
    const trick = (pts, name) => {
      this.combo = this.time - this.lastTrick < 5 ? Math.min(6, this.combo + 1) : 1;
      this.lastTrick = this.time;
      const gain = Math.round(pts * (1 + (this.combo - 1) * 0.25));
      this.score += gain;
      this.c.audio.gate(this.combo);
      this.c.toast(`${name} +${gain}${this.combo > 1 ? ' · x' + this.combo : ''}`, 1100);
    };
    if (Math.abs(this.rot.x) > Math.PI * 2) { this.rot.x -= Math.sign(this.rot.x) * Math.PI * 2; trick(260, 'FLIP'); }
    if (Math.abs(this.rot.z) > Math.PI * 2) { this.rot.z -= Math.sign(this.rot.z) * Math.PI * 2; trick(220, 'ROLL 360'); }
    if (Math.abs(this.rot.y) > Math.PI * 2) { this.rot.y -= Math.sign(this.rot.y) * Math.PI * 2; trick(120, 'SPIN 360'); }
    if (this.time - this.lastTrick > 5) this.combo = 1;

    const g = this.world.checkAnyGate(this.c.prevPos, this.model.pos);
    if (g) { this.score += 150; this.c.audio.gate(2); this.c.toast('GATE +150', 900); }

    // style: altitude bonus
    if (m.pos.y > 10 && m.pos.y < 25 && Math.hypot(m.vel.x, m.vel.z) > 14) this.score += dt * 5;

    if (this.time >= this.limit) {
      const s = Math.round(this.score);
      const newBest = isBest('freestyle', s, false);
      if (newBest) putBest('freestyle', s);
      this.c.audio.success();
      this.end(true, 'JUDGES SCORE', [['Freestyle score', String(s)], ['Battery left', Math.round(m.battery * 100) + '%']], s);
      this.result.best = bestOf('freestyle'); this.result.newBest = newBest;
    }
    if (this.limit - this.time < 10 && Math.floor(this.limit - this.time) !== Math.floor(this.limit - this.time + dt)) this.c.audio.countdown();
  }
  onEvent(e) { if (e.t === 'crash') { this.c.audio.fail(); this.end(false, 'CRASHED · ZERO', [['Score at crash', String(Math.round(this.score))]], Math.round(this.score)); } }
  get objective() { return 'Flip · roll · spin · thread gates · keep the combo'; }
  get bigStat() { return { value: String(Math.round(this.score)), label: 'SCORE', sub: Math.max(0, Math.ceil(this.limit - this.time)) + 's LEFT · x' + this.combo }; }
  get progressFrac() { return this.time / this.limit; }
}

export const MISSION_DEFS = [
  { id: 'free', name: 'FREE FLIGHT', tag: 'SANDBOX', blurb: 'No goals. Learn the quad, explore day and night, thread the gates.', color: '#34e2ff', make: (ctx) => new FreeFlight(ctx) },
  { id: 'tt', name: 'TIME TRIAL', tag: 'RACE', blurb: '14 gates, strict order, one lap. Every impact costs a second.', color: '#ff7a1a', make: (ctx) => new TimeTrial(ctx) },
  { id: 'rush', name: 'GATE RUSH', tag: 'ARCADE', blurb: '120 seconds. Any gate, any order. Chain them fast for combo multipliers.', color: '#ff2d55', make: (ctx) => new GateRush(ctx) },
  { id: 'cargo', name: 'CARGO RUN', tag: 'OPS', blurb: 'Load at the cyan pad, deliver to amber zones. Manage your battery.', color: '#f2b705', make: (ctx) => new CargoRun(ctx) },
  { id: 'hover', name: 'PRECISION HOVER', tag: 'SKILL', blurb: '90 seconds against a drifting zone. Measure your stick discipline.', color: '#7c5cff', make: (ctx) => new PrecisionHover(ctx) },
  { id: 'freestyle', name: 'FREESTYLE', tag: 'TRICKS', blurb: '90-second judge session. Flips, rolls, spins and gate links build combo.', color: '#3ddc84', make: (ctx) => new Freestyle(ctx) }
];

export function createMission(id, ctx) {
  const def = MISSION_DEFS.find((m) => m.id === id) || MISSION_DEFS[0];
  const m = def.make(ctx);
  m.onStart();
  return m;
}
