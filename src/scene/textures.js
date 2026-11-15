// Procedural texture factory. No external assets — everything is generated
// on canvas so the sim runs fully offline with a consistent art direction.
// Each generator returns a configured THREE.CanvasTexture.

import * as THREE from 'three';

// ---- deterministic noise ----
function makeRng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function valueNoise(seed) {
  const size = 256;
  const g = new Float32Array(size * size);
  const rng = makeRng(seed);
  for (let i = 0; i < g.length; i++) g[i] = rng();
  const at = (x, y) => g[((y & 255) << 8) | (x & 255)];
  const sm = (t) => t * t * (3 - 2 * t);
  return function (x, y) {
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = sm(x - x0), fy = sm(y - y0);
    const a = at(x0, y0), b = at(x0 + 1, y0), c = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
}

function fbm(noiseFn, x, y, oct = 4, lac = 2, gain = 0.5) {
  let v = 0, amp = 0.5, f = 1, norm = 0;
  for (let i = 0; i < oct; i++) {
    v += amp * noiseFn(x * f, y * f);
    norm += amp; amp *= gain; f *= lac;
  }
  return v / norm;
}

function ctx2d(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return { c, g: c.getContext('2d') };
}

function toTex(canvas, { srgb = true, repeat = 1, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (Array.isArray(repeat)) t.repeat.set(repeat[0], repeat[1]);
  else t.repeat.set(repeat, repeat);
  t.anisotropy = aniso;
  t.needsUpdate = true;
  return t;
}

function heightToNormal(size, heightArr, strength = 1.5) {
  const { c, g } = ctx2d(size);
  const img = g.createImageData(size, size);
  const at = (x, y) => heightArr[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const len = Math.hypot(-dx, -dy, 1);
      const i = (y * size + x) * 4;
      img.data[i] = ((-dx / len) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((-dy / len) * 0.5 + 0.5) * 255;
      img.data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

// ---- public generators ----
export function grassTextures(seed = 7) {
  const size = 512;
  const { c, g } = ctx2d(size);
  const n = valueNoise(seed);
  const h = new Float32Array(size * size);
  const img = g.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size * 6, v = y / size * 6;
      const f = fbm(n, u, v, 5, 2.1, 0.55);
      const patch = fbm(n, u * 0.4 + 10, v * 0.4 + 10, 3);
      const blade = n(x * 0.9, y * 0.9);
      let r = 46 + f * 34 + blade * 12 - patch * 18;
      let gg = 82 + f * 60 + blade * 20 + patch * 14;
      let b = 34 + f * 20 - patch * 8;
      const hh = f * 0.7 + blade * 0.3;
      h[y * size + x] = hh;
      const i = (y * size + x) * 4;
      img.data[i] = Math.max(0, Math.min(255, r));
      img.data[i + 1] = Math.max(0, Math.min(255, gg));
      img.data[i + 2] = Math.max(0, Math.min(255, b));
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return {
    map: toTex(c, { repeat: 120, srgb: true }),
    normalMap: toTex(heightToNormal(size, h, 1.1), { repeat: 120, srgb: false })
  };
}

export function asphaltTextures(seed = 21) {
  const size = 512;
  const { c, g } = ctx2d(size);
  const n = valueNoise(seed);
  const h = new Float32Array(size * size);
  const img = g.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size * 10, v = y / size * 10;
      const f = fbm(n, u, v, 5, 2.3, 0.5);
      const grain = n(x * 2.2, y * 2.2);
      let val = 34 + f * 30 + grain * 26;
      // occasional aggregate speckle
      if (n(x * 3.1 + 5, y * 3.1) > 0.9) val += 40;
      const i = (y * size + x) * 4;
      img.data[i] = val * 0.98; img.data[i + 1] = val; img.data[i + 2] = val * 1.02;
      img.data[i + 3] = 255;
      h[y * size + x] = f * 0.6 + grain * 0.4;
    }
  }
  g.putImageData(img, 0, 0);
  return {
    map: toTex(c, { repeat: 40 }),
    normalMap: toTex(heightToNormal(size, h, 0.7), { repeat: 40, srgb: false })
  };
}

export function concreteTextures(seed = 33) {
  const size = 512;
  const { c, g } = ctx2d(size);
  const n = valueNoise(seed);
  const h = new Float32Array(size * size);
  const img = g.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size * 8, v = y / size * 8;
      const f = fbm(n, u, v, 4, 2, 0.5);
      let val = 120 + f * 40;
      const mottle = fbm(n, u * 2 + 30, v * 2, 3);
      val += (mottle - 0.5) * 26;
      const i = (y * size + x) * 4;
      img.data[i] = val; img.data[i + 1] = val * 0.99; img.data[i + 2] = val * 0.96;
      img.data[i + 3] = 255;
      h[y * size + x] = f;
    }
  }
  g.putImageData(img, 0, 0);
  // scored panel seams
  g.strokeStyle = 'rgba(30,34,40,0.55)';
  g.lineWidth = 3;
  for (let k = 0; k <= 512; k += 256) {
    g.beginPath(); g.moveTo(k, 0); g.lineTo(k, 512); g.stroke();
    g.beginPath(); g.moveTo(0, k); g.lineTo(512, k); g.stroke();
  }
  return {
    map: toTex(c, { repeat: 8 }),
    normalMap: toTex(heightToNormal(size, h, 0.6), { repeat: 8, srgb: false })
  };
}

export function metalTexture(seed = 44, tint = '#2a2f38') {
  const size = 256;
  const { c, g } = ctx2d(size);
  g.fillStyle = tint; g.fillRect(0, 0, size, size);
  const n = valueNoise(seed);
  const img = g.getImageData(0, 0, size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // horizontal brush streaks
      const streak = fbm(n, x * 0.05, y * 1.4, 3, 2, 0.5);
      const d = (streak - 0.5) * 46;
      const i = (y * size + x) * 4;
      img.data[i] = Math.max(0, Math.min(255, img.data[i] + d));
      img.data[i + 1] = Math.max(0, Math.min(255, img.data[i + 1] + d));
      img.data[i + 2] = Math.max(0, Math.min(255, img.data[i + 2] + d));
    }
  }
  g.putImageData(img, 0, 0);
  return toTex(c, { repeat: 1 });
}

export function carbonTexture(seed = 55) {
  const size = 128;
  const { c, g } = ctx2d(size);
  g.fillStyle = '#0d0f13'; g.fillRect(0, 0, size, size);
  const cell = 16;
  for (let y = 0; y < size; y += cell) {
    for (let x = 0; x < size; x += cell) {
      const horiz = (((x + y) / cell) | 0) % 2 === 0;
      const grd = g.createLinearGradient(x, y, horiz ? x + cell : x, horiz ? y : y + cell);
      grd.addColorStop(0, '#1b2027');
      grd.addColorStop(0.5, '#0a0c10');
      grd.addColorStop(1, '#161a20');
      g.fillStyle = grd;
      g.fillRect(x, y, cell, cell);
    }
  }
  return toTex(c, { repeat: 6 });
}

// Building facade: returns { map, emissiveMap, glow }. Emissive map is lit
// windows used at night. gridRows/cols derive from the building footprint.
export function facadeTexture(palette = 0, seed = 101, cols = 6, rows = 10) {
  const W = 256, H = 512;
  const cw = document.createElement('canvas'); cw.width = W; cw.height = H;
  const ce = document.createElement('canvas'); ce.width = W; ce.height = H;
  const g = cw.getContext('2d');
  const ge = ce.getContext('2d');
  const walls = ['#3a4150', '#4a4640', '#2f3a44', '#54524c', '#3c3f4a'];
  const base = walls[palette % walls.length];
  g.fillStyle = base; g.fillRect(0, 0, W, H);
  ge.fillStyle = '#000'; ge.fillRect(0, 0, W, H);

  const n = valueNoise(seed);
  // wall noise
  const img = g.getImageData(0, 0, W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const f = fbm(n, x / W * 6, y / H * 10, 4);
      const d = (f - 0.5) * 30;
      const i = (y * W + x) * 4;
      img.data[i] = Math.max(0, Math.min(255, img.data[i] + d));
      img.data[i + 1] = Math.max(0, Math.min(255, img.data[i + 1] + d));
      img.data[i + 2] = Math.max(0, Math.min(255, img.data[i + 2] + d));
    }
  }
  g.putImageData(img, 0, 0);

  const mx = W / cols, my = H / rows;
  const rng = makeRng(seed + 7);
  const glassDay = ['#101821', '#16212c', '#0e1a24', '#1a2836'];
  for (let r = 0; r < rows; r++) {
    for (let cI = 0; cI < cols; cI++) {
      const x = cI * mx + mx * 0.18, y = r * my + my * 0.2;
      const w = mx * 0.64, h = my * 0.56;
      g.fillStyle = glassDay[(r + cI + palette) % glassDay.length];
      g.fillRect(x, y, w, h);
      // reflection sliver
      g.fillStyle = 'rgba(150,190,230,0.14)';
      g.fillRect(x, y, w * 0.4, h);
      // frame
      g.strokeStyle = 'rgba(10,12,16,0.6)'; g.lineWidth = 1.2;
      g.strokeRect(x, y, w, h);
      // emissive: some windows lit warm at night
      if (rng() < 0.42) {
        const warm = rng();
        const col = warm < 0.7 ? `rgba(255,${190 + (rng() * 40 | 0)},120,1)` : `rgba(200,225,255,0.9)`;
        ge.fillStyle = col;
        ge.fillRect(x, y, w, h);
      }
    }
    // floor divider
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.fillRect(0, (r + 1) * my - 2, W, 3);
  }

  const map = toTex(cw, { repeat: 1 });
  const emissiveMap = toTex(ce, { repeat: 1 });
  return { map, emissiveMap };
}

export function helipadTexture() {
  const size = 512;
  const { c, g } = ctx2d(size);
  const concrete = concreteTextures(9);
  g.drawImage(concrete.map.image, 0, 0, size, size);
  const cx = size / 2, cy = size / 2;
  g.strokeStyle = '#f2b705'; g.lineWidth = 14;
  g.beginPath(); g.arc(cx, cy, size * 0.4, 0, Math.PI * 2); g.stroke();
  g.fillStyle = '#eceef2';
  g.font = 'bold 240px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('H', cx, cy + 8);
  g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 4;
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2 + Math.PI / 4;
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * size * 0.42, cy + Math.sin(a) * size * 0.42);
    g.lineTo(cx + Math.cos(a) * size * 0.48, cy + Math.sin(a) * size * 0.48);
    g.stroke();
  }
  return toTex(c, { repeat: 1 });
}

// Tileable pond ripple normals: fbm micro-detail + two domain-warped sine
// wave sets (integer cycles so the texture tiles seamlessly at any repeat).
export function waterNormalTexture() {
  const size = 256;
  const n = valueNoise(777);
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size * 8, v = y / size * 8;
      const warp = Math.sin(v * 1.5 + 1.3) * 1.1;
      h[y * size + x] = 0.5 * fbm(n, u, v, 3, 2, 0.5)
        + 0.3 * Math.sin(u * 2.5 + warp) + 0.2 * Math.sin(v * 3.0 - warp);
    }
  }
  return toTex(heightToNormal(size, h, 1.6), { repeat: 5, srgb: false });
}

export function runwayTexture(seed = 12) {
  const W = 256, H = 1024;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  const n = valueNoise(seed);
  const img = g.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const f = fbm(n, x / W * 8, y / H * 30, 4, 2.2, 0.5);
      let val = 40 + f * 26;
      if (n(x * 2.5, y * 1.2) > 0.93) val += 30;
      const i = (y * W + x) * 4;
      img.data[i] = val * 0.98; img.data[i + 1] = val; img.data[i + 2] = val * 1.03; img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  // edge lines
  g.fillStyle = '#e9edf2';
  g.fillRect(W * 0.06, 0, 8, H); g.fillRect(W * 0.94 - 8, 0, 8, H);
  // dashed centerline
  g.fillStyle = '#f4c81f';
  for (let y = 40; y < H - 60; y += 96) g.fillRect(W / 2 - 4, y, 8, 52);
  const t = toTex(c, { repeat: 1 });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
