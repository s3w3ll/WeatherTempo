# Day Forecast Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two compact day-forecast cards (tomorrow + day after) to the right of the main conditions card on desktop, stacked below on mobile, showing temp, humidity, sun, wind, precip, UV, and pressure extrema with times.

**Architecture:** Pure HTML/CSS/JS — no build step. Layout uses a CSS Grid wrapper (`.cards-row`) around the existing conditions card and a new `.day-cards-col` flex column. Data is computed from the existing `data/weather.json` `hourly[]` and `daily[]` arrays inside `app.js`.

**Tech Stack:** HTML5, CSS custom properties, vanilla ES5-compatible JS (IIFE pattern already used in `app.js`), `Intl` locale APIs already in use.

---

## File Map

| File | Change |
|------|--------|
| `index.html` | Wrap `.conditions-card` in `.cards-row`; add `.day-cards-col` with two `.day-card` divs |
| `style.css` | Add `.cards-row`, `.day-cards-col`, `.day-card` + inner row classes + responsive rules |
| `src/app.js` | Add `buildDayForecast()`, `renderDayCard()`; call both from `populateCard()` |

No changes to `src/chart.js`, `src/tides.js`, `scripts/fetch_weather.py`, or GitHub Actions.

---

## Task 1: HTML scaffold

**Files:**
- Modify: `index.html:27-139`

- [ ] **Step 1: Wrap the conditions card**

In `index.html`, find the opening `<section class="card conditions-card">` (line 27) and the closing `</section>` (line 139). Wrap both — plus add the day-cards column — so the structure becomes:

```html
    <!-- ── Cards row (conditions + 2-day forecast) ─────────────────────── -->
    <div class="cards-row">

      <!-- ── Conditions Card ──────────────────────────────────────────────── -->
      <section class="card conditions-card">
        <!-- … all existing content unchanged … -->
      </section>

      <!-- ── 2-Day Forecast Cards ─────────────────────────────────────────── -->
      <div class="day-cards-col">
        <div class="card day-card" id="day-card-1"></div>
        <div class="card day-card" id="day-card-2"></div>
      </div>

    </div><!-- .cards-row -->
```

- [ ] **Step 2: Verify structure in browser**

Open `index.html` in a browser (or via a local HTTP server — `python -m http.server 8080`). The page should look identical to before (no visual change yet — `.cards-row` has no styles). Open DevTools → Elements and confirm:
- `.cards-row` wraps `.conditions-card` and `.day-cards-col`
- Two empty `.day-card` divs exist with ids `day-card-1` and `day-card-2`

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat: add cards-row wrapper and day-card scaffold"
```

---

## Task 2: CSS layout

**Files:**
- Modify: `style.css` (append after the existing `.card` rules, before the `/* ── Chart section ──` comment)

- [ ] **Step 1: Add layout styles**

Insert the following CSS block in `style.css` after the `.card` base rule (around line 88) and before `.conditions-card`:

```css
/* ── Cards row (conditions + day forecast) ──────────────────────────────── */
.cards-row {
  display: grid;
  grid-template-columns: 1fr 252px;
  align-items: stretch;
  margin: 0 16px 16px;
  gap: 0 16px;
}

/* Remove the card's own side margins when inside cards-row — the row
   carries the outer margin */
.cards-row > .card,
.cards-row > .day-cards-col {
  margin: 0;
}

.day-cards-col {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* ── Day forecast card ───────────────────────────────────────────────────── */
.day-card {
  padding: 16px;
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0;
}

/* Day label (e.g. "Thu 19 Mar") */
.dc-label {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin-bottom: 10px;
}

.dc-day {
  font-size: 0.88rem;
  font-weight: 700;
  color: var(--text);
}

.dc-date {
  font-size: 0.72rem;
  color: var(--text-muted);
  letter-spacing: 0.03em;
}

/* Separator line */
.dc-sep {
  border: none;
  border-top: 1px solid var(--card-border);
  margin: 8px 0;
}

/* Generic data row */
.dc-row {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 2px 0;
  font-size: 0.78rem;
  min-width: 0;
}

.dc-row-icon {
  flex-shrink: 0;
  font-size: 0.82rem;
  line-height: 1;
}

.dc-row-content {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

/* Temp row: two halves side by side */
.dc-temp-row {
  display: flex;
  justify-content: space-between;
  gap: 4px;
  padding: 2px 0;
  font-size: 0.82rem;
}

.dc-temp-half {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}

.dc-temp-val {
  font-size: 1.05rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.dc-temp-val.hi { color: var(--accent-warm); }
.dc-temp-val.lo { color: var(--accent-cyan); }

.dc-temp-time {
  font-size: 0.68rem;
  color: var(--text-muted);
  white-space: nowrap;
}

/* Arrow icons (reuse existing .hl-arrow styles) */
.dc-arrow {
  width: 11px;
  height: 11px;
  fill: currentColor;
  flex-shrink: 0;
}

.dc-arrow.up   { color: var(--accent-warm); }
.dc-arrow.down { color: var(--accent-cyan); }

/* Sun row */
.dc-sun-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 3px 0;
  font-size: 0.78rem;
  color: var(--text-muted);
}

.dc-sun-item {
  display: flex;
  align-items: center;
  gap: 4px;
}

.dc-sun-val {
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--text);
  white-space: nowrap;
}

/* Coloured value spans */
.dc-val-wind    { color: var(--accent-red);  font-weight: 600; }
.dc-val-precip  { color: var(--accent-blue); font-weight: 600; }
.dc-val-uv      { color: var(--accent-warm); font-weight: 600; }
.dc-val-muted   { color: var(--text-muted);  font-size: 0.72rem; }
.dc-val-pressure{ color: var(--text);        font-weight: 600; font-variant-numeric: tabular-nums; }

/* Pressure rows */
.dc-pressure-row {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 1px 0;
  font-size: 0.78rem;
}

/* ── Responsive ─────────────────────────────────────────────────────────── */
@media (max-width: 600px) {
  .cards-row {
    grid-template-columns: 1fr;
    gap: 0;
    margin: 0 10px 12px;
  }

  /* Re-add bottom margin to conditions card so day cards aren't flush */
  .cards-row > .conditions-card {
    margin-bottom: 16px;
  }

  .day-cards-col {
    flex-direction: row;
  }
}

@media (max-width: 380px) {
  .day-cards-col {
    flex-direction: column;
  }
}
```

- [ ] **Step 2: Verify layout in browser**

Resize the browser:
- **Desktop (> 600 px):** Conditions card takes most width; two empty day-cards are stacked to the right in a 252 px column.
- **≤ 600 px:** Conditions card is full width; two empty day-cards appear side-by-side below it.
- **≤ 380 px:** All three cards stack in a single column.

Confirm the conditions card looks unchanged (no padding/margin regression).

- [ ] **Step 3: Commit**

```bash
git add style.css
git commit -m "feat: add day-card CSS layout and responsive rules"
```

---

## Task 3: buildDayForecast() data function

**Files:**
- Modify: `src/app.js` — insert before the `// ── Populate conditions card` comment

- [ ] **Step 1: Add the function**

Insert this function into `src/app.js` just before the `// ── Populate conditions card ──` comment (around line 150):

```js
  // ── Day forecast data builder ─────────────────────────────────────────
  /**
   * Computes extrema and times for a single forecast day.
   *
   * @param {number} dayIndex - 1 = tomorrow, 2 = day after (daily[0] = today)
   * @param {Array}  hourly   - data.hourly[]
   * @param {Array}  daily    - data.daily[]
   * @returns {object|null}   - null when daily[dayIndex] is unavailable
   */
  function buildDayForecast(dayIndex, hourly, daily) {
    const d = (daily || [])[dayIndex];
    if (!d) return null;

    // ── Date key helper (same pattern as todayHighLow / uvInfo) ──────────
    const dateKey = function(ts) {
      return new Date(ts * 1000).toLocaleDateString("en-NZ", {
        timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
      });
    };

    // Primary: derive date from sunrise; fallback: client clock + offset
    const refTs = d.sunriseTimeUtc != null
      ? d.sunriseTimeUtc
      : Math.round(Date.now() / 1000) + dayIndex * 86400;

    const targetKey = dateKey(refTs);
    const slots = (hourly || []).filter(h => h.validTimeUtc && dateKey(h.validTimeUtc) === targetKey);

    // ── Label ─────────────────────────────────────────────────────────────
    const label = dayIndex === 1
      ? "Tomorrow"
      : new Date(refTs * 1000).toLocaleDateString("en-NZ", { timeZone: TZ, weekday: "long" });

    // ── Date display ("19 Mar") ───────────────────────────────────────────
    const date = new Date(refTs * 1000).toLocaleDateString("en-NZ", {
      timeZone: TZ, day: "numeric", month: "short",
    });

    // ── Helpers ───────────────────────────────────────────────────────────
    const pick = function(arr, fn) {
      return arr.reduce(function(best, h) { return fn(h) > fn(best) ? h : best; }, arr[0]);
    };

    // ── Temperature (val from daily, time from hourly max/min slot) ───────
    const hiSlot = slots.length ? pick(slots, function(h) { return h.temperature; }) : null;
    const loSlot = slots.length ? slots.reduce(function(a, b) {
      return a.temperature < b.temperature ? a : b;
    }) : null;

    // ── Humidity ──────────────────────────────────────────────────────────
    const humHiSlot = slots.length ? pick(slots, function(h) { return h.relativeHumidity; }) : null;
    const humLoSlot = slots.length ? slots.reduce(function(a, b) {
      return a.relativeHumidity < b.relativeHumidity ? a : b;
    }) : null;

    // ── Wind (highest windSpeed) ───────────────────────────────────────────
    const windSlot = slots.length ? pick(slots, function(h) { return h.windSpeed; }) : null;

    // ── Precip ────────────────────────────────────────────────────────────
    const totalMm = slots.length
      ? +slots.reduce(function(s, h) { return s + (h.qpf || 0); }, 0).toFixed(1)
      : null;
    const maxChance = slots.length
      ? Math.max.apply(null, slots.map(function(h) { return h.precipChance || 0; }))
      : null;

    // ── UV ────────────────────────────────────────────────────────────────
    const peakUV = slots.length
      ? Math.max.apply(null, slots.map(function(h) { return h.uvIndex || 0; }))
      : null;

    const uvFmt = function(ts) {
      return new Date(ts * 1000)
        .toLocaleTimeString("en-NZ", { timeZone: TZ, hour: "numeric", hour12: true })
        .replace(/ (am|pm)$/i, "$1");
    };
    const uvSlots = slots.filter(function(h) { return (h.uvIndex || 0) >= 3; });
    const uvWindow = uvSlots.length
      ? uvFmt(uvSlots[0].validTimeUtc) + "–" + uvFmt(uvSlots[uvSlots.length - 1].validTimeUtc + 3600)
      : null;

    // ── Pressure ──────────────────────────────────────────────────────────
    const presHiSlot = slots.length ? pick(slots, function(h) { return h.pressureMeanSeaLevel; }) : null;
    const presLoSlot = slots.length ? slots.reduce(function(a, b) {
      return a.pressureMeanSeaLevel < b.pressureMeanSeaLevel ? a : b;
    }) : null;

    return {
      label,
      date,
      sunrise: d.sunriseTimeUtc  || null,
      sunset:  d.sunsetTimeUtc   || null,
      temp: {
        max: { val: d.calendarDayTemperatureMax, utcSec: hiSlot ? hiSlot.validTimeUtc : null },
        min: { val: d.calendarDayTemperatureMin, utcSec: loSlot ? loSlot.validTimeUtc : null },
      },
      humidity: {
        max: { val: humHiSlot ? humHiSlot.relativeHumidity : null, utcSec: humHiSlot ? humHiSlot.validTimeUtc : null },
        min: { val: humLoSlot ? humLoSlot.relativeHumidity : null, utcSec: humLoSlot ? humLoSlot.validTimeUtc : null },
      },
      wind: {
        speed:   windSlot ? windSlot.windSpeed            : null,
        cardinal: windSlot ? (windSlot.windDirectionCardinal || degToCard(windSlot.windDirection)) : null,
        utcSec:  windSlot ? windSlot.validTimeUtc         : null,
      },
      precip:   { totalMm, maxChance },
      uv:       { peak: peakUV, window: uvWindow },
      pressure: {
        max: { val: presHiSlot ? presHiSlot.pressureMeanSeaLevel : null, utcSec: presHiSlot ? presHiSlot.validTimeUtc : null },
        min: { val: presLoSlot ? presLoSlot.pressureMeanSeaLevel : null, utcSec: presLoSlot ? presLoSlot.validTimeUtc : null },
      },
    };
  }
```

- [ ] **Step 2: Smoke-test via DevTools console**

Open the page in a browser. In the DevTools console, the `data` variable is not in scope (it's inside the IIFE). Temporarily add a `console.log` at the end of `populateCard()` to dump `buildDayForecast(1, data.hourly, data.daily)` and reload. Confirm the returned object has sensible values (temps, times, wind etc.) matching the hourly data. Remove the console.log after verifying.

- [ ] **Step 3: Commit**

```bash
git add src/app.js
git commit -m "feat: add buildDayForecast() data function"
```

---

## Task 4: renderDayCard() DOM function

**Files:**
- Modify: `src/app.js` — insert immediately after `buildDayForecast()`

- [ ] **Step 1: Add the render function**

Insert this function right after `buildDayForecast()`:

```js
  // ── Day forecast card renderer ────────────────────────────────────────
  /**
   * Populates a .day-card element from a buildDayForecast() result.
   *
   * @param {HTMLElement} el  - the .day-card div
   * @param {object|null} fc  - forecast object or null
   */
  function renderDayCard(el, fc) {
    if (!el) return;

    // Helper: format utcSec as "2pm", "10am", etc., or "—" when null
    const fmtH = function(utcSec) {
      if (!utcSec) return "—";
      return new Date(utcSec * 1000)
        .toLocaleTimeString("en-NZ", { timeZone: TZ, hour: "numeric", hour12: true })
        .replace(/ (am|pm)$/i, "$1");
    };

    // Helper: format utcSec as "6:32am" (with minutes), or "—"
    const fmtHM = function(utcSec) {
      if (!utcSec) return "—";
      return new Date(utcSec * 1000)
        .toLocaleTimeString("en-NZ", { timeZone: TZ, hour: "numeric", minute: "2-digit", hour12: true })
        .replace(/ (am|pm)$/i, "$1");
    };

    // Render "—" for nulls
    const n = function(v, suffix) {
      return v != null ? v + (suffix || "") : "—";
    };

    if (!fc) {
      el.innerHTML = '<div class="dc-label"><span class="dc-day">—</span></div>';
      return;
    }

    const hiTemp  = fc.temp.max.val != null ? Math.round(fc.temp.max.val) + "°" : "—";
    const loTemp  = fc.temp.min.val != null ? Math.round(fc.temp.min.val) + "°" : "—";
    const hiTime  = fmtH(fc.temp.max.utcSec);
    const loTime  = fmtH(fc.temp.min.utcSec);

    const humHi   = n(fc.humidity.max.val, "%");
    const humHiT  = fmtH(fc.humidity.max.utcSec);
    const humLo   = n(fc.humidity.min.val, "%");
    const humLoT  = fmtH(fc.humidity.min.utcSec);

    const windStr = fc.wind.speed != null
      ? `${fc.wind.speed} km/h ${fc.wind.cardinal || ""} at ${fmtH(fc.wind.utcSec)}`
      : "—";

    const precipStr = (fc.precip.totalMm != null && fc.precip.maxChance != null)
      ? `${fc.precip.totalMm} mm · ${fc.precip.maxChance}%`
      : "—";

    const uvPeak  = fc.uv.peak != null ? uvLabel(fc.uv.peak) : "—";
    const uvWin   = fc.uv.window || "Below 3";

    const presHi  = fc.pressure.max.val != null ? Math.round(fc.pressure.max.val) + " hPa" : "—";
    const presHiT = fmtH(fc.pressure.max.utcSec);
    const presLo  = fc.pressure.min.val != null ? Math.round(fc.pressure.min.val) + " hPa" : "—";
    const presLoT = fmtH(fc.pressure.min.utcSec);

    el.innerHTML = `
      <div class="dc-label">
        <span class="dc-day">${fc.label}</span>
        <span class="dc-date">${fc.date}</span>
      </div>

      <div class="dc-temp-row">
        <div class="dc-temp-half">
          <svg class="dc-arrow up" viewBox="0 0 16 16"><path d="M8 2l5 7H3z"/></svg>
          <span class="dc-temp-val hi">${hiTemp}</span>
          <span class="dc-temp-time">${hiTime}</span>
        </div>
        <div class="dc-temp-half">
          <svg class="dc-arrow down" viewBox="0 0 16 16"><path d="M8 14l5-7H3z"/></svg>
          <span class="dc-temp-val lo">${loTemp}</span>
          <span class="dc-temp-time">${loTime}</span>
        </div>
      </div>

      <div class="dc-row">
        <span class="dc-row-icon">💧</span>
        <span class="dc-row-content">
          <span class="dc-val-muted">Hi</span>
          <span style="color:var(--accent-blue);font-weight:600">${humHi}</span>
          <span class="dc-val-muted">${humHiT}</span>
          &nbsp;·&nbsp;
          <span class="dc-val-muted">Lo</span>
          <span style="color:var(--accent-cyan);font-weight:600">${humLo}</span>
          <span class="dc-val-muted">${humLoT}</span>
        </span>
      </div>

      <hr class="dc-sep">

      <div class="dc-sun-row">
        <div class="dc-sun-item">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent-warm)" stroke-width="2">
            <circle cx="12" cy="12" r="5"/>
            <path d="M12 1v3M12 20v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M1 12h3M20 12h3M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12"/>
          </svg>
          <span class="dc-sun-val">${fmtHM(fc.sunrise)}</span>
        </div>
        <div class="dc-sun-item">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ff8c50" stroke-width="2">
            <circle cx="12" cy="12" r="5"/>
            <path d="M12 1v3M12 20v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M1 12h3M20 12h3M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12"/>
          </svg>
          <span class="dc-sun-val">${fmtHM(fc.sunset)}</span>
        </div>
      </div>

      <hr class="dc-sep">

      <div class="dc-row">
        <span class="dc-row-icon">💨</span>
        <span class="dc-row-content dc-val-wind">${windStr}</span>
      </div>

      <div class="dc-row">
        <span class="dc-row-icon">🌧</span>
        <span class="dc-row-content dc-val-precip">${precipStr}</span>
      </div>

      <div class="dc-row">
        <span class="dc-row-icon">☀️</span>
        <span class="dc-row-content">
          <span class="dc-val-uv">UV ${uvPeak}</span>
          <span class="dc-val-muted"> · ${uvWin}</span>
        </span>
      </div>

      <hr class="dc-sep">

      <div class="dc-pressure-row">
        <svg class="dc-arrow up" viewBox="0 0 16 16"><path d="M8 2l5 7H3z"/></svg>
        <span class="dc-val-pressure">${presHi}</span>
        <span class="dc-val-muted">${presHiT}</span>
      </div>
      <div class="dc-pressure-row">
        <svg class="dc-arrow down" viewBox="0 0 16 16"><path d="M8 14l5-7H3z"/></svg>
        <span class="dc-val-pressure">${presLo}</span>
        <span class="dc-val-muted">${presLoT}</span>
      </div>
    `;
  }
```

- [ ] **Step 2: Verify function exists without errors**

Reload the page. Check the DevTools console — there should be no JS errors from the new function definition (it's not called yet, so nothing will render in the cards).

- [ ] **Step 3: Commit**

```bash
git add src/app.js
git commit -m "feat: add renderDayCard() DOM renderer"
```

---

## Task 4b: Patch generateSampleData() for sunrise/sunset

**Files:**
- Modify: `src/app.js` — inside `generateSampleData()`, the `daily` array (around line 524)

The sample `daily` array currently omits `sunriseTimeUtc` and `sunsetTimeUtc`. Without them `buildDayForecast()` renders "—" for the sun row in sample-data mode.

- [ ] **Step 1: Add sunrise/sunset to each sample daily entry**

Find the `daily` array inside `generateSampleData()`:

```js
    const daily = Array.from({ length: 5 }, (_, d) => ({
      calendarDayTemperatureMax: 25 - d * 0.5,
      calendarDayTemperatureMin: 11 - d * 0.3,
      temperatureMax:            25 - d * 0.5,
      temperatureMin:            11 - d * 0.3,
    }));
```

Replace it with:

```js
    const daily = Array.from({ length: 5 }, (_, d) => ({
      calendarDayTemperatureMax: 25 - d * 0.5,
      calendarDayTemperatureMin: 11 - d * 0.3,
      temperatureMax:            25 - d * 0.5,
      temperatureMin:            11 - d * 0.3,
      sunriseTimeUtc: nowTs + d * 86400 - 3 * 3600,   // approx 3 h before current time
      sunsetTimeUtc:  nowTs + d * 86400 + 6 * 3600,   // approx 6 h after current time
    }));
```

- [ ] **Step 2: Commit**

```bash
git add src/app.js
git commit -m "fix: add sunrise/sunset to generateSampleData daily entries"
```

---

## Task 5: Wire up in populateCard()

**Files:**
- Modify: `src/app.js` — inside `populateCard()`, after the `// Tides` block

- [ ] **Step 1: Call buildDayForecast and renderDayCard**

In `populateCard(data)`, at the very end of the function (after the `populateTides()` call), add:

```js
    // Day forecast cards
    renderDayCard(
      document.getElementById("day-card-1"),
      buildDayForecast(1, data.hourly || [], data.daily || [])
    );
    renderDayCard(
      document.getElementById("day-card-2"),
      buildDayForecast(2, data.hourly || [], data.daily || [])
    );
```

- [ ] **Step 2: Full visual verification — desktop layout**

Reload in browser at a width > 600 px. Verify:
- Both day cards are populated with data (not blank or "—" everywhere)
- "Tomorrow" appears as the label on card 1; a weekday name on card 2
- Temp high and low show in warm/cyan colours with times
- Humidity Hi/Lo appear below temp with times
- Sunrise and sunset show with correct times in the sun row
- Wind shows a speed, cardinal direction, and time
- Precip shows mm and %
- UV shows peak label and window (or "Below 3" if applicable)
- Pressure shows max and min with times
- Conditions card is visually unchanged

- [ ] **Step 3: Verify mobile layout (≤ 600 px)**

Using DevTools device simulation or resizing the window to < 600 px:
- Day cards appear **below** the conditions card, side by side
- Content in cards is readable and not clipped/overflowing

- [ ] **Step 4: Verify ≤ 380 px layout**

Resize to < 380 px:
- All three cards stack in a single column

- [ ] **Step 5: Verify fallback / sample data**

Temporarily break the fetch (e.g. rename `data/weather.json`) to trigger the sample data path. Reload — both day cards should still render with synthetic values rather than showing blank or erroring. Restore the file after testing.

- [ ] **Step 6: Commit**

```bash
git add src/app.js
git commit -m "feat: wire day forecast cards into populateCard"
```

---

## Task 6: Polish and edge-case check

**Files:**
- Modify: `style.css` (if any visual tweaks needed after real-data review)

- [ ] **Step 1: Check text overflow on narrow mobile**

At 381–600 px viewport, confirm no text overflows the card bounds. The `.dc-row-content` has `overflow:hidden; white-space:nowrap; text-overflow:ellipsis` — if wind or precip text is clipped, the ellipsis should appear rather than text running off-card.

- [ ] **Step 2: Check conditions card margin on mobile**

At ≤ 600 px, confirm there is visible spacing between the conditions card and the day-cards row (the `.cards-row > .conditions-card { margin-bottom: 16px }` rule on mobile).

- [ ] **Step 3: Commit any CSS fixes**

If any visual fixes were made:

```bash
git add style.css
git commit -m "fix: day-card mobile polish"
```

If no fixes needed, skip this step.

---

## Done

All tasks complete. The two day-forecast cards are live alongside the conditions card. No CI/CD or data pipeline changes were needed.
