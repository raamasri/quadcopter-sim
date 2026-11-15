// QUADSIM PRO bootstrap: renderer + bloom, world, physics, missions, HUD,
// screens, audio and the master game loop.

import * as THREE from 'three';
import { Controls } from './core/input.js';
import { CameraRig } from './core/cameraRig.js';
import { FlightModel } from './core/physics.js';
import { WindField } from './core/wind.js';
import { CFG } from './core/config.js';
import { Quality } from './core/quality.js';
import { AudioEngine } from './core/audio.js';
import { droneById, DRONES } from './core/drones.js';
import { World } from './scene/world.js';
import { EnvReflections } from './scene/env.js';
import { DroneVisual } from './scene/droneVisual.js';
import { HUD } from './ui/hud.js';
import { Screens, loadSettings, saveSettings } from './ui/screens.js';
import { MISSION_DEFS, createMission, bestOf } from './game/missions.js';

const bootError = (err) => {
  const box = document.getElementById('boot-error');
  const msg = document.getElementById('boot-error-msg');
  if (box && msg) { msg.textContent = (err && (err.stack || err.message)) || String(err); box.hidden = false; }
  console.error(err);
};

try {
  const canvas = document.getElementById('scene');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(64, window.innerWidth / window.innerHeight, 0.05, 1800);
  camera.position.set(0, 5, 14);

  // optional bloom post-processing (graceful fallback if unavailable)
  let composer = null, bloom = null;
  try {
    const [{ EffectComposer }, { RenderPass }, { UnrealBloomPass }, { OutputPass }] = await Promise.all([
      import('three/addons/postprocessing/EffectComposer.js'),
      import('three/addons/postprocessing/RenderPass.js'),
      import('three/addons/postprocessing/UnrealBloomPass.js'),
      import('three/addons/postprocessing/OutputPass.js')
    ]);
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.38, 0.7, 0.82);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
  } catch { composer = null; }

  // water reflector class fetched alongside bloom to keep addons lazy-loaded
  let ReflectorClass = null;
  try { ({ Reflector: ReflectorClass } = await import('three/addons/objects/Reflector.js')); } catch { ReflectorClass = null; }

  const settings = loadSettings();
  const quality = new Quality(settings);
  const world = new World(scene);
  world.setNight(settings.night);
  if (ReflectorClass) world.installWater(ReflectorClass);
  const wind = new WindField(CFG);
  wind.setStrength(settings.wind);
  world.setWindField(wind);
  const hud = new HUD(document);
  const env = new EnvReflections(renderer, scene, () => world.skyMat);
  world.onNightChanged = () => env.schedule(quality.cfg.envPx); // debounced bake after transition settles
  const audio = new AudioEngine();
  audio.setVolume(settings.volume);
  audio.setEnabled(settings.sound);

  let spec = droneById(settings.drone);
  let model = new FlightModel(spec, wind);
  let visual = new DroneVisual(scene, spec);
  visual.applyVisualTier(quality.cfg);

  const rig = new CameraRig(camera);
  const controls = new Controls(canvas);
  controls.sensitivity = settings.sensitivity;

  const ctx = {
    world, model, audio, settings,
    prevPos: new THREE.Vector3(),
    pos: new THREE.Vector3(),
    maxSpeed: 0,
    toast: (m, ms) => hud.toast(m, ms)
  };
  parkOnPad();

  let state = 'menu'; // menu | play | pause | results
  let mission = null;
  let helpOpen = false;
  let respawnTimer = -1;

  hud.setView(rig.name);
  hud.setMission('');

  // ---------- lifecycle ----------
  function rebuildDrone() {
    scene.remove(visual.mesh); scene.remove(visual.trail);
    visual.dispose(scene);
    visual = new DroneVisual(scene, spec);
    visual.applyVisualTier(quality.cfg);
    model = new FlightModel(spec, wind);
    ctx.model = model;
    hud.setHoverPoint(model.hoverThrottle);
    parkOnPad();
  }

  function parkOnPad() {
    model.spawn(world.padPos.x, 0.24, world.padPos.z, 0);
    visual.reset(model.pos);
    ctx.maxSpeed = 0;
  }

  function launch(missionId, droneId) {
    audio.start();
    if (droneId && droneId !== spec.id) { spec = droneById(droneId); rebuildDrone(); }
    if (mission) { world.clearCourse(); world.clearMarkers(); }
    mission = createMission(missionId, ctx);
    parkOnPad();
    model.setMode('angle');
    rig.setMode(0); hud.setView(rig.name);
    world.setNight(settings.night);
    hud.setMission(mission.id === 'free' ? '' : MISSION_DEFS.find((m) => m.id === missionId).name);
    hud.setHoverPoint(model.hoverThrottle);
    respawnTimer = -1;
    state = 'play';
    screens.hide();
    helpOpen = true;
    hud.showHelp(true);
  }

  function restart() { launch(mission ? mission.id : 'free', spec.id); }

  function quitToMenu() {
    state = 'menu';
    if (mission) { world.clearCourse(); world.clearMarkers(); mission = null; }
    parkOnPad();
    controls.throttle = 0;
    rig.setMode(2); // orbit for menu backdrop
    hud.setMission('');
    hud.showHelp(false);
    screens.showMenu();
  }

  function showResults(result) {
    state = 'results';
    controls.throttle = 0;
    rig.setMode(5); // cinematic orbit of the aftermath
    screens.showResults(result);
  }

  const screens = new Screens(document.getElementById('screens'), {
    missions: MISSION_DEFS, drones: DRONES, bestOf, settings, audio,
    onLaunch: launch,
    onRestart: restart,
    onQuit: quitToMenu,
    onResume: () => { state = 'play'; screens.hide(); },
    audioClick: () => { audio.start(); audio.click(); },
    onChange: (patch) => {
      Object.assign(settings, patch);
      saveSettings(settings);
      if ('volume' in patch) { audio.start(); audio.setVolume(patch.volume); }
      if ('sound' in patch) audio.setEnabled(patch.sound);
      if ('sensitivity' in patch) controls.sensitivity = patch.sensitivity;
      if ('night' in patch) world.setNight(patch.night);
      if ('wind' in patch) wind.setStrength(patch.wind);
      if ('quality' in patch) { quality.setPreset(patch.quality); applyQuality(false); }
      if ('shadows' in patch) applyQuality(false);
    }
  });
  screens.showMenu();
  rig.setMode(2);

  // ---------- quality tier application (live, no reload) ----------
  let lastEnvPx = -1;
  function applyQuality(autoDegraded) {
    const cfg = quality.cfg;
    // pixel ratio cap + bloom toggle (composer needs its own ratio update)
    const dpr = Math.min(window.devicePixelRatio || 1, cfg.pixelRatio);
    renderer.setPixelRatio(dpr);
    renderer.setSize(window.innerWidth, window.innerHeight);
    if (composer) { composer.setPixelRatio(dpr); composer.setSize(window.innerWidth, window.innerHeight); }
    if (bloom) bloom.enabled = cfg.bloom;
    // shadows: master flag respects user 'shadows' toggle AND tier; recompile
    // materials only when the master enabled state actually flips
    const shadowsOn = cfg.shadows && settings.shadows !== false;
    const flipped = renderer.shadowMap.enabled !== shadowsOn;
    renderer.shadowMap.enabled = shadowsOn;
    // world: fog density, water reflector visibility, shadow map size (dispose)
    world.applyTier(cfg, settings.shadows !== false);
    // drone material sharpness for the tier
    visual.applyVisualTier(cfg);
    // environment reflections (bake size 0 disables); only rebake when the
    // tier's bake size actually changed — day/night re-bakes come through
    // world.onNightChanged. Renderer AA is init-only; tier changes apply live
    // to shadows/env/post, never forcing a reload.
    if (cfg.envPx !== lastEnvPx) { lastEnvPx = cfg.envPx; env.schedule(cfg.envPx, false); }
    if (flipped) scene.traverse((o) => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { m.needsUpdate = true; }); });
    hud.setQuality(quality.resolved.toUpperCase());
    screens.setQualityResolved(quality.resolved.toUpperCase());
    if (autoDegraded) hud.toast('Quality lowered to keep 60fps', 2200);
  }
  applyQuality(false);

  // ---------- control callbacks ----------
  let armedLatch = false;
  const doArm = (on) => {
    if (state !== 'play' || model.crashed) return;
    if (on && !model.armed) { model.arm(true); audio.arm(); hud.toast('ARMED', 900); }
    else if (!on && model.armed) { model.arm(false); audio.disarm(); hud.toast('DISARMED', 900); }
  };

  controls.cb = {
    cycleView: () => { if (state !== 'menu') { rig.next(); hud.setView(rig.name); } },
    selectView: (i) => { if (state !== 'menu') { rig.setMode(i); hud.setView(rig.name); } },
    reset: () => {
      if (state === 'play') {
        if (mission && mission.id === 'free') { parkOnPad(); audio.click(); hud.toast('RESPAWN', 800); }
        else restart();
      } else if (state === 'results') restart();
    },
    toggleHelp: () => { helpOpen = !helpOpen; hud.showHelp(helpOpen); },
    togglePause: () => {
      if (state === 'play') { state = 'pause'; screens.showPause(); }
      else if (state === 'pause') { state = 'play'; screens.hide(); }
    },
    fullscreen: () => {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      else document.documentElement.requestFullscreen().catch(() => {});
    },
    toggleLight: () => {
      settings.night = !settings.night;
      world.setNight(settings.night);
      saveSettings(settings);
      screens.showMenu && state === 'menu' && screens.showMenu();
      hud.toast(settings.night ? 'NIGHT' : 'DAY', 900);
    },
    toggleMode: () => {
      if (state !== 'play' || !model.armed) return;
      model.setMode(model.mode === 'angle' ? 'acro' : 'angle');
      hud.toast(model.mode === 'angle' ? 'ANGLE MODE' : 'ACRO MODE', 1000);
    },
    toggleArm: () => doArm(!model.armed),
    armHoldRequest: () => { if (state === 'play') { doArm(true); controls._armLatch = true; } },
    padStatus: (on) => { hud.setPad(on); screens.setPad(on); },
    mouseLookChanged: (on) => hud.toast(on ? 'MOUSE LOOK ON' : 'MOUSE LOOK OFF', 800),
    anyFlightKey: () => { if (helpOpen && state === 'play') { helpOpen = false; hud.showHelp(false); } audio.start(); }
  };

  document.addEventListener('pointerdown', () => audio.start(), { once: true });
  document.addEventListener('pointerdown', () => {
    if (helpOpen && state === 'play') { helpOpen = false; hud.showHelp(false); }
  });

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    if (composer) composer.setSize(window.innerWidth, window.innerHeight);
  });

  // ---------- master loop ----------
  let fps = 60, fpsAcc = 0, fpsFrames = 0, fpsTimer = 0;
  let last = performance.now();

  function frame(now) {
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.1) dt = 0.1;

    fpsAcc += dt; fpsFrames++; fpsTimer += dt;
    if (fpsTimer >= 0.25) { fps = fpsFrames / fpsAcc; fpsAcc = 0; fpsFrames = 0; fpsTimer = 0; }

    wind.update(dt);
    const raw = controls.update(dt);
    const input = { ...raw, throttle: raw.throttle };

    if (state === 'play') {
      // arming combos
      if (controls.armHold >= 1 && !model.armed) { doArm(true); controls._armLatch = true; }
      if (controls.disarmHold >= 1 && model.armed) { doArm(false); controls._armLatch = true; }

      ctx.prevPos.copy(model.pos);
      const locked = helpOpen;
      model.advance(dt, locked ? { pitch: 0, roll: 0, yaw: 0, throttle: input.throttle, mouseDX: 0, mouseDY: 0, mouseLook: false } : input, world);
      ctx.pos.copy(model.pos);
      ctx.maxSpeed = Math.max(ctx.maxSpeed, Math.hypot(model.vel.x, model.vel.z));

      // physics events
      for (const e of model.events) {
        if (mission) mission.onEvent(e);
        if (e.t === 'impact') audio.impact();
        if (e.t === 'crash') {
          audio.crash(1);
          if (mission && mission.id === 'free') { respawnTimer = 1.6; hud.toast('WRECKED · respawning...', 1500); }
        }
      }
      model.events.length = 0;

      if (mission) {
        mission.time += dt;
        mission.update(dt);
        if (mission.finished && mission.result && state === 'play') showResults(mission.result);
      }
      audio.lowBatteryBeep(dt, model.armed ? model.battery : 1);

      if (respawnTimer > 0) {
        respawnTimer -= dt;
        if (respawnTimer <= 0) { parkOnPad(); hud.toast('RESPAWNED', 800); }
      }
    } else {
      model.events.length = 0;
      if (state === 'pause' || state === 'results' || state === 'menu') {
        input.pitch = 0; input.roll = 0; input.yaw = 0;
      }
    }

    // visuals
    visual.update(dt, model, state === 'menu' ? { trailColor: [0.1, 0.5, 0.9] } : {});
    world.update(dt, model.pos, camera.position);
    rig.update(dt, { pos: model.pos, quat: model.quat, vel: model.vel });

    // audio frame
    const rvx = model.vel.x - wind.baseVel.x;
    const rvz = model.vel.z - wind.baseVel.z;
    const relSpeed = Math.hypot(rvx, model.vel.y, rvz);
    if (state === 'play') audio.frame(dt, model.rpmNorm, model.vel.length(), model.armed);
    else audio.frame(dt, 0, 0, false);
    audio.setWind(relSpeed, wind.strength);

    // HUD
    const t = model.telemetry();
    t.fps = fps;
    hud.update(t, {
      armProg: controls.armHold,
      disarmProg: controls.disarmHold,
      objective: state === 'play' && mission ? mission.objective : (state === 'menu' ? '' : ''),
      progressFrac: state === 'play' && mission ? mission.progressFrac : 0,
      big: state === 'play' && mission ? mission.bigStat : null
    });
    hud.setWind({ visible: state === 'play' && wind.strength > 0, heading: wind.headingDeg, speed: wind.baseSpeed });

    renderer.toneMappingExposure = world.exposure;
    if (composer) composer.render(); else renderer.render(scene, camera);

    // sustained low fps in play -> one-time auto-degrade
    if (quality.update(dt, fps, state === 'play')) applyQuality(true);

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // ---------- headless verification hook ----------
  window.__SIM = {
    get state() {
      return {
        gameState: state,
        mission: mission ? mission.id : null,
        pos: model.pos.toArray().map((v) => +v.toFixed(3)),
        speed: +Math.hypot(model.vel.x, model.vel.z).toFixed(2),
        alt: +model.pos.y.toFixed(2),
        armed: model.armed,
        crashed: model.crashed,
        battery: +(model.battery * 100).toFixed(1),
        gates: world.gatesPassed,
        view: rig.name,
        night: world.night,
        windLevel: wind.level,
        windSpeed: +wind.baseSpeed.toFixed(2),
        quality: quality.resolved,
        fps: Math.round(fps)
      };
    },
    launch: (id, drone) => launch(id || 'free', drone || spec.id),
    arm: () => doArm(true),
    setThrottle(v) { controls.setThrottle(v); },
    setNight(v) { world.setNight(v); settings.night = v; },
    crash: () => { if (state === 'play') { model.triggerCrash(); } },
    dbg: () => ({
      state, helpOpen, drone: spec.id,
      thr: controls.throttle, coll: +model.collective.toFixed(3),
      thrustN: +model.thrustN.toFixed(2), weight: +model.weight.toFixed(2),
      bf: +model._batteryFactor().toFixed(3), batt: +model.battery.toFixed(3),
      armed: model.armed, landed: model.landed, y: +model.pos.y.toFixed(3),
      vy: +model.vel.y.toFixed(3), rpm: +model.rpmNorm.toFixed(2)
    }),
    cycleView: () => { rig.next(); hud.setView(rig.name); },
    tp(x, y, z, vx = 0, vy = 0, vz = 0) { model.pos.set(x, y, z); model.vel.set(vx, vy, vz); },
    gates: () => world._gateDefs.map((g) => ({ pos: g.pos.toArray(), passed: g.passed })),
    restart: () => restart(),
    quit: () => quitToMenu(),
    wind(level) { wind.setStrength(level); settings.wind = level; saveSettings(settings); },
    windSpeed() { return { level: wind.level, strength: wind.strength, speed: +wind.baseSpeed.toFixed(2), heading: Math.round(wind.headingDeg) }; }
  };
} catch (err) {
  bootError(err);
}
