# Chart Days Persistence & Responsive Width Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist the chart "days to show" dropdown selection in `localStorage` across page loads, and make the chart section always match the width of the top cards section (including after mobile rotation and desktop window resize).

**Architecture:** Pure HTML/CSS/JS — no build step, no test runner. Two files change: `style.css` for the width CSS fix, and `src/app.js` for localStorage read/write and a `ResizeObserver`. All changes are inside the existing `boot()` async IIFE in `app.js`. Manual browser verification is used throughout since there is no automated test framework.

**Tech Stack:** Vanilla JS (IIFE pattern), `localStorage` Web API, `ResizeObserver` Web API, CSS `max-width`/`width`.

**Spec:** `docs/superpowers/specs/2026-03-26-chart-persistence-and-width-design.md`

---

## File Map

| File | Change |
|------|--------|
| `src/app.js` | Add localStorage read before `initChart` call; add localStorage write in change listener; add `ResizeObserver` after change listener — all inside `boot()` |
| `style.css` | Replace `width: 80vw` with `max-width: 900px; width: 100%` on `.chart-section`; remove `width: 95vw` media query override |

---

## Task 1: localStorage — persist and restore days selection

**Files:**
- Modify: `src/app.js:842-851`

The current code at lines 842–851 of `src/app.js`:

```js
// Read initial zoom value from the dropdown (default 2 from HTML selected attr)
const zoomSel = document.getElementById("chart-zoom");
initChart(data.hourly, data.current, zoomSel ? +zoomSel.value : 2);

// Re-render chart when zoom level changes
if (zoomSel) {
  zoomSel.addEventListener("change", () => {
    initChart(data.hourly, data.current, +zoomSel.value);
  });
}
```

Replace that entire block with:

```js
// Read initial zoom value — restore from localStorage if available
const zoomSel = document.getElementById("chart-zoom");
if (zoomSel) {
  try {
    const stored = localStorage.getItem("weatherTempo.chartDays");
    const validValues = Array.from(zoomSel.options).map(o => o.value);
    if (stored && validValues.includes(stored)) {
      zoomSel.value = stored;
    }
  } catch (_) { /* localStorage unavailable (e.g. Safari private mode) */ }
}
initChart(data.hourly, data.current, zoomSel ? +zoomSel.value : 2);

// Re-render chart when zoom level changes; persist selection
if (zoomSel) {
  zoomSel.addEventListener("change", () => {
    initChart(data.hourly, data.current, +zoomSel.value);
    try {
      localStorage.setItem("weatherTempo.chartDays", zoomSel.value);
    } catch (_) { /* storage unavailable */ }
  });
}
```

**Key points:**
- The localStorage read happens before `initChart()` so the chart renders once with the correct day count.
- Validation uses `Array.from(zoomSel.options).map(o => o.value)` — reads from the actual DOM options, not a hardcoded range, so stale stored values are rejected if the option set ever changes.
- Both read and write are wrapped in try/catch — `localStorage` throws `DOMException` in Safari private browsing and when quota is exceeded.

- [ ] **Step 1: Apply the code change**

  In `src/app.js`, replace the block starting with `// Read initial zoom value from the dropdown` through the closing `}` of the `if (zoomSel)` change-listener block (lines 842–851) with the new block above.

- [ ] **Step 2: Verify in browser — first visit**

  Open `index.html` in a browser (or via live server). Open DevTools → Application → Local Storage. Confirm `weatherTempo.chartDays` is not present. Chart should display the default 2-day view.

- [ ] **Step 3: Verify in browser — selection is saved**

  Change the dropdown to "4 days". Confirm in DevTools → Local Storage that `weatherTempo.chartDays` = `"4"` is now set.

- [ ] **Step 4: Verify in browser — selection is restored**

  Reload the page. Confirm the dropdown shows "4 days" and the chart renders 4 days without flicker (it should NOT briefly show 2 days then jump to 4).

- [ ] **Step 5: Commit**

  ```bash
  git add src/app.js
  git commit -m "feat: persist chart days selection in localStorage"
  ```

---

## Task 2: CSS — chart width matches top section

**Files:**
- Modify: `style.css:530-535` (`.chart-section` rule)
- Modify: `style.css:647-649` (`@media (max-width: 900px)` block — remove the `chart-section` override)

Current state of the two locations:

```css
/* line 530 */
.chart-section {
  position: relative;
  padding-bottom: 48px;   /* breathing room at page bottom */
  width: 80vw;
  margin: 0 auto;
}

/* line 647 */
@media (max-width: 900px) {
  .chart-section { width: 95vw; }
}
```

- [ ] **Step 1: Replace `width: 80vw` in `.chart-section`**

  In `style.css` line 533, replace `width: 80vw;` with:
  ```css
  max-width: 900px;
  width: 100%;
  ```

  The result should be:
  ```css
  .chart-section {
    position: relative;
    padding-bottom: 48px;   /* breathing room at page bottom */
    max-width: 900px;
    width: 100%;
    margin: 0 auto;
  }
  ```

  **Do not remove `position: relative`** — the hover tooltip (`#chart-tooltip`) is positioned `absolute` relative to this element and will break without it.

- [ ] **Step 2: Remove the `95vw` media query line**

  In `style.css`, inside the `@media (max-width: 900px)` block around line 647, delete the line:
  ```css
    .chart-section { width: 95vw; }
  ```

  If that was the only rule in that media query block, remove the entire `@media` block too. If other rules exist in that block, leave those and only remove the `chart-section` line.

- [ ] **Step 3: Verify in browser — desktop**

  Open the page in a desktop browser at a wide viewport (>900px). The chart section and the top cards row should now have the same width. Previously the chart was 80vw (wider than 900px on large monitors).

- [ ] **Step 4: Verify in browser — narrow viewport**

  Resize the browser window to below 600px. Both the cards row and chart section should span the full viewport width with no gap between their edges.

- [ ] **Step 5: Verify hover tooltip still works**

  Hover over the chart. The tooltip should appear positioned correctly over the chart, not floating at the top-left of the page. (This confirms `position: relative` is preserved.)

- [ ] **Step 6: Commit**

  ```bash
  git add style.css
  git commit -m "fix: chart section width matches top cards section"
  ```

---

## Task 3: ResizeObserver — redraw chart on width change

**Files:**
- Modify: `src/app.js` — add after the `if (zoomSel)` change-listener block inside `boot()`

After Task 1, `boot()` ends with this structure:

```js
initChart(data.hourly, data.current, zoomSel ? +zoomSel.value : 2);

if (zoomSel) {
  zoomSel.addEventListener("change", () => {
    initChart(data.hourly, data.current, +zoomSel.value);
    try {
      localStorage.setItem("weatherTempo.chartDays", zoomSel.value);
    } catch (_) { /* storage unavailable */ }
  });
}

startLiveRefresh(data);
```

Add the ResizeObserver block between the `if (zoomSel)` block and `startLiveRefresh(data)`:

```js
// Redraw chart when container width changes (desktop resize, mobile rotation)
let resizeTimer;
let roFirstRun = true;
const chartSection = document.querySelector(".chart-section");
if (chartSection && window.ResizeObserver) {
  new ResizeObserver(() => {
    if (roFirstRun) { roFirstRun = false; return; }
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      initChart(data.hourly, data.current, zoomSel ? +zoomSel.value : 2);
    }, 150);
  }).observe(chartSection);
}
```

**Key points:**
- This block must be inside `boot()` so `data` and `zoomSel` are in scope in the callback closure.
- `roFirstRun` suppresses the initial async callback that `ResizeObserver` fires after `.observe()` — without this, every page load would cause a redundant second chart render 150ms after load.
- The 150ms debounce prevents thrashing during continuous drag-resize on desktop.
- `initChart._abort` (set inside `initChart`) cancels all prior drag and hover listeners before adding new ones, so repeated calls are safe.

- [ ] **Step 1: Apply the code change**

  Add the ResizeObserver block after the `if (zoomSel)` block and before `startLiveRefresh(data)`.

- [ ] **Step 2: Verify in browser — no double-render on load**

  Open the page. Open DevTools → Network or Performance tab. Confirm the chart renders once, not twice. There should be no visible flash or double-draw.

- [ ] **Step 3: Verify in browser — desktop resize**

  With the page open, slowly drag the browser window narrower then wider. After the drag stops (150ms), the chart canvas should redraw to fill the new width correctly — no stretched or clipped chart.

- [ ] **Step 4: Verify in browser — mobile rotation (or DevTools simulation)**

  In DevTools, open Device Mode (mobile simulation). Switch between portrait and landscape orientation. The chart should redraw to fill the new width after rotation.

- [ ] **Step 5: Verify hover tooltip still works after resize**

  After resizing, hover over the chart. The cursor line and tooltip should appear at the correct horizontal position.

- [ ] **Step 6: Commit**

  ```bash
  git add src/app.js
  git commit -m "feat: redraw chart on container resize and mobile rotation"
  ```
