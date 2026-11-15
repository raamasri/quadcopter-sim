// Unified input: keyboard, mouse look, gamepad (Mode 2), arming combo.
// Produces per-frame { pitch, roll, yaw, throttle } plus discrete callbacks.

const FLIGHT_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'Space', 'ShiftLeft', 'ShiftRight', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
const PREVENT = ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'];
const SPRING_FALL = 0.45; // v0.8.0 spring mode: throttle decay to 0 per second when no key held

const dz = (v, z = 0.12) => (Math.abs(v) < z ? 0 : (v - Math.sign(v) * z) / (1 - z));
const expo = (v, e) => v * (Math.abs(v) * e + (1 - e));

export class Controls {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.mouseLook = false;
    this.cb = {};
    this.sensitivity = 0.55; // expo amount
    this._dx = 0; this._dy = 0;

    this.throttle = 0;
    this.throttleLock = false;
    this.spring = false; // v0.8.0 sprung-stick throttle: released throttle decays to 0
    this.padConnected = false;
    this.padIndex = -1;
    this.pad = { pitch: 0, roll: 0, yaw: 0, throttle: null };
    this._padActive = false;

    this.armHold = 0;      // 0..1 progress toward arm (yaw right)
    this.disarmHold = 0;   // 0..1 progress toward disarm (yaw left)
    this._armLatch = false;

    this._onKeyDown = (e) => {
      if (PREVENT.includes(e.code)) e.preventDefault();
      if (!e.repeat) { this._system(e.code); if (this.cb.anyFlightKey && FLIGHT_KEYS.includes(e.code)) this.cb.anyFlightKey(); }
      this.keys.add(e.code);
    };
    this._onKeyUp = (e) => this.keys.delete(e.code);
    this._onBlur = () => this.keys.clear();
    this._onMove = (e) => {
      if (!this.mouseLook) return;
      this._dx += e.movementX || 0; this._dy += e.movementY || 0;
    };
    this._onLock = () => {
      this.mouseLook = document.pointerLockElement === this.canvas;
      if (this.cb.mouseLookChanged) this.cb.mouseLookChanged(this.mouseLook);
    };
    this._onPadConn = (e) => {
      this.padConnected = e.type === 'gamepadconnected';
      this.padIndex = this.padConnected ? e.gamepad.index : -1;
      if (this.cb.padStatus) this.cb.padStatus(this.padConnected, e.gamepad ? e.gamepad.id : '');
    };

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('blur', this._onBlur);
    document.addEventListener('mousemove', this._onMove);
    document.addEventListener('pointerlockchange', this._onLock);
    window.addEventListener('gamepadconnected', this._onPadConn);
    window.addEventListener('gamepaddisconnected', this._onPadConn);

    this._prevButtons = [];
    this._prevPad = null;
    this.touch = null; // reused axes ref from TouchControls: {pitch,roll,yaw,throttle,active}
  }

  _system(code) {
    const c = this.cb;
    switch (code) {
      case 'KeyC': if (c.cycleView) c.cycleView(); break;
      case 'Digit1': if (c.selectView) c.selectView(0); break;
      case 'Digit2': if (c.selectView) c.selectView(1); break;
      case 'Digit3': if (c.selectView) c.selectView(2); break;
      case 'Digit4': if (c.selectView) c.selectView(3); break;
      case 'Digit5': if (c.selectView) c.selectView(4); break;
      case 'Digit6': if (c.selectView) c.selectView(5); break;
      case 'KeyR': if (c.reset) c.reset(); break;
      case 'KeyM': this.toggleMouseLook(); break;
      case 'KeyH': if (c.toggleHelp) c.toggleHelp(); break;
      case 'KeyP': if (c.togglePause) c.togglePause(); break;
      case 'KeyF': if (c.fullscreen) c.fullscreen(); break;
      case 'KeyL': if (c.toggleLight) c.toggleLight(); break;
      case 'KeyT': if (c.toggleMode) c.toggleMode(); break;
      case 'KeyG': if (c.toggleArm) c.toggleArm(); break;
    }
  }

  toggleMouseLook() {
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    else if (this.canvas.requestPointerLock) { const p = this.canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); }
  }

  _pollPad(dt) {
    this._padActive = false;
    if (this.padIndex < 0) return;
    const gps = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = gps[this.padIndex];
    if (!gp) return;
    const ax = gp.axes, btns = gp.buttons;
    if (!ax || ax.length < 4) return;

    const lx = dz(ax[0] || 0), ly = dz(ax[1] || 0), rx = dz(ax[2] || 0), ry = dz(ax[3] || 0);
    this.pad.yaw = this._applyExpo(lx);
    this.pad.pitch = this._applyExpo(-ry);
    this.pad.roll = this._applyExpo(rx);
    this.pad.throttle = (-ly + 1) / 2; // stick down = 0, up = 1

    if (Math.abs(lx) + Math.abs(ly) + Math.abs(rx) + Math.abs(ry) > 0.02) this._padActive = true;

    const pressed = (i) => btns[i] && (btns[i].pressed || btns[i].value > 0.5);
    const edge = (i) => pressed(i) && !this._prevButtons[i];
    const c = this.cb;
    if (edge(0) && c.toggleArm) c.toggleArm();          // A
    if (edge(1) && c.cycleView) c.cycleView();          // B
    if (edge(2) && c.toggleMode) c.toggleMode();        // X
    if (edge(3) && c.toggleMouseLook) c.toggleMouseLook(); // Y
    if (edge(8) && c.reset) c.reset();                  // Select
    if (edge(9) && c.togglePause) c.togglePause();      // Start
    if (edge(4) && c.armHoldRequest) c.armHoldRequest(); // LB (hold-to-arm helper)
    this._prevButtons = btns.map((b) => !!(b.pressed || b.value > 0.5));
  }

  _applyExpo(v) { return expo(v, this.sensitivity * 0.6); }

  // v0.9.0 gamepad rumble (dual-rumble). Silently no-ops when the pad has no
  // vibrationActuator (Safari) or playEffect rejects (Firefox permission).
  rumble(ms = 180, strong = 0.6, weak = 0.35) {
    try {
      if (this.padIndex < 0 || !navigator.getGamepads) return;
      const gp = navigator.getGamepads()[this.padIndex];
      const va = gp && gp.vibrationActuator;
      if (!va || !va.playEffect) return;
      const p = va.playEffect('dual-rumble', {
        startDelay: 0,
        duration: Math.max(1, ms),
        strongMagnitude: Math.max(0, Math.min(1, strong)),
        weakMagnitude: Math.max(0, Math.min(1, weak))
      });
      if (p && p.catch) p.catch(() => {});
    } catch { /* haptics unsupported */ }
  }

  // Call once per frame. Returns flight command + consumed mouse delta.
  update(dt) {
    this._pollPad(dt);
    const k = this.keys;
    let pitch = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    let roll = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    let yaw = (k.has('KeyE') ? 1 : 0) - (k.has('KeyQ') ? 1 : 0);

    pitch = this._applyExpo(pitch); roll = this._applyExpo(roll); yaw = this._applyExpo(yaw);

    if (Math.abs(this.pad.pitch) > Math.abs(pitch)) pitch = this.pad.pitch;
    if (Math.abs(this.pad.roll) > Math.abs(roll)) roll = this.pad.roll;
    if (Math.abs(this.pad.yaw) > Math.abs(yaw)) yaw = this.pad.yaw;

    // touch sticks override while engaged (~0.5s hold after release); mouse look untouched
    const tt = this.touch;
    const touchOn = !!tt && tt.active;
    if (touchOn) {
      pitch = this._applyExpo(tt.pitch); roll = this._applyExpo(tt.roll); yaw = this._applyExpo(tt.yaw);
    }

    // throttle: gamepad stick wins when connected; keys ramp otherwise; touch wins last
    // spring mode (v0.8.0): no key held -> decay to 0; Shift fall keeps the -0.9/s keyRate.
    // _padActive (not padConnected) so idle/phantom pads never block keyboard spring
    if (!this.throttleLock) {
      const keyRate = (k.has('Space') ? 0.7 : 0) - (k.has('ShiftLeft') || k.has('ShiftRight') ? 0.9 : 0);
      if (this.padConnected && this.pad.throttle !== null) {
        this.throttle = this._padActive ? this.pad.throttle : this.throttle;
      }
      if (keyRate !== 0) this.throttle = Math.max(0, Math.min(1, this.throttle + keyRate * dt));
      else if (this.spring && !this._padActive && !touchOn && this.throttle > 0) this.throttle = Math.max(0, this.throttle - SPRING_FALL * dt);
      if (touchOn) this.throttle = Math.max(0, Math.min(1, tt.throttle));
    }

    // Betaflight-style arming: zero throttle + full yaw held
    if (this._armLatch && Math.abs(yaw) < 0.4) this._armLatch = false;
    const canArmCombo = this.throttle < 0.05 && !this._armLatch;
    if (canArmCombo && yaw > 0.85) { this.armHold = Math.min(1, this.armHold + dt / 0.7); this.disarmHold = 0; }
    else if (canArmCombo && yaw < -0.85) { this.disarmHold = Math.min(1, this.disarmHold + dt / 0.7); this.armHold = 0; }
    else { this.armHold = 0; this.disarmHold = 0; }

    const mouseDX = this._dx, mouseDY = this._dy;
    this._dx = 0; this._dy = 0;

    return {
      pitch, roll, yaw,
      throttle: this.throttle,
      mouseDX, mouseDY,
      mouseLook: this.mouseLook
    };
  }

  setThrottle(v) { this.throttle = Math.max(0, Math.min(1, v)); }

  // Accepts the reused TouchControls.getAxes() object (no per-frame copies).
  setTouchAxes(a) { this.touch = a; }

  dispose() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('blur', this._onBlur);
    document.removeEventListener('mousemove', this._onMove);
    document.removeEventListener('pointerlockchange', this._onLock);
    window.removeEventListener('gamepadconnected', this._onPadConn);
    window.removeEventListener('gamepaddisconnected', this._onPadConn);
  }
}
