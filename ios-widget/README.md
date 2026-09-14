# WeatherTempo iOS Widget (Scriptable)

Home-screen widget for WeatherTempo, built with [Scriptable](https://scriptable.app/)
(free, no Xcode/Apple Developer account needed). Pulls live data from the
same Cloudflare Worker the web dashboard uses.

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
   the meteogram (temperature curve + precip bars) — small/medium show a
   condensed current-conditions card instead, there isn't enough height in
   those sizes for a readable chart.
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

`renderMeteogramImage()` draws a simplified version of the web dashboard's
`chart.js` meteogram (temperature curve + fill, dashed feels-like line,
precip-chance bars, hour axis) into an offscreen `DrawContext`, since
Scriptable's `ListWidget` layout system can only stack text/images/spacers
— it can't draw curves or bars directly. The image is then dropped into the
widget like any other image element.

Deliberately left out for now, to keep the first pass simple — all good
follow-ups if you want closer parity with the web chart:
- Cloud-cover shading (the pale overlay bands in the web chart)
- Wind-speed row + direction arrows
- True Catmull-Rom smoothing (currently uses a cheaper midpoint-quadratic
  approximation — visually close, not identical)
- A second day of data (currently shows the next `CHART_HOURS` hours only)

## Customizing

- **Icon/color mapping** — `iconForCondition()` in `WeatherTempo.js` maps
  each `iconCode` to an SF Symbol + accent color (see the comment block
  above it for the full code reference if you want to adjust any).
- **Chart span** — `CHART_HOURS` at the top of the script controls how many
  hourly points the large widget's meteogram plots (16 by default).
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
