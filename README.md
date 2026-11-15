# QUADSIM PRO

A customer-facing quadcopter flight simulator that runs entirely in the browser.
Realistic rigid-body physics, procedural world with generated textures (no
downloaded assets), six game modes with persistent records, synthesized engine
audio, and keyboard / mouse / gamepad support.

## Run it

```bash
npm install
npm run dev      # http://127.0.0.1:5178
npm run build    # production bundle in dist/
npm run preview  # serve the production build
```

## Game modes

| Mode | Goal | Record |
|---|---|---|
| **Free Flight** | Sandbox. Learn the quad, fly the gates, switch day/night. | gates flown |
| **Time Trial** | 14 gates, strict order, one lap. +1s per impact, crash = wreck. | best lap time |
| **Gate Rush** | 120 s, any gate any order. Chain gates within 10 s for combo multipliers. | best score |
| **Cargo Run** | Load at the cyan pad, deliver to amber zones before the LiPo dies. | best score |
| **Precision Hover** | 90 s inside a drifting zone under 1.6 m/s. | stability % |
| **Freestyle** | 90 s judge session: flips, rolls, spins and gate links build combo. | best score |

Best results persist in `localStorage` (`quadsim.records.v2`). A new Time Trial
lap record also stores the full run as a replay ghost (`quadsim.ghosts.v2`): the
next TT launch on that airframe flies a translucent cyan ghost of your best lap
alongside you with a per-gate delta readout (on/off in Settings).

## Flight model (`src/core/physics.js`)

- Fixed 240 Hz substep integrator over a quaternion attitude model
- **Angle mode** (self-levelling attitude PD) and **Acro mode** (rate PD)
- Collective thrust with first-order rotor lag and battery voltage sag
- Battery model: capacity drain ∝ throttle^1.7, sag below 32 %, failsafe cutoff
- Quadratic + linear aerodynamic drag, ground effect near the deck
- Collisions against buildings (OBB), trees (cylinders), arena wall and ceiling
  with restitution and impact damage; hard impacts wreck the airframe
- Per-motor rotor speeds derived from an X-frame mixer (drives visuals + audio)

## Controls

| Action | Keyboard | Gamepad (Mode 2) |
|---|---|---|
| Arm | hold throttle-down + **E** (or **G**) | **A** |
| Disarm | hold throttle-down + **Q** | **A** |
| Pitch / Roll | **W/S**, **A/D** or arrows | right stick |
| Yaw | **Q/E** | left stick X |
| Throttle | **Space** / **Shift** | left stick Y |
| Angle ↔ Acro | **T** | **X** |
| Camera | **C**, digits **1–6** | **B** |
| Mouse look FPV | **M** | **Y** |
| Respawn / Pause | **R** / **P** | Select / Start |
| Day/night · Fullscreen · Help | **L** · **F** · **H** | — |

## Stack

- `three@0.170` + UnrealBloom post-processing + Reflector water + PMREM env
  reflections (graceful fallback if unavailable)
- `vite@6` dev/build
- Everything visual is generated at load: grass/asphalt/concrete/carbon/facade
  textures (with height→normal maps), lit-window night emissive facades,
  helipad, runway, sky shader with HDR sun disc + horizon glow, stars, pond
  ripple normals
- Quality presets Low/Med/High + Auto (hardware-detected, runtime auto-degrade
  on sustained < 40 fps); persisted in settings
- Audio is synthesized in WebAudio (motor bank, wind, gates, SFX) — zero assets
- HUD minimap: north-up top-down view of arena, gates, mission markers, trail and
  heading arrow; static world layer baked once to an offscreen canvas (re-baked on
  day/night only), overlay redraw capped at 20 Hz; on/off in Settings
- TT ghost replays: best lap recorded at 20 Hz into a preallocated Float32 ring
  buffer, pruned to ~10 Hz on save; translucent replay drone (mesh cached per
  airframe, zero per-frame allocations) driven by the mission clock so pause
  freezes it; per-gate delta chip; on/off in Settings

## Layout

```
src/
  main.js              game state machine + master loop
  core/physics.js      rigid-body flight model + collisions
  core/input.js        keyboard + mouse + gamepad + arming combo
  core/cameraRig.js    chase / FPV / orbit / top / side / cinematic
  core/audio.js        WebAudio engine
  core/drones.js       4 airframes with different flight envelopes
  core/quality.js      Low/Med/High tier maps + auto-degrade
  core/config.js       shared constants
  scene/world.js       arena, gates, markers, day-night, pond reflector, fog
  scene/env.js         PMREM environment map baked from the procedural sky
  scene/textures.js    procedural texture factory
  scene/droneVisual.js drone mesh, rotors, LEDs, motion trail
  game/missions.js     mission framework + 6 modes + records
  game/ghost.js        TT ghost record/save + translucent replay playback
  ui/hud.js            telemetry, ADI, throttle, arm, objectives
  ui/minimap.js        north-up canvas minimap (baked static world + 20 Hz overlay)
  ui/touch.js          dual virtual sticks + action buttons (auto/on/off)
  ui/screens.js        menu, hangar, settings, pause, results
```
