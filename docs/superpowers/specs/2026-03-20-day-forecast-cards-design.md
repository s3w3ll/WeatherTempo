# Day Forecast Cards — Design Spec
**Date:** 2026-03-20
**Status:** Approved

---

## Overview

Add two compact forecast cards covering the next 2 calendar days (tomorrow and the day after). On desktop they sit to the right of the existing conditions card in a two-column grid. On mobile they stack below the conditions card.

---

## Layout

### HTML structure

```html
<div class="cards-row">
  <section class="card conditions-card">…existing…</section>
  <div class="day-cards-col">
    <div class="card day-card" id="day-card-1"></div>
    <div class="card day-card" id="day-card-2"></div>
  </div>
</div>
```

### CSS breakpoints

| Viewport    | `.cards-row`                          | `.day-cards-col`              |
|-------------|---------------------------------------|-------------------------------|
| > 600 px    | `grid-template-columns: 1fr 252px`    | `flex-direction: column`      |
| ≤ 600 px    | `grid-template-columns: 1fr`          | `flex-direction: row`         |
| ≤ 380 px    | `grid-template-columns: 1fr`          | `flex-direction: column`      |

- `.cards-row` uses `display: grid` with `align-items: stretch` so the conditions card and the day-cards column match height on desktop.
- `.day-cards-col` is `display: flex` with `gap: 16px`. On desktop each `.day-card` takes `flex: 1`.
- `.day-card` padding: `16px` (tighter than the `20px` conditions card).
- `.day-card` must have `min-width: 0` and `flex: 1` to ensure equal widths when two cards share a row on 381–600 px viewports. Long text lines (e.g. wind row) are allowed to truncate with `overflow: hidden; text-overflow: ellipsis; white-space: nowrap` on the value span.
- The existing `.card` margin (`0 16px 16px`) is preserved on the inner cards; `.cards-row` itself carries the outer margin.

---

## Data model

### New function: `buildDayForecast(dayIndex, hourly, daily)`

**Parameters:**
- `dayIndex` — 1 for tomorrow, 2 for the day after (indexes into `data.daily[]`)
- `hourly` — full `data.hourly[]` array
- `daily` — full `data.daily[]` array

**Array origin assumption:** `daily[0]` always represents the current NZ calendar day (the same day as `data.current`). Therefore `daily[1]` = tomorrow, `daily[2]` = the day after. This matches the Open-Meteo response structure used by `fetch_weather.py`.

**Steps:**
1. Read `daily[dayIndex]` — if absent or `dayIndex` out of range, return `null`.
2. Derive the target NZ calendar date key for filtering:
   - **Shared formatter** (used on both sides to guarantee identical output): `const dateKey = ts => new Date(ts * 1000).toLocaleDateString("en-NZ", { timeZone: TZ, year:"numeric", month:"2-digit", day:"2-digit" })`. This is the same pattern already used in `todayHighLow()` and `uvInfo()` in `app.js`, confirmed to work cross-browser within this project.
   - **Primary:** `targetKey = dateKey(daily[dayIndex].sunriseTimeUtc)`.
   - **Fallback** (if `sunriseTimeUtc` null/missing): build a reference timestamp for the target day using `Date.now() / 1000 + dayIndex * 86400` as an approximation, then apply `dateKey()`. This may be off by ±1 day near midnight but is acceptable as a last resort.
3. Filter `hourly[]` to slots where `dateKey(h.validTimeUtc) === targetKey`.
4. From the filtered slots compute:

| Field          | Source                                                                 |
|----------------|------------------------------------------------------------------------|
| `temp.max`     | `calendarDayTemperatureMax` from daily (°C); `utcSec` = `validTimeUtc` of the hourly slot with the highest `temperature` (independent of the daily aggregate — daily and hourly may differ due to rounding) |
| `temp.min`     | `calendarDayTemperatureMin` from daily (°C); `utcSec` = `validTimeUtc` of the hourly slot with the lowest `temperature` |
| `humidity.max` | slot with max `relativeHumidity` → value + `validTimeUtc`             |
| `humidity.min` | slot with min `relativeHumidity` → value + `validTimeUtc`             |
| `wind.max`     | slot with max `windSpeed` → speed + `windDirectionCardinal` + `validTimeUtc` |
| `precip.totalMm` | sum of `qpf` across day slots (rounded to 1 dp)                    |
| `precip.maxChance` | max `precipChance` across day slots                               |
| `uv.peak`      | max `uvIndex` across day slots                                        |
| `uv.window`    | Filter day slots for `uvIndex >= 3`. If any exist, format as `"Xam–Ypm"`: start = first such slot's `validTimeUtc` formatted with `{ hour:"numeric", hour12:true }` (lowercase, no leading zero, e.g. `"10am"`); end = last such slot's `validTimeUtc + 3600` (exclusive end of that 1-hour slot, e.g. last slot at 14:00 → +3600 = 15:00 → `"3pm"`) formatted the same way. Result e.g. `"10am–3pm"`. Assumes 1-hour slot resolution (guaranteed by Open-Meteo). If no slot meets threshold → `null`. |
| `pressure.max` | slot with max `pressureMeanSeaLevel` → value + `validTimeUtc`        |
| `pressure.min` | slot with min `pressureMeanSeaLevel` → value + `validTimeUtc`        |
| `sunrise`      | `sunriseTimeUtc` from `daily[dayIndex]`                               |
| `sunset`       | `sunsetTimeUtc` from `daily[dayIndex]`                                |

**Returns:**
```js
{
  label,        // "Tomorrow" (always for dayIndex=1), full weekday name e.g. "Thursday" (dayIndex=2+)
  date,         // "19 Mar" — short date string derived from the target calendar date
  sunrise,      // utc seconds from daily[dayIndex].sunriseTimeUtc
  sunset,       // utc seconds from daily[dayIndex].sunsetTimeUtc
  temp:     { max: { val, utcSec }, min: { val, utcSec } },
  humidity: { max: { val, utcSec }, min: { val, utcSec } },
  wind:     { speed, cardinal, utcSec },   // slot with highest windSpeed
  precip:   { totalMm, maxChance },
  uv:       { peak, window },              // window is string or null
  pressure: { max: { val, utcSec }, min: { val, utcSec } },
}
```

**Label and date display rules:**
- `dayIndex === 1` → `label = "Tomorrow"`.
- `dayIndex === 2` → `label` = full weekday name derived from `sunriseTimeUtc` (primary) or `Date.now()/1000 + dayIndex*86400` (fallback) via `new Date(ts * 1000).toLocaleDateString("en-NZ", { timeZone: TZ, weekday: "long" })`.
- `date` display string (e.g. `"19 Mar"`) = `new Date(ts * 1000).toLocaleDateString("en-NZ", { timeZone: TZ, day: "numeric", month: "short" })` where `ts` is the same source timestamp used for the date key.
- `dayIndex` out of range or `daily[dayIndex]` absent → return `null`.

**Wind aggregation:**
- Use the slot with the highest `windSpeed` value (consistent with the conditions card).
- `cardinal` and `utcSec` come from that same slot.
- `windGust` is not used here (no gust field shown in day cards).

**Time formatting for all card time fields:**
Use the existing `fmtHourOnly(utcSec)` helper already in `app.js` (formats as `{ hour: "numeric", hour12: true }` in NZ locale). In practice this yields e.g. `"2 pm"` — strip the space and lowercase to get `"2pm"`. The UV window uses the same formatter (already specified in the table above). A `null` `utcSec` always renders as `"—"`.

**Edge cases:**
- If `daily[dayIndex]` is missing → return `null`; the card renders "—" for all values.
- If no hourly slots match the target day → `temp.val` from `calendarDayTemperatureMax/Min` (°C, same units as hourly), all `utcSec` fields `null` → display "—"; `wind`, `humidity`, `pressure`, `precip`, `uv` all render as "—".
- UV window: if no slot has `uvIndex >= 3`, `uv.window` is `null` and the card shows "Below 3".

---

## Card content layout

Each `.day-card` renders the following rows top-to-bottom:

```
Thu 19 Mar                        ← .day-label row
──────────────────────────────────
↑ 24°  2pm      ↓ 11°  6am       ← .dc-temp row  (warm=max, cyan=min)
💧 Hi 85%  8am  · Lo 42%  2pm    ← .dc-humidity row
──────────────────────────────────
☀ 6:32am           ☽ 7:54pm      ← .dc-sun row
──────────────────────────────────
💨 47 km/h ENE  at 3pm           ← .dc-wind row
🌧 3.2 mm  · 65%                 ← .dc-precip row
☀ UV 6 High  · 10am–3pm          ← .dc-uv row  (or "Below 3" when null)
──────────────────────────────────
↑ 1028 hPa  2am                  ← .dc-pressure rows
↓ 1019 hPa  4pm
```

### Colour mapping (reusing existing CSS variables)

| Element           | Colour                  |
|-------------------|-------------------------|
| Max temp / arrow  | `--accent-warm` (#ffa420) |
| Min temp / arrow  | `--accent-cyan` (#3ee5ff) |
| Humidity icon     | `--accent-blue`          |
| Wind icon/value   | `--accent-red`           |
| Precip icon/value | `--accent-blue`          |
| UV value          | `--accent-warm`          |
| Pressure          | `--text` (white)         |
| Labels / times    | `--text-muted`           |
| Separators        | `--card-border`          |

---

## Implementation scope

### Files changed

| File        | Change                                                                 |
|-------------|------------------------------------------------------------------------|
| `index.html` | Wrap conditions card in `.cards-row`; add `.day-cards-col` with two `.day-card` divs |
| `style.css`  | Add `.cards-row`, `.day-cards-col`, `.day-card`, and inner row classes  |
| `src/app.js` | Add `buildDayForecast()`, `renderDayCard()`, call both from `populateCard()` |

### No changes to

- `src/chart.js`, `src/tides.js` — untouched
- `scripts/fetch_weather.py` — data already contains all required fields
- GitHub Actions workflow — no new data fetching needed

---

## Out of scope

- Live refresh for the day cards (they update on page load from `weather.json`; the 5-min PWS refresh loop updates only the current conditions card as before)
- A third "day 3" card
- Animated transitions between card states
