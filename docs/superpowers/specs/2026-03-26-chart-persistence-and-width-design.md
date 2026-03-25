# Design Spec: Chart Days Persistence & Responsive Width

**Date:** 2026-03-26
**Status:** Approved

---

## Overview

Two related UX improvements to the forecast chart:

1. **Days persistence** — the browser remembers the user's last "days to show" dropdown selection across page loads and sessions.
2. **Responsive chart width** — the chart section always matches the width of the top cards section, including after phone rotation or desktop window resize.

---

## Feature 1: Days Persistence via localStorage

### Goal
When a user selects "3 days" from the dropdown, their next visit should open with 3 days pre-selected — not reset to the HTML default of 2.

### Storage

- **Key:** `weatherTempo.chartDays`
- **Value:** string `"1"` through `"5"` (the `<option value>` strings)
- **Scope:** `localStorage` — persists across sessions, per-browser/device

### Behaviour on page load

All localStorage access must be wrapped in try/catch. In Safari private browsing and when storage quota is exceeded, `localStorage` throws a `DOMException`. An unhandled throw at this point would prevent `initChart` from being called. The catch block must silently fall through to the default.

1. Attempt `localStorage.getItem("weatherTempo.chartDays")` inside a try/catch.
2. If a value was retrieved, validate it against the actual `<option>` values from `zoomSel` (e.g. `Array.from(zoomSel.options).map(o => o.value).includes(stored)`). This is preferred over a hardcoded `"1"`–`"5"` check so that if the option set ever changes, stale stored values are rejected rather than silently accepted.
3. If valid, set `zoomSel.value` to the stored value.
4. If invalid or missing (first visit, cleared storage, private browsing), leave the HTML `selected` default (`"2"`) in place.
5. Pass the resolved `+zoomSel.value` to `initChart()`. This read and assignment must occur before the existing `initChart()` call so the chart renders immediately with the persisted day count — not as a follow-up call after the default has already rendered.

### Behaviour on dropdown change

In the existing `zoomSel` `"change"` listener, after re-calling `initChart`, persist the selection:

```js
try {
  localStorage.setItem("weatherTempo.chartDays", zoomSel.value);
} catch (_) { /* storage unavailable — silently ignore */ }
```

### Files changed
- `src/app.js` — add try/catch localStorage read before `initChart` call; add try/catch write in change listener.

---

## Feature 2: Responsive Chart Width

### Goal
The `.chart-section` (chart header + scroll canvas + legend) should always match the rendered width of `.app` (the top cards row). This must hold at initial load, after desktop window resize, and after mobile device rotation.

### CSS changes (`style.css`)

Modify the `.chart-section` rule to use the same `max-width: 900px; width: 100%` pattern as `.app`. The `position: relative` and `padding-bottom` properties must be preserved — `position: relative` is required for the absolutely-positioned hover tooltip (`#chart-tooltip`).

**Before:**
```css
.chart-section {
  position: relative;
  padding-bottom: 48px;
  width: 80vw;
  margin: 0 auto;
}

@media (max-width: 900px) {
  .chart-section { width: 95vw; }
}
```

**After:**
```css
.chart-section {
  position: relative;
  padding-bottom: 48px;
  max-width: 900px;
  width: 100%;
  margin: 0 auto;
}
```

The `95vw` media query override is removed — `width: 100%` already handles narrower viewports correctly, exactly as `.app` does.

### JS changes (`src/app.js`) — ResizeObserver

After `initChart` is first called (inside `boot()`, where `data` is in scope), attach a `ResizeObserver` to `.chart-section`. The observer must be created inside `boot()` so that `data`, `zoomSel`, and other locals are available in the callback closure.

The `ResizeObserver` callback fires asynchronously (before next paint, but not synchronously on `.observe()`). The first callback will therefore always fire shortly after `.observe()` is called — even though `initChart` was just called — resulting in one redundant re-render on every page load. To avoid this, use a `firstRun` flag to skip the initial callback:

```js
let resizeTimer;
let roFirstRun = true;
const chartSection = document.querySelector(".chart-section");
if (chartSection && window.ResizeObserver) {
  new ResizeObserver(() => {
    if (roFirstRun) { roFirstRun = false; return; }
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      initChart(data.hourly, data.current, +zoomSel.value);
    }, 150);
  }).observe(chartSection);
}
```

The observer is set up once and never torn down (page lifetime). The existing `initChart._abort` abort-controller pattern prevents listener accumulation on repeated calls, so re-calling `initChart` on resize is safe.

### Why not a `window` `resize` event?

`ResizeObserver` is more precise — it fires only when the element's actual rendered box changes, not on every window resize regardless of layout impact. It also catches mobile orientation changes without a separate `orientationchange` listener.

### Files changed
- `style.css` — modify `.chart-section`: replace `width: 80vw` with `max-width: 900px; width: 100%`; preserve `position: relative` and `padding-bottom`; remove `95vw` media query override.
- `src/app.js` — add `ResizeObserver` inside `boot()` after the initial `initChart` call.

---

## Out of Scope

- Syncing selection across tabs (StorageEvent) — not needed.
- URL-based state (`?days=3`) — not needed.
- Server-side persistence — not needed.

---

## Summary of Changes

| File | Change |
|---|---|
| `style.css` | `.chart-section`: replace `width: 80vw` → `max-width: 900px; width: 100%`; preserve `position: relative` + `padding-bottom`; remove `95vw` media query |
| `src/app.js` | try/catch localStorage read before `initChart`; try/catch write in change listener; `ResizeObserver` inside `boot()` with `firstRun` guard |
