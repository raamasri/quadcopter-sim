// DOM HUD: telemetry, attitude indicator, throttle, battery, mission panel,
// arm indicator, toasts.

const CARDINALS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

export class HUD {
  constructor(root = document) {
    const g = (id) => root.getElementById(id);
    this.el = {
      spd: g('spd'), alt: g('alt'), vspeed: g('vspeed'), hdg: g('hdg'), hdgCard: g('hdg-card'),
      throttleFill: g('throttle-fill'), throttlePct: g('throttle-pct'), throttleHover: g('throttle-hover'),
      aiHorizon: g('ai-horizon'), pitchOut: g('pitch-out'), rollOut: g('roll-out'),
      batteryFill: g('battery-fill'), batteryPct: g('battery-pct'), batteryVol: g('battery-vol'),
      fps: g('fps'), viewBadge: g('view-badge'), flightMode: g('flight-mode'), modeDot: g('mode-dot'),
      flash: g('flash'), toast: g('toast'), help: g('help'), hud: g('hud'),
      missionBadge: g('mission-badge'), objText: g('obj-text'), progFill: g('prog-fill'),
      bigVal: g('big-val'), bigLabel: g('big-label'), bigSub: g('big-sub'),
      armBadge: g('arm-badge'), armBar: g('arm-bar'), padBadge: g('pad-badge'),
      rpmFill: g('rpm-fill'),
      windInd: g('wind-ind'), windArrow: g('wind-arrow'), windSpeed: g('wind-speed'),
      windBars: root.querySelectorAll('#wind-bars i'),
      qualityChip: g('quality-chip'),
      ghostRow: g('ghost-row'), ghostDelta: g('ghost-delta'),
      keyLegend: g('key-legend'), klThrLabel: g('kl-thr-label'), pauseBtn: g('pause-btn')
    };
    this._toastTimer = 0;
    this._lastBig = '';
    this._windVis = null; this._windHdg = null; this._windSpd = ''; this._windBars = -1;
    this._ghostOn = null; this._lastDelta = ''; this._lastDeltaCls = '';
    this._legendV = null; this._pauseV = null; this._springLbl = null;
  }

  setWind(o) {
    const e = this.el;
    if (!e.windInd) return;
    const vis = !!o.visible;
    if (this._windVis !== vis) { this._windVis = vis; e.windInd.classList.toggle('on', vis); }
    if (!vis) return;
    const hdg = Math.round(o.heading || 0) % 360;
    if (this._windHdg !== hdg) { this._windHdg = hdg; e.windArrow.style.transform = `rotate(${hdg}deg)`; }
    const sp = (o.speed || 0).toFixed(1);
    if (this._windSpd !== sp) { this._windSpd = sp; e.windSpeed.textContent = sp; }
    const s = o.speed || 0;
    const bars = s <= 0.05 ? 0 : s < 1.6 ? 1 : s < 3.4 ? 2 : 3;
    if (this._windBars !== bars) {
      this._windBars = bars;
      const list = e.windBars;
      for (let i = 0; i < list.length; i++) list[i].classList.toggle('lit', i < bars);
    }
  }

  setHoverPoint(pct) {
    if (this.el.throttleHover) this.el.throttleHover.style.bottom = `calc(${(pct * 100).toFixed(1)}% - 1px)`;
  }

  update(t, extra = {}) {
    const e = this.el;
    e.spd.textContent = (t.speed * 3.6).toFixed(1);
    e.alt.textContent = t.altitude.toFixed(1);
    e.vspeed.textContent = (t.vspeed >= 0 ? '+' : '') + t.vspeed.toFixed(1);
    const hdg = Math.round(t.heading) % 360;
    e.hdg.textContent = String((hdg + 360) % 360).padStart(3, '0');
    e.hdgCard.textContent = CARDINALS[Math.round(((hdg + 360) % 360) / 45) % 8];

    const thr = Math.max(0, Math.min(1, t.throttle / 100));
    e.throttleFill.style.height = (thr * 100).toFixed(0) + '%';
    e.throttlePct.textContent = Math.round(thr * 100) + '%';
    if (e.rpmFill) e.rpmFill.style.height = Math.min(100, t.rpm * 88).toFixed(0) + '%';

    const pxPerDeg = 1.3;
    const pitch = Math.max(-90, Math.min(90, t.pitchDeg));
    const roll = Math.max(-90, Math.min(90, t.rollDeg));
    e.aiHorizon.style.transform = `translateY(${(pitch * pxPerDeg).toFixed(1)}px) rotate(${(-roll).toFixed(1)}deg)`;
    e.pitchOut.textContent = pitch.toFixed(0);
    e.rollOut.textContent = roll.toFixed(0);

    const batt = Math.max(0, Math.min(100, t.battery));
    e.batteryFill.style.width = batt.toFixed(0) + '%';
    e.batteryPct.textContent = Math.round(batt) + '%';
    e.batteryFill.style.background = batt < 20 ? 'var(--bad)' : batt < 45 ? 'var(--warn)' : 'var(--good)';
    const cells = 4;
    e.batteryVol.textContent = (batt / 100 * 0.85 + 3.3) * cells > 0 ? ((batt / 100 * 0.85 + 3.3) * cells).toFixed(1) + 'V' : '';

    if (t.fps) e.fps.textContent = Math.round(t.fps) + ' FPS';

    const mode = t.mode || 'STABLE';
    e.flightMode.textContent = mode;
    const dotColor = mode === 'DISARMED' || mode === 'CRASHED' ? 'var(--bad)' : mode === 'ACRO' ? 'var(--accent-2)' : 'var(--good)';
    e.modeDot.style.background = dotColor;
    e.modeDot.style.boxShadow = `0 0 8px ${dotColor}`;

    // arm badge + combo progress
    if (extra.armProg > 0 || extra.disarmProg > 0) {
      e.armBar.parentElement.classList.add('show');
      const p = extra.armProg > 0 ? extra.armProg : extra.disarmProg;
      e.armBar.style.width = (p * 100).toFixed(0) + '%';
      e.armBar.style.background = extra.armProg > 0 ? 'var(--good)' : 'var(--bad)';
    } else {
      e.armBar.parentElement.classList.remove('show');
    }
    e.armBadge.textContent = t.armed ? 'ARMED' : 'DISARMED';
    e.armBadge.classList.toggle('armed', !!t.armed);
    e.armBadge.classList.toggle('crashed', !!t.crashed);

    // mission info
    if (extra.objective !== undefined) e.objText.textContent = extra.objective || '';
    if (extra.progressFrac !== undefined) e.progFill.style.width = (Math.max(0, Math.min(1, extra.progressFrac)) * 100).toFixed(1) + '%';
    const big = extra.big;
    const key = big ? big.value + '|' + big.label + '|' + (big.sub || '') : '';
    if (key !== this._lastBig) {
      this._lastBig = key;
      if (big) {
        e.bigVal.textContent = big.value;
        e.bigLabel.textContent = big.label;
        e.bigSub.textContent = big.sub || '';
        e.bigVal.parentElement.style.display = '';
      } else e.bigVal.parentElement.style.display = 'none';
    }
  }

  setView(name) { this.el.viewBadge.textContent = name; }
  setMission(name) { this.el.missionBadge.textContent = name; this.el.missionBadge.style.display = name ? '' : 'none'; }
  setQuality(name) { if (this.el.qualityChip) this.el.qualityChip.textContent = name; }

  // TT ghost replay (v0.6.0): 'GHOST ON' chip + per-gate delta readout
  setGhost(on) {
    if (this._ghostOn === on) return;
    this._ghostOn = on;
    if (this.el.ghostRow) this.el.ghostRow.style.display = on ? '' : 'none';
    document.body.classList.toggle('ghost-visible', on);
    if (on) this.setGhostDelta(0);
  }

  setGhostDelta(d) {
    const e = this.el;
    if (!e.ghostDelta) return;
    let txt, cls;
    if (d == null || Math.abs(d) < 0.005) { txt = '±0.00'; cls = ''; }
    else { txt = (d < 0 ? '-' : '+') + Math.abs(d).toFixed(2); cls = d < 0 ? 'good' : 'bad'; }
    if (txt !== this._lastDelta) { this._lastDelta = txt; e.ghostDelta.textContent = txt; }
    if (cls !== this._lastDeltaCls) { this._lastDeltaCls = cls; e.ghostDelta.className = 'ghost-delta' + (cls ? ' ' + cls : ''); }
  }

  setPad(on) {
    this.el.padBadge.style.display = on ? '' : 'none';
    if (on) this.toast('GAMEPAD CONNECTED', 1400);
  }

  // v0.8.0: keyboard legend ('on' | 'dim' | 'off'), pause pill, spring label
  setLegendVisible(v) {
    if (v === this._legendV) return;
    this._legendV = v;
    const el = this.el.keyLegend;
    if (!el) return;
    el.classList.toggle('on', v !== 'off');
    el.classList.toggle('dim', v === 'dim');
  }

  setPauseVisible(v) {
    if (v === this._pauseV) return;
    this._pauseV = v;
    if (this.el.pauseBtn) this.el.pauseBtn.classList.toggle('on', v);
  }

  setThrottleSpring(v) {
    if (v === this._springLbl) return;
    this._springLbl = v;
    if (this.el.klThrLabel) this.el.klThrLabel.textContent = v ? 'Throttle \u2191\u2193 spring' : 'Throttle';
  }

  flashGate() {
    const f = this.el.flash;
    f.classList.remove('on');
    void f.offsetWidth;
    f.classList.add('on');
  }

  toast(msg, ms = 1400) {
    const el = this.el.toast;
    el.textContent = msg;
    el.classList.add('on');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => el.classList.remove('on'), ms);
  }

  showHelp(v) { this.el.help.classList.toggle('hide', !v); }
}
