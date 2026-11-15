// PMREM environment map baked from the procedural sky (world's sky shader).
// Rebuilt only on tier change or day/night settle — never per frame. Each
// rebuild disposes the previous PMREM target; the intermediate cube target
// is kept and reused across rebuilds (disposed on size change / dispose).

import * as THREE from 'three';
import { createSkyMaterial } from './world.js';

export class EnvReflections {
  constructor(renderer, scene, snapshot) {
    this._renderer = renderer;
    this._scene = scene;
    this._snapshot = snapshot; // () => live sky ShaderMaterial to sample colors from
    this._pmrem = new THREE.PMREMGenerator(renderer);
    this._rt = null;
    this._cube = null;
    this._cam = null;
    this._timer = 0;
    this._mini = null;
  }

  // px 0 disables env reflections entirely (low tier).
  schedule(px, immediate = false) {
    clearTimeout(this._timer);
    if (!px) { this._clear(); return; }
    if (immediate) this.rebuild(px);
    else this._timer = setTimeout(() => this.rebuild(px), 1500);
  }

  rebuild(px) {
    if (!this._mini) {
      const mat = createSkyMaterial();
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(120, 24, 12), mat);
      const scene = new THREE.Scene();
      scene.add(mesh);
      this._mini = { scene, mat };
    }
    const src = this._snapshot().uniforms;
    const u = this._mini.mat.uniforms;
    u.topColor.value.copy(src.topColor.value);
    u.bottomColor.value.copy(src.bottomColor.value);
    u.sunDir.value.copy(src.sunDir.value);
    u.sunCol.value.copy(src.sunCol.value);
    u.night.value = src.night.value;

    if (!this._cube || this._cube.size !== px) {
      if (this._cube) this._cube.dispose();
      this._cube = new THREE.WebGLCubeRenderTarget(px, { type: THREE.HalfFloatType });
      this._cam = new THREE.CubeCamera(1, 400, this._cube);
    }
    this._cam.update(this._renderer, this._mini.scene);
    const rt = this._pmrem.fromCubemap(this._cube.texture);
    const old = this._rt;
    this._rt = rt;
    this._scene.environment = rt.texture;
    if (old) old.dispose();
  }

  _clear() {
    if (this._rt) { this._rt.dispose(); this._rt = null; }
    this._scene.environment = null;
  }

  dispose() {
    clearTimeout(this._timer);
    this._clear();
    if (this._cube) { this._cube.dispose(); this._cube = null; }
    this._pmrem.dispose();
  }
}
