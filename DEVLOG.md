# QuadSim Pro — Development Log

Autonomous staged development. Baseline: v0.1.0 (`cfc2ba1`) — full simulator rewrite, pushed to github.com/raamasri/quadcopter-sim (public), deployed to Vercel project `raama-srivatsans-projects/quadcopter-sim`.

## Stage plan
| Stage | Theme | Status |
|---|---|---|
| v0.2.0 | Wind system: WindField, air-relative physics, windsock/flags/dust, wind audio, HUD indicator, settings | done |
| v0.3.0 | Visual fidelity: PMREM env reflections, shadow camera follow, fog, Low/Med/High quality presets | implemented, pending QA |
| v0.4.0 | Touch controls: dual virtual sticks + arm/camera/pause buttons | implemented, pending QA |
| v0.5.0 | HUD minimap + UI no-overlap polish pass | implemented, pending QA |
| v0.6.0 | TT ghost replays (record best run, translucent ghost) | planned |
| v0.7.0 | PWA (manifest, icons, meta/og, vercel.json) + final polish | planned |

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