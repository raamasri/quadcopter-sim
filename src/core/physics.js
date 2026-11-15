// Rigid-body quadcopter flight model.
// Body axes: forward = -Z, right = +X, up = +Y.
// Angle mode: attitude PD self-levels toward a stick-tilted target.
// Acro mode: rate PD drives body angular rates directly.
// Per-motor rotor speeds (for visuals + audio) are derived from a physical
// X-frame mixer with spin-up lag and control-authority saturation.

import * as THREE from 'three';
import { CFG, clamp, lerp, smoothstep, rad2deg } from './config.js';

const V = THREE.Vector3;
const AXIS_X = new V(1, 0, 0);
const AXIS_Y = new V(0, 1, 0);
const AXIS_Z = new V(0, 0, 1);

export class FlightModel {
  constructor(spec, windField) {
    this.spec = spec;
    this.maxThrust = spec.mass * 9.81 * spec.tw;
    this.weight = spec.mass * 9.81;
    this.hoverThrottle = 1 / spec.tw;
    this.R = 0.22 * spec.size;
    this.drainMult = 110 / spec.batteryWh;

    this.wind = windField || null;

    this.pos = new V();
    this.vel = new V();
    this.quat = new THREE.Quaternion();
    this.omega = new V();
    this.yaw = 0;

    this.throttle = 0;
    this.collective = 0;
    this.battery = 1;
    this.armed = false;
    this.landed = true;
    this.crashed = false;
    this.crashTimer = 0;
    this.damage = 0;
    this.mode = 'angle'; // 'angle' | 'acro'
    this.mousePitch = 0;

    this.rotorNorm = [0, 0, 0, 0];
    this.rpmNorm = 0;
    this.thrustN = 0;
    this.gLoad = 1;
    this.events = [];

    // scratch
    this._qi = new THREE.Quaternion();
    this._dq = new THREE.Quaternion();
    this._tv = new V();
    this._lift = new V();
    this._force = new V();
    this._acc = new V();
    this._qYaw = new THREE.Quaternion();
    this._qPitch = new THREE.Quaternion();
    this._qRoll = new THREE.Quaternion();
    this._qTarget = new THREE.Quaternion();
    this._euler = new THREE.Euler();
    this._fwd = new V();
    this._right = new V();
    this._up = new V();

    this._rateCmd = new V();
    this._airVel = new V();
    this._airL = new V();
    this._rel = new V();
  }

  setWind(windField) { this.wind = windField || null; }

  spawn(x = 0, y = 0.5, z = 6, yaw = 0) {
    this.pos.set(x, y, z);
    this.vel.set(0, 0, 0);
    this.yaw = yaw;
    this.quat.setFromAxisAngle(AXIS_Y, yaw);
    this.omega.set(0, 0, 0);
    this.throttle = 0;
    this.collective = 0;
    this.battery = 1;
    this.armed = false;
    this.landed = true;
    this.crashed = false;
    this.crashTimer = 0;
    this.damage = 0;
    this.mousePitch = 0;
    this.rotorNorm = [0, 0, 0, 0];
    this.rpmNorm = 0;
    this.events.length = 0;
  }

  arm(v = true) {
    if (v && !this.armed && !this.crashed) {
      this.armed = true;
      this.events.push({ t: 'arm' });
    } else if (!v) {
      this.armed = false;
      this.throttle = 0;
    }
  }

  setMode(m) {
    this.mode = m === 'acro' ? 'acro' : 'angle';
    this.events.push({ t: 'mode', mode: this.mode });
  }

  // Advance by wall dt, internally running fixed substeps for stability.
  advance(dt, input, world) {
    if (this.crashed) {
      this._crashPhysics(dt, world);
      return;
    }
    const h = CFG.fixedStep;
    if (this.wind && this.wind.strength > 0) this.wind.sample(this.pos.x, this.pos.y, this.pos.z, this._airVel);
    else this._airVel.set(0, 0, 0);
    let acc = dt;
    let guard = 0;
    while (acc > 1e-6 && guard < 60) {
      this._substep(Math.min(h, acc), input, world, this._airVel);
      acc -= h;
      guard++;
    }
    this._updateRotors(dt, input);
    this._updateBattery(dt);
  }

  _authority() {
    // Control authority rises with collective; near-zero throttle tumbles.
    const c = this.armed ? this.collective : 0;
    return clamp(0.18 + c * 1.25, 0, 1);
  }

  _batteryFactor() {
    const b = this.battery;
    if (b <= 0) return 0;
    const sag = 0.55 + 0.45 * smoothstep(0.05, 0.32, b);
    const cutoff = smoothstep(0, 0.02, b);
    return sag * cutoff;
  }

  _substep(s, input, world, airVel) {
    const spec = this.spec;

    // --- heading ---
    this.yaw += -input.yaw * spec.rateYaw * s * (this.armed ? 1 : 0);
    if (input.mouseLook && this.armed) {
      this.mousePitch = clamp(this.mousePitch - input.mouseDY * 0.0021, -spec.maxTilt, spec.maxTilt);
    } else {
      const kb = -input.pitch * spec.maxTilt;
      this.mousePitch += (kb - this.mousePitch) * Math.min(1, 6 * s);
    }

    const tiltP = input.mouseLook ? this.mousePitch : -input.pitch * spec.maxTilt;
    const tiltR = -input.roll * spec.maxTilt;

    // collective thrust command with battery sag
    const bf = this._batteryFactor();
    this.throttle = clamp(input.throttle, 0, 1);
    this.collective = this.armed ? this.throttle * bf : 0;

    if (this.mode === 'angle') {
      this._qYaw.setFromAxisAngle(AXIS_Y, this.yaw);
      this._qPitch.setFromAxisAngle(AXIS_X, tiltP);
      this._qRoll.setFromAxisAngle(AXIS_Z, tiltR);
      this._qTarget.copy(this._qYaw).multiply(this._qPitch).multiply(this._qRoll);

      this._qi.copy(this.quat).invert().multiply(this._qTarget);
      if (this._qi.w < 0) { this._qi.x = -this._qi.x; this._qi.y = -this._qi.y; this._qi.z = -this._qi.z; this._qi.w = -this._qi.w; }
      const angle = 2 * Math.acos(clamp(this._qi.w, -1, 1));
      const sn = Math.sqrt(Math.max(0, 1 - this._qi.w * this._qi.w));
      let ax = this._qi.x, ay = this._qi.y, az = this._qi.z;
      if (sn > 1e-5) { ax /= sn; ay /= sn; az /= sn; }
      const auth = this._authority();
      const kp = spec.kpAtt * auth, kd = spec.kdAtt;
      this.omega.x += (kp * angle * ax - kd * this.omega.x) * s;
      this.omega.y += (kp * angle * ay - kd * this.omega.y) * s;
      this.omega.z += (kp * angle * az - kd * this.omega.z) * s;
    } else {
      // acro: direct body-rate commands
      const mx = spec.maxRate, my = spec.rateYaw * 1.5;
      this._rateCmd.set(input.pitch * mx, -input.yaw * my, input.roll * mx);
      const auth = this._authority();
      const k = 18 * auth * spec.kpRate;
      this.omega.x += (this._rateCmd.x - this.omega.x) * Math.min(1, k * s);
      this.omega.y += (this._rateCmd.y - this.omega.y) * Math.min(1, k * s);
      this.omega.z += (this._rateCmd.z - this.omega.z) * Math.min(1, k * s);
      // acro has no self-levelling: integrate current attitude only
    }

    const om = this.omega.length();
    const cap = spec.maxRate * 2.4;
    if (om > cap) this.omega.multiplyScalar(cap / om);
    if (om > 1e-7) {
      this._tv.copy(this.omega).multiplyScalar(1 / om);
      this._dq.setFromAxisAngle(this._tv, om * s);
      this.quat.multiply(this._dq).normalize();
    }

    // --- forces ---
    this._up.set(0, 1, 0).applyQuaternion(this.quat);
    // ground effect: extra lift + cushion when close to ground
    let ge = 0;
    if (world && this.pos.y < 0.7 * spec.size) {
      ge = smoothstep(0.7 * spec.size, 0, this.pos.y) * 0.22;
    }
    const thrustScale = this.collective * this.maxThrust * (1 + ge);
    this.thrustN = thrustScale;
    this._lift.copy(this._up).multiplyScalar(thrustScale);
    this._force.copy(this._lift);
    this._force.y -= spec.mass * 9.81;

    // aerodynamic drag opposes motion relative to the air (wind-aware). Near
    // the deck the rotor downwash dominates, so wind coupling is damped toward
    // 25 % at the surface. With no wind this is identical to plain drag.
    const air = airVel || this._airVel;
    let wg = 1;
    const geH = CFG.windGroundEffectH ?? 1.2;
    const alt = this.pos.y - CFG.groundClear;
    if (alt < geH) wg = lerp(0.25, 1, clamp(alt / geH, 0, 1));
    this._airL.copy(air).multiplyScalar(wg);
    this._rel.copy(this.vel).sub(this._airL);
    const sp = this._rel.length();
    this._force.addScaledVector(this._rel, -(spec.dragLin + spec.dragQuad * sp));

    this._acc.copy(this._force).multiplyScalar(1 / spec.mass);
    this.gLoad = this._lift.y / this.weight;
    this.vel.addScaledVector(this._acc, s);
    this.pos.addScaledVector(this.vel, s);

    // --- collisions ---
    this._resolveGround();
    if (world) this._resolveWorld(world);
  }

  _resolveGround() {
    const gc = CFG.groundClear;
    if (this.pos.y < gc) {
      this.pos.y = gc;
      if (this.vel.y < 0) {
        const impact = -this.vel.y;
        this.vel.y = impact * CFG.restitution;
        if (this.vel.y < 0.45) this.vel.y = 0;
        if (impact > 5.5) this._impact(impact, 'ground');
      }
      const f = Math.max(0, 1 - CFG.groundFriction * CFG.fixedStep);
      this.vel.x *= f; this.vel.z *= f;
      const hs = Math.hypot(this.vel.x, this.vel.z);
      const wasLanded = this.landed;
      this.landed = hs < 0.5 && Math.abs(this.vel.y) < 0.5;
      if (this.landed) {
        this._qYaw.setFromAxisAngle(AXIS_Y, this.yaw);
        this.quat.slerp(this._qYaw, Math.min(1, 9 * CFG.fixedStep));
        this.omega.multiplyScalar(0.8);
        if (!wasLanded && this.armed) this.events.push({ t: 'land' });
      }
    } else if (this.pos.y > CFG.groundClear + 0.35) {
      this.landed = false;
    }
  }

  _resolveWorld(world) {
    const R = this.R;
    const colliders = world.colliders;
    for (let i = 0; i < colliders.length; i++) {
      const c = colliders[i];
      if (c.t === 'b') {
        // rotate into box local frame (Y rotation only)
        const dx = this.pos.x - c.x, dz = this.pos.z - c.z;
        const lx = dx * c.cos + dz * c.sin;
        const lz = -dx * c.sin + dz * c.cos;
        const ly = this.pos.y - c.y;
        const extx = c.hx + R, extz = c.hz + R, exty = c.hy + R;
        if (Math.abs(lx) < extx && Math.abs(lz) < extz && Math.abs(ly) < exty) {
          const px = extx - Math.abs(lx);
          const py = exty - Math.abs(ly);
          const pz = extz - Math.abs(lz);
          let nlx = 0, nly = 0, nlz = 0;
          if (px <= py && px <= pz) nlx = Math.sign(lx) || 1;
          else if (py <= px && py <= pz) nly = Math.sign(ly) || 1;
          else nlz = Math.sign(lz) || 1;
          // world normal
          const wnx = nlx * c.cos - nlz * c.sin;
          const wnz = nlx * c.sin + nlz * c.cos;
          const pen = Math.min(px, py, pz);
          this.pos.x += wnx * pen; this.pos.z += wnz * pen; this.pos.y += nly * pen;
          const vn = this.vel.x * wnx + this.vel.y * nly + this.vel.z * wnz;
          if (vn < 0) {
            this.vel.x -= (1 + CFG.restitution) * vn * wnx;
            this.vel.z -= (1 + CFG.restitution) * vn * wnz;
            this.vel.y -= (1 + CFG.restitution) * vn * nly;
            if (-vn > 6) this._impact(-vn, 'object');
          }
        }
      } else if (c.t === 'c') {
        const dx = this.pos.x - c.x, dz = this.pos.z - c.z;
        const d = Math.hypot(dx, dz);
        const rr = c.r + R;
        if (d < rr && this.pos.y > 0 && this.pos.y < c.top + R) {
          const nx = d > 1e-4 ? dx / d : 1, nz = d > 1e-4 ? dz / d : 0;
          const pen = rr - d;
          this.pos.x += nx * pen; this.pos.z += nz * pen;
          const vn = this.vel.x * nx + this.vel.z * nz;
          if (vn < 0) {
            this.vel.x -= (1 + CFG.restitution) * vn * nx;
            this.vel.z -= (1 + CFG.restitution) * vn * nz;
            if (-vn > 6) this._impact(-vn, 'object');
          }
        }
      }
    }

    // arena wall + ceiling
    const r = Math.hypot(this.pos.x, this.pos.z);
    if (r > CFG.arenaR) {
      const nx = this.pos.x / r, nz = this.pos.z / r;
      this.pos.x = nx * CFG.arenaR; this.pos.z = nz * CFG.arenaR;
      const vn = this.vel.x * nx + this.vel.z * nz;
      if (vn > 0) { this.vel.x -= vn * nx * 1.5; this.vel.z -= vn * nz * 1.5; }
    }
    if (this.pos.y > CFG.ceilY) { this.pos.y = CFG.ceilY; if (this.vel.y > 0) this.vel.y = 0; }
  }

  _impact(speed, kind) {
    this.damage = Math.min(1, this.damage + speed / 45);
    this.events.push({ t: 'impact', speed, kind });
    if (speed > 10 && !this.crashed) this.triggerCrash();
  }

  triggerCrash() {
    if (this.crashed) return;
    this.crashed = true;
    this.armed = false;
    this.crashTimer = 0;
    this.damage = Math.min(1, this.damage + 0.35);
    this.events.push({ t: 'crash' });
  }

  _crashPhysics(dt, world) {
    this.crashTimer += dt;
    this.collective = 0;
    this._up.set(0, 1, 0).applyQuaternion(this.quat);
    this.vel.y -= 9.81 * dt;
    this.pos.addScaledVector(this.vel, dt);
    if (this.pos.y < CFG.groundClear) {
      this.pos.y = CFG.groundClear;
      const f = Math.max(0, 1 - 6 * dt);
      this.vel.x *= f; this.vel.z *= f; this.vel.y = 0;
      // topple flat
      this._qYaw.setFromAxisAngle(AXIS_Y, this.yaw);
      this.quat.slerp(this._qYaw, Math.min(1, 4 * dt));
      this.omega.multiplyScalar(0.85);
    }
  }

  _updateRotors(dt, input) {
    const spin = this.armed && this.battery > 0;
    const coll = spin ? this.collective : 0;
    // per-motor differential (X frame) for visuals/audio from body rates
    const rollA = clamp(this.omega.x / 4, -1, 1);
    const pitchA = clamp(this.omega.z / 4, -1, 1);
    const yawA = clamp(this.omega.y / 3, -1, 1);
    const base = 0.12 + coll * 1.05;
    const tgt = [
      clamp(base + pitchA + rollA - yawA, 0, 1.18),
      clamp(base - pitchA + rollA + yawA, 0, 1.18),
      clamp(base - pitchA - rollA - yawA, 0, 1.18),
      clamp(base + pitchA - rollA + yawA, 0, 1.18)
    ];
    const rate = (tgt > coll) ? 12 : 6;
    for (let i = 0; i < 4; i++) {
      this.rotorNorm[i] += (tgt[i] - this.rotorNorm[i]) * Math.min(1, rate * dt);
    }
    this.rpmNorm = (this.rotorNorm[0] + this.rotorNorm[1] + this.rotorNorm[2] + this.rotorNorm[3]) / 4;
  }

  _updateBattery(dt) {
    if (!this.armed || this.crashed) return;
    const c = this.collective;
    const rate = (0.0007 + Math.pow(c, 1.7) * 0.0042) * this.drainMult;
    const before = this.battery;
    this.battery = Math.max(0, this.battery - rate * dt);
    const warn = (th) => { if (before > th && this.battery <= th) this.events.push({ t: 'battery', level: th }); };
    warn(0.25); warn(0.1);
    if (this.battery <= 0 && this.armed) this.arm(false);
  }

  forward(out) { return (out || new V()).set(0, 0, -1).applyQuaternion(this.quat); }
  right(out) { return (out || new V()).set(1, 0, 0).applyQuaternion(this.quat); }
  up(out) { return (out || new V()).set(0, 1, 0).applyQuaternion(this.quat); }

  telemetry() {
    this._fwd.set(0, 0, -1).applyQuaternion(this.quat);
    const heading = (Math.atan2(this._fwd.x, -this._fwd.z) * rad2deg + 360) % 360;
    this._euler.setFromQuaternion(this.quat, 'YXZ');
    return {
      speed: Math.hypot(this.vel.x, this.vel.z),
      altitude: this.pos.y,
      vspeed: this.vel.y,
      heading,
      pitchDeg: this._euler.x * rad2deg,
      rollDeg: this._euler.z * rad2deg,
      battery: this.battery * 100,
      throttle: this.throttle * 100,
      rpm: this.rpmNorm,
      gLoad: this.gLoad,
      damage: this.damage,
      armed: this.armed,
      crashed: this.crashed,
      landed: this.landed,
      mode: this.crashed ? 'CRASHED'
        : !this.armed ? 'DISARMED'
          : this.mode === 'acro' ? 'ACRO' : 'ANGLE'
    };
  }
}
