// One-shot procedural app-icon generator (pure Node, zero deps).
// Writes PNGs by hand: zlib deflate + CRC32, raw RGBA scanlines with filter byte 0.
// Renders a quadcopter glyph over a dark full-bleed background, 2x supersampled.
// Usage: node scripts/gen-icons.mjs

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'icons');
mkdirSync(outDir, { recursive: true });

// ---------- minimal PNG encoder ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
};
const encodePng = (size, rgba) => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // 8-bit RGBA
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter: None
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
};

// ---------- shape math ----------
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (t) => t * t * (3 - 2 * t);
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
// distance from point to segment a->b
const segDist = (px, py, ax, ay, bx, by) => {
  const dx = bx - ax, dy = by - ay;
  const t = clamp(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy), 0, 1);
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
};
// signed distance of a centered rounded rect (negative inside)
const rrectSd = (x, y, hx, hy, r) => {
  const qx = Math.abs(x) - hx + r, qy = Math.abs(y) - hy + r;
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - r;
};

// ---------- palette ----------
const BG_TOP = [14, 22, 40];
const BG_BOT = [7, 12, 22];
const CYAN = [52, 226, 255];
const CYAN_HI = [168, 244, 255];
const SLATE = [146, 168, 194];
const DARK = [18, 29, 48];

const SS = 2; // supersample factor
const HUB = 0.29, ROTOR_R = 0.15, RING_T = 0.03, HUB_R = 0.052;
const ARM_W = 0.047, LINE_W = 0.013;
const BODY_HX = 0.16, BODY_HY = 0.12, BODY_R = 0.055, BODY_T = 0.02;

function pixel(u, v, s, feU) {
  const feG = feU / s;
  let col = mix(BG_TOP, BG_BOT, smooth(v));
  // rounded-square panel outline
  const pd = Math.abs(rrectSd(u - 0.5, v - 0.5, 0.452, 0.452, 0.17));
  col = mix(col, CYAN, clamp(0.5 + (0.006 - pd) / (feU * 2), 0, 1) * 0.22);
  // soft cyan glow disc behind the craft
  const gc = Math.hypot(u - 0.5, v - 0.5);
  col = mix(col, CYAN, clamp(0.55 - gc / (s * 0.62), 0, 1) * 0.05);

  const gx = (u - 0.5) / s, gy = (v - 0.5) / s;
  // diagonal arms + cyan centerlines
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const d = segDist(gx, gy, 0, 0, sx * HUB, sy * HUB);
      col = mix(col, SLATE, clamp(0.5 + (ARM_W - d) / feG, 0, 1));
      col = mix(col, CYAN, clamp(0.5 + (LINE_W - d) / feG, 0, 1) * 0.85);
    }
  }
  // rotor disc fill
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const d = Math.hypot(gx - sx * HUB, gy - sy * HUB);
      col = mix(col, CYAN, clamp(0.5 + (ROTOR_R - d) / feG, 0, 1) * 0.12);
    }
  }
  // center body + border + camera slot
  const bd = rrectSd(gx, gy, BODY_HX, BODY_HY, BODY_R);
  col = mix(col, DARK, clamp(0.5 + -bd / feG, 0, 1));
  col = mix(col, CYAN, clamp(0.5 + (BODY_T - Math.abs(bd)) / feG, 0, 1) * 0.9);
  col = mix(col, CYAN, clamp(0.5 + -rrectSd(gx, gy, 0.062, 0.038, 0.02) / feG, 0, 1) * 0.95);
  // rotor rings + hubs
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const d = Math.hypot(gx - sx * HUB, gy - sy * HUB);
      col = mix(col, CYAN, clamp(0.5 + (RING_T - Math.abs(d - ROTOR_R)) / feG, 0, 1) * 0.95);
      col = mix(col, CYAN_HI, clamp(0.5 + (HUB_R - d) / feG, 0, 1));
    }
  }
  return col;
}

function renderIcon(size, glyphScale) {
  const feU = 1.6 / (size * SS);
  const rgba = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const c = pixel((x + (sx + 0.5) / SS) / size, (y + (sy + 0.5) / SS) / size, glyphScale, feU);
          r += c[0]; g += c[1]; b += c[2];
        }
      }
      const n = SS * SS, i = (y * size + x) * 4;
      rgba[i] = r / n; rgba[i + 1] = g / n; rgba[i + 2] = b / n; rgba[i + 3] = 255;
    }
  }
  return encodePng(size, rgba);
}

const targets = [
  ['icon-192.png', 192, 0.8],
  ['icon-512.png', 512, 0.8],
  ['icon-maskable-512.png', 512, 0.64],
  ['apple-touch-icon-180.png', 180, 0.8]
];
for (const [name, size, scale] of targets) {
  const png = renderIcon(size, scale);
  writeFileSync(join(outDir, name), png);
  console.log(`${name}  ${size}x${size}  ${(png.length / 1024).toFixed(1)} KiB`);
}
