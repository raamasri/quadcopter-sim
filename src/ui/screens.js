// Full-screen UI: main menu, hangar, settings, pause, results.

const SETTINGS_KEY = 'quad…s.v2';

export function loadSettings() {
  const base = { volume: 0.7, sound: true, sensitivity: 0.55, shadows: true, night: false, drone: 'scout', mission: 'free' };
  try { return Object.assign(base, JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}); } catch { return base; }
}
export function saveSettings(s) { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* ignore */ } }

const fmtBest = (id, raw) => {
  if (raw == null) return '—';
  if (id === 'tt') { const m = Math.floor(raw / 60), s = raw - m * 60; return m > 0 ? `${m}:${s.toFixed(2).padStart(5, '0')}` : s.toFixed(2) + 's'; }
  if (id === 'hover') return (raw / 10).toFixed(1) + '%';
  return String(Math.round(raw));
};

export class Screens {
  constructor(root, opts) {
    this.root = root;
    this.o = opts;
    this.root.innerHTML = this._template();
    this.el = {
      menu: this.root.querySelector('#scr-menu'),
      pause: this.root.querySelector('#scr-pause'),
      results: this.root.querySelector('#scr-results'),
      missionGrid: this.root.querySelector('#mission-grid'),
      droneGrid: this.root.querySelector('#drone-grid'),
      launchBtn: this.root.querySelector('#launch-btn'),
      resTitle: this.root.querySelector('#res-title'),
      resLines: this.root.querySelector('#res-lines'),
      resBest: this.root.querySelector('#res-best'),
      padHint: this.root.querySelector('#pad-hint')
    };
    this.selectedMission = this.o.settings.mission;
    this.selectedDrone = this.o.settings.drone;
    this._bind();
    this.renderMissions();
    this.renderDrones();
    this._syncSettings();
  }

  _template() {
    return `
    <div class="screen" id="scr-menu">
      <div class="menu-wrap">
        <header class="menu-head">
          <div class="logo">
            <div class="logo-mark"></div>
            <div>
              <h1>QUADSIM <span class="logo-pro">PRO</span></h1>
              <p class="tagline">Quadcopter flight simulator · realistic physics · browser native</p>
            </div>
          </div>
          <div class="head-right">
            <div class="pill" id="pad-hint">GAMEPAD: NOT DETECTED</div>
          </div>
        </header>

        <section>
          <h2 class="sec-title">Mission</h2>
          <div class="cards" id="mission-grid"></div>
        </section>

        <section>
          <h2 class="sec-title">Hangar</h2>
          <div class="drones" id="drone-grid"></div>
        </section>

        <section class="settings">
          <h2 class="sec-title">Settings</h2>
          <div class="set-grid">
            <label class="set-row"><span>Master volume</span><input type="range" id="set-volume" min="0" max="1" step="0.05"></label>
            <label class="set-row"><span>Stick sensitivity</span><input type="range" id="set-sens" min="0" max="1" step="0.05"></label>
            <label class="set-row toggle"><span>Sound</span><input type="checkbox" id="set-sound"></label>
            <label class="set-row toggle"><span>Shadows</span><input type="checkbox" id="set-shadows"></label>
            <label class="set-row toggle"><span>Night session</span><input type="checkbox" id="set-night"></label>
          </div>
          <p class="set-note">Shadows OFF boosts FPS on weaker GPUs. Sensitivity blends linear ↔ expo response.</p>
        </section>

        <section class="controls-cheat">
          <h2 class="sec-title">Controls</h2>
          <div class="cheat-grid">
            <div><kbd>Throttle down + E</kbd> hold 0.7s to <b>ARM</b> · <kbd>Throttle down + Q</kbd> disarm · <kbd>G</kbd> quick arm</div>
            <div><kbd>W/S</kbd> pitch · <kbd>A/D</kbd> roll · <kbd>Q/E</kbd> yaw · <kbd>Space</kbd>/<kbd>Shift</kbd> throttle</div>
            <div><kbd>T</kbd> angle/acro mode · <kbd>C</kbd> camera · <kbd>M</kbd> mouse look · <kbd>R</kbd> respawn</div>
            <div><kbd>P</kbd> pause · <kbd>L</kbd> day/night · <kbd>H</kbd> help · <kbd>F</kbd> fullscreen · Gamepad: LS throttle/yaw · RS pitch/roll · A arm · X mode</div>
          </div>
        </section>

        <div class="launch-bar">
          <button class="btn-launch" id="launch-btn">LAUNCH MISSION<em id="launch-sub"></em></button>
        </div>
      </div>
    </div>

    <div class="screen hidden" id="scr-pause">
      <div class="pause-card">
        <h2>PAUSED</h2>
        <button class="btn big" data-act="resume">RESUME</button>
        <button class="btn" data-act="restart">RESTART MISSION</button>
        <button class="btn" data-act="quit">QUIT TO MENU</button>
        <div class="set-grid pause-set">
          <label class="set-row"><span>Volume</span><input type="range" id="set-volume-p" min="0" max="1" step="0.05"></label>
        </div>
      </div>
    </div>

    <div class="screen hidden" id="scr-results">
      <div class="results-card">
        <h2 id="res-title">RESULT</h2>
        <div id="res-lines"></div>
        <div id="res-best" class="res-best"></div>
        <div class="res-btns">
          <button class="btn big" data-act="again">FLY AGAIN</button>
          <button class="btn" data-act="menu">MAIN MENU</button>
        </div>
      </div>
    </div>`;
  }

  _bind() {
    this.root.addEventListener('click', (e) => {
      const t = e.target.closest('[data-act], .card, .drone-card, #launch-btn');
      if (!t) return;
      if (t.id === 'launch-btn') { this.o.onLaunch(this.selectedMission, this.selectedDrone); return; }
      const act = t.dataset.act;
      if (act === 'resume') this.o.onResume();
      else if (act === 'restart') this.o.onRestart();
      else if (act === 'quit') this.o.onQuit();
      else if (act === 'again') this.o.onRestart();
      else if (act === 'menu') this.o.onQuit();
      const mid = t.dataset.mission;
      if (mid) { this.selectedMission = mid; this.renderMissions(); this.o.onChange({ mission: mid }); this.o.audioClick(); }
      const did = t.dataset.drone;
      if (did) { this.selectedDrone = did; this.renderDrones(); this.o.onChange({ drone: did }); this.o.audioClick(); }
    });
    const bindRange = (id, key) => {
      this.root.querySelectorAll(id).forEach((r) => r.addEventListener('input', () => {
        this.o.settings[key] = parseFloat(r.value);
        this.o.onChange({ [key]: this.o.settings[key] });
        this.root.querySelectorAll(id).forEach((x) => { x.value = r.value; });
      }));
    };
    const bindCheck = (id, key) => {
      this.root.querySelectorAll(id).forEach((r) => r.addEventListener('change', () => {
        this.o.settings[key] = r.checked;
        this.o.onChange({ [key]: r.checked });
        this.root.querySelectorAll(id).forEach((x) => { x.checked = r.checked; });
      }));
    };
    bindRange('#set-volume, #set-volume-p', 'volume');
    bindRange('#set-sens', 'sensitivity');
    bindCheck('#set-sound', 'sound');
    bindCheck('#set-shadows', 'shadows');
    bindCheck('#set-night', 'night');
  }

  _syncSettings() {
    const s = this.o.settings;
    this._setVal('#set-volume, #set-volume-p', s.volume);
    this._setVal('#set-sens', s.sensitivity);
    this._setChk('#set-sound', s.sound);
    this._setChk('#set-shadows', s.shadows);
    this._setChk('#set-night', s.night);
  }
  _setVal(sel, v) { this.root.querySelectorAll(sel).forEach((r) => { r.value = v; }); }
  _setChk(sel, v) { this.root.querySelectorAll(sel).forEach((r) => { r.checked = v; }); }

  renderMissions() {
    const grid = this.el.missionGrid;
    grid.innerHTML = this.o.missions.map((m) => {
      const best = fmtBest(m.id, this.o.bestOf(m.id));
      const sel = m.id === this.selectedMission;
      return `<button class="card ${sel ? 'sel' : ''}" data-mission="${m.id}" style="--mc:${m.color}">
        <div class="card-tag">${m.tag}</div>
        <div class="card-name">${m.name}</div>
        <div class="card-blurb">${m.blurb}</div>
        <div class="card-best">${m.id === 'free' ? 'RELAX MODE' : 'BEST ' + best}</div>
      </button>`;
    }).join('');
    const def = this.o.missions.find((m) => m.id === this.selectedMission);
    this.el.launchBtn.querySelector('#launch-sub').textContent = def ? ' · ' + def.name : '';
  }

  renderDrones() {
    const grid = this.el.droneGrid;
    grid.innerHTML = this.o.drones.map((d) => {
      const sel = d.id === this.selectedDrone;
      const hex = '#' + d.color.accent.toString(16).padStart(6, '0');
      const bar = (v) => `<i class="sb-track"><i class="sb-fill" style="width:${v * 20}%"></i></i>`;
      return `<button class="drone-card ${sel ? 'sel' : ''}" data-drone="${d.id}" style="--dc:${hex}">
        <div class="dc-swatch"><i></i></div>
        <div class="dc-name">${d.name}</div>
        <div class="dc-role">${d.role}</div>
        <div class="dc-stats">
          <span>AGI ${bar(d.agility)}</span>
          <span>SPD ${bar(d.speed)}</span>
          <span>STB ${bar(d.stability)}</span>
        </div>
      </button>`;
    }).join('');
  }

  setPad(on) {
    this.el.padHint.textContent = on ? 'GAMEPAD READY · Mode 2' : 'GAMEPAD: NOT DETECTED';
    this.el.padHint.classList.toggle('on', !!on);
  }

  showMenu() { this._show(this.el.menu); this.renderMissions(); this.renderDrones(); this._syncSettings(); }
  showPause() { this._syncSettings(); this._show(this.el.pause); }
  showResults(res) {
    this.el.resTitle.textContent = res.title;
    this.el.resTitle.className = res.win ? 'win' : 'lose';
    this.el.resLines.innerHTML = (res.lines || []).map(([k, v]) => `<div class="res-row"><span>${k}</span><b>${v}</b></div>`).join('');
    let bestTxt = '';
    if (res.id && res.id !== 'free' && res.best != null) {
      bestTxt = res.newBest ? '★ NEW RECORD' : 'BEST ' + fmtBest(res.id, res.best);
      if (res.win === false) bestTxt = 'BEST ' + fmtBest(res.id, this.o.bestOf(res.id));
    }
    this.el.resBest.textContent = bestTxt;
    this.el.resBest.classList.toggle('newrec', !!res.newBest);
    this._show(this.el.results);
  }
  hide() { [this.el.menu, this.el.pause, this.el.results].forEach((s) => s.classList.add('hidden')); }
  _show(s) { this.hide(); s.classList.remove('hidden'); }
}
