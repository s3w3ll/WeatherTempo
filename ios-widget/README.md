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
   preview — you should see current Christchurch conditions.
4. Long-press your home screen → **+** (top left) → search **Scriptable** →
   drag on a **small** or **medium** widget.
5. Long-press the new widget → **Edit Widget** → set:
   - **Script**: `WeatherTempo`
   - **When Interacting**: `Run Script`
6. (Optional) Add both a small and a medium widget as separate tiles — same
   script serves both sizes.

## Refresh behaviour

iOS controls widget refresh timing itself (it's a system budget, not
something an app can force) — typically every 15–60 minutes depending on
how often you look at the widget. The script sets `refreshAfterDate` as a
*hint* (30 min, matching the data pipeline's cadence) but iOS may refresh
less often to save battery. Tapping the widget always re-runs the script
for a fresh read.

## Customizing

- **Icon/color mapping** — `iconForCondition()` in `WeatherTempo.js` is a
  stub; fill it in with your own SF Symbol + accent-color choices per
  `iconCode` (see the comment block above the function for the full code
  reference and trade-offs).
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
