# Light Theme & Day-Extrema Chart Labels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the light-only theme from `docs/design_handoff_light_theme/` to the production WeatherTempo webapp, and replace per-peak/trough chart labels with one high + one low label per calendar day.

**Architecture:** Three file changes only — `style.css` (theme tokens + layout classes), `index.html` (structure to match prototype), `src/chart.js` (replace `_drawTempLabels`). No changes to `src/app.js` — it already has all required JS (renderHourlyStrip, 4-day cards, tides-now indicator, countdown).

**Tech Stack:** Vanilla JS, HTML5 Canvas, CSS custom properties. No build step.

---

## File Map

| File | Change |
|---|---|
| `style.css` | Rewrite `:root` to light tokens; add missing tokens; fix all hardcoded dark colors; port layout classes from prototype |
| `index.html` | Restructure markup to match prototype: hero-grid, 8-stat grid, standalone tides card, chart inside app |
| `src/chart.js` | Replace `_drawTempLabels()` lines 572–600 with day-extrema implementation |

---

## Task 1: Update `style.css` — Light Theme Tokens & Layout

**Files:**
- Modify: `style.css`

- [ ] **Step 1: Replace the `:root` variable block with light theme tokens**

Replace the existing `:root { … }` block (everything up to and including the closing brace of the root block, typically around line 1–45 in production) with:

```css
:root {
  --bg:          #eef2f8;
  --bg-glow-1:   rgba(120,170,230,0.22);
  --bg-glow-2:   rgba(220,210,255,0.32);
  --card-bg:     rgba(255,255,255,0.78);
  --card-border: rgba(20,40,80,0.08);
  --card-shadow: 0 1px 2px rgba(20,40,80,0.04), 0 8px 24px rgba(20,40,80,0.05);
  --stat-bg:     rgba(255,255,255,0.55);

  --text:        #1a2640;
  --text-strong: #0a1426;
  --text-muted:  #56708e;
  --text-fade:   #7892ad;

  --accent-warm:  #ea7c1c;
  --accent-cyan:  #0aa5c8;
  --accent-red:   #d63b54;
  --accent-green: #1f9f5b;
  --accent-blue:  #2563d8;
  --sunset:       #d9663c;

  --chart-bg:    #f5f8fc;
  --chart-day:   rgba(255,210,140,0.22);
  --chart-grid:  rgba(20,40,80,0.07);
  --chart-axis:  rgba(20,40,80,0.18);
  --chart-now:   rgba(20,40,80,0.55);
  --chart-press: rgba(20,40,80,0.30);
  --chart-cloud: rgba(120,140,180,1);

  --tide-curve:   rgba(10,140,200,0.9);
  --tide-fill-a:  rgba(80,170,220,0.55);
  --tide-fill-b:  rgba(140,200,235,0.4);
  --tide-fill-c:  rgba(220,235,250,0.15);
  --tide-canvas:  rgba(225,235,250,0.7);

  --select-bg:    #ffffff;
  --select-bg-hi: #eaf0fa;

  --radius: 16px;
}
```

If there is a `[data-theme="dark"]` block or any separate dark-mode overrides, delete them entirely.

- [ ] **Step 2: Fix hardcoded dark colors in body / page background**

Find the `body` rule. Replace any hardcoded background with:

```css
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
  background-color: var(--bg);
  background-image:
    radial-gradient(ellipse at 0% 0%, var(--bg-glow-1) 0%, transparent 55%),
    radial-gradient(ellipse at 100% 100%, var(--bg-glow-2) 0%, transparent 55%);
  background-attachment: fixed;
  color: var(--text);
  min-height: 100vh;
  margin: 0;
}
```

- [ ] **Step 3: Fix `.app` max-width and `.card` box-shadow**

Update `.app`:
```css
.app {
  max-width: 1440px;
  margin: 0 auto;
  padding: 0 24px 8px;
}
```

Add `box-shadow` to `.card` (it was missing in production):
```css
.card {
  background: var(--card-bg);
  border: 1px solid var(--card-border);
  border-radius: var(--radius);
  box-shadow: var(--card-shadow);
}
```

- [ ] **Step 4: Add / replace hero layout classes**

Replace the production `.cards-row` and `.day-cards-col` rules (if they exist) with:

```css
/* Hero row: today card + 2×2 day cards */
.hero-grid {
  display: grid;
  grid-template-columns: minmax(380px, 460px) 1fr;
  gap: 16px;
  margin-bottom: 16px;
  align-items: start;
}

.days-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  grid-auto-rows: 1fr;
  gap: 16px;
}
```

- [ ] **Step 5: Fix `.conditions-card` and `.current-temp` / `.current-icon`**

```css
.conditions-card {
  padding: 22px 24px;
}

.cond-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 16px;
}

.cond-main {
  display: flex;
  flex-direction: column;
}

.current-icon {
  font-size: 3.2rem;
  line-height: 1;
  margin-bottom: 6px;
  filter: drop-shadow(0 2px 6px rgba(0,0,0,0.18));
}

.current-temp {
  font-size: 5rem;
  font-weight: 200;
  letter-spacing: -0.04em;
  line-height: 1;
  color: var(--text-strong);   /* was hardcoded #fff */
  font-variant-numeric: tabular-nums;
}

.current-detail { margin-top: 6px; }

.current-condition {
  font-size: 1rem;
  color: var(--text);
}

.current-feels {
  font-size: 0.82rem;
  color: var(--text-muted);
  margin-top: 2px;
}
```

- [ ] **Step 6: Add `.high-low` styles**

```css
.high-low {
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: flex-end;
}

.hl-item {
  display: flex;
  align-items: center;
  gap: 5px;
}

.hl-arrow {
  width: 14px;
  height: 14px;
  fill: var(--text-muted);
}
.hl-arrow.up   { fill: var(--accent-warm); }
.hl-arrow.down { fill: var(--accent-cyan); }

.hl-temp {
  font-size: 1.05rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--text);
}

.hl-time {
  font-size: 0.7rem;
  color: var(--text-muted);
}
```

- [ ] **Step 7: Add hourly strip and hour cell styles**

```css
.hourly-strip {
  display: flex;
  gap: 2px;
  padding: 12px 4px;
  border-top: 1px solid var(--card-border);
  border-bottom: 1px solid var(--card-border);
  overflow-x: auto;
  margin-bottom: 18px;
  scrollbar-width: none;
}
.hourly-strip::-webkit-scrollbar { display: none; }

.hour-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 4px 2px;
  border-radius: 8px;
  flex: 1 1 0;
  min-width: 40px;
  transition: background 0.15s ease;
}
.hour-cell.now {
  background: color-mix(in oklch, var(--accent-warm) 10%, transparent);
}
.hour-cell.now .hour-time { color: var(--accent-warm); font-weight: 700; }

.hour-time {
  font-size: 0.68rem;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  white-space: nowrap;
}
.hour-icon {
  font-size: 1.05rem;
  line-height: 1;
}
.hour-temp {
  font-size: 0.86rem;
  font-weight: 600;
  color: var(--text);
  font-variant-numeric: tabular-nums;
}
.hour-precip {
  font-size: 0.66rem;
  color: var(--accent-blue);
  font-variant-numeric: tabular-nums;
  min-height: 0.8em;
}
.hour-precip.zero { color: transparent; }
```

- [ ] **Step 8: Fix `.stats-grid` and `.stat`**

Replace/update `.stats-grid` and `.stat`:
```css
.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  grid-auto-rows: 1fr;
  gap: 1px;
  background: var(--card-border);
  border: 1px solid var(--card-border);
  border-radius: 12px;
  overflow: hidden;
  margin-bottom: 18px;
}

.stat {
  background: var(--stat-bg);   /* was rgba(255,255,255,0.03) */
  padding: 13px 10px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}

.stat-icon { width: 18px; height: 18px; color: var(--text-muted); }

.stat-value {
  font-size: 1rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--text);
  line-height: 1;
  text-align: center;
}

.stat-label {
  font-size: 0.66rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-muted);
}
```

- [ ] **Step 9: Fix `.astro-row` and `.astro-icon.sunset`**

```css
.astro-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 4px 2px;
  border-top: 1px solid var(--card-border);
}

.astro-sep {
  width: 1px;
  height: 32px;
  background: var(--card-border);
  flex-shrink: 0;
}

.astro-item { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; }
.astro-icon { width: 22px; height: 22px; flex-shrink: 0; }
.astro-icon.sunrise { color: var(--accent-warm); }
.astro-icon.sunset  { color: var(--sunset); }   /* was hardcoded #ff8c50 */
.moon-emoji { font-size: 1.35rem; line-height: 1; }

.astro-label {
  font-size: 0.66rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-muted);
}

.astro-value {
  font-size: 0.92rem;
  font-weight: 600;
  color: var(--text);
  margin-top: 1px;
}
```

- [ ] **Step 10: Add standalone tides card styles (replace old tides-section styles)**

Remove any old `.tides-section` CSS that placed tides inside the conditions card. Add:

```css
/* ── Tides card (full-width standalone) ─────────────────────────── */
.tides-card {
  padding: 20px 24px;
  margin-bottom: 16px;
  position: relative;
}

.tides-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}

.tides-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.76rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-muted);
}

.tide-icon { width: 16px; height: 16px; color: var(--accent-cyan); }

.tides-now { display: flex; align-items: baseline; gap: 8px; }

.tides-now-label {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-muted);
}

.tides-now-value {
  font-size: 1.05rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--accent-cyan);
}

.tides-now-trend {
  font-size: 0.78rem;
  color: var(--text-muted);
  letter-spacing: 0.02em;
}
.tides-now-trend.rising  { color: var(--accent-warm); }
.tides-now-trend.falling { color: var(--accent-cyan); }

.tides-body {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(280px, 1fr);
  gap: 20px;
  align-items: stretch;
}

.tide-chart-wrap {
  background: var(--tide-canvas);
  border-radius: 12px;
  overflow: hidden;
  min-height: 180px;
  position: relative;
}

#tide-mini-chart {
  width: 100%;
  height: 100%;
  display: block;
}

.tides-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.tide-event {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 14px;
  background: var(--stat-bg);
  border: 1px solid var(--card-border);
  border-radius: 10px;
  padding: 10px 14px;
  transition: background 0.15s ease, border-color 0.15s ease;
}

.tide-event:hover {
  border-color: color-mix(in oklch, var(--accent-cyan) 40%, var(--card-border));
}

.tide-event.next {
  border-color: color-mix(in oklch, var(--accent-cyan) 55%, transparent);
  background: color-mix(in oklch, var(--accent-cyan) 8%, var(--stat-bg));
}

.tide-event-icon { font-size: 1.25rem; line-height: 1; text-align: center; }
.tide-info { display: flex; flex-direction: column; gap: 2px; min-width: 0; }

.tide-type {
  font-size: 0.66rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-muted);
}

.tide-time {
  font-size: 0.96rem;
  font-weight: 600;
  color: var(--text);
  font-variant-numeric: tabular-nums;
}

.tide-height {
  font-size: 0.92rem;
  font-weight: 600;
  color: var(--accent-cyan);
  font-variant-numeric: tabular-nums;
  text-align: right;
  min-width: 48px;
}

.tide-countdown {
  font-size: 0.74rem;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
  text-align: right;
  min-width: 72px;
}

.tide-loading { font-size: 0.86rem; color: var(--text-muted); font-style: italic; padding: 12px; }

#tide-tooltip {
  display: none;
  position: absolute;
  z-index: 30;
  background: var(--card-bg);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid var(--card-border);
  border-radius: 8px;
  padding: 6px 10px;
  pointer-events: none;
  box-shadow: var(--card-shadow);
  white-space: nowrap;
}
#tide-tooltip .tt-time { margin-bottom: 3px; }
```

- [ ] **Step 11: Fix chart section, zoom select, tooltip, and legend**

The chart section moves inside `.app` in the HTML; update its CSS:

```css
.chart-section {
  padding: 16px 20px 12px;
  margin-bottom: 16px;
}

.chart-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.chart-header-label {
  font-size: 0.76rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-muted);
}

.chart-zoom-select {
  background: var(--select-bg) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%2356708e'/%3E%3C/svg%3E") no-repeat right 8px center;
  /* was background: #0d1e2e url(...) */
  color: var(--text);
  border: 1px solid var(--card-border);
  border-radius: 6px;
  padding: 4px 28px 4px 10px;
  font-size: 0.8rem;
  appearance: none;
  cursor: pointer;
}
.chart-zoom-select:hover { background-color: var(--select-bg-hi); }

#chart-tooltip {
  display: none;
  position: absolute;
  z-index: 20;
  background: var(--card-bg);       /* was rgba(9,19,31,0.93) */
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid var(--card-border);
  border-radius: 10px;
  padding: 8px 12px;
  pointer-events: none;
  white-space: nowrap;
  box-shadow: var(--card-shadow);
  font-size: 0.8rem;
  color: var(--text);
}

.chart-legend {
  display: flex;
  gap: 18px;
  justify-content: center;
  margin-top: 10px;
  flex-wrap: wrap;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.72rem;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.legend-item::before {
  content: "";
  display: inline-block;
  width: 20px;
  height: 3px;
  border-radius: 2px;
}

.legend-item.temp::before    { background: var(--accent-warm); }
.legend-item.feels::before   { background: var(--accent-cyan); }
.legend-item.wind::before    { background: var(--accent-red); }
.legend-item.precip::before  { background: var(--accent-blue); }
.legend-item.pressure::before { background: var(--chart-press); }  /* was rgba(255,255,255,0.4) */
```

- [ ] **Step 12: Fix header styles and remove theme toggle CSS**

```css
.header {
  position: sticky;
  top: 0;
  z-index: 100;
  background: var(--card-bg);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border-bottom: 1px solid var(--card-border);
  padding: 18px 24px 12px;
}

.header-inner {
  max-width: 1440px;
  margin: 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.location {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.96rem;
  font-weight: 600;
  color: var(--text);
}

.location .icon { width: 18px; height: 18px; color: var(--accent-cyan); }

.updated {
  font-size: 0.72rem;
  color: var(--text-muted);
}

/* Remove .theme-toggle styles entirely */
```

- [ ] **Step 13: Update responsive breakpoints**

```css
@media (max-width: 1100px) {
  .hero-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 720px) {
  .app { padding: 0 14px 8px; }
  .days-grid { grid-template-columns: 1fr; }
  .tides-body { grid-template-columns: 1fr; }
  .hourly-strip { justify-content: flex-start; }
}

@media (max-width: 380px) {
  .app { padding: 0 10px 6px; }
  .stats-grid { grid-template-columns: repeat(2, 1fr); }
}
```

- [ ] **Step 14: Commit**

```bash
git add style.css
git commit -m "style: apply light theme tokens, fix hardcoded dark colors, port layout classes"
```

---

## Task 2: Restructure `index.html`

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Add `data-theme="light"` and change `<div class="app">` to `<main>`**

Change line 1:
```html
<html lang="en" data-theme="light">
```

The outer app wrapper from:
```html
<div class="app">
```
to:
```html
<main class="app">
```
(and close with `</main>`)

Move `<header>` OUTSIDE `<main>` — it should be a sibling before `<main>`, not a child.

- [ ] **Step 2: Remove theme toggle button from header**

Remove the entire `<button class="theme-toggle" …>…</button>` element from the header. The `<div class="header-right">` should contain only the `<div class="updated" id="last-updated">` element (or remove header-right entirely if it becomes empty).

- [ ] **Step 3: Replace `.cards-row` / `.day-cards-col` with `.hero-grid` and `.days-grid`**

Replace:
```html
<div class="cards-row">
  <section class="card conditions-card">
    …
  </section>
  <div class="day-cards-col">
    <div class="card day-card" id="day-card-1"></div>
    <div class="card day-card" id="day-card-2"></div>
  </div>
</div>
```

With:
```html
<div class="hero-grid">
  <section class="card conditions-card">
    …
  </section>
  <div class="days-grid">
    <div class="card day-card" id="day-card-1"></div>
    <div class="card day-card" id="day-card-2"></div>
    <div class="card day-card" id="day-card-3"></div>
    <div class="card day-card" id="day-card-4"></div>
  </div>
</div><!-- .hero-grid -->
```

- [ ] **Step 4: Add `current-icon` span and `hourly-strip` div to conditions card**

Inside `.conditions-card`, the `.cond-main` div needs the icon span added before the temperature:
```html
<div class="cond-main">
  <span class="current-icon" id="current-icon" aria-hidden="true">☁️</span>
  <div class="current-temp" id="current-temp">—°</div>
  <div class="current-detail">
    <div class="current-condition" id="current-condition">—</div>
    <div class="current-feels" id="current-feels">Feels like —°</div>
  </div>
</div>
```

After `.cond-top`, add the hourly strip:
```html
<!-- Hourly strip: next ~12 hours -->
<div class="hourly-strip" id="hourly-strip"></div>
```

- [ ] **Step 5: Expand stats grid from 4 cells to 8 cells**

Replace the existing 4-stat `.stats-grid` with all 8 stats in this exact order (Humidity · Wind · Gust · Pressure · Dew Point · Cloud · Rain Today · UV):

```html
<div class="stats-grid">
  <div class="stat">
    <svg class="stat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M12 2a3 3 0 0 1 3 3v7a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z"/>
      <path d="M19 10a7 7 0 0 1-14 0"/>
    </svg>
    <span class="stat-value" id="humidity">—%</span>
    <span class="stat-label">Humidity</span>
  </div>
  <div class="stat">
    <svg class="stat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M5 8h8a4 4 0 0 1 0 8H5"/>
      <path d="M3 12h2M9 4l-2 4M15 4l2 4"/>
    </svg>
    <span class="stat-value" id="wind">— km/h</span>
    <span class="stat-label wind-dir" id="wind-dir">—</span>
  </div>
  <div class="stat">
    <svg class="stat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M3 12c2-3 4-3 6 0M11 12c2-3 4-3 6 0M19 12c1-1.5 2-1.5 3 0"/>
      <path d="M3 17c2-3 4-3 6 0M11 17c2-3 4-3 6 0M19 17c1-1.5 2-1.5 3 0"/>
    </svg>
    <span class="stat-value" id="gust">— km/h</span>
    <span class="stat-label">Gust</span>
  </div>
  <div class="stat">
    <svg class="stat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="12" cy="12" r="9"/>
      <circle cx="12" cy="12" r="3"/>
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3"/>
    </svg>
    <span class="stat-value" id="pressure">— hPa</span>
    <span class="stat-label" id="pressure-trend">Pressure</span>
  </div>
  <div class="stat">
    <svg class="stat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M12 3l5 8a5.5 5.5 0 1 1-10 0z"/>
    </svg>
    <span class="stat-value" id="dewpoint">—°</span>
    <span class="stat-label">Dew Point</span>
  </div>
  <div class="stat">
    <svg class="stat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M6 17h11a4 4 0 0 0 0-8 6 6 0 0 0-11.7 1.5A3.5 3.5 0 0 0 6 17z"/>
    </svg>
    <span class="stat-value" id="cloud-cover">—%</span>
    <span class="stat-label">Cloud</span>
  </div>
  <div class="stat">
    <svg class="stat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M12 3c-4 5-6 8-6 11a6 6 0 0 0 12 0c0-3-2-6-6-11z"/>
    </svg>
    <span class="stat-value" id="rain-today">— mm</span>
    <span class="stat-label" id="rain-chance">Rain today</span>
  </div>
  <div class="stat">
    <svg class="stat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="12" cy="12" r="5"/>
      <path d="M12 1v3M12 20v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M1 12h3M20 12h3M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12"/>
    </svg>
    <span class="stat-value" id="uv-index">—</span>
    <span class="stat-label" id="uv-label">UV</span>
  </div>
</div>
```

- [ ] **Step 6: Move tides out of conditions card; make it a standalone section after the chart**

Remove the entire tides block from inside `.conditions-card`. After the `</section>` of `.chart-section`, add:

```html
<!-- ── Tides Card (full-width, vertical list) ──────────────────────── -->
<section class="card tides-card">
  <div class="tides-header">
    <div class="tides-title">
      <svg class="tide-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M2 18c2-4 4-4 6 0s4 4 6 0 4-4 6 0"/>
        <path d="M2 13c2-4 4-4 6 0s4 4 6 0 4-4 6 0"/>
      </svg>
      <span>New Brighton Beach — Tides</span>
    </div>
    <div class="tides-now" id="tides-now">
      <span class="tides-now-label">Now</span>
      <span class="tides-now-value" id="tides-now-value">—</span>
      <span class="tides-now-trend" id="tides-now-trend">—</span>
    </div>
  </div>

  <div class="tides-body">
    <div class="tide-chart-wrap">
      <canvas id="tide-mini-chart"></canvas>
    </div>
    <div class="tides-list" id="tides-list">
      <span class="tide-loading">Computing…</span>
    </div>
  </div>
</section>
```

Note: the tide canvas has **no `width`/`height` attributes** — the CSS `width: 100%; height: 100%` on `#tide-mini-chart` and `min-height: 180px` on `.tide-chart-wrap` control dimensions. The JS `drawTideMiniChart` must handle this (see Step 8 below).

- [ ] **Step 7: Move chart section inside `<main class="app">` and make it a card**

Currently the chart `<section class="chart-section">` is outside `.app`. Move it inside `<main class="app">`, between the hero grid and the tides card, and add `card` class:

```html
<!-- ── Forecast chart ──────────────────────────────────────────────── -->
<section class="chart-section card">
  <div class="chart-header">
    <span class="chart-header-label">Forecast</span>
    <label class="chart-zoom-label" for="chart-zoom">
      <select id="chart-zoom" class="chart-zoom-select">
        <option value="1">1 day</option>
        <option value="2">2 days</option>
        <option value="3" selected>3 days</option>
        <option value="4">4 days</option>
        <option value="5">5 days</option>
      </select>
    </label>
  </div>
  <div class="chart-scroll" id="chart-scroll">
    <canvas id="weather-chart"></canvas>
  </div>
  <div class="chart-legend">
    <span class="legend-item temp">Temperature</span>
    <span class="legend-item feels">Feels like</span>
    <span class="legend-item wind">Wind</span>
    <span class="legend-item precip">Precipitation</span>
    <span class="legend-item pressure">Pressure</span>
  </div>
</section>
```

Note the zoom default changed from `value="2"` to `value="3" selected`.

- [ ] **Step 8: Commit**

```bash
git add index.html
git commit -m "markup: restructure to hero-grid, 8-stat grid, standalone tides card"
```

---

## Task 3: Replace `_drawTempLabels()` in `src/chart.js`

**Files:**
- Modify: `src/chart.js` (lines 572–600)

`★ Insight ─────────────────────────────────────`
The current implementation finds local peaks/troughs — every hour where temperature is higher than both neighbors. This produces many labels crowding the chart. The new design reduces it to exactly 2 labels per calendar day: the hour of the daily maximum (warm orange) and the hour of the daily minimum (cyan). Grouping by `Pacific/Auckland` local date string ensures "day" boundaries match what the user sees on the day axis, which already uses the same approach at lines 620–628.
`─────────────────────────────────────────────────`

- [ ] **Step 1: Replace the `_drawTempLabels` method (lines 572–600)**

Replace the entire method (from `// ── 12. Temperature labels…` comment through the closing `}` at line 600) with:

```javascript
// ── 12. Temperature labels — one high + one low per calendar day ───
_drawTempLabels() {
  const { ctx, hours } = this;
  const TZ = "Pacific/Auckland";

  // Group hour indices by local calendar date
  const byDay = new Map();
  for (let i = 0; i < hours.length; i++) {
    const date = new Date((hours[i].validTimeUtc || 0) * 1000)
      .toLocaleDateString("en-NZ", { timeZone: TZ });
    if (!byDay.has(date)) byDay.set(date, []);
    byDay.get(date).push(i);
  }

  ctx.save();
  ctx.font      = "bold 11px -apple-system, sans-serif";
  ctx.textAlign = "center";
  ctx.lineWidth = 3;

  for (const indices of byDay.values()) {
    // Find index of daily max temperature
    const highIdx = indices.reduce((best, i) =>
      (hours[i].temperature ?? -Infinity) > (hours[best].temperature ?? -Infinity) ? i : best,
      indices[0]
    );
    // Find index of daily min temperature
    const lowIdx = indices.reduce((best, i) =>
      (hours[i].temperature ?? Infinity) < (hours[best].temperature ?? Infinity) ? i : best,
      indices[0]
    );

    const drawLabel = (idx, color, offset) => {
      const t = hours[idx].temperature ?? 0;
      const x = this.hourX(idx);
      const y = this.tempY(t) + offset;
      const lbl = `${Math.round(t)}°`;
      ctx.strokeStyle = labelStroke();
      ctx.strokeText(lbl, x, y);
      ctx.fillStyle = color;
      ctx.fillText(lbl, x, y);
    };

    drawLabel(highIdx, C.tempLine,  -6);  // high: warm orange, above line
    drawLabel(lowIdx,  C.feelsLine, 14);  // low:  cyan, below line
  }

  ctx.restore();
}
```

- [ ] **Step 2: Verify `labelStroke()` is defined**

Run:
```
grep -n "function labelStroke\|labelStroke =" src/chart.js
```

Expected output: a line showing `labelStroke` defined (it already exists in the production file). If not found, add this helper just above the `WeatherChart` class definition:

```javascript
function labelStroke() {
  return getComputedStyle(document.documentElement)
    .getPropertyValue("--chart-bg").trim() || "rgba(245,248,252,0.85)";
}
```

- [ ] **Step 3: Commit**

```bash
git add src/chart.js
git commit -m "chart: label calendar-day high and low only, drop per-peak/trough labels"
```

---

## Task 4: Fix tide chart canvas sizing in JS

The tide canvas no longer has fixed `width`/`height` HTML attributes. `drawTideMiniChart` in `src/app.js` must read the element's actual rendered size.

**Files:**
- Modify: `src/app.js` — `drawTideMiniChart` function

- [ ] **Step 1: Find `drawTideMiniChart` in app.js**

```
grep -n "drawTideMiniChart\|tide-mini-chart" src/app.js
```

- [ ] **Step 2: Update canvas sizing at the start of the function**

Find the lines that set canvas width/height (they likely read `canvas.width = 280; canvas.height = 56;` or similar fixed values). Replace the sizing block with:

```javascript
const rect = canvas.parentElement.getBoundingClientRect();
const dpr  = window.devicePixelRatio || 1;
const W    = rect.width  || canvas.parentElement.offsetWidth  || 400;
const H    = rect.height || canvas.parentElement.offsetHeight || 180;
canvas.width  = W * dpr;
canvas.height = H * dpr;
canvas.style.width  = W + "px";
canvas.style.height = H + "px";
const ctx = canvas.getContext("2d");
ctx.scale(dpr, dpr);
```

- [ ] **Step 3: Fix hardcoded dark fill colors inside `drawTideMiniChart`**

The tide fill gradient uses hardcoded dark-theme RGBA values. Replace them with CSS variable reads:

```javascript
const cs     = getComputedStyle(document.documentElement);
const curveC = cs.getPropertyValue("--tide-curve").trim()   || "rgba(10,140,200,0.9)";
const fillA  = cs.getPropertyValue("--tide-fill-a").trim()  || "rgba(80,170,220,0.55)";
const fillB  = cs.getPropertyValue("--tide-fill-b").trim()  || "rgba(140,200,235,0.4)";
const fillC  = cs.getPropertyValue("--tide-fill-c").trim()  || "rgba(220,235,250,0.15)";
```

Then use `curveC`, `fillA`, `fillB`, `fillC` instead of any hardcoded RGBA strings in the gradient/stroke calls within the same function.

- [ ] **Step 4: Commit**

```bash
git add src/app.js
git commit -m "fix: tide canvas uses rendered dimensions and CSS var colors for light theme"
```

---

## Self-Review Checklist

- [x] All 4 tasks cover the 3 files that need changing (style.css, index.html, chart.js) plus the JS fix for tide canvas
- [x] No TBD or placeholder steps — every step has actual code
- [x] `labelStroke()` is verified before use in Task 3 Step 2
- [x] Tide canvas sizing fix added as Task 4 (a spec gap that would break the tide chart at runtime)
- [x] `data-theme="light"` on `<html>` — covered Task 2 Step 1
- [x] Theme toggle removed — covered Task 2 Step 2
- [x] Chart zoom default changed from 2 → 3 — covered Task 2 Step 7
- [x] `color-mix(in oklch, …)` used for `.hour-cell.now` and `.tide-event.next` — modern browsers only; acceptable for this project (GitHub Pages, no IE requirement)
- [x] `id="pressure-trend"` added to pressure stat label — covered Task 2 Step 5
- [x] `id="gust"`, `id="dewpoint"`, `id="cloud-cover"`, `id="rain-today"`, `id="rain-chance"`, `id="uv-index"`, `id="uv-label"` — all added in Task 2 Step 5, matching the IDs that `src/app.js` already targets
