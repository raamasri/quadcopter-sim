# QuadSim Pro — Development Log

Autonomous staged development. Baseline: v0.1.0 (`cfc2ba1`) — full simulator rewrite, pushed to github.com/raamasri/quadcopter-sim (public), deployed to Vercel project `raama-srivatsans-projects/quadcopter-sim`.

## Stage plan
| Stage | Theme | Status |
|---|---|---|
| v0.2.0 | Wind system: WindField, air-relative physics, windsock/flags/dust, wind audio, HUD indicator, settings | done |
| v0.3.0 | Visual fidelity: PMREM env reflections, shadow camera follow, fog, Low/Med/High quality presets | planned |
| v0.4.0 | Touch controls: dual virtual sticks + arm/camera/pause buttons | planned |
| v0.5.0 | HUD minimap + UI no-overlap polish pass | planned |
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