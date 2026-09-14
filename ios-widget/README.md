# WeatherTempo iOS Widget (Scriptable)

Home-screen widget for WeatherTempo, built with [Scriptable](https://scriptable.app/)
(free, no Xcode/Apple Developer account needed). Pulls live data from the
same Cloudflare Worker the web dashboard uses.

## Iterating without copy-pasting into Scriptable every time

[`preview.html`](./preview.html) is a browser-based simulator — a shim
implementing just enough of the Scriptable API (`ListWidget`, `DrawContext`,
`Path`, `Color`, `Font`, `Request`, `SFSymbol`, …) to run
[`WeatherTempo.js`](./WeatherTempo.js) **unmodified** in a normal browser tab.
Real live worker data, real colors/fonts/layout — only the SF Symbol icons
are simplified stand-in shapes (not Apple's actual glyphs), since those
only render for real on-device.

```bash
python -m http.server 8080
# then open http://localhost:8080/ios-widget/preview.html
```

It polls the file every 1.5s and re-renders automatically when it changes —
edit `WeatherTempo.js`, save, watch the preview update. Switch widget
family (small/medium/large) and light/dark mode from the toolbar. Once it
looks right, paste the file into Scriptable per the steps below to confirm
on-device (icons especially — the real SF Symbols will look sharper).

## Setup

1. Install **Scriptable** from the App Store.
2. Open Scriptable → **+** (top right) → paste the contents of
   [`WeatherTempo.js`](./WeatherTempo.js) → tap the untitled name at the top
   and rename the script to `WeatherTempo`.
3. Run it once inside the app (▶) to confirm it fetches and renders a
   preview — you should see current Christchurch conditions. By default
   the in-app preview shows the small size; to preview medium/large, tap
   the widget-family icon in the bottom toolbar before running (or just
   add the widget to your home screen — step 4 — and see it there).
4. Long-press your home screen → **+** (top left) → search **Scriptable** →
   drag on a **small**, **medium**, or **large** widget. Pick **large** for
   the two-panel meteogram (a like-for-like recreation of Apple Weather's
   watch-app forecast screen) — small/medium show a condensed
   current-conditions card instead, there isn't enough height in those
   sizes for a chart.
5. Long-press the new widget → **Edit Widget** → set:
   - **Script**: `WeatherTempo`
   - **When Interacting**: `Run Script`
6. (Optional) Add more than one size as separate tiles — same script
   serves all three.

## Refresh behaviour

iOS controls widget refresh timing itself (it's a system budget, not
something an app can force) — typically every 15–60 minutes depending on
how often you look at the widget. The script sets `refreshAfterDate` as a
*hint* (30 min, matching the data pipeline's cadence) but iOS may refresh
less often to save battery. Tapping the widget always re-runs the script
for a fresh read.

## The large-widget meteogram

`buildLargeWidget()` is a like-for-like recreation of an Apple Weather
watch-app screenshot: a header (current temp/feels-like/icon + a condition
summary), a precip-intensity status line with a short rail showing the next
few hours' rain rate, then two stacked chart panels. Both panels are drawn
by the same `renderChartPanel()` function into an offscreen `DrawContext`
(Scriptable's `ListWidget` layout system can only stack text/images/spacers
— it can't draw curves or bars directly) and dropped into the widget as
images:
- **Hourly panel** — the next ~36 hours, x-axis labeled with hour-of-day
  numbers and a day-name chip at each midnight (`18 · FRI · 6 · 12 · 18 ·
  SAT`, matching the reference).
- **Daily panel** — every hour the worker returns (5 days), x-axis labeled
  with one day name per day and that day's hi/lo plotted right on the curve
  at its peak/trough.

Each panel draws, top to bottom: a white "cloud cover" wave
(`drawCloudWave`, amplitude tracks hourly `cloudCover%`) + a raindrop row
(`drawRaindrops`), a dotted cyan feels-like line, the solid temp curve with
its fill, a dashed red wind line sharing the temp zone's pixel range on its
own auto-scaled axis (plus one direction arrow per day), and blue
precip-chance bars + green UV bars in the bottom strip.

**Why the panels render transparent.** The reference sits on one continuous
blue gradient behind the header, status line, and both charts — not a dark
card per chart. `buildLargeWidget()` sets that gradient as
`widget.backgroundGradient` and every chart image is drawn with
`draw.opaque = false`, so it shows through anywhere nothing is drawn. It
also means the white cloud fill and yellow temp fill blend with that blue
into the same olive-green the reference shows wherever they overlap — that
falls out of ordinary alpha compositing, nothing is color-mixed by hand.

Known simplifications, in order of how much they matter:
- **The headline sentence** (`"0.9 mm/h light rain for 3 hours, then
  moderate rain"`) is intentionally a stub — `describePrecipTrend()` in
  `WeatherTempo.js` just returns `current.condition` until you write the
  actual trend narrative. It's flagged as a TODO in-file because there's no
  single correct phrasing (how far ahead to look, what counts as a trend
  vs. noise) — see the comment above the function.
- **5 days, not 7** — the reference's bottom panel spans a week; this one
  spans 5 days because that's all Open-Meteo's free tier returns via this
  worker (`forecast_days=5` in `workers/pws-proxy.js`). Extending the
  worker's forecast range would extend this too.
- **"17:05"-style minute precision** isn't real — the worker's hourly data
  lands on the hour, so the status line always shows `:00`.
- Cloud cover is a stylized crossing-wave motif, not literal cloud texture
  (not practical in DrawContext's path API).
- True Catmull-Rom smoothing (currently uses a cheaper midpoint-quadratic
  approximation — visually close, not identical, to `chart.js`'s curve).
- No pressure line, no sunrise/sunset shading blocks on the daily panel.

## Customizing

- **Icon/color mapping** — `iconForCondition()` in `WeatherTempo.js` maps
  each `iconCode` to an SF Symbol + accent color (see the comment block
  above it for the full code reference if you want to adjust any).
- **Chart span** — the daily panel always plots everything `data.hourly`
  contains (5 days, matching what the worker returns — going higher needs
  the worker's forecast range extended too). The hourly panel's span is the
  `36` in `hourly.slice(0, 36)` inside `buildLargeWidget()`.
- **Different location** — change `LOCATION_ID`/`LOCATION_LABEL` at the top
  of the script to any id from `workers/pws-proxy.js`'s `LOCATIONS` map
  (only `christchurch` gets live PWS current-conditions; everything else
  falls back to Open-Meteo-only).

## Why Scriptable instead of a native WidgetKit app?

A real WidgetKit widget needs a native Swift app + widget extension built
in Xcode, which requires a Mac and (for anything beyond a 7-day local
sideload) an Apple Developer account. Scriptable ships its own widget
extension already installed and registered with iOS — you're just handing
it a JS script to run each refresh — so this gets a real home-screen
widget with no Mac, no Xcode, no paid account, and no App Store review.
The trade-off: Scriptable is a third-party app in the loop rather than
your own bundle ID.
