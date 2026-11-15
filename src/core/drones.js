// Drone definitions. Each spec drives physics, visuals and hangar stats.
// thrust-to-weight (tw) sets maxThrust = mass * g * tw.

import { CFG } from './config.js';

const G = 9.81;

export const DRONES = [
  {
    id: 'scout',
    name: 'SP-7 SCOUT',
    role: 'Balanced training quad. Stable, forgiving, great to learn on.',
    color: { body: 0x161b22, accent: 0xff7a1a, led: 0x22ff88 },
    mass: 1.4,
    tw: 2.1,
    size: 1.0,
    armLen: 0.26,
    maxTilt: 0.55,
    maxRate: 3.6,
    rateYaw: 2.4,
    kpAtt: 260,
    kdAtt: 22,
    kpRate: 1.0,
    dragLin: 0.5,
    dragQuad: 0.042,
    batteryWh: 78,
    agility: 3,
    speed: 3,
    stability: 4
  },
  {
    id: 'racer',
    name: 'VX-9 VIPER',
    role: 'Lightweight racer. Raw speed and razor response, twitchy in wind.',
    color: { body: 0x0e1420, accent: 0xff2d55, led: 0x4db8ff },
    mass: 0.82,
    tw: 3.4,
    size: 0.82,
    armLen: 0.2,
    maxTilt: 0.85,
    maxRate: 6.2,
    rateYaw: 3.6,
    kpAtt: 340,
    kdAtt: 24,
    kpRate: 1.25,
    dragLin: 0.28,
    dragQuad: 0.021,
    batteryWh: 62,
    agility: 5,
    speed: 5,
    stability: 2
  },
  {
    id: 'heavy',
    name: 'ATLAS CARGO',
    role: 'Heavy-lift workhorse. Slow but rock solid, huge battery for hauls.',
    color: { body: 0x1a1f16, accent: 0xf2b705, led: 0x9dff5a },
    mass: 3.4,
    tw: 1.55,
    size: 1.35,
    armLen: 0.36,
    maxTilt: 0.4,
    maxRate: 2.2,
    rateYaw: 1.6,
    kpAtt: 220,
    kdAtt: 34,
    kpRate: 1.1,
    dragLin: 0.9,
    dragQuad: 0.08,
    batteryWh: 168,
    agility: 2,
    speed: 2,
    stability: 5
  },
  {
    id: 'cinematic',
    name: 'AERO LX',
    role: 'Long-range cinematic rig. Smooth gimbal feel, glide for days.',
    color: { body: 0x101826, accent: 0x34e2ff, led: 0xffffff },
    mass: 2.1,
    tw: 1.9,
    size: 1.15,
    armLen: 0.3,
    maxTilt: 0.6,
    maxRate: 3.0,
    rateYaw: 2.0,
    kpAtt: 280,
    kdAtt: 28,
    kpRate: 1.05,
    dragLin: 0.6,
    dragQuad: 0.03,
    batteryWh: 130,
    agility: 3,
    speed: 4,
    stability: 5
  }
];

export function droneById(id) {
  return DRONES.find((d) => d.id === id) || DRONES[0];
}

export function derived(spec) {
  return {
    maxThrust: spec.mass * G * spec.tw,
    weight: spec.mass * G,
    hoverThrottle: 1 / spec.tw
  };
}

export { G };
