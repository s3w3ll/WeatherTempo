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
| 2c | 4-day cards, week strip + summary, hourly table, Pages deploy workflow | next |
| 3 | iOS unsigned-ipa job, notifications/alerts, warnings, diagnostics | |
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
