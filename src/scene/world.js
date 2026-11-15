// Environment: sky, lighting, terrain, runway/helipad, buildings, trees,
// mission course gates, cargo/hover/beacon markers, day/night and colliders.

import * as THREE from 'three';
import { CFG, clamp, lerp, smoothstep, deg2rad } from '../core/config.js';
import {
  grassTextures, asphaltTextures, concreteTextures, metalTexture,
  facadeTexture, helipadTexture, runwayTexture, waterNormalTexture
} from './textures.js';

const V = THREE.Vector3;
const UP = new V(0, 1, 0);

const DAY = {
  skyTop: 0x2f7ad6, skyBot: 0xcfe6f5, sun: 0xfff2d4, sunI: 3.1,
  hemiSky: 0x9cc4ea, hemiGnd: 0x4a5a3a, hemiI: 0.95,
  fog: 0xc4dbec, exposure: 1.15, star: 0
};
const NIGHT = {
  skyTop: 0x03060f, skyBot: 0x0b1424, sun: 0x9fb4ff, sunI: 0.55,
  hemiSky: 0x1a2942, hemiGnd: 0x080d12, hemiI: 0.32,
  fog: 0x080f1c, exposure: 0.9, star: 1
};
// pre-built linear Colors so the frame lerp never allocates
for (const d of [DAY, NIGHT]) {
  for (const k of ['skyTop', 'skyBot', 'sun', 'hemiSky', 'hemiGnd', 'fog']) d[k + 'C'] = new THREE.Color(d[k]);
}
DAY.sunDiscC = new THREE.Color(2.6, 1.95, 1.3);   // HDR sun disc -> blooms
NIGHT.sunDiscC = new THREE.Color(0.85, 0.95, 1.35); // pale moon
DAY.waterMirrorC = new THREE.Color(0x8fa6b8);
NIGHT.waterMirrorC = new THREE.Color(0x2a3548);
DAY.waterC = new THREE.Color(0x14555e);
NIGHT.waterC = new THREE.Color(0x0a2531);

function rng(seed) { let s = seed >>> 0 || 1; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

// Sky gradient + HDR sun disc + warm horizon glow. Shared with env.js PMREM
// baking so reflections and the visible sky always agree.
export function createSkyMaterial() {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      topColor: { value: new THREE.Color(DAY.skyTop) },
      bottomColor: { value: new THREE.Color(DAY.skyBot) },
      offset: { value: 33 }, exponent: { value: 0.75 },
      sunDir: { value: new THREE.Vector3(120, 180, 60).normalize() },
      sunCol: { value: new THREE.Color().copy(DAY.sunDiscC) },
      night: { value: 0 }
    },
    vertexShader: `varying vec3 vP; void main(){ vec4 wp=modelMatrix*vec4(position,1.0); vP=wp.xyz; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader: `uniform vec3 topColor; uniform vec3 bottomColor; uniform float offset; uniform float exponent; uniform vec3 sunDir; uniform vec3 sunCol; uniform float night; varying vec3 vP;
      void main(){ vec3 dir=normalize(vP+vec3(0.0,offset,0.0)); float t=pow(max(dir.y,0.0),exponent);
        float sd=max(dot(dir,sunDir),0.0);
        float disc=smoothstep(mix(0.9982,0.99945,night),mix(0.9988,0.99975,night),sd);
        float halo=pow(sd,220.0)*0.8+pow(sd,7.0)*0.08;
        float glow=pow(max(dot(normalize(dir.xz+vec2(1e-4)),normalize(sunDir.xz+vec2(1e-4))),0.0),4.0)*pow(1.0-abs(dir.y),5.0);
        vec3 col=mix(bottomColor,topColor,t)+sunCol*(disc+halo)*(1.0-night*0.35)+vec3(1.0,0.52,0.22)*glow*0.38*(1.0-night);
        gl_FragColor=vec4(col,1.0);}`
  });
}

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
    this._roofSpots = [];
    this._wind = null;
    this._windT = 0;
    this._flags = [];
    this._tier = null;
    this._fogDensity = 0.0035;
    this._water = null;
    this.onNightChanged = null;
    this.onGatePass = null; // v0.9.0: set by main -> gate flash/blip/HUD feedback

    this._buildSky();
    this._buildLights();
    this._buildGround();
    this._buildPerimeter();
    this._buildRunway();
    this._scatter();
    this._buildWindDressing();
  }

  setWindField(windField) { this._wind = windField || null; }

  get exposure() { return DAY.exposure + (NIGHT.exposure - DAY.exposure) * this._nightMix; }

  _buildSky() {
    this.skyMat = createSkyMaterial();
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

    this.scene.fog = new THREE.FogExp2(DAY.fog, this._fogDensity);
  }

  _buildLights() {
    this.hemi = new THREE.HemisphereLight(DAY.hemiSky, DAY.hemiGnd, DAY.hemiI);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(DAY.sun, DAY.sunI);
    this.sun.position.set(120, 180, 60);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const s = 22; Object.assign(this.sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 1, far: 520 });
    this.sun.shadow.bias = -0.0005;
    this._sunTarget = new THREE.Object3D(); this.scene.add(this._sunTarget);
    this.sun.target = this._sunTarget; this.scene.add(this.sun);
    this._sunBase = new THREE.Vector3(120, 180, 60);
    // orthonormal basis of the (fixed-orientation) shadow light for texel snapping
    const mtx = new THREE.Matrix4().lookAt(this._sunBase, new THREE.Vector3(0, 0, 0), UP);
    this._slRight = new THREE.Vector3().setFromMatrixColumn(mtx, 0);
    this._slUp = new THREE.Vector3().setFromMatrixColumn(mtx, 1);
    this._slAxis = this._sunBase.clone().normalize();
    this._shadowHalf = s;
    this._texel = (2 * s) / 2048;
    this._su = null; this._sv = null;
    this._shadowOn = true;
  }

  _buildGround() {
    this.grass = grassTextures(7);
    this.ground = new THREE.Mesh(
      new THREE.PlaneGeometry(1600, 1600),
      new THREE.MeshStandardMaterial({ map: this.grass.map, normalMap: this.grass.normalMap, roughness: 1, metalness: 0, envMapIntensity: 0.35 })
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
    const poleMat = new THREE.MeshStandardMaterial({ map: metalTexture(88, '#33383f'), roughness: 0.5, metalness: 0.7, envMapIntensity: 0.9 });
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
      const mat = new THREE.MeshStandardMaterial({ map: fac.map, emissiveMap: fac.emissiveMap, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.82, metalness: 0.12, envMapIntensity: 0.45 });
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      const x = Math.cos(bp.a) * bp.dist, z = Math.sin(bp.a) * bp.dist;
      b.position.set(x, h / 2, z);
      const ry = n() * Math.PI * 2; b.rotation.y = ry;
      b.castShadow = true; b.receiveShadow = true;
      this.scene.add(b);
      this._facadeMats.push(mat);
      const c = Math.cos(ry), si = Math.sin(ry);
      this.colliders.push({ t: 'b', x, y: h / 2, z, hx: w / 2, hy: h / 2, hz: d / 2, cos: c, sin: si });
      if (bp.inside) this._roofSpots.push({ x, z, h });
    }

    this._pickPondPos();

    // trees + rocks inside arena
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3524, roughness: 1, envMapIntensity: 0.3 });
    const foliageMat = new THREE.MeshStandardMaterial({ color: 0x2e5d2f, roughness: 1, envMapIntensity: 0.3 });
    const foliageMat2 = new THREE.MeshStandardMaterial({ color: 0x3c6b32, roughness: 1, envMapIntensity: 0.3 });
    const trunkGeo = new THREE.CylinderGeometry(0.16, 0.24, 1.8, 6);
    const coneGeo = new THREE.ConeGeometry(1.3, 3, 7);
    const blobGeo = new THREE.IcosahedronGeometry(1.3, 0);
    const rockGeo = new THREE.DodecahedronGeometry(0.9, 0);
    const rockMat = new THREE.MeshStandardMaterial({ map: concrete.map, color: 0x9a9a9a, roughness: 1, metalness: 0, envMapIntensity: 0.3 });
    for (let i = 0; i < 90; i++) {
      const a = n() * Math.PI * 2;
      const dist = 14 + n() * (CFG.arenaR - 24);
      const x = Math.cos(a) * dist, z = Math.sin(a) * dist;
      if (Math.hypot(x - this.padPos.x, z - this.padPos.z) < 9) continue;
      if (Math.abs(x + 30) < 8) continue;
      if (Math.hypot(x - this.pondPos.x, z - this.pondPos.z) < 32) continue; // keep the pond clear
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

  // ---- wind-reactive dressing: windsock, roof flags, dust motes ----
  _buildWindDressing() {
    const metalPole = new THREE.MeshStandardMaterial({ color: 0xc4ccd6, roughness: 0.45, metalness: 0.7, envMapIntensity: 1.0 });
    const n = rng(2027);

    // windsock ~6 m beside the pad
    const sx = this.padPos.x + 5, sz = this.padPos.z - 4;
    const poleH = 5;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, poleH, 8), metalPole);
    pole.position.set(sx, poleH / 2, sz); pole.castShadow = true; this.scene.add(pole);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 8), metalPole);
    cap.position.set(sx, poleH, sz); this.scene.add(cap);

    const pivot = new THREE.Group(); pivot.position.set(sx, poleH - 0.08, sz); this.scene.add(pivot);
    const tilt = new THREE.Group(); pivot.add(tilt);
    const bands = [[0.40, 0.30, 0.0, 0.7, 0xff5320], [0.30, 0.20, 0.7, 1.5, 0xff8a3a], [0.20, 0.09, 1.5, 2.2, 0xff3b1a]];
    for (const [r0, r1, x0, x1, col] of bands) {
      const geo = new THREE.CylinderGeometry(r1, r0, x1 - x0, 12, 1, true);
      geo.rotateZ(-Math.PI / 2);
      const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: col, side: THREE.DoubleSide, roughness: 0.85, metalness: 0, flatShading: true }));
      mesh.position.x = (x0 + x1) / 2; mesh.castShadow = true; tilt.add(mesh);
    }
    this._sockPivot = pivot;
    this._sockTilt = tilt;

    // two flag banners on rooftops near the arena centre
    const spots = this._roofSpots;
    if (spots.length) {
      const chosen = [spots[0]];
      const alt = spots.find((s) => Math.hypot(s.x - spots[0].x, s.z - spots[0].z) > 45) || spots[1];
      if (alt && alt !== spots[0]) chosen.push(alt);
      for (const sp of chosen) this._buildFlag(sp, metalPole, n);
    }

    // dust motes in a 60 m box that follows the camera
    const count = 500;
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      arr[i * 3] = (n() * 2 - 1) * 30;
      arr[i * 3 + 1] = n() * 30;
      arr[i * 3 + 2] = (n() * 2 - 1) * 30;
    }
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    const dcv = document.createElement('canvas'); dcv.width = dcv.height = 32;
    const dctx = dcv.getContext('2d');
    const grad = dctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.4, 'rgba(255,255,255,0.5)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    dctx.fillStyle = grad; dctx.fillRect(0, 0, 32, 32);
    const dm = new THREE.PointsMaterial({
      color: 0xffe6c8, size: 0.14, transparent: true, opacity: 0.22,
      depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
      map: new THREE.CanvasTexture(dcv)
    });
    const pts = new THREE.Points(dg, dm); pts.frustumCulled = false; this.scene.add(pts);
    this._dust = pts; this._dustArr = arr; this._dustCount = count; this._dustMat = dm;
  }

  _buildFlag(sp, poleMat, n) {
    const group = new THREE.Group(); group.position.set(sp.x, sp.h, sp.z);
    const poleH = 2.7;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, poleH, 6), poleMat);
    pole.position.y = poleH / 2; pole.castShadow = true; group.add(pole);
    const banner = new THREE.Group(); banner.position.y = poleH - 0.2; group.add(banner);
    const W = 2.4, H = 1.3;
    const geo = new THREE.PlaneGeometry(W, H, 16, 12);
    geo.translate(W / 2, 0, 0);
    const mat = new THREE.MeshStandardMaterial({ color: 0xff7a2a, side: THREE.DoubleSide, roughness: 0.9, metalness: 0 });
    const mesh = new THREE.Mesh(geo, mat); mesh.castShadow = true; banner.add(mesh);
    this.scene.add(group);
    this._flags.push({ banner, geo, base: Float32Array.from(geo.attributes.position.array), phase: n() * 6.28, w: W });
  }

  _updateWindDressing(dt, dronePos, camPos) {
    this._windT += dt;
    const t = this._windT;
    const wf = this._wind;
    const bSpeed = wf ? wf.baseSpeed : 0;
    const headingRad = (wf ? wf.headingDeg : 0) * deg2rad;
    const dirX = wf ? wf.baseVel.x : 0;
    const dirZ = wf ? wf.baseVel.z : 0;
    const wf01 = clamp(bSpeed / 6, 0, 1);
    const yaw = Math.PI / 2 - headingRad;

    if (this._sockPivot) {
      this._sockPivot.rotation.y = yaw;
      const droop = lerp(deg2rad * 70, deg2rad * 5, wf01);
      const flut = Math.sin(t * 9) * 0.12 * wf01 + Math.sin(t * 3.3) * 0.05 * wf01;
      this._sockTilt.rotation.z = -droop + flut;
      this._sockTilt.rotation.x = Math.sin(t * 7 + 1) * 0.1 * wf01;
    }

    for (const fl of this._flags) {
      fl.banner.rotation.y = yaw;
      const pos = fl.geo.attributes.position;
      const a = pos.array, base = fl.base;
      const amp = 0.05 + 0.18 * wf01;
      const k = 3, f = 3 + 5 * wf01;
      for (let i = 0; i < a.length; i += 3) {
        const x = base[i], y = base[i + 1];
        a[i + 2] = Math.sin(x * k + t * f + fl.phase) * amp * (x / fl.w) * (1 - (Math.abs(y) / (1.3 * 0.5)) * 0.3);
      }
      pos.needsUpdate = true;
    }

    if (this._dust) {
      const arr = this._dustArr, c = this._dustCount;
      for (let i = 0; i < c; i++) {
        const ix = i * 3;
        arr[ix] += dirX * dt;
        arr[ix + 1] += Math.sin(t * 1.3 + i) * 0.04 * dt;
        arr[ix + 2] += dirZ * dt;
        if (arr[ix] > 30) arr[ix] -= 60; else if (arr[ix] < -30) arr[ix] += 60;
        if (arr[ix + 2] > 30) arr[ix + 2] -= 60; else if (arr[ix + 2] < -30) arr[ix + 2] += 60;
        if (arr[ix + 1] > 30) arr[ix + 1] -= 30; else if (arr[ix + 1] < 0) arr[ix + 1] += 30;
      }
      this._dust.geometry.attributes.position.needsUpdate = true;
      const anchor = camPos || dronePos;
      if (anchor) this._dust.position.set(anchor.x, 0, anchor.z);
      this._dustMat.opacity = lerp(0.22, 0.09, this._nightMix);
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
      const mat = new THREE.MeshStandardMaterial({ color: 0xff7a1a, emissive: 0xff6a00, emissiveIntensity: 0.2, roughness: 0.5, metalness: 0.4, envMapIntensity: 0.9 });
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
        passed: false, index: i, ring, mat, disc, label: g.label || '', flash: 0
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
    for (const d of this._gateDefs) { d.passed = false; d.flash = 0; }
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
      def.passed = true; def.flash = 1; this.gatesPassed++; this._nextGate++;
      this._refreshGateLook();
      if (this.onGatePass) this.onGatePass(def);
      return { gate: def, index: def.index };
    }
    return false;
  }

  // unordered: returns first unpassed gate crossed this step (for slalom)
  checkAnyGate(prevPos, pos) {
    for (const def of this._gateDefs) {
      if (def.passed) continue;
      if (this._cross(def, prevPos, pos)) { def.passed = true; def.flash = 1; this.gatesPassed++; this._refreshGateLook(); if (this.onGatePass) this.onGatePass(def); return { gate: def, index: def.index }; }
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

  // ---- reflecting pond (Reflector class injected by main, lazy addon) ----
  installWater(Reflector) {
    if (this._water || !Reflector) return;
    const p = this.pondPos;
    const shore = new THREE.Mesh(new THREE.CircleGeometry(29.6, 64),
      new THREE.MeshStandardMaterial({ color: 0x5c5342, roughness: 1, metalness: 0 }));
    shore.rotation.x = -Math.PI / 2; shore.position.set(p.x, 0.015, p.z); shore.receiveShadow = true;
    const mirror = new Reflector(new THREE.CircleGeometry(28, 72),
      { clipBias: 0.004, textureWidth: 512, textureHeight: 512, color: 0x8fa6b8 });
    mirror.rotation.x = -Math.PI / 2; mirror.position.set(p.x, 0.02, p.z);
    const rip = waterNormalTexture();
    const overlay = new THREE.Mesh(new THREE.CircleGeometry(28.06, 72),
      new THREE.MeshStandardMaterial({
        color: 0x14555e, transparent: true, opacity: 0.35, roughness: 0.16, metalness: 0.3,
        normalMap: rip, normalScale: new THREE.Vector2(0.9, 0.9), depthWrite: false, envMapIntensity: 0.9
      }));
    overlay.rotation.x = -Math.PI / 2; overlay.position.set(p.x, 0.055, p.z);
    this.scene.add(shore, mirror, overlay);
    this._water = { shore, mirror, overlay, rip };
    if (this._tier) this._setWaterVisible(!!this._tier.reflector);
  }

  _setWaterVisible(on) {
    const w = this._water;
    w.mirror.visible = on; w.overlay.visible = on; w.shore.visible = on;
  }

  // Maximize clearance to buildings/runway/pad; pond edge sits outside the
  // gate circuits (<= ~73 m) and inside the perimeter (220 m).
  _pickPondPos() {
    let best = { x: 108, z: 0 }, bestClear = -Infinity;
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2 + 0.13;
      const x = Math.cos(a) * 108, z = Math.sin(a) * 108;
      let clear = Math.hypot(x - this.padPos.x, z - this.padPos.z) - 28;
      const rx = clamp(x, -35.5, -24.5), rz = clamp(z, -60, 60);
      clear = Math.min(clear, Math.hypot(x - rx, z - rz) - 28);
      for (const c of this.colliders) {
        if (c.t !== 'b') continue;
        clear = Math.min(clear, Math.hypot(x - c.x, z - c.z) - Math.hypot(c.hx, c.hz) - 28);
      }
      if (clear > bestClear) { bestClear = clear; best = { x, z }; }
    }
    this.pondPos = new V(best.x, 0, best.z);
  }

  // ---- quality tier (fog density, water visibility, shadow map size) ----
  applyTier(cfg, userShadows = true) {
    this._tier = cfg;
    this._fogDensity = cfg.fogDensity;
    if (this._water) this._setWaterVisible(!!cfg.reflector);
    const on = cfg.shadows && userShadows !== false;
    const size = cfg.mapSize;
    const resized = this.sun.shadow.mapSize.x !== size;
    if (resized) this.sun.shadow.mapSize.set(size, size);
    // three rebuilds the shadow map only after dispose + null
    if (this.sun.shadow.map && (!on || resized)) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    this._shadowOn = on;
    this._texel = (2 * this._shadowHalf) / size;
    this._su = null; this._sv = null;
  }

  // Sun shadow box follows the drone with the center snapped to the shadow
  // texel grid (light-space right/up) so contact shadows don't crawl.
  _updateShadowFollow(pos) {
    if (!this._shadowOn) return;
    const u = pos.dot(this._slRight), v = pos.dot(this._slUp), w = pos.dot(this._slAxis);
    const su = Math.floor(u / this._texel) * this._texel + this._texel * 0.5;
    const sv = Math.floor(v / this._texel) * this._texel + this._texel * 0.5;
    if (su === this._su && sv === this._sv) return;
    this._su = su; this._sv = sv;
    this._sunTarget.position.set(0, 0, 0)
      .addScaledVector(this._slRight, su)
      .addScaledVector(this._slUp, sv)
      .addScaledVector(this._slAxis, w);
    this.sun.position.copy(this._sunTarget.position).add(this._sunBase);
  }

  // ---- day/night + per-frame ----
  setNight(v) {
    const on = !!v;
    if (on === this.night) return;
    this.night = on;
    if (this.onNightChanged) this.onNightChanged();
  }

  update(dt, dronePos, camPos) {
    this._t += dt;
    const target = this.night ? 1 : 0;
    this._nightMix += (target - this._nightMix) * Math.min(1, dt * 2.2);
    const m = this._nightMix;

    const skyU = this.skyMat.uniforms;
    skyU.topColor.value.copy(DAY.skyTopC).lerp(NIGHT.skyTopC, m);
    skyU.bottomColor.value.copy(DAY.skyBotC).lerp(NIGHT.skyBotC, m);
    skyU.sunCol.value.copy(DAY.sunDiscC).lerp(NIGHT.sunDiscC, m);
    skyU.night.value = m;
    this.sun.color.copy(DAY.sunC).lerp(NIGHT.sunC, m);
    this.sun.intensity = DAY.sunI + (NIGHT.sunI - DAY.sunI) * m;
    this.hemi.color.copy(DAY.hemiSkyC).lerp(NIGHT.hemiSkyC, m);
    this.hemi.groundColor.copy(DAY.hemiGndC).lerp(NIGHT.hemiGndC, m);
    this.hemi.intensity = DAY.hemiI + (NIGHT.hemiI - DAY.hemiI) * m;
    this.scene.fog.color.copy(DAY.fogC).lerp(NIGHT.fogC, m);
    this.scene.fog.density = this._fogDensity * (1 + 0.75 * m);
    this.starMat.opacity = m;

    const winI = smoothstep(0.35, 0.8, m) * 1.1;
    for (const fm of this._facadeMats) fm.emissiveIntensity = winI;
    for (const bm of this._perimBulbs) bm.emissiveIntensity = winI * 1.4;

    // shadow box follows drone (texel-snapped, guarded)
    this._updateShadowFollow(dronePos);
    this.sky.position.set(dronePos.x, 0, dronePos.z);
    this.stars.position.set(dronePos.x, 0, dronePos.z);

    // gate next-pulse + pass flash (v0.9.0: ring emissive spike ~0.5s decay)
    const pulse = 1.2 + Math.sin(this._t * 5) * 0.6;
    for (const d of this._gateDefs) {
      let want = d.passed ? 0.08 : d.userDataNext ? pulse : 0.35;
      if (d.flash > 0) want += d.flash * 7;
      d.mat.emissiveIntensity += (want - d.mat.emissiveIntensity) * Math.min(1, dt * 10);
      if (d.userDataNext) { const sc = 1 + Math.sin(this._t * 5) * 0.03; d.ring.scale.setScalar(sc); }
      else d.ring.scale.setScalar(1);
      d.disc.material.opacity = d.passed ? 0.02 : d.userDataNext ? 0.08 + Math.sin(this._t * 5) * 0.05 : 0.03;
      if (d.flash > 0) {
        d.flash = Math.max(0, d.flash - dt * 2); // 0.5s decay
        const pop = 1 + d.flash * d.flash * 0.12;
        d.ring.scale.setScalar(pop);
        d.disc.material.opacity = Math.max(d.disc.material.opacity, d.flash * 0.28);
      }
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

    // pond: night dimming + slow ripple drift
    if (this._water) {
      const w = this._water;
      w.mirror.material.uniforms.color.value.copy(DAY.waterMirrorC).lerp(NIGHT.waterMirrorC, m);
      w.overlay.material.color.copy(DAY.waterC).lerp(NIGHT.waterC, m);
      w.overlay.material.opacity = lerp(0.35, 0.5, m);
      w.rip.offset.x += dt * 0.011;
      w.rip.offset.y += dt * 0.006;
    }

    this._updateWindDressing(dt, dronePos, camPos);
  }
}
