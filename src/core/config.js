// Central configuration and shared constants for QuadSim.

export const VERSION = '0.8.0';

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
  dayNight: true,

  // Wind
  windLevels: { off: 0, calm: 0.22, breezy: 0.5, gusty: 0.95 },
  windBaseSpeed: 4.5, // m/s at strength 1.0
  windHeading: 35, // base heading (deg, compass: 0=N toward -Z)
  windShear: 0.35, // wind weaker near ground: v *= pow(clamp(y/refH,0.15,1), shear)
  windShearRefH: 12,
  windGroundEffectH: 1.2, // downwash reduces wind coupling near the deck
  windGustAmp: 0.55,
  windFlutterAmp: 0.22,
  windDirWobbleAmp: 26, // deg around base heading
  windRipple: 0.14 // positional sine ripple (fraction of base speed)
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
