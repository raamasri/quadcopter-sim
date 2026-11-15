// Central configuration and shared constants for QuadSim.

export const CFG = {
  // World
  arenaR: 220,
  ceilY: 140,
  groundClear: 0.22,
  restitution: 0.28,
  groundFriction: 8,

  // Physics integration
  fixedStep: 1 / 240,

  // Environment
  dayNight: true
};

// Shared math helpers
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (a, b, lambda, dt) => b + (a - b) * Math.exp(-lambda * dt);
export const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0 || 1e-6), 0, 1);
  return t * t * (3 - 2 * t);
};
export const rad2deg = 180 / Math.PI;
export const deg2rad = Math.PI / 180;
