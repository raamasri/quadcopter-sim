// Drone visual model builder + frame updater + motion trail.

import * as THREE from 'three';
import { metalTexture, carbonTexture } from './textures.js';

let _sharedTex = null;
function sharedTex() {
  if (!_sharedTex) _sharedTex = { metal: metalTexture(44), carbon: carbonTexture(55) };
  return _sharedTex;
}

export function buildDrone(spec) {
  const tex = sharedTex();
  const group = new THREE.Group();
  const { body, accent, led } = spec.color;

  const matBody = new THREE.MeshStandardMaterial({ map: tex.carbon.clone(), color: 0xffffff, roughness: 0.42, metalness: 0.55 });
  const matAccent = new THREE.MeshStandardMaterial({ color: accent, roughness: 0.38, metalness: 0.4, emissive: accent, emissiveIntensity: 0.06 });
  const matMetal = new THREE.MeshStandardMaterial({ map: tex.metal.clone(), color: 0xffffff, roughness: 0.35, metalness: 0.9 });

  // central stack
  const plateBot = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.02, 0.44), matBody);
  plateBot.position.y = -0.03; plateBot.castShadow = true; group.add(plateBot);
  const plateTop = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.018, 0.36), matBody);
  plateTop.position.y = 0.06; plateTop.castShadow = true; group.add(plateTop);
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.09, 10), matMetal);
  group.add(post);

  const canopy = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.09, 0.22), matAccent);
  canopy.position.set(0, 0.11, -0.04); canopy.castShadow = true; group.add(canopy);

  // FPV cam pod
  const camPod = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.06), matBody);
  camPod.position.set(0, 0.02, -0.22); group.add(camPod);
  const lens = new THREE.Mesh(new THREE.SphereGeometry(0.026, 16, 12),
    new THREE.MeshStandardMaterial({ color: 0x05070d, roughness: 0.1, metalness: 0.2, emissive: 0x1b5cff, emissiveIntensity: 1.4 }));
  lens.position.set(0, 0.02, -0.25); group.add(lens);

  // battery strap block
  const batt = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.06, 0.26),
    new THREE.MeshStandardMaterial({ color: 0x12161d, roughness: 0.7, metalness: 0.2 }));
  batt.position.set(0, 0, 0.02); group.add(batt);

  // landing legs
  for (const sx of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.1, 0.36), matAccent);
    leg.position.set(sx * 0.16, -0.09, 0); group.add(leg);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.02, 0.4), matBody);
    foot.position.set(sx * 0.16, -0.145, 0); group.add(foot);
  }

  // arms + motors + rotors
  const M = spec.armLen;
  const diag = Math.sqrt(2) * M;
  const armGeo = new THREE.BoxGeometry(0.05, 0.028, diag);
  const motorGeo = new THREE.CylinderGeometry(0.03, 0.038, 0.07, 16);
  const bellGeo = new THREE.CylinderGeometry(0.038, 0.03, 0.02, 16);
  const hubGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.02, 8);
  const bladeGeo = new THREE.BoxGeometry(0.014, 0.004, 0.17);
  const blurGeo = new THREE.CircleGeometry(0.11, 28);
  const rotors = [];
  const ledMats = [];

  const corners = [[M, -M], [M, M], [-M, M], [-M, -M]]; // FR, RR, RL, FL
  const dir = [1, -1, 1, -1];
  for (let i = 0; i < 4; i++) {
    const [ax, az] = corners[i];
    const arm = new THREE.Mesh(armGeo, matBody);
    arm.position.set(ax / 2, 0, az / 2);
    arm.rotation.y = Math.atan2(ax, az);
    arm.castShadow = true; group.add(arm);

    const motor = new THREE.Mesh(motorGeo, matMetal);
    motor.position.set(ax, 0.05, az); motor.castShadow = true; group.add(motor);
    const bell = new THREE.Mesh(bellGeo, matAccent);
    bell.position.set(ax, 0.09, az); group.add(bell);

    const rotor = new THREE.Group();
    rotor.position.set(ax, 0.108, az);
    const hub = new THREE.Mesh(hubGeo, matMetal); rotor.add(hub);
    const bladeMat = new THREE.MeshStandardMaterial({ color: 0x0c0e12, roughness: 0.6, metalness: 0.2, transparent: true, opacity: 0.92 });
    for (let b = 0; b < 3; b++) {
      const blade = new THREE.Mesh(bladeGeo, bladeMat);
      blade.position.set(0, 0, 0);
      blade.rotation.y = (b / 3) * Math.PI * 2;
      blade.translateZ(0.095);
      blade.castShadow = true;
      rotor.add(blade);
    }
    const blur = new THREE.Mesh(blurGeo, new THREE.MeshBasicMaterial({ color: 0xbfe6ff, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
    blur.rotation.x = -Math.PI / 2;
    rotor.userData.blur = blur; rotor.add(blur);
    rotor.userData.dir = dir[i];
    group.add(rotor);
    rotors.push(rotor);

    // LED pod under each motor
    const isFront = az < 0;
    const ledMat = new THREE.MeshStandardMaterial({
      color: isFront ? 0xffffff : led, emissive: isFront ? 0xffffff : led, emissiveIntensity: 2, toneMapped: false
    });
    const ledMesh = new THREE.Mesh(new THREE.SphereGeometry(0.016, 10, 10), ledMat);
    ledMesh.position.set(ax, -0.03, az + (isFront ? -0.03 : 0.03));
    group.add(ledMesh);
    ledMats.push(ledMat);
  }

  group.scale.setScalar(spec.size);
  return { group, rotors, ledMats, materials: { matBody, matAccent, matMetal } };
}

export class DroneVisual {
  constructor(scene, spec) {
    const { group, rotors, ledMats, materials } = buildDrone(spec);
    this.mesh = group;
    this.rotors = rotors;
    this.ledMats = ledMats;
    this.materials = materials;
    this._spin = [0, 0, 0, 0];
    scene.add(group);

    // trail
    this.trailLen = 60;
    const tg = new THREE.BufferGeometry();
    this._trailPos = new Float32Array(this.trailLen * 3);
    this._trailCol = new Float32Array(this.trailLen * 3);
    tg.setAttribute('position', new THREE.BufferAttribute(this._trailPos, 3));
    tg.setAttribute('color', new THREE.BufferAttribute(this._trailCol, 3));
    this.trail = new THREE.Line(tg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.trail.frustumCulled = false;
    this._trailFilled = false;
    scene.add(this.trail);
  }

  reset(pos) {
    this._trailFilled = false;
    for (let i = 0; i < this.trailLen; i++) {
      this._trailPos[i * 3] = pos.x; this._trailPos[i * 3 + 1] = pos.y; this._trailPos[i * 3 + 2] = pos.z;
    }
  }

  // sharp metal + stronger env reflections only on the high tier
  applyVisualTier(cfg) {
    const sharp = cfg.envPx >= 256;
    const m = this.materials;
    m.matMetal.roughness = sharp ? 0.25 : 0.35;
    m.matBody.roughness = sharp ? 0.32 : 0.42;
    const inten = cfg.envPx ? (sharp ? 1.15 : 0.9) : 1;
    m.matMetal.envMapIntensity = inten;
    m.matBody.envMapIntensity = inten;
    m.matAccent.envMapIntensity = inten * 0.7;
  }

  update(dt, m, opts = {}) {
    this.mesh.position.copy(m.pos);
    this.mesh.quaternion.copy(m.quat);

    const base = 24 + m.rpmNorm * 190;
    for (let i = 0; i < 4; i++) {
      this._spin[i] += base * this.rotors[i].userData.dir * dt * (0.4 + m.rotorNorm[i]);
      this.rotors[i].rotation.y = this._spin[i];
      const blur = this.rotors[i].userData.blur;
      const spin = m.rotorNorm[i];
      blur.material.opacity = Math.min(0.28, spin * 0.34);
      for (let b = 1; b <= 3; b++) this.rotors[i].children[b].visible = spin < 0.55;
    }

    const flash = m.armed ? (0.6 + 0.4 * Math.sin(performance.now() * 0.02)) : 0.05;
    for (const lm of this.ledMats) lm.emissiveIntensity = m.crashed ? 0.02 : flash * 2;

    // trail update
    const p = this._trailPos, c = this._trailCol;
    if (!this._trailFilled) {
      for (let i = 0; i < this.trailLen; i++) { p[i * 3] = m.pos.x; p[i * 3 + 1] = m.pos.y; p[i * 3 + 2] = m.pos.z; }
      this._trailFilled = true;
    }
    for (let i = this.trailLen - 1; i > 0; i--) {
      p[i * 3] = p[(i - 1) * 3]; p[i * 3 + 1] = p[(i - 1) * 3 + 1]; p[i * 3 + 2] = p[(i - 1) * 3 + 2];
    }
    p[0] = m.pos.x; p[1] = m.pos.y; p[2] = m.pos.z;
    const glow = m.armed ? 1 : 0.15;
    const acc = opts.trailColor || [0.2, 0.8, 1.0];
    for (let i = 0; i < this.trailLen; i++) {
      const t = 1 - i / this.trailLen;
      c[i * 3] = acc[0] * t * glow; c[i * 3 + 1] = acc[1] * t * glow; c[i * 3 + 2] = acc[2] * t * glow;
    }
    this.trail.geometry.attributes.position.needsUpdate = true;
    this.trail.geometry.attributes.color.needsUpdate = true;
    this.trail.visible = !m.crashed;
  }

  dispose(scene) {
    scene.remove(this.mesh);
    scene.remove(this.trail);
    this.mesh.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((mm) => mm.dispose()); });
    this.trail.geometry.dispose(); this.trail.material.dispose();
  }
}
