# Handoff: WeatherTempo — Light Theme & Day-Extrema Chart Labels

## Overview

This handoff covers two changes to the WeatherTempo dashboard:

1. **Light theme** — A polished light-mode design (cool off-white base, white frosted cards, dark slate text, accent hues tuned for contrast). This is the design direction; **adopt it as the only theme** unless you want to keep a separate dark mode.
2. **Forecast chart label simplification** — On the main temperature graph, **only label the highest temperature and the lowest temperature for each calendar day** — not every local peak/trough. Two numbered markers per day, max.

## About the Design Files

The files in this bundle are **design references created in HTML/CSS/JS** — a working prototype showing the intended look, layout, and behavior. They are not production code to ship as-is. Recreate this design in your target codebase using its existing patterns (React, Vue, Svelte, native, whatever you use). If the project has no framework yet, choose what makes sense for the team.

The included `index.html`, `style.css`, `src/app.js`, and `src/chart.js` are the current working prototype — read them to understand the intended structure and behavior, then reimplement.

## Fidelity

**High-fidelity.** All colors (hex / oklch), spacing, typography, border radii, and interactions in the included files are final. Recreate pixel-perfectly in your codebase's preferred styling system (CSS variables, Tailwind theme, styled-components, etc.).

---

## Screens / Views

There is one screen — a single-page weather dashboard.

### Layout (1440px max, responsive)

| Region | Content |
|---|---|
| **Header** (sticky) | Location · last-updated · theme toggle (optional — see below) |
| **Hero row** | Today card (left, 380–460 px) + 2×2 grid of day forecast cards (right) |
| **Forecast chart** | Full-width line/area chart, scrollable horizontally, with day-zoom selector |
| **Tides card** | Full-width — curve graph on left, vertical event list on right |

Below `1100px` the hero row stacks vertically. Below `720px` day cards become one column and the hourly strip scrolls horizontally.

### Components

#### Today (conditions) card
Padding `22px 24px`, card background, blurred 24 px backdrop.

- **Top row** — weather icon (3.2 rem) + big temperature (5 rem, weight 200, letter-spacing −0.04em) + condition + "Feels like Nº"; right-aligned today high/low with up/down arrows.
- **Hourly strip** — horizontal flexbox, 10 cells, top + bottom border. Each cell: time label ("Now" / "1pm" — uppercase 0.68rem), weather emoji (1.05 rem), temp (0.86 rem, 600), precip chance (0.66 rem, accent-blue) — chance hidden when < 10 %. The "Now" cell has a warm-tinted background.
- **Stats grid** — 4 columns × 2 rows, 1-px gap "grout" using the card border color, rounded 12 px. Each cell: icon (18 px, muted), value (1 rem, 600, tabular nums), label (0.66 rem, uppercase, 0.06em letter-spacing, muted).
  - Cells in order: Humidity · Wind+direction · Gust · Pressure (label changes to "↑ Rising" / "↓ Falling" / "→ Steady" based on 3 h delta) · Dew Point · Cloud · Rain Today (label = "Peak N%") · UV (with peak window).
- **Astronomy row** — Sunrise (warm icon) · Sunset (sunset icon, slightly darker orange) · Moon (emoji + phase name). Separators are 1-px vertical card-border dividers.

#### Day forecast card (×4)
Each card padding `16px 18px`. Top row: day name (1 rem 700) + date (0.78 rem muted). Then dense info rows separated by `dc-sep` (1-px card-border `hr`):
1. Temp high/low (each with arrow icon, time)
2. Humidity hi/lo with timestamps
3. Sunrise / sunset times
4. Wind (red accent), precip (blue accent), UV (warm accent) — one row each
5. Pressure max/min with timestamps

#### Forecast chart
Canvas-based. Zoom selector ("1 day" → "5 days") in top-right; legend below. Day bands (warm beige in light), grid lines, temperature filled area (orange), feels-like dashed line (cyan), wind area (red), precipitation (blue), pressure (muted secondary axis). "NOW" vertical marker.

**⚠️ Label change — this is the new behavior to implement:**

> Render exactly **one "high" label and one "low" label per calendar day** on the temperature curve — at the hour where the day's max and min temperatures occur. Drop the existing per-peak / per-trough behavior. The high label uses the warm-orange tempLine color, the low uses the cyan feels-line color, with a stroke halo (light label-stroke against light chart bg).

Implementation: group hourly slots by calendar date in `Pacific/Auckland`, pick `argmax(temperature)` and `argmin(temperature)` per group, draw a label at each. See `src/chart.js → _drawTempLabels()` for the current impl that must be replaced.

#### Tides card
Header: title (left) + "Now Xm ↑ Rising" indicator (right).
Body: grid `1.4fr 1fr` — left = tide curve canvas (~180 px tall, rounded, subtle tinted bg); right = vertical list of 6 next tide events. Each event row: icon (🌊 high / 🏖️ low) · type+time (small uppercase + 0.96 rem) · height (cyan tabular) · countdown ("in 4h 36m"). The next-upcoming event gets a cyan-tinted background and border.

### Theme toggle

The shipped prototype has a sun/moon toggle in the header. **For this handoff the light theme is the default and only target.** You can:
- Drop the toggle entirely (simplest), or
- Keep it if you want to retain dark mode — both stylesheets are still in `style.css`.

---

## Interactions & Behavior

- **Hourly strip** — non-interactive in the prototype. Horizontal scroll on overflow.
- **Stats grid** — non-interactive.
- **Day cards** — non-interactive.
- **Forecast chart** — drag/scroll horizontally; hover shows a per-hour tooltip with temp/feels/wind/precip/pressure. Zoom select changes how many days fit in the viewport (re-renders the chart). Selection persists in `localStorage` (`weatherTempo.chartDays`).
- **Tide chart** — hover shows tooltip with date/time and height; nearest high/low within ±90 min annotated.
- **Tides list** — hover slightly brightens the border. Countdowns recompute every 60 s.
- **Live refresh** — 5-minute poll against the Cloudflare Worker proxy updates temp/feels/humidity/wind/gust/pressure/UV/icon/condition without re-rendering the page.

### Animations / transitions

- Theme transition (if you keep the toggle): `background-color 0.25s ease, color 0.25s ease` on `body`.
- Theme toggle button hover: `transform: translateY(-1px)`, border color shift, 0.18 s ease.
- Tide event hover: border color shift, 0.15 s ease.
- Hourly "now" cell: background fade via `transition: background 0.15s ease`.

No keyframe animations.

---

## State Management

Only client-side, no router:

- `currentTheme` — `"light"` (or `"dark"` if you keep both); persisted in `localStorage["weatherTempo.theme"]`. First load also respects `prefers-color-scheme`.
- `chartDays` — integer 1–5; persisted in `localStorage["weatherTempo.chartDays"]`.
- `weatherData` — fetched once from `data/weather.json` on boot, then mutated by the live-refresh loop.

Data fetching:
- `GET data/weather.json` on boot (static file generated by GitHub Action).
- `GET <Worker URL>` every 5 min for live PWS readings, merged into `data.current`.

---

## Design Tokens (Light Theme)

All tokens are CSS custom properties on `:root` / `[data-theme="light"]`.

### Color

| Token | Value | Usage |
|---|---|---|
| `--bg` | `#eef2f8` | Page background |
| `--bg-glow-1` | `rgba(120,170,230,0.22)` | Top-left radial gradient |
| `--bg-glow-2` | `rgba(220,210,255,0.32)` | Bottom-right radial gradient |
| `--card-bg` | `rgba(255,255,255,0.78)` | Card background (over the gradient) |
| `--card-border` | `rgba(20,40,80,0.08)` | Card border, dividers, grid grout |
| `--card-shadow` | `0 1px 2px rgba(20,40,80,0.04), 0 8px 24px rgba(20,40,80,0.05)` | Card elevation |
| `--stat-bg` | `rgba(255,255,255,0.55)` | Inner panels (stats, tide events) |
| `--text` | `#1a2640` | Body text |
| `--text-strong` | `#0a1426` | Big numbers / headings |
| `--text-muted` | `#56708e` | Labels, secondary text |
| `--text-fade` | `#7892ad` | De-emphasized text |
| `--accent-warm` | `#ea7c1c` | Highs, sunrise, "rising" |
| `--accent-cyan` | `#0aa5c8` | Lows, tides |
| `--accent-red` | `#d63b54` | Wind |
| `--accent-green` | `#1f9f5b` | (reserve) |
| `--accent-blue` | `#2563d8` | Precipitation, humidity-hi |
| `--sunset` | `#d9663c` | Sunset icon |
| `--chart-bg` | `#f5f8fc` | Forecast canvas background |
| `--chart-day` | `rgba(255,210,140,0.22)` | Daytime band in chart |
| `--chart-grid` | `rgba(20,40,80,0.07)` | Horizontal grid lines |
| `--chart-axis` | `rgba(20,40,80,0.18)` | Zone separators |
| `--chart-now` | `rgba(20,40,80,0.55)` | "Now" vertical marker |
| `--chart-press` | `rgba(20,40,80,0.30)` | Pressure curve |
| `--chart-cloud` | `rgba(120,140,180,1)` | Cloud puff base |
| `--tide-curve` | `rgba(10,140,200,0.9)` | Tide line |
| `--tide-fill-a` | `rgba(80,170,220,0.55)` | Tide fill top stop |
| `--tide-fill-b` | `rgba(140,200,235,0.4)` | Tide fill mid stop |
| `--tide-fill-c` | `rgba(220,235,250,0.15)` | Tide fill bottom stop |
| `--tide-canvas` | `rgba(225,235,250,0.7)` | Tide canvas background |
| `--select-bg` | `#ffffff` | Select control bg |
| `--select-bg-hi` | `#eaf0fa` | Select control hover bg |

### Typography

- Font stack: `-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif`
- Sizes used: `0.66rem`–`5rem` (see specific component specs above)
- All numeric displays use `font-variant-numeric: tabular-nums`
- Big temp: weight 200, letter-spacing −0.04em

### Spacing & shape

- Radius: card `16px` (`--radius`), inner panels `12px`, hour cells / tide events `8–10px`
- Card padding: top card `22px 24px`, day cards `16px 18px`, tides card `20px 24px`
- Page padding: `24px` desktop, `14px` ≤720 px
- Card grid gaps: `16px`

---

## Assets

- All icons are inline SVG (location pin, theme moon/sun, stat icons, sun/moon for astronomy, tide wavy lines). No external icon library.
- Weather/condition icons in the hourly strip and current weather use **emoji** (☀️ ⛅ ☁️ 🌥️ 🌦️ 🌧️ ❄️ ⛈️ 🌫️ 💨) keyed off TWC `iconCode` + day/night. See `iconFor()` in `src/app.js`. If you replace emoji with a real icon set (e.g. Weather Icons, custom SVG), keep the mapping logic.
- Moon-phase emoji map: see `MOON_EMOJI` in `src/app.js`.

---

## Files

Included in this bundle (under `prototype/`):

| File | Purpose |
|---|---|
| `prototype/index.html` | Markup for the whole dashboard |
| `prototype/style.css` | All styles. Both themes are in here; the light theme variables are under `[data-theme="light"]`. You can collapse to a single theme by inlining those values on `:root` and removing the dark block. |
| `prototype/src/app.js` | Boot, data fetch, live refresh, all renderers (today card, hourly strip, day cards, tides), theme toggle |
| `prototype/src/chart.js` | Forecast `WeatherChart` class. **Update `_drawTempLabels()` per the rule above.** |
| `prototype/src/tides.js` | Lyttelton harmonic tide predictor (pure compute, no UI) |
| `prototype/data/weather.json` | Sample dataset used by the prototype — same shape as production output |

The prototype uses sample data if the JSON is empty (`generateSampleData()` in `app.js`); preserve that fallback or remove it depending on your needs.

---

## Implementation checklist

- [ ] Set up the light theme tokens above as your design system's color/spacing primitives
- [ ] Recreate the layout (hero grid + chart + tides) using your framework's primitives
- [ ] Today card: top row, hourly strip (10 cells), 4×2 stats grid, astronomy row
- [ ] Day card component (×4) with the row stack shown
- [ ] Forecast chart — port `WeatherChart` or rebuild with your charting lib (D3 / visx / Chart.js / Recharts)
- [ ] **Forecast chart labels: only mark the calendar-day high and low** (see chart.js change above)
- [ ] Tides card with curve + vertical list (highlight next event)
- [ ] Live refresh via the existing Cloudflare Worker
- [ ] Persist chart-days selection (and theme if you keep one) in `localStorage`
