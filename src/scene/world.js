// Environment: sky, lighting, terrain, runway/helipad, buildings, trees,
// mission course gates, cargo/hover/beacon markers, day/night and colliders.

import * as THREE from 'three';
import { CFG, clamp, smoothstep } from '../core/config.js';
import {
  grassTextures, asphaltTextures, concreteTextures, metalTexture,
  facadeTexture, helipadTexture, runwayTexture
} from './textures.js';

const V = THREE.Vector3;
const UP = new V(0, 1, 0);

const DAY = {
  skyTop: 0x2f7ad6, skyBot: 0xcfe6f5, sun: 0xfff2d4, sunI: 3.1,
  hemiSky: 0x9cc4ea, hemiGnd: 0x4a5a3a, hemiI: 0.95,
  fog: 0xc4dbec, fogNear: 140, fogFar: 640, exposure: 1.06, star: 0
};
const NIGHT = {
  skyTop: 0x03060f, skyBot: 0x0b1424, sun: 0x9fb4ff, sunI: 0.55,
  hemiSky: 0x1a2942, hemiGnd: 0x080d12, hemiI: 0.32,
  fog: 0x080f1c, fogNear: 45, fogFar: 420, exposure: 0.9, star: 1
};

function rng(seed) { let s = seed >>> 0 || 1; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

export class World {
  constructor(scene) {
    this.scene = scene;
    this.night = false;
    this._nightMix = 0;
    this._t = 0;
    this.colliders = [];
    this._facadeMats = [];
    this._gateDefs = [];
    this._gateRings = [];
    this._nextGate = 0;
    this.gatesPassed = 0;
    this._markers = [];

    this._buildSky();
    this._buildLights();
    this._buildGround();
    this._buildPerimeter();
    this._buildRunway();
    this._scatter();
  }

  _buildSky() {
    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        topColor: { value: new THREE.Color(DAY.skyTop) },
        bottomColor: { value: new THREE.Color(DAY.skyBot) },
        offset: { value: 33 }, exponent: { value: 0.75 }
      },
      vertexShader: `varying vec3 vP; void main(){ vec4 wp=modelMatrix*vec4(position,1.0); vP=wp.xyz; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
      fragmentShader: `uniform vec3 topColor; uniform vec3 bottomColor; uniform float offset; uniform float exponent; varying vec3 vP;
        void main(){ float h=normalize(vP+vec3(0.0,offset,0.0)).y; float t=pow(max(h,0.0),exponent); gl_FragColor=vec4(mix(bottomColor,topColor,t),1.0);}`
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1000, 32, 16), this.skyMat);
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);

    // stars
    const n = 900; const pos = new Float32Array(n * 3); const r = rng(99);
    for (let i = 0; i < n; i++) {
      const a = r() * Math.PI * 2; const el = r() * Math.PI * 0.5; const rr = 820;
      pos[i * 3] = Math.cos(a) * Math.cos(el) * rr;
      pos[i * 3 + 1] = Math.sin(el) * rr + 40;
      pos[i * 3 + 2] = Math.sin(a) * Math.cos(el) * rr;
    }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.starMat = new THREE.PointsMaterial({ color: 0xdfe8ff, size: 1.6, transparent: true, opacity: 0, sizeAttenuation: true, depthWrite: false });
    this.stars = new THREE.Points(sg, this.starMat);
    this.stars.frustumCulled = false;
    this.scene.add(this.stars);

    this.scene.fog = new THREE.Fog(DAY.fog, DAY.fogNear, DAY.fogFar);
  }

  _buildLights() {
    this.hemi = new THREE.HemisphereLight(DAY.hemiSky, DAY.hemiGnd, DAY.hemiI);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(DAY.sun, DAY.sunI);
    this.sun.position.set(120, 180, 60);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const s = 26; Object.assign(this.sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 1, far: 520 });
    this.sun.shadow.bias = -0.0005;
    this._sunTarget = new THREE.Object3D(); this.scene.add(this._sunTarget);
    this.sun.target = this._sunTarget; this.scene.add(this.sun);
    this._sunBase = new THREE.Vector3(120, 180, 60);
  }

  _buildGround() {
    this.grass = grassTextures(7);
    this.ground = new THREE.Mesh(
      new THREE.PlaneGeometry(1600, 1600),
      new THREE.MeshStandardMaterial({ map: this.grass.map, normalMap: this.grass.normalMap, roughness: 1, metalness: 0 })
    );
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);

    this.hemiTex = helipadTexture();
    const pad = new THREE.Mesh(new THREE.CircleGeometry(4.2, 48),
      new THREE.MeshStandardMaterial({ map: this.hemiTex, roughness: 0.9, metalness: 0 }));
    pad.rotation.x = -Math.PI / 2; pad.position.y = 0.04; pad.receiveShadow = true;
    this.scene.add(pad);
    this.padPos = new V(0, 0, 6);
    pad.position.x = this.padPos.x; pad.position.z = this.padPos.z;
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2 + Math.PI / 4;
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 8),
        new THREE.MeshStandardMaterial({ color: 0x9fffb0, emissive: 0x44ff88, emissiveIntensity: 1.6, toneMapped: false }));
      lamp.position.set(Math.cos(a) * 3.6 + this.padPos.x, 0.13, Math.sin(a) * 3.6 + this.padPos.z);
      this.scene.add(lamp);
    }
  }

  _buildRunway() {
    const rt = runwayTexture(12);
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(11, 120), new THREE.MeshStandardMaterial({ map: rt, roughness: 0.95, metalness: 0 }));
    strip.rotation.x = -Math.PI / 2; strip.position.set(-30, 0.03, 0); strip.receiveShadow = true;
    this.scene.add(strip);
  }

  _buildPerimeter() {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(CFG.arenaR, 0.14, 8, 128),
      new THREE.MeshStandardMaterial({ color: 0xf2b705, emissive: 0xf2b705, emissiveIntensity: 0.5 }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.06; this.scene.add(ring);
    // perimeter light poles every 24 degrees
    const poleGeo = new THREE.CylinderGeometry(0.12, 0.16, 7, 6);
    const poleMat = new THREE.MeshStandardMaterial({ map: metalTexture(88, '#33383f'), roughness: 0.5, metalness: 0.7 });
    const bulbMatDay = new THREE.MeshStandardMaterial({ color: 0x111418, emissive: 0xfff0b0, emissiveIntensity: 0, toneMapped: false });
    this._perimBulbs = [];
    for (let i = 0; i < 15; i++) {
      const a = (i / 15) * Math.PI * 2;
      const pole = new THREE.Mesh(poleGeo, poleMat);
      pole.position.set(Math.cos(a) * CFG.arenaR, 3.5, Math.sin(a) * CFG.arenaR);
      pole.castShadow = true; this.scene.add(pole);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 8), bulbMatDay.clone());
      bulb.position.set(Math.cos(a) * CFG.arenaR, 7, Math.sin(a) * CFG.arenaR);
      this.scene.add(bulb); this._perimBulbs.push(bulb.material);
    }
    this._perimBulbBase = 0;
  }

  _scatter() {
    const concrete = concreteTextures(33);
    const n = rng(1337);

    // buildings outside the arena (visual skyline) + a few canyons inside
    const bpos = [];
    for (let i = 0; i < 30; i++) {
      const a = n() * Math.PI * 2;
      const dist = CFG.arenaR + 42 + n() * 180;
      bpos.push({ a, dist, inside: false });
    }
    for (let i = 0; i < 7; i++) {
      const a = n() * Math.PI * 2;
      const dist = 120 + n() * 70;
      bpos.push({ a, dist, inside: true });
    }
    for (const bp of bpos) {
      const w = 10 + n() * 14, h = 16 + n() * (bp.inside ? 40 : 60), d = 10 + n() * 14;
      const palette = (n() * 5) | 0;
      const cols = Math.max(4, Math.round(w / 2.4)), rows = Math.max(6, Math.round(h / 3.2));
      const fac = facadeTexture(palette, (n() * 1e6) | 0, cols, rows);
      const mat = new THREE.MeshStandardMaterial({ map: fac.map, emissiveMap: fac.emissiveMap, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.82, metalness: 0.12 });
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      const x = Math.cos(bp.a) * bp.dist, z = Math.sin(bp.a) * bp.dist;
      b.position.set(x, h / 2, z);
      const ry = n() * Math.PI * 2; b.rotation.y = ry;
      b.castShadow = true; b.receiveShadow = true;
      this.scene.add(b);
      this._facadeMats.push(mat);
      const c = Math.cos(ry), si = Math.sin(ry);
      this.colliders.push({ t: 'b', x, y: h / 2, z, hx: w / 2, hy: h / 2, hz: d / 2, cos: c, sin: si });
    }

    // trees + rocks inside arena
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3524, roughness: 1 });
    const foliageMat = new THREE.MeshStandardMaterial({ color: 0x2e5d2f, roughness: 1 });
    const foliageMat2 = new THREE.MeshStandardMaterial({ color: 0x3c6b32, roughness: 1 });
    const trunkGeo = new THREE.CylinderGeometry(0.16, 0.24, 1.8, 6);
    const coneGeo = new THREE.ConeGeometry(1.3, 3, 7);
    const blobGeo = new THREE.IcosahedronGeometry(1.3, 0);
    const rockGeo = new THREE.DodecahedronGeometry(0.9, 0);
    const rockMat = new THREE.MeshStandardMaterial({ map: concrete.map, color: 0x9a9a9a, roughness: 1, metalness: 0 });
    for (let i = 0; i < 90; i++) {
      const a = n() * Math.PI * 2;
      const dist = 14 + n() * (CFG.arenaR - 24);
      const x = Math.cos(a) * dist, z = Math.sin(a) * dist;
      if (Math.hypot(x - this.padPos.x, z - this.padPos.z) < 9) continue;
      if (Math.abs(x + 30) < 8) continue;
      const s = 0.7 + n() * 1.3;
      if (n() < 0.75) {
        const g = new THREE.Group();
        const trunk = new THREE.Mesh(trunkGeo, trunkMat); trunk.position.y = 0.9; trunk.castShadow = true; g.add(trunk);
        const leaf = new THREE.Mesh(n() < 0.5 ? coneGeo : blobGeo, n() < 0.5 ? foliageMat : foliageMat2);
        leaf.position.y = 3.1; leaf.castShadow = true; g.add(leaf);
        g.scale.setScalar(s); g.position.set(x, 0, z); g.rotation.y = n() * 6.28;
        this.scene.add(g);
        this.colliders.push({ t: 'c', x, z, r: 0.25 * s, top: 2.2 * s });
      } else {
        const rock = new THREE.Mesh(rockGeo, rockMat);
        rock.scale.set(s, s * 0.7, s); rock.position.set(x, 0.3 * s, z); rock.rotation.set(n(), n(), n());
        rock.castShadow = true; rock.receiveShadow = true; this.scene.add(rock);
      }
    }
  }

  // ---- course / gates ----
  buildCourse(gates) {
    this.clearCourse();
    const torusGeoCache = {};
    for (let i = 0; i < gates.length; i++) {
      const g = gates[i];
      const radius = g.radius || 3.4;
      if (!torusGeoCache[radius]) torusGeoCache[radius] = new THREE.TorusGeometry(radius, 0.18, 12, 44);
      const mat = new THREE.MeshStandardMaterial({ color: 0xff7a1a, emissive: 0xff6a00, emissiveIntensity: 0.2, roughness: 0.5, metalness: 0.4 });
      const ring = new THREE.Mesh(torusGeoCache[radius], mat);
      ring.castShadow = true;
      const grp = new THREE.Group(); grp.add(ring);
      // glow disc
      const disc = new THREE.Mesh(new THREE.CircleGeometry(radius, 32),
        new THREE.MeshBasicMaterial({ color: 0xffa64d, transparent: true, opacity: 0.05, side: THREE.DoubleSide, depthWrite: false }));
      grp.add(disc);
      const normal = new V(g.normal ? g.normal[0] : 0, g.normal ? g.normal[1] : 0, g.normal ? g.normal[2] : 1).normalize();
      grp.quaternion.setFromUnitVectors(new V(0, 0, 1), normal);
      grp.position.set(g.pos[0], g.pos[1], g.pos[2]);
      this.scene.add(grp);
      this._gateRings.push(grp);
      this._gateDefs.push({
        pos: new V(g.pos[0], g.pos[1], g.pos[2]), normal, radius,
        passed: false, index: i, ring, mat, disc, label: g.label || ''
      });
    }
    this._nextGate = 0; this.gatesPassed = 0;
    this._refreshGateLook();
  }

  clearCourse() {
    for (const r of this._gateRings) this.scene.remove(r);
    this._gateRings = []; this._gateDefs = []; this.gatesPassed = 0; this._nextGate = 0;
  }

  resetCourse() {
    for (const d of this._gateDefs) d.passed = false;
    this.gatesPassed = 0; this._nextGate = 0; this._refreshGateLook();
  }

  get gateCount() { return this._gateDefs.length; }
  nextGate() { return this._gateDefs[this._nextIndexSafe()] || null; }
  _nextIndexSafe() { return Math.min(this._nextGate, this._gateDefs.length - 1); }

  // ordered gate crossing: returns true when the required next gate is passed
  checkGate(prevPos, pos) {
    const def = this._gateDefs[this._nextGate];
    if (!def) return false;
    if (this._cross(def, prevPos, pos)) {
      def.passed = true; this.gatesPassed++; this._nextGate++;
      this._refreshGateLook();
      return { gate: def, index: def.index };
    }
    return false;
  }

  // unordered: returns first unpassed gate crossed this step (for slalom)
  checkAnyGate(prevPos, pos) {
    for (const def of this._gateDefs) {
      if (def.passed) continue;
      if (this._cross(def, prevPos, pos)) { def.passed = true; this.gatesPassed++; this._refreshGateLook(); return { gate: def, index: def.index }; }
    }
    return false;
  }

  _cross(def, prevPos, pos) {
    const toP = new V().subVectors(prevPos, def.pos).dot(def.normal);
    const toC = new V().subVectors(pos, def.pos).dot(def.normal);
    if ((toP < 0 && toC >= 0) || (toP > 0 && toC <= 0)) {
      const t = toP / (toP - toC || 1e-6);
      const hit = new V().lerpVectors(prevPos, pos, clamp(t, 0, 1));
      return hit.distanceTo(def.pos) < def.radius;
    }
    return false;
  }

  _refreshGateLook() {
    for (const d of this._gateDefs) {
      const isNext = d.index === this._nextGate && !d.passed;
      d.mat.color.setHex(d.passed ? 0x2f6b3a : isNext ? 0xff8a2a : 0x9a4d12);
      d.disc.material.color.setHex(d.passed ? 0x37d67a : 0xffa64d);
      d.userDataNext = isNext;
    }
  }

  // ---- markers (cargo / hover / beacon) ----
  clearMarkers() {
    for (const m of this._markers) this.scene.remove(m.group);
    this._markers = [];
  }

  addMarker(type, pos, r = 2.4) {
    const p = new V(pos[0], pos[1], pos[2]);
    const g = new THREE.Group();
    const col = type === 'pickup' ? 0x34e2ff : type === 'drop' ? 0xffc21f : type === 'hover' ? 0x7c5cff : 0xff4d6d;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.09, 10, 40),
      new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 1.4, toneMapped: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.12; g.add(ring);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.86, r * 0.86, 60, 20, 1, true),
      new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.09, side: THREE.DoubleSide, depthWrite: false }));
    beam.position.y = 30; g.add(beam);
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(r * 0.32, 0),
      new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 1.8, toneMapped: false }));
    core.position.y = 1.2; g.add(core);
    g.position.copy(p);
    this.scene.add(g);
    const m = { type, group: g, ring, beam, core, pos: p, r, active: true };
    this._markers.push(m);
    return m;
  }

  insideMarker(m, pos, vertical = true) {
    if (!m || !m.active) return false;
    const d = Math.hypot(pos.x - m.pos.x, pos.z - m.pos.z);
    if (d > m.r) return false;
    if (vertical) return pos.y > m.pos.y - 1 && pos.y < m.pos.y + 14;
    return true;
  }

  // ---- day/night + per-frame ----
  setNight(v) { this.night = !!v; }

  update(dt, dronePos) {
    this._t += dt;
    const target = this.night ? 1 : 0;
    this._nightMix += (target - this._nightMix) * Math.min(1, dt * 2.2);
    const m = this._nightMix;
    const lerpC = (a, b) => new THREE.Color(a).lerp(new THREE.Color(b), m);

    this.skyMat.uniforms.topColor.value.copy(lerpC(DAY.skyTop, NIGHT.skyTop));
    this.skyMat.uniforms.bottomColor.value.copy(lerpC(DAY.skyBot, NIGHT.skyBot));
    this.sun.color.copy(lerpC(DAY.sun, NIGHT.sun));
    this.sun.intensity = DAY.sunI + (NIGHT.sunI - DAY.sunI) * m;
    this.hemi.color.copy(lerpC(DAY.hemiSky, NIGHT.hemiSky));
    this.hemi.groundColor.copy(lerpC(DAY.hemiGnd, NIGHT.hemiGnd));
    this.hemi.intensity = DAY.hemiI + (NIGHT.hemiI - DAY.hemiI) * m;
    this.scene.fog.color.copy(lerpC(DAY.fog, NIGHT.fog));
    this.scene.fog.near = DAY.fogNear + (NIGHT.fogNear - DAY.fogNear) * m;
    this.scene.fog.far = DAY.fogFar + (NIGHT.fogFar - DAY.fogFar) * m;
    this.starMat.opacity = m;

    const winI = smoothstep(0.35, 0.8, m) * 1.1;
    for (const fm of this._facadeMats) fm.emissiveIntensity = winI;
    for (const bm of this._perimBulbs) bm.emissiveIntensity = winI * 1.4;

    // shadow box follows drone
    this._sunTarget.position.copy(dronePos);
    this.sun.position.set(dronePos.x + this._sunBase.x, this._sunBase.y, dronePos.z + this._sunBase.z);
    this.sky.position.set(dronePos.x, 0, dronePos.z);
    this.stars.position.set(dronePos.x, 0, dronePos.z);

    // gate next-pulse
    const pulse = 1.2 + Math.sin(this._t * 5) * 0.6;
    for (const d of this._gateDefs) {
      const want = d.passed ? 0.08 : d.userDataNext ? pulse : 0.35;
      d.mat.emissiveIntensity += (want - d.mat.emissiveIntensity) * Math.min(1, dt * 8);
      if (d.userDataNext) { const sc = 1 + Math.sin(this._t * 5) * 0.03; d.ring.scale.setScalar(sc); }
      else d.ring.scale.setScalar(1);
      d.disc.material.opacity = d.passed ? 0.02 : d.userDataNext ? 0.08 + Math.sin(this._t * 5) * 0.05 : 0.03;
    }

    // markers animation
    for (const mk of this._markers) {
      mk.ring.rotation.z += dt * 0.6;
      mk.core.rotation.y += dt * 1.2; mk.core.rotation.x += dt * 0.7;
      mk.core.position.y = 1.2 + Math.sin(this._t * 2 + mk.pos.x) * 0.25;
      const glowP = 1.2 + Math.sin(this._t * 4) * 0.5;
      mk.ring.material.emissiveIntensity = mk.active ? glowP : 0.2;
      mk.beam.material.opacity = mk.active ? 0.09 + Math.sin(this._t * 3) * 0.03 : 0.02;
    }
  }
}
