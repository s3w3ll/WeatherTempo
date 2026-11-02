# WeatherTempo Native iOS App (SwiftUI) Implementation Plan

**Goal:** Replace the WeatherGraph iOS app on the author's phone with a native SwiftUI app that renders the same swimlane meteogram, current-conditions cards, daily forecast and tides, plus real WidgetKit home/lock-screen widgets. No Apple Watch work.

**Architecture:** A native client for the *existing* Cloudflare Worker (`https://weathertempo-pws-proxy.forgesync.workers.dev?location=<id>`). The Worker, its JSON contract, and the web app are not changed. All logic shared between the app and the widget lives in a local Swift Package (`WeatherTempoKit`) so the widget extension and the app never drift apart.

**Tech Stack:** Swift 5.10+/6, SwiftUI, `Canvas` for the chart, WidgetKit, `URLSession` + `Codable`, Swift Testing (or XCTest), min target **iOS 17** (needed for `containerBackground`, interactive widgets, `@Observable`).

**Constraints / environment**
- Authored on Windows in this repo; **compiled and tested by GitHub Actions on a macOS runner** (the local 2018 Mac is a fallback, not a requirement). The Swift has no local compiler feedback, so "Verify on Mac" steps below mean "check the CI run (or a Mac if available)".
- Free Apple ID signing to start (7-day expiry), via Sideloadly/AltServer from Windows. Paid account only needed later for TestFlight / push / CI signing.
- Source of truth for behaviour is the existing JS: `src/chart.js`, `src/tides.js`, `src/locations.js`, `src/app.js`, `ios-widget/WeatherTempo.js`.

---

## Repo layout

New top-level folder `ios/` (keeps native code out of the GitHub Pages root; add `ios/` to `.nojekyll` concerns only if Pages ever serves it, which it should not).

```
ios/
  WeatherTempo.xcodeproj
  WeatherTempo/                 # app target
    WeatherTempoApp.swift
    Views/ (DashboardView, CurrentCard, DailyStrip, TidesPanel, LocationPicker, StaleBanner)
  WeatherTempoWidget/           # widget extension target
    WeatherTempoWidget.swift    # TimelineProvider + small/medium/large + lock-screen
  Packages/WeatherTempoKit/     # local Swift package, linked by both targets
    Sources/WeatherTempoKit/
      Models/    WeatherPayload.swift
      Network/   WeatherClient.swift, PayloadCache.swift
      Locations/ Location.swift (port of src/locations.js)
      Tides/     TidePredictor.swift (port of src/tides.js)
      Chart/     ChartLayout.swift, MeteogramView.swift, CurveMath.swift
      Theme/     Palette.swift
    Tests/WeatherTempoKitTests/
```

---

## Task 0: CI-first bootstrap (REVISED: the author's Mac is a 2018 MacBook that may not run a current Xcode)

The Mac is optional. GitHub Actions on a macOS runner (free: public repo) is the compiler and test runner.

- [x] `ios/project.yml` (XcodeGen) is the project definition; the `.xcodeproj` is generated in CI and never committed, so no Xcode GUI clicks are needed and everything is editable from Windows.
- [x] `.github/workflows/ios-ci.yml`: select newest stable Xcode, `swift test` the package, generate project, simulator compile-check, build an **unsigned `.ipa`** artifact.
- [x] `ios/README.md`: install path = download the `.ipa` artifact, sign + install from Windows with **Sideloadly / AltServer** using a free Apple ID (7-day expiry). Needs Developer Mode on the phone.
- [ ] Verify the first CI run is green (fix compile errors it reveals; none of the Swift has been compiled yet).
- [ ] Sideload once to confirm the install path works on the actual phone.
- [ ] **Known risk:** App Groups / extensions under Sideloadly + free Apple ID (needed for the Task 5 widget to share the cache). Test early with a stub widget; if it fails, the widget fetches the Worker directly instead of reading the shared cache.
- [ ] Optional: check whether the local Mac can run Xcode 26.x (macOS Sequoia is likely its ceiling) and whether Xcode supports the phone's iOS version. Not required.
- [ ] Later, with a paid account: CI signs with an App Store Connect API key and uploads to TestFlight, still no Mac.

---

## Task 1: Data model + client (`WeatherTempoKit`)

Maps the Worker payload (verified against `workers/pws-proxy.js` and `data/weather.json`):

```
meta{updated, location, lat, lon, sourceStatus{openMeteo, pws, currentSource}}
current{temp, feelsLike, humidity, pressure, windSpeed, windGust, windDirection,
        windCardinal, uvIndex, dewPoint, solarRad, condition, cloudPhrase, iconCode,
        sunriseUtc, sunsetUtc, tempMax24h, tempMin24h}
today{moonPhase, moonPhaseCode, moonPhaseDay}
hourly[120]{validTimeUtc, temperature, temperatureFeelsLike, relativeHumidity,
            windSpeed, windDirection, windDirectionCardinal, windGust, cloudCover,
            qpf, precipChance, precipType, pressureMeanSeaLevel, uvIndex, iconCode,
            dayOrNight, wxPhraseMedium}
daily[5]{calendarDayTemperatureMax/Min, temperatureMax/Min, sunriseTimeUtc, sunsetTimeUtc}
```

- [ ] `WeatherPayload.swift`: `Codable` structs. **Decode every numeric as `Double`** (Worker mixes ints/floats, e.g. `temp` vs `windSpeed`) and make `daily.*` and `sourceStatus` optional (`?? null` in the Worker, and `sourceStatus` was added late).
- [ ] `WeatherClient.swift`: `actor` with `func load(location: Location) async throws -> WeatherPayload`. 10 s timeout, 2 retries with backoff (mirror `DataFetcher` in `src/app.js` lines ~70-190), `cachePolicy = .reloadIgnoringLocalCacheData`.
- [ ] Validation mirroring `app.js` ("well-formed and recent"): reject payloads with empty `hourly`, flag `meta.updated` older than 45 min as stale.
- [ ] `PayloadCache.swift`: write last good JSON to the App Group container, keyed by location id. Dashboard shows cached data instantly, then refreshes (stale-while-revalidate). Widget reads the same file.
- [ ] Tests: decode `data/weather.json` copied into `Tests/Fixtures/` (add a null-`daily` and missing-`sourceStatus` fixture).

**Verify on Mac:** `swift test` in the package passes; a debug button in the app prints decoded `current.condition`.

## Task 2: Locations + tides port

- [ ] `Location.swift`: port the array in `src/locations.js` (id, name, lat/lon, `pwsStation`, `tidePort`, `tideLabel`). Keep ids identical, they're the Worker's query keys.
- [ ] `TidePredictor.swift`: port `src/tides.js` (harmonic sum over LINZ constituents, **J2000.0 epoch = 2000-01-01 12:00 UTC**, per CLAUDE.md gotcha 4). Keep the constants as Swift data, same values.
- [ ] Tests: golden values. Run the JS (`node`) for 3 timestamps per port and assert the Swift output matches to ±0.01 m. This is the cheap, high-value correctness check for the port.

## Task 3: Meteogram chart (the core feature)

Use SwiftUI **`Canvas`** (not Swift Charts): the swimlane layout, cloud overlay, wind arrows and per-zone scaling are custom and map 1:1 onto the existing canvas code. Swift Charts would fight the layout.

Port `src/chart.js` method by method; the `ZONE` constants become a `ChartLayout` struct with the **70/15/15 split** (main 0-224, wind 228-276, precip 280-328, axis 332-364; keep all 8 constants consistent per CLAUDE.md).

| JS method | Swift |
|---|---|
| `_drawBackground`, `_drawDayDividers` | `drawGrid(in:)` |
| `_drawCloudCover` | `drawClouds(in:)` (white, opacity by cover %, see recent "white clouds" commits) |
| `_drawTemperatureArea/Line`, `_drawFeelsLikeLine`, `_drawTempLabels` | `drawTemperature(in:)` using `CurveMath.catmullRom(points, tension: 0.5)` → `Path.addCurve` |
| `_drawPressureLine` | `drawPressure(in:)` |
| `drawWindIndicators` | `drawWind(in:)`; arrow rotation = `windDirection` degrees clockwise from N (SwiftUI rotation is clockwise already, so **drop the `-90` fix** the JS needs) |
| `_drawPrecipBars` | `drawPrecip(in:)` |
| `_drawNowMarker`, `_drawTimeAxis`, `_drawDayAxis` | `drawAxes(in:)` |
| hover tooltip (`attachHover`) | `DragGesture(minimumDistance: 0)` → scrub line + tooltip overlay (haptic tick per hour) |

- [ ] Wrap in `ScrollView(.horizontal)` with a fixed pixels-per-hour, auto-scrolled to "now"; days-to-show picker persists via `@AppStorage` (matches the web `localStorage` feature).
- [ ] Pixel snapping: the JS `Math.floor` rule becomes `(x * scale).rounded() / scale` using `displayScale`, otherwise 1 px lines blur on Retina.
- [ ] `MeteogramView` takes plain data + a `ChartLayout`, no networking, so the **widget reuses it**.

**Risk (spike first):** `Canvas` inside a widget. WidgetKit snapshots views; `Canvas` generally works, but if it does not render, fall back to `ImageRenderer` to produce a `UIImage` (this is exactly what `renderMeteogramImage()` does in the Scriptable widget). Do this spike *before* investing in widget layout.

**Verify on Mac:** side-by-side screenshot against `https://<site>` at the same hour; zones, curves and colours match; SwiftUI previews for light/dark and for edge data (all-zero rain, 100% cloud).

## Task 4: Dashboard UI

- [ ] `DashboardView`: header (location, "updated N min ago"), `CurrentCard` (temp, feels like, wind, humidity, UV, pressure, sunrise/sunset, moon), meteogram, `DailyStrip` (5 days), `TidesPanel` (hidden when `tidePort == nil`).
- [ ] `@Observable DashboardModel`: cache-first load → network refresh → `StaleBanner` when `sourceStatus.pws == "stale"` or payload age > 45 min (mirror the web error banner wording).
- [ ] `.refreshable`, `scenePhase == .active` refresh, `LocationPicker` sheet (last location in `@AppStorage`).
- [ ] Theme: port the light theme palette from `docs/design_handoff_light_theme/README.md` into `Palette.swift`; support dark via asset-catalog colours.
- [ ] Icons: map Open-Meteo/WMO `iconCode` → SF Symbols (the Scriptable widget already has this mapping to reuse).

## Task 5: WidgetKit

- [ ] `TimelineProvider`: read App Group cache → render immediately; schedule a refresh `.after(Date()+30min)` and fetch in `getTimeline`. iOS throttles; expect 15-60 min, same caveat as the Scriptable widget.
- [ ] Families: `.systemSmall` (now + hi/lo), `.systemMedium` (now + next hours), `.systemLarge` (two-panel meteogram, like-for-like with the Scriptable large widget), `.accessoryRectangular` / `.accessoryCircular` (lock screen).
- [ ] `.containerBackground(for: .widget)`; widget tap deep-links to the app on that location.
- [ ] Keep the Scriptable widget in the repo as the zero-cost fallback.

## Task 6: Polish & distribution

- [ ] App icon from `docs/icon/icon-512x512.png` (Xcode needs a 1024 px source; regenerate from `favicon.svg`).
- [ ] Launch screen, `Info.plist` display name, accessibility labels and Dynamic Type on cards, VoiceOver summary of the chart ("Rain likely 3pm, 4 mm").
- [ ] Offline: cached payload + "Offline, showing data from 14:05".
- [ ] Free-account run: re-sign weekly (or AltStore/SideStore). If the 7-day churn is annoying, enrol ($99/yr) → internal TestFlight (no review, 90-day builds).
- [ ] If ever pursuing App Store review: privacy policy URL + "Data not collected" label; the app is genuinely native, so Guideline 4.2 is not a concern.

---

## Out of scope (explicitly)

Apple Watch app/complications, push notifications / rain alerts (needs paid account + a Worker cron and APNs), Live Activities, Android, changes to the Worker contract.

## Suggested order & milestones

1. Task 0 + Task 1 → app launches and prints live data.
2. Task 3 spike (Canvas in widget) in parallel with the chart port: biggest technical unknown.
3. Task 3 full chart → Task 4 dashboard: **usable daily driver** (milestone A).
4. Task 5 widgets: **WeatherGraph replacement complete** (milestone B).
5. Task 2 tides can slot in anywhere after Task 1.
6. Task 6 polish.

## Open questions for the user

- Which WeatherGraph features beyond the chart + widgets do you rely on (alerts? radar? specific lock-screen layouts)? This only matters for scope after milestone B.
- Is dark mode required at launch or can it follow after the light theme?
