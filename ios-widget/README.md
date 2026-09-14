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
   the 5-day meteogram — small/medium show a condensed current-conditions
   card instead, there isn't enough height in those sizes for a chart.
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

`renderMeteogramImage()` draws the 5-day chart into an offscreen
`DrawContext`, since Scriptable's `ListWidget` layout system can only stack
text/images/spacers — it can't draw curves or bars directly. The image is
then dropped into the widget like any other image element.

**Why it's not a literal 5-series chart.** The web dashboard's `chart.js`
plots temp/feels-like/wind/precip/pressure as separate zones over a much
bigger canvas. A large widget's chart area is ~300×168px — five fully
independent zones for Temp, Wind, Cloud, Rain, and UV in that space would
be unreadable at a glance (which defeats the point of a widget). So it's:
- **Temp** — the curve, with each day's hi/lo (from the worker's `daily[]`)
  plotted right on the curve at that day's peak/trough, mirroring the
  floating hi/lo labels in the WeatherGraph reference screenshot.
- **Wind** — shares the temp zone rather than getting its own strip: a
  dashed red line on its own auto-scaled min/max axis (same pixel range as
  temp, different value-per-pixel — a proper dual-axis overlay), plus one
  direction arrow per day at a representative hour (all 120 points would
  be far too dense for arrows). Dashed so it doesn't read as a second temp
  line where the two curves cross.
- **Cloud** — flat-opacity background shading per hour (no gradient —
  `DrawContext` has no path-gradient fill, unlike canvas in `chart.js`).
- **Rain** — precip-chance bars in the strip below the curve.
- **UV** — dropped from the chart entirely, surfaced instead as a per-day
  badge (`14km · UV5`) in the strip under the chart — one peak-per-day
  number rather than a full profile, since UV mainly matters near its
  daily peak anyway.

Other simplifications worth knowing about:
- True Catmull-Rom smoothing (currently uses a cheaper midpoint-quadratic
  approximation — visually close, not identical, to `chart.js`'s curve).
- Wind's day-strip badge is the day's *max* speed; the on-chart line is the
  hourly profile. UV is always the day's peak index, not a full profile.
- No pressure line.

## Customizing

- **Icon/color mapping** — `iconForCondition()` in `WeatherTempo.js` maps
  each `iconCode` to an SF Symbol + accent color (see the comment block
  above it for the full code reference if you want to adjust any).
- **Chart span** — `CHART_DAYS` at the top of the script controls how many
  days the large widget's meteogram plots (5 by default, matching what the
  worker returns — going higher needs the worker's forecast range extended
  too).
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
