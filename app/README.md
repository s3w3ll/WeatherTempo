# WeatherTempo (Expo)

One TypeScript codebase for the website and the iOS app. Lives on the `EXPO`
branch while it is built; the root `index.html` site stays live until this
replaces it.

## Status

| Phase | What | State |
|---|---|---|
| 1 | Expo scaffold + shared core (`src/core`): tides, insights, locations, with tests | **done** |
| 2a | Data layer, theme, shell, conditions/warnings/tides cards | **done** |
| 2b | Skia meteogram + pressure strip + tide curve (hover/tap, zoom, scroll) | **done** |
| 2c | 4-day cards, week strip + summary, hourly table, Pages deploy workflow | **done** (workflow is inert until Pages source is switched; see `.github/workflows/pages.yml`) |
| 3a | CI builds an unsigned iOS ipa (macOS runner, ~8 min) | **done**; not yet run on a device |
| 3b | Notifications/alerts, background refresh, diagnostics screen | next |
| 4 | Native widget (expo-apple-targets, reusing the SwiftUI widget views) | |
| 5 | Retire the `ios` branch and the root vanilla-JS site | |

## Shared core (`src/core`)

Pure TypeScript: no React, DOM or canvas, so it runs unchanged on iOS (Hermes),
web and Node.

- `tides.ts`, `tidePorts.ts`: harmonic predictor and constants. New Brighton is
  fitted to LINZ's official table; tests check every one of the 1,410 highs and
  lows in 2026 (`__fixtures__/linz-new-brighton-2026.json`).
- `insights.ts`: sun position, sky/glow, dew point, pressure tendency, week
  columns, next-12-hours summary, warning timing.
- `locations.ts`: the single list of locations (the website had two copies).

```bash
npm install
npm test            # jest
npm run typecheck
npm run web         # expo start --web
npm run export:web  # static web build into dist/ (also fetches CanvasKit; not committed)
```

## Refitting tides each year

The predictor has no nodal corrections, so New Brighton is fitted to one year.
See the docstring in `tools/fit_linz_tides.py`: download LINZ's table for the
new year, `pdftotext -layout` it (not `-raw`), run the script, paste the
constants into `tidePorts.ts`, update the fixture, and run `npm test`.

## iOS build (no Mac, no paid Apple account)

`.github/workflows/ios-ipa.yml` runs on every push to `EXPO` that touches `app/`
(or by hand under Actions → "iOS ipa (Expo)" → Run workflow):

1. typecheck + tests, then `expo prebuild --platform ios` (the native project is
   generated from `app.json`, never committed), then `xcodebuild` for a device
   with signing off, then zip `Payload/` into an `.ipa`.
2. Download the `WeatherTempo-Expo-unsigned-ipa` artifact from the run.
3. On Windows, open Sideloadly (or AltServer / SideStore), plug in the phone,
   sign in with your free Apple ID and drag the `.ipa` in. Valid 7 days with a
   free ID (SideStore refreshes it automatically). Developer Mode must be on.

Runner: Expo SDK 58 targets the iOS 27 SDK; `macos-15` (Xcode up to 26.3) fails
to compile ExpoModulesJSI, `macos-26` (Xcode 26.6) works. Both runner and Xcode
are inputs on a manual run if that changes.

### Temporary: installs next to the Swift app
`app.json` uses bundle id `nz.sewell.weathertempo.expo` and name "WT Expo" so
this build does not replace the Swift app while we migrate.

## Cutover checklist (when the Expo app replaces everything)
- [ ] `app.json`: `ios.bundleIdentifier` → `nz.sewell.weathertempo`, `ios.infoPlist.CFBundleDisplayName` → `WeatherTempo`
- [ ] `.github/workflows/pages.yml`: trigger branch `EXPO` → `main`; Pages source → "GitHub Actions"; allow `main` on the `github-pages` environment
- [ ] `ios-ipa.yml` / `expo-ci.yml`: trigger branch `EXPO` → `main`
- [ ] Merge `EXPO` into `main`; retire the `ios` branch, `ios/`, `src/*.js`, `index.html`, `style.css` at the repo root
