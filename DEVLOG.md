# QuadSim Pro — Development Log

Autonomous staged development. Baseline: v0.1.0 (`cfc2ba1`) — full simulator rewrite, pushed to github.com/raamasri/quadcopter-sim (public), deployed to Vercel project `raama-srivatsans-projects/quadcopter-sim`.

## Stage plan
| Stage | Theme | Status |
|---|---|---|
| v0.2.0 | Wind system: WindField, air-relative physics, windsock/flags/dust, wind audio, HUD indicator, settings | done |
| v0.3.0 | Visual fidelity: PMREM env reflections, shadow camera follow, fog, Low/Med/High quality presets | implemented, pending QA |
| v0.4.0 | Touch controls: dual virtual sticks + arm/camera/pause buttons | implemented, pending QA |
| v0.5.0 | HUD minimap + UI no-overlap polish pass | implemented, pending QA |
| v0.6.0 | TT ghost replays (record best run, translucent ghost) | implemented, pending QA |
| v0.7.0 | PWA (manifest, icons, meta/og, vercel.json) + final polish | implemented, pending QA |

## Invariants
- No new npm dependencies; no external/remote assets — everything procedural.
- `window.__SIM` headless hooks must keep working.
- 60 FPS target, zero console errors, clean build.

## Open questions (deferred to the end)
- (none yet)

## Log
- 2026-11-15: v0.1.0 baseline on GitHub + Vercel prod. Started v0.2.0 wind system.

- 2026-11-15: v0.2.0 wind system implemented, audited PASS (0 crit/major; minors fixed: dead CFG freq keys, unused local). Runtime: 60 FPS, 0 console errors, wind 1.8 m/s breezy verified via __SIM.
- 2026-11-15: v0.2.0 deployed -> https://quadcopter-sim.vercel.app (production alias, guest GET 200, protection not blocking). CLI linked to raama-srivatsans-projects/quadcopter-sim.

- 2026-11-15: v0.3.0 visuals implemented+audited (FIXES_APPLIED: HIGH-severity corrupted SETTINGS_KEY U+2026 fixed with legacy migration; env debounce 600->1500ms; dust motes now soft round sprites). Leak test pass (130/101/31 stable over 10 night toggles), 60 FPS, pond reflections verified visually.
- 2026-11-15: v0.4.0 touch controls implemented: src/ui/touch.js dual dynamic-anchor sticks (Mode 2, per-pointer capture, 0.12 deadzone, 0.5s authority hold) + ARM/CAM/MODE/PAUSE glass buttons reusing keyboard handlers; settings.touch auto/on/off persisted (SETTINGS_KEY unchanged); telemetry/throttle/battery lift via body.touch-on; __SIM.touch(on) + state.touchEnabled.
- 2026-11-15: v0.4.0 touch controls implemented+audited (minor fix: knob transform reset on re-press; knob contrast boosted). Multi-touch verified, ARM/CAM/MODE/PAUSE buttons wired to keyboard paths, telemetry lifted clear of stick zones.
- 2026-11-15: v0.5.0 HUD minimap implemented: src/ui/minimap.js north-up 300px-backing canvas under .minimap-wrap (top-left under wind cluster, 150px / 120px touch-on, moved to top-center-left on short landscape windows). Static world layer (arena ring, runway, pond, OBB buildings, tree dots, helipad H, N label) baked to one offscreen canvas, re-baked only on day/night flips via world.onNightChanged; gates (passed/next-pulse/todo), mission markers, 20-point Float32 trail ring-buffer and heading arrow redraw at 20 Hz cap with zero per-frame allocations (fixed style strings + globalAlpha). Visible in play (full) / pause (dimmed) only; settings.minimap on/off select in Settings + persisted (SETTINGS_KEY unchanged). HUD polish pass: --stick-h/--surface/--blur/--focus tokens unified panels/chips/toast/cards, global :focus-visible rings, touch-on layout reflow (ADI dial + arm-hint + battery volts-line hidden; portrait left-stack minimap->readout->battery with 2x2 action grid; landscape compact telemetry with QUALITY row dropped, actions in a row above right stick), help overlay scrolls (max-height + inset padding), pause/results cards viewport-capped, 1-column menus <=520px, 44px thumb targets, results version footer. package.json + config VERSION -> 0.5.0.
- 2026-11-15: v0.6.0 TT ghost replays implemented: src/game/ghost.js GhostRecorder (Float32Array ring buffer, 20 Hz, 2400-frame prealloc + grow, pruned to ~10 Hz / 3 dp on save) persists ONLY on a new TT lap record into new key quadsim.ghosts.v2 { droneId: { t, frames:[[t,x,y,z,qx,qy,qz,qw]...], gateTs:[s per gate = nearest-frame scan] } } (quota errors silently drop). GhostReplay playback: translucent cyan droneVisual buildDrone({ghost:true}) clone (opacity 0.32, emissive tint, depthWrite off, no shadows, static blades, dim LEDs, no trail), mesh cached per droneId and reused across restarts; timeline driven by mission.time so pause freezes the pose, crash/quit/restart re-attach replays from t=0, hidden after timeline end / results / menu. Delta chip + GHOST ON chip in the objective panel: per-gate player-elapsed vs ghost.gateTs (first gate ±0.00 muted, green/red thereafter, last delta persists between gates); HUD writes change-gated. Settings 'Ghost replay' On/Off row (default on) in quadsim.settings.v2 (key untouched, byte-verified), live apply mid-run. Results shows 'NEW GHOST SAVED' row when storage updated. __SIM.ghostInfo() + state.ghostActive added; all 15 existing hooks intact (16 now). package.json + config 0.6.0.
- 2026-11-15: v0.7.0 PWA + final polish implemented: scripts/gen-icons.mjs (pure-Node PNG writer: CRC32 table + zlib deflateSync, RGBA scanlines filter 0, rounded-rect/segment SDF quad glyph on dark full-bleed bg, 2x supersampled) generates public/icons/{icon-192,icon-512,icon-maskable-512,apple-touch-icon-180}.png committed as assets. public/manifest.webmanifest (standalone + window-controls-overlay, theme/bg #0a101a, icons any/maskable split). index.html head: manifest link, description, theme-color, apple capable/status-bar black-translucent/apple-touch-icon, OG + twitter:card, viewport-fit=cover. public/sw.js quadsim-v3: navigations network-first (fresh deploys win, offline falls back to cached '/'), hashed /assets/ + /icons/ cache-first, rest passthrough; registered in main.js guarded off localhost/127.0.0.1 (dev vite 404s /sw.js -> would log a console error; guard keeps dev console clean). vercel.json cache headers (sw/manifest must-revalidate, assets immutable 1y, icons 1d). README PWA section + storage-key table. Final sweep: no TODO/console.log in src. package.json + config VERSION 0.7.0.
- 2026-11-15: v0.7.0 PWA implemented+audited (FIXES: hostname SW guard replaced with import.meta.env.DEV, and hidden TLA/load race that would have blocked SW registration in prod fixed readyState-aware). Offline boot proven on preview build; icons CRC-verified + visually clean.

## Deferred questions for the user
1. Settings key is quadcopter-sim.settings.v2 while records/ghosts use quadsim.* - left as-is for save compatibility; unify only if you accept a migration.
2. Artificial-horizon dial is hidden on touch layouts (compact pitch/roll text replaces it) - confirm you are OK losing the dial on phones.
3. Touch throttle is Mode-2 absolute hold: releasing the left stick drops throttle to zero (real radio behavior). Want a hover-hold assist toggle instead of/in addition to this?
4. Vercel project is under raama-srivatsans-projects (personal) - rename the project or alias quadcopter-sim.vercel.app is already yours; change anything?
- 2026-11-15: v0.7.1 hotfix - touch reflow media queries were applying on touch-capable DESKTOPS (phone-landscape button row at x=448 over the help panel, unscoped short-window rules). Scoped portrait/landscape touch reflows to max-width:960px and gated short-window block on body.touch-on. Verified 0 overlaps at 1280x800 touch-on + 390x844 regression.
