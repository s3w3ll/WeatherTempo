// WeatherTempo — Scriptable iOS Widget
// ---------------------------------------------------------------------------
// Renders live Christchurch conditions from the WeatherTempo Cloudflare
// Worker on a home-screen widget. Small/medium show a current-conditions
// card; large adds a 5-day WeatherGraph-style meteogram (temp curve with
// daily hi/lo, cloud shading, rain bars, plus a per-day Wind/UV badge
// strip) rendered via DrawContext — see renderMeteogramImage() below.
//
// Large widget is a like-for-like recreation of Apple Weather's watch-app
// meteogram screenshot: header + precip-intensity rail + two stacked chart
// panels (renderChartPanel, called once per panel with a different x-axis
// mode) — see buildLargeWidget() and the comment above renderChartPanel().
//
// SETUP (one-time):
//   1. Install "Scriptable" from the App Store (free).
//   2. Open Scriptable → tap "+" → paste this whole file → name it
//      "WeatherTempo" (top-left, tap the title).
//   3. Long-press your home screen → "+" → search "Scriptable" → add a
//      widget (small/medium/large — large gets you the meteogram) → tap
//      it → set Script: WeatherTempo, When Interacting: Run Script.
//   4. Widget refreshes on iOS's own schedule (usually every 15-60 min,
//      not under app control — see REFRESH_MINUTES below for the hint
//      Scriptable gives the OS).
//
// DATA SOURCE: same Cloudflare Worker src/app.js uses — see WORKER_URL.
// ---------------------------------------------------------------------------

const WORKER_URL = "https://weathertempo-pws-proxy.forgesync.workers.dev";
const LOCATION_ID = "christchurch";
const LOCATION_LABEL = "Christchurch";
const REFRESH_MINUTES = 30; // matches the pipeline's ~30 min data cadence
const WIND_SMOOTH_WINDOW = 5; // hours averaged per point on the wind line — wind is noisier hour-to-hour than temp, so it gets an extra smoothing pass the temp curve doesn't need

// Palette lifted from src/chart.js CHART_COLORS so the widget matches the
// web dashboard's look.
const COLORS = {
  bgLight: "#f5f8fc",
  bgDark: "#0e1420",
  tempLine: "#f2c94c",   // yellow — temperature curve (large widget matches the Apple Weather reference's yellow, not chart.js's orange)
  wind: "#e5484d",       // red — wind, matches chart.js's wind-zone line color
  precip: "#3fa9f5",     // blue — precipitation
  uv: "#3ecf6e",         // green — UV bars in the hourly/daily strips
  textLight: "#1a2640",
  textDark: "#e8edf5",
  mutedLight: "#56708e",
  mutedDark: "#8fa3bf",

  // Large widget only — the reference screenshot always sits on its own
  // fixed blue "sky" gradient regardless of home-screen light/dark mode
  // (this is how Apple's own Weather widget behaves too: the card color
  // follows the weather condition, not the system theme). So unlike
  // textColor()/mutedColor() below, these are NOT Color.dynamic.
  skyTop: "#1c3f74",
  skyMid: "#2e5c8f",
  skyBot: "#4a7db0",
  skyText: "#ffffff",
  skyMuted: "#a9c9e8",
  skyCyan: "#5fd6f2",    // "Moderate rain at…" label + the feels-like dotted line

  // Precipitation-intensity bar segments (renderPrecipBar) — light → dark
  // as mm/h climbs, same idea as the reference's shaded rain-intensity rail.
  precipLight: "#7fd8f7",
  precipModerate: "#2f9fe8",
  precipHeavy: "#1a5fc2",
};

async function fetchWeather() {
  const url = `${WORKER_URL}?location=${encodeURIComponent(LOCATION_ID)}`;
  const req = new Request(url);
  req.timeoutInterval = 10;
  return await req.loadJSON();
}

// ─────────────────────────────────────────────────────────────────────────
// Icon + accent color per condition, per-condition color scheme (Apple
// Weather-style — instant visual read without reading text). The worker's
// `iconCode` already bakes in day/night (e.g. 32 clear-day vs 31
// clear-night), so no separate day/night branch is needed here — see
// workers/pws-proxy.js → wmoToIcon() for the source TWC-code mapping.
//
// All symbol names below ship in SF Symbols 3+ (iOS 15+) under the
// "Weather" category — verify any future additions in the free "SF
// Symbols" Mac app or sfsymbols.com before using them; Scriptable can only
// draw symbols that exist on-device.
// ─────────────────────────────────────────────────────────────────────────
const ICON_MAP = {
  32: { symbol: "sun.max.fill", color: "#f5b942" },       // clear (day)
  31: { symbol: "moon.stars.fill", color: "#8a8fb0" },    // clear (night)
  34: { symbol: "sun.max.fill", color: "#f5b942" },       // mainly clear (day)
  33: { symbol: "moon.stars.fill", color: "#8a8fb0" },    // mainly clear (night)
  30: { symbol: "cloud.sun.fill", color: "#e8a33d" },     // partly cloudy (day)
  27: { symbol: "cloud.moon.fill", color: "#7d84ab" },    // partly cloudy (night)
  26: { symbol: "cloud.fill", color: "#8a94a6" },         // overcast
  20: { symbol: "cloud.fog.fill", color: "#9aa5b8" },     // fog
  9:  { symbol: "cloud.drizzle.fill", color: "#4f8fe0" }, // drizzle
  11: { symbol: "cloud.rain.fill", color: "#2563d8" },    // rain
  12: { symbol: "cloud.rain.fill", color: "#2563d8" },    // rain (heavier)
  16: { symbol: "cloud.snow.fill", color: "#b8d4f0" },    // snow
  45: { symbol: "cloud.heavyrain.fill", color: "#1a4faa" }, // showers
  4:  { symbol: "cloud.bolt.rain.fill", color: "#8b5fbf" }, // thunderstorm
};
const DEFAULT_ICON = { symbol: "cloud.fill", color: "#8a94a6" };

function iconForCondition(iconCode) {
  return ICON_MAP[iconCode] || DEFAULT_ICON;
}

function fmtTemp(v) {
  return v == null ? "—" : `${Math.round(v)}°`;
}

function fmtUpdatedAgo(isoString) {
  const ageMs = Date.now() - new Date(isoString).getTime();
  const mins = Math.round(ageMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  return `${Math.round(mins / 60)}h ago`;
}

function addBackground(widget) {
  widget.backgroundColor = Color.dynamic(
    new Color(COLORS.bgLight),
    new Color(COLORS.bgDark)
  );
}

function textColor() {
  return Color.dynamic(new Color(COLORS.textLight), new Color(COLORS.textDark));
}

function mutedColor() {
  return Color.dynamic(new Color(COLORS.mutedLight), new Color(COLORS.mutedDark));
}

// ─────────────────────────────────────────────────────────────────────────
// Meteogram rendering (large widget) — a simplified version of the
// WeatherGraph-style chart in src/chart.js. Scriptable's ListWidget can't
// draw curves/bars directly, so this renders the whole chart into a
// DrawContext offscreen and the result gets dropped in as a single image.
//
// Kept deliberately simpler than chart.js: no cloud-cover overlay, no wind
// row, no pressure line, straight-segment-through-midpoints smoothing
// instead of true Catmull-Rom. Good candidates to layer in later if you
// want closer parity with the web chart.
// ─────────────────────────────────────────────────────────────────────────

function scaleY(value, min, max, top, bottom) {
  if (max === min) return (top + bottom) / 2;
  const t = (value - min) / (max - min);
  return bottom - t * (bottom - top);
}

// Smooths a polyline by routing through the midpoint of each consecutive
// pair with a quadratic curve anchored at the real data point — cheap
// approximation of chart.js's Catmull-Rom curve, good enough at widget
// scale.
function smoothPath(points) {
  const path = new Path();
  if (points.length === 0) return path;
  path.move(points[0]);
  for (let i = 1; i < points.length - 1; i++) {
    const mid = new Point(
      (points[i].x + points[i + 1].x) / 2,
      (points[i].y + points[i + 1].y) / 2
    );
    path.addQuadCurve(mid, points[i]);
  }
  path.addLine(points[points.length - 1]);
  return path;
}

// Centered moving average over `windowSize` hours. smoothPath() only
// softens the *geometry* of a path between points — it can't fix noisy
// underlying data. Wind speed swings hour-to-hour far more than
// temperature does, so the raw line looked jagged even after smoothPath();
// averaging the values themselves first fixes that at the source.
function movingAverage(values, windowSize) {
  const half = Math.floor(windowSize / 2);
  return values.map((_, i) => {
    const start = Math.max(0, i - half);
    const end = Math.min(values.length, i + half + 1);
    const slice = values.slice(start, end);
    return slice.reduce((sum, v) => sum + v, 0) / slice.length;
  });
}

// DrawContext has no native dashed-stroke option, so this walks each
// segment of the polyline in dashLen/gapLen increments, stroking only the
// "on" pieces — used for the wind line, so it stays visually distinct from
// the solid temp curve it shares an axis with.
function strokeDashedPolyline(draw, points, dashLen, gapLen, color, width) {
  draw.setStrokeColor(color);
  draw.setLineWidth(width);
  let drawing = true;
  let remaining = dashLen;
  for (let i = 0; i < points.length - 1; i++) {
    let cur = points[i];
    const end = points[i + 1];
    let segLen = Math.hypot(end.x - cur.x, end.y - cur.y);
    const ux = segLen ? (end.x - cur.x) / segLen : 0;
    const uy = segLen ? (end.y - cur.y) / segLen : 0;
    while (segLen > 0.01) {
      const step = Math.min(remaining, segLen);
      const next = new Point(cur.x + ux * step, cur.y + uy * step);
      if (drawing) {
        const seg = new Path();
        seg.move(cur);
        seg.addLine(next);
        draw.addPath(seg);
        draw.strokePath();
      }
      cur = next;
      segLen -= step;
      remaining -= step;
      if (remaining <= 0.01) {
        drawing = !drawing;
        remaining = drawing ? dashLen : gapLen;
      }
    }
  }
}

function rotatePoint(px, py, cx, cy, angleRad) {
  const dx = px - cx, dy = py - cy;
  return new Point(
    cx + dx * Math.cos(angleRad) - dy * Math.sin(angleRad),
    cy + dx * Math.sin(angleRad) + dy * Math.cos(angleRad)
  );
}

// Wind direction chevron. windDirection is degrees clockwise from north
// (meteorological convention); DrawContext has no path-rotate transform,
// so each vertex is rotated by hand around the marker's center using the
// same (dir - 90) → radians conversion documented in src/chart.js →
// drawWindIndicators(), so it points the same way the web chart does.
//
// Earlier version also drew a shaft from tail to head — at chevron spacing
// of every 3-6 hours that shaft's own length ran right into the dashed
// wind line's own dashes sitting on the same point, reading as a stray
// long stroke rather than a direction marker. The reference just uses a
// small ">"-shaped chevron with no shaft, so this does too: a tip plus two
// wings behind it, nothing extending forward past the tip.
function drawWindArrow(draw, cx, cy, dirDeg, size) {
  const angle = ((dirDeg - 90) * Math.PI) / 180;
  const tip = rotatePoint(cx + size * 0.6, cy, cx, cy, angle);
  const wing1 = rotatePoint(cx - size * 0.4, cy - size * 0.5, cx, cy, angle);
  const wing2 = rotatePoint(cx - size * 0.4, cy + size * 0.5, cx, cy, angle);

  draw.setStrokeColor(new Color(COLORS.wind));
  draw.setLineWidth(1.4);

  const chevron = new Path();
  chevron.move(wing1);
  chevron.addLine(tip);
  chevron.addLine(wing2);
  draw.addPath(chevron);
  draw.strokePath();
}

// ─────────────────────────────────────────────────────────────────────────
// Apple-Weather-style meteogram (large widget), rebuilt to match the
// watch-app screenshot the widget is now cloned from: two stacked panels —
// a near-term hourly one and a multi-day one — drawn by the SAME function
// with different x-axis framing, sitting on ONE continuous background
// instead of each owning a dark card of its own (see buildLargeWidget's
// LinearGradient). That's why every fill below is translucent and
// draw.opaque is false: a transparent PNG lets the sky gradient show
// through everywhere nothing is drawn, and lets the white cloud-wave and
// yellow temp fills blend with that blue into the same olive-green the
// reference image shows wherever they overlap — no manual color mixing
// needed, it falls out of normal alpha compositing.
//
// Layout differences from the old single-chart renderer this replaces:
//   • a cloud "wave" strip + raindrop row on top (drawCloudWave/drawRaindrops)
//   • a green UV bar alongside the blue precip bar, not folded into a badge
//   • mode: "hourly" labels the x-axis with hour numbers + a day-name chip
//     at each midnight (matches "18 · FRI · 6 · 12 · 18 · SAT"); mode:
//     "daily" instead prints one day name per day and per-day hi/lo on the
//     curve (kept from the old renderer, which already did this well).
// ─────────────────────────────────────────────────────────────────────────
function renderChartPanel(hourly, opts) {
  const { width, height, mode, daily } = opts;
  const draw = new DrawContext();
  draw.size = new Size(width, height);
  draw.opaque = false; // transparent — see comment above
  draw.respectScreenScale = true;

  const n = hourly.length;
  if (n < 2) return draw.getImage();
  const xAt = (i) => (i / (n - 1)) * width;
  const hoursPerDay = 24;

  // Day boundaries — found by scanning for real local midnights, not
  // assumed at fixed 24-hour offsets from index 0. Both panels now open on
  // the current hour rather than midnight (see buildLargeWidget's nowIdx),
  // so index 0 is partway through "today", not a day boundary itself —
  // a fixed d*24 step would misplace every separator, day-chip, and
  // per-day hi/lo group by however many hours it is past midnight right
  // now. dayBoundaries[0] is always 0 and the last entry is always n, so
  // segment d spans hourly.slice(dayBoundaries[d], dayBoundaries[d+1]) —
  // segment 0 is the remainder of today, matching daily[0]; segment 1 is
  // tomorrow, matching daily[1]; and so on.
  const dayBoundaries = [0];
  for (let i = 1; i < n; i++) {
    const localHour = +new Date(hourly[i].validTimeUtc * 1000)
      .toLocaleString("en-NZ", { hour: "numeric", hour12: false, timeZone: "Pacific/Auckland" });
    if (localHour === 0) dayBoundaries.push(i);
  }
  dayBoundaries.push(n);

  // Row layout, top to bottom: cloud wave, raindrops, ONE shared plot zone
  // (temp/feels/wind curves AND precip/UV bars, all in the same pixel
  // range — see the bars section below), axis labels. Earlier versions
  // gave precip/UV their own walled-off strip under the curves, which read
  // as two stacked charts; the reference draws bars rising from the same
  // baseline the curves sit on, so this does too.
  const cloudTop = 2, cloudBot = 20;
  const dropY = cloudBot + 8;
  const plotTop = dropY + 14; // extra headroom over the old tempTop for the hourly-mode value labels added below
  const axisH = 14;
  const plotBot = height - axisH - 4;
  const axisY = height - axisH + 2;

  const temps = hourly.map((h) => h.temperature);
  const feels = hourly.map((h) => h.temperatureFeelsLike ?? h.temperature);
  const minT = Math.min(...temps, ...feels) - 2;
  const maxT = Math.max(...temps, ...feels) + 4; // headroom for hi° labels above the peak

  // Night shading — drawn first so it sits behind the cloud band, curves,
  // and bars. Uses the worker's own dayOrNight flag (from Open-Meteo's
  // is_day per hour) rather than deriving sunrise/sunset here, so it's
  // exact for whichever hour Open-Meteo already classified.
  drawDayNightBands(draw, hourly, xAt, cloudTop, plotBot, width);

  drawCloudWave(draw, hourly, xAt, cloudTop, cloudBot - cloudTop);
  drawRaindrops(draw, hourly, xAt, dropY);

  // Wind shares the same plot zone rather than getting its own strip — a
  // fixed 0–90 km/h scale barely moves for Christchurch's usual 10–25
  // km/h, so it gets its own auto-scaled min/max sharing the tall zone
  // instead (a real dual-axis overlay: same pixels, different meaning).
  const smoothedWind = movingAverage(hourly.map((h) => h.windSpeed || 0), WIND_SMOOTH_WINDOW);
  const minW = Math.max(0, Math.min(...smoothedWind) - 2);
  const maxW = Math.max(...smoothedWind) + 2;

  // Day-boundary separators — one per interior dayBoundaries entry (the
  // first and last entries are the panel's own edges, not real boundaries
  // worth drawing a line at).
  draw.setStrokeColor(new Color("#ffffff", 0.14));
  draw.setLineWidth(1);
  for (let d = 1; d < dayBoundaries.length - 1; d++) {
    const x = xAt(dayBoundaries[d]);
    const sep = new Path();
    sep.move(new Point(x, plotTop));
    sep.addLine(new Point(x, plotBot));
    draw.addPath(sep);
    draw.strokePath();
  }

  // Precipitation bars (blue) + UV bars (green) — drawn FIRST, anchored to
  // the same plotBot baseline the curves sit on and capped at a fraction
  // of the zone height, so they read as bars rising up into the shared
  // chart rather than a separate strip. Drawn before the curves/fill so
  // the temp line stays legible on top wherever a tall bar would otherwise
  // cross it.
  const barW = Math.max(1, (width / n) * 0.6);
  const barZoneH = plotBot - plotTop;
  hourly.forEach((h, i) => {
    const pct = (h.precipChance || 0) / 100;
    const barH = pct * barZoneH * 0.55; // capped short of the full zone so it doesn't compete with the curves for headroom
    if (barH >= 1) {
      const barPath = new Path();
      barPath.addRect(new Rect(xAt(i) - barW / 2, plotBot - barH, barW, barH));
      draw.setFillColor(new Color(COLORS.precip, 0.65));
      draw.addPath(barPath);
      draw.fillPath();
    }
    const uvH = Math.min(1, (h.uvIndex || 0) / 11) * barZoneH * 0.4; // UV 11 = WHO "extreme", so scale 0–11 not 0–100; capped shorter than rain so it reads as a secondary series
    if (uvH >= 1) {
      const uvPath = new Path();
      uvPath.addRect(new Rect(xAt(i) - barW / 4, plotBot - uvH, barW / 2, uvH));
      draw.setFillColor(new Color(COLORS.uv, 0.75));
      draw.addPath(uvPath);
      draw.fillPath();
    }
  });

  // Feels-like — dotted cyan line, drawn before the solid temp curve and
  // its fill so those sit above it, matching the reference's layering.
  const feelsPts = feels.map((v, i) => new Point(xAt(i), scaleY(v, minT, maxT, plotTop, plotBot)));
  strokeDashedPolyline(draw, feelsPts, 1.6, 3.4, new Color(COLORS.skyCyan, 0.9), 1.6);

  // Temperature area fill + curve — translucent over the sky gradient
  // rather than a solid navy backdrop (see function comment).
  const tempPts = hourly.map((h, i) => new Point(xAt(i), scaleY(h.temperature, minT, maxT, plotTop, plotBot)));
  const fillPath = smoothPath(tempPts);
  fillPath.addLine(new Point(width, plotBot));
  fillPath.addLine(new Point(0, plotBot));
  fillPath.closeSubpath();
  draw.setFillColor(new Color(COLORS.tempLine, 0.35));
  draw.addPath(fillPath);
  draw.fillPath();

  draw.setStrokeColor(new Color(COLORS.tempLine));
  draw.setLineWidth(2.2);
  draw.addPath(smoothPath(tempPts));
  draw.strokePath();

  // Wind — dashed red line, own auto-scaled axis sharing the plot zone's
  // pixel range (see minW/maxW above), plus a direction chevron every few
  // hours (every hour would be too dense to read as individual chevrons).
  // The daily panel spans 5x the width of the hourly one for the same
  // image width, so its chevrons can space out further (6h) than the
  // hourly panel's (3h) without looking sparse.
  const windArrowStep = mode === "daily" ? 6 : 3;
  const arrowIdxs = [];
  for (let idx = 0; idx < n; idx += windArrowStep) arrowIdxs.push(idx);
  const windPts = smoothedWind.map((v, i) => new Point(xAt(i), scaleY(v, minW, maxW, plotTop, plotBot)));

  // Drawn in pieces — one per gap between chevrons — rather than one
  // dashed stroke across the whole width. A single stroke's dash phase is
  // whatever the running dash/gap math happens to land on at each
  // chevron's x position, so a dash could still fall right under a
  // chevron by chance (worse on the daily panel: it packs 5x the hours
  // into the same pixel width, so there's far less room per chevron for
  // the phase to miss). Cutting the line with a small cleared margin
  // (clearPx) on each side of every chevron, and letting each piece start
  // its own fresh dash phase, guarantees that clearance instead of hoping.
  const clearPx = 4;
  let cursorX = 0;
  arrowIdxs.forEach((idx) => {
    const arrowX = xAt(idx);
    const segPts = windPts.filter((p) => p.x >= cursorX && p.x <= arrowX - clearPx);
    if (segPts.length >= 2) strokeDashedPolyline(draw, segPts, 3, 6, new Color(COLORS.wind, 0.9), 1.6);
    cursorX = arrowX + clearPx;
  });
  const tailPts = windPts.filter((p) => p.x >= cursorX);
  if (tailPts.length >= 2) strokeDashedPolyline(draw, tailPts, 3, 6, new Color(COLORS.wind, 0.9), 1.6);

  arrowIdxs.forEach((idx) => {
    const h = hourly[idx];
    const cx = xAt(idx);
    const cy = scaleY(smoothedWind[idx], minW, maxW, plotTop, plotBot);
    drawWindArrow(draw, cx, cy, h.windDirection || 0, 5);
  });

  if (mode === "daily") {
    // Per-day hi/lo plotted directly on the curve's peak/trough, and a
    // pill-chip day name centered under each day (same chip style the
    // hourly axis uses for its day boundary, for legibility against the
    // busier shared plot zone — plain muted text there was hard to spot).
    //
    // Label VALUES come from this segment's own local max/min, not
    // daily[]'s full-day figures — segment 0 is only "now through
    // midnight" (see dayBoundaries above), so daily[0]'s full-day max
    // could be a hotter hour earlier today that isn't part of the visible
    // curve at all, which would show a number the curve on screen never
    // actually reaches. daily[] is only used to gate how many segments get
    // labeled (real days the worker forecast for, not just data leftovers
    // past the end of it).
    draw.setTextAlignedCenter();
    for (let d = 0; d < dayBoundaries.length - 1 && d < daily.length; d++) {
      const start = dayBoundaries[d], end = dayBoundaries[d + 1];
      const slice = hourly.slice(start, end);
      if (slice.length < 2) continue;
      let hiIdx = 0, loIdx = 0;
      slice.forEach((h, i) => {
        if (h.temperature > slice[hiIdx].temperature) hiIdx = i;
        if (h.temperature < slice[loIdx].temperature) loIdx = i;
      });

      const hiX = xAt(start + hiIdx);
      const hiY = scaleY(slice[hiIdx].temperature, minT, maxT, plotTop, plotBot);
      draw.setFont(Font.boldSystemFont(9));
      draw.setTextColor(new Color(COLORS.skyText));
      draw.drawTextInRect(`${Math.round(slice[hiIdx].temperature)}°`, new Rect(hiX - 16, hiY - 15, 32, 11));

      const loX = xAt(start + loIdx);
      const loY = scaleY(slice[loIdx].temperature, minT, maxT, plotTop, plotBot);
      draw.setFont(Font.systemFont(8));
      draw.setTextColor(new Color(COLORS.skyMuted));
      draw.drawTextInRect(`${Math.round(slice[loIdx].temperature)}°`, new Rect(loX - 16, loY + 4, 32, 11));

      const mid = xAt(Math.min(start + Math.floor((end - start) / 2), n - 1));
      const dayLabel = new Date(hourly[Math.min(start, n - 1)].validTimeUtc * 1000)
        .toLocaleString("en-NZ", { weekday: "short", timeZone: "Pacific/Auckland" })
        .toUpperCase();
      const chipW = 34;
      const chip = new Path();
      chip.addRoundedRect(new Rect(mid - chipW / 2, axisY - 1, chipW, axisH - 2), 4, 4);
      draw.setFillColor(new Color("#ffffff", 0.16));
      draw.addPath(chip);
      draw.fillPath();
      draw.setFont(Font.semiboldSystemFont(9));
      draw.setTextColor(new Color(COLORS.skyText));
      draw.drawTextInRect(dayLabel, new Rect(mid - chipW / 2, axisY, chipW, axisH));
    }
  } else {
    // Per-day hi/lo — every day this panel touches gets its own high and
    // low plotted on the curve, same as the daily panel below, using the
    // shared dayBoundaries computed above. Values are this SLICE's own
    // max/min, not daily[]'s full-day figures: the panel can show only
    // part of a day (its last day likely cuts off wherever the 36h window
    // ends), and a full day's max/min could sit outside what's actually
    // drawn here.
    draw.setTextAlignedCenter();
    for (let d = 0; d < dayBoundaries.length - 1; d++) {
      const start = dayBoundaries[d], end = dayBoundaries[d + 1];
      const slice = hourly.slice(start, end);
      if (slice.length < 2) continue; // sliver too small to label (e.g. panel ends an hour past midnight)
      let hiIdx = 0, loIdx = 0;
      slice.forEach((h, i) => {
        if (h.temperature > slice[hiIdx].temperature) hiIdx = i;
        if (h.temperature < slice[loIdx].temperature) loIdx = i;
      });

      const hiX = xAt(start + hiIdx);
      const hiY = scaleY(slice[hiIdx].temperature, minT, maxT, plotTop, plotBot);
      draw.setFont(Font.boldSystemFont(10));
      draw.setTextColor(new Color(COLORS.skyText));
      draw.drawTextInRect(`${Math.round(slice[hiIdx].temperature)}°`, new Rect(hiX - 16, hiY - 15, 32, 11));

      const loX = xAt(start + loIdx);
      const loY = scaleY(slice[loIdx].temperature, minT, maxT, plotTop, plotBot);
      draw.setFont(Font.mediumSystemFont(9));
      draw.setTextColor(new Color(COLORS.skyMuted));
      draw.drawTextInRect(`${Math.round(slice[loIdx].temperature)}°`, new Rect(loX - 16, loY + 4, 32, 11));
    }

    // Hour-of-day labels every 6 hours, with a day-name chip standing in
    // for "0" at each midnight — mirrors the reference's "18 FRI 6 12 18
    // SAT" axis exactly.
    draw.setFont(Font.mediumSystemFont(9));
    for (let i = 0; i < n; i++) {
      const dt = new Date(hourly[i].validTimeUtc * 1000);
      const localHour = +dt.toLocaleString("en-NZ", { hour: "numeric", hour12: false, timeZone: "Pacific/Auckland" });
      if (localHour % 6 !== 0) continue;
      const x = xAt(i);
      if (localHour === 0) {
        const label = dt.toLocaleString("en-NZ", { weekday: "short", timeZone: "Pacific/Auckland" }).toUpperCase();
        const chipW = 30;
        const chip = new Path();
        chip.addRoundedRect(new Rect(x - chipW / 2, axisY - 1, chipW, axisH - 2), 4, 4);
        draw.setFillColor(new Color("#ffffff", 0.16));
        draw.addPath(chip);
        draw.fillPath();
        draw.setTextColor(new Color(COLORS.skyText));
        draw.drawTextInRect(label, new Rect(x - chipW / 2, axisY, chipW, axisH));
      } else {
        draw.setTextColor(new Color(COLORS.skyMuted));
        draw.drawTextInRect(String(localHour), new Rect(x - 15, axisY, 30, axisH));
      }
    }
  }

  return draw.getImage();
}

// Builds a closed ribbon between two same-length point arrays (their upper
// and lower edges), each edge smoothed the same way smoothPath() softens a
// single line — used by drawCloudWave to turn a top/bottom point pair into
// one fillable band.
function ribbonPath(topPts, botPts) {
  const path = new Path();
  path.move(topPts[0]);
  for (let i = 1; i < topPts.length - 1; i++) {
    const mid = new Point((topPts[i].x + topPts[i + 1].x) / 2, (topPts[i].y + topPts[i + 1].y) / 2);
    path.addQuadCurve(mid, topPts[i]);
  }
  path.addLine(topPts[topPts.length - 1]);
  path.addLine(botPts[botPts.length - 1]);
  for (let i = botPts.length - 2; i > 0; i--) {
    const mid = new Point((botPts[i].x + botPts[i - 1].x) / 2, (botPts[i].y + botPts[i - 1].y) / 2);
    path.addQuadCurve(mid, botPts[i]);
  }
  path.addLine(botPts[0]);
  path.closeSubpath();
  return path;
}

// Shades contiguous night hours (hourly[i].dayOrNight === "N") as one
// translucent dark band per run, from `top` to `bottom` across the full
// vertical extent both panels share. Merges consecutive night hours into a
// single rect rather than one per hour so there's no visible seam between
// adjacent night columns, and extends the trailing run all the way to
// `width` if the panel's data ends mid-night (nothing to close it against).
function drawDayNightBands(draw, hourly, xAt, top, bottom, width) {
  const n = hourly.length;
  draw.setFillColor(new Color("#050a16", 0.24));
  let i = 0;
  while (i < n) {
    if (hourly[i].dayOrNight !== "N") { i++; continue; }
    let j = i;
    while (j < n && hourly[j].dayOrNight === "N") j++;
    const x0 = xAt(i);
    const x1 = j < n ? xAt(j) : width;
    const band = new Path();
    band.addRect(new Rect(x0, top, Math.max(1, x1 - x0), bottom - top));
    draw.addPath(band);
    draw.fillPath();
    i = j;
  }
}

// White "cloud cover" band — its thickness at each hour tracks that hour's
// actual cloudCover%, not an arbitrary repeating wave. The earlier version
// used a fixed-period sine, so it "breathed" on its own rhythm regardless
// of the data — clear hours and overcast hours looked the same, just
// phase-shifted, which read as a meaningless squiggle rather than cloud.
// This instead pinches to a thin sliver when clear and puffs out toward
// rowH when overcast, smoothed across neighbors (movingAverage) so hour-
// to-hour cloud noise doesn't make the edge jitter.
function drawCloudWave(draw, hourly, xAt, top, rowH) {
  const n = hourly.length;
  const mid = top + rowH / 2;
  const maxAmp = rowH * 0.46;
  const minAmp = rowH * 0.08; // never fully collapses to a line, so it still reads as a band on clear stretches
  const smoothedCloud = movingAverage(hourly.map((h) => h.cloudCover || 0), 3);

  const topPts = [], botPts = [];
  for (let i = 0; i < n; i++) {
    const amp = minAmp + (smoothedCloud[i] / 100) * (maxAmp - minAmp);
    topPts.push(new Point(xAt(i), mid - amp));
    botPts.push(new Point(xAt(i), mid + amp));
  }

  draw.setFillColor(new Color("#ffffff", 0.22));
  draw.addPath(ribbonPath(topPts, botPts));
  draw.fillPath();

  draw.setStrokeColor(new Color("#ffffff", 0.75));
  draw.setLineWidth(1.3);
  draw.addPath(smoothPath(topPts));
  draw.strokePath();
  draw.addPath(smoothPath(botPts));
  draw.strokePath();
}

// One small dot per ~hour wherever precip chance clears a threshold —
// approximates the reference's raindrop row. Drawn as filled ellipses
// rather than an actual teardrop path: at this size (4px) the distinction
// isn't visible, and it keeps this function trivial.
function drawRaindrops(draw, hourly, xAt, y) {
  const n = hourly.length;
  draw.setFillColor(new Color(COLORS.precip, 0.85));
  for (let i = 0; i < n; i++) {
    if ((hourly[i].precipChance || 0) < 35) continue;
    const x = xAt(i);
    const p = new Path();
    p.addEllipse(new Rect(x - 1.8, y - 2, 3.6, 4.5));
    draw.addPath(p);
    draw.fillPath();
  }
}

// Classifies an hour's rainfall rate (mm/h) into the label + bar color used
// by both the "Moderate rain at 17:00" status line and the intensity bar
// below it. Thresholds are Open-Meteo's own rain-rate bands, not something
// tuned by eye.
function precipIntensityLabel(qpf) {
  if (qpf == null || qpf <= 0) return { label: null, color: null };
  if (qpf >= 4) return { label: "Heavy rain", color: COLORS.precipHeavy };
  if (qpf >= 1) return { label: "Moderate rain", color: COLORS.precipModerate };
  return { label: "Light rain", color: COLORS.precipLight };
}

function fmtHourMin(unixSec) {
  return new Date(unixSec * 1000).toLocaleString("en-NZ", {
    hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Pacific/Auckland",
  });
}

// Rounded intensity rail — a compressed version of the reference's "17 18
// 19" gradient bar. `startIdx` is the hourly index the rail should OPEN
// on: the caller passes the actual rain event's index (not always 0) so
// the window this draws always contains the event the status line next to
// it names. Slicing from a fixed hourly.slice(0, 9) — the first version —
// meant the bar showed "now through +9h" regardless of when the rain
// actually started; if the event was further out than that, the rail
// could end up showing a run of empty hours with the event past its right
// edge, or past its full window entirely, both of which contradict the
// "Moderate rain at HH:00" text right next to it.
function renderPrecipBar(hourly, startIdx, width, height) {
  const draw = new DrawContext();
  draw.size = new Size(width, height);
  draw.opaque = false;
  draw.respectScreenScale = true;

  const hours = hourly.slice(startIdx, startIdx + 9);
  const n = hours.length;
  if (!n) return draw.getImage();

  const trackTop = height * 0.08;
  const trackH = height * 0.84;
  const track = new Path();
  track.addRoundedRect(new Rect(0, trackTop, width, trackH), trackH / 2, trackH / 2);
  draw.setFillColor(new Color("#ffffff", 0.14));
  draw.addPath(track);
  draw.fillPath();

  const segW = width / n;
  const gap = 1.5;
  hours.forEach((h, i) => {
    const { color } = precipIntensityLabel(h.qpf);
    if (!color) return;
    const seg = new Path();
    seg.addRoundedRect(new Rect(i * segW + gap / 2, trackTop, segW - gap, trackH), 3, 3);
    draw.setFillColor(new Color(color, 0.95));
    draw.addPath(seg);
    draw.fillPath();
  });

  // Rect height is the label's own line height (not trackH) and its y is
  // computed to sit centered in the track — drawTextInRect anchors to the
  // rect's top, not its own vertical center, so a rect as tall as the
  // whole track would push the text toward the top of it, not the middle.
  draw.setFont(Font.semiboldSystemFont(7));
  draw.setTextColor(new Color(COLORS.skyText));
  draw.setTextAlignedCenter();
  const labelH = 9;
  const labelY = trackTop + trackH / 2 - labelH / 2;
  for (let i = 0; i < n; i += 3) {
    const hourLabel = new Date(hours[i].validTimeUtc * 1000)
      .toLocaleString("en-NZ", { hour: "numeric", hour12: false, timeZone: "Pacific/Auckland" });
    draw.drawTextInRect(hourLabel, new Rect(i * segW, labelY, segW, labelH));
  }

  return draw.getImage();
}

function buildSmallWidget(data) {
  const widget = new ListWidget();
  addBackground(widget);
  widget.setPadding(14, 14, 14, 14);

  const c = data.current;
  const { symbol, color } = iconForCondition(c.iconCode);

  const header = widget.addStack();
  header.centerAlignContent();
  const loc = header.addText(LOCATION_LABEL.toUpperCase());
  loc.font = Font.mediumSystemFont(10);
  loc.textColor = mutedColor();
  header.addSpacer();
  const sfi = SFSymbol.named(symbol);
  sfi.applyFont(Font.systemFont(18));
  const iconEl = header.addImage(sfi.image);
  iconEl.imageSize = new Size(20, 20);
  iconEl.tintColor = new Color(color);

  widget.addSpacer(6);

  const tempRow = widget.addStack();
  tempRow.centerAlignContent();
  const tempText = tempRow.addText(fmtTemp(c.temp));
  tempText.font = Font.boldSystemFont(34);
  tempText.textColor = textColor();

  widget.addSpacer(2);

  const cond = widget.addText(c.condition || "—");
  cond.font = Font.systemFont(12);
  cond.textColor = mutedColor();
  cond.lineLimit = 1;

  widget.addSpacer();

  const footer = widget.addStack();
  footer.centerAlignContent();
  const feels = footer.addText(`Feels ${fmtTemp(c.feelsLike)}`);
  feels.font = Font.systemFont(10);
  feels.textColor = mutedColor();
  footer.addSpacer();
  const hiLo = footer.addText(`${fmtTemp(c.tempMax24h)} / ${fmtTemp(c.tempMin24h)}`);
  hiLo.font = Font.systemFont(10);
  hiLo.textColor = mutedColor();

  return widget;
}

function buildMediumWidget(data) {
  const widget = new ListWidget();
  addBackground(widget);
  widget.setPadding(14, 16, 14, 16);

  const c = data.current;
  const { symbol, color } = iconForCondition(c.iconCode);

  const row = widget.addStack();
  row.centerAlignContent();

  // Left: current conditions
  const left = row.addStack();
  left.layoutVertically();

  const loc = left.addText(LOCATION_LABEL.toUpperCase());
  loc.font = Font.mediumSystemFont(10);
  loc.textColor = mutedColor();

  const tempRow = left.addStack();
  tempRow.centerAlignContent();
  const sfi = SFSymbol.named(symbol);
  sfi.applyFont(Font.systemFont(26));
  const iconEl = tempRow.addImage(sfi.image);
  iconEl.imageSize = new Size(28, 28);
  iconEl.tintColor = new Color(color);
  tempRow.addSpacer(6);
  const tempText = tempRow.addText(fmtTemp(c.temp));
  tempText.font = Font.boldSystemFont(30);
  tempText.textColor = textColor();

  const cond = left.addText(c.condition || "—");
  cond.font = Font.systemFont(11);
  cond.textColor = mutedColor();

  row.addSpacer();

  // Right: stats column (wind / humidity / hi-lo), mirrors the web
  // dashboard's conditions card fields.
  const right = row.addStack();
  right.layoutVertically();
  right.spacing = 3;

  const statLine = (label, value) => {
    const s = right.addStack();
    s.centerAlignContent();
    const l = s.addText(label);
    l.font = Font.systemFont(10);
    l.textColor = mutedColor();
    s.addSpacer(6);
    const v = s.addText(value);
    v.font = Font.mediumSystemFont(10);
    v.textColor = textColor();
  };

  statLine("Feels", fmtTemp(c.feelsLike));
  statLine("Hi/Lo", `${fmtTemp(c.tempMax24h)} / ${fmtTemp(c.tempMin24h)}`);
  statLine("Wind", `${Math.round(c.windSpeed)} km/h ${c.windCardinal || ""}`);
  statLine("Humidity", `${Math.round(c.humidity)}%`);

  widget.addSpacer();

  const footer = widget.addText(`Updated ${fmtUpdatedAgo(data.meta.updated)}`);
  footer.font = Font.systemFont(9);
  footer.textColor = mutedColor();

  return widget;
}

// Width the two chart images are drawn at. iOS large widgets vary by
// device (roughly 329–364pt frame width; this widget pads only 8pt each
// side — see buildLargeWidget's setPadding, kept tight so the charts run
// close to the widget's edge like the reference does), and Scriptable
// gives no API to ask a widget its actual rendered size before drawing
// into it. So this targets the smallest common frame (329pt, matching
// preview.html's "large" frame) rather than the largest — undersizing
// wastes a little edge margin on bigger phones; oversizing would clip the
// chart's right edge on smaller ones, which is worse.
const LARGE_CONTENT_WIDTH = 313;

function buildLargeWidget(data) {
  const widget = new ListWidget();

  // The reference screenshot sits on a fixed blue "sky" card regardless of
  // the phone's home-screen theme (see COLORS.sky* comment) — a gradient,
  // not a flat fill, and crucially NOT drawn into the chart images below:
  // widget.backgroundGradient paints behind the whole widget, so every
  // transparent pixel in those images shows this gradient through it.
  const gradient = new LinearGradient();
  gradient.locations = [0, 0.55, 1];
  gradient.colors = [new Color(COLORS.skyTop), new Color(COLORS.skyMid), new Color(COLORS.skyBot)];
  widget.backgroundGradient = gradient;
  widget.setPadding(14, 8, 8, 8);

  const c = data.current;
  const rawHourly = data.hourly || [];
  const daily = data.daily || [];
  const { symbol, color } = iconForCondition(c.iconCode);

  // Open-Meteo's hourly array starts at today's local midnight, not the
  // current hour — so both chart panels and the rain-event search below
  // need to open on "now" themselves, or they'd show however much of
  // today has already elapsed as if it were still ahead. nowIdx is the
  // first hour at/after now (a 30-min tolerance covers the just-turned
  // hour, since validTimeUtc lands on the hour); everything downstream
  // uses `hourly` (this trimmed view), not `rawHourly`.
  const nowSec = Date.now() / 1000;
  let nowIdx = rawHourly.findIndex((h) => h.validTimeUtc >= nowSec - 1800);
  if (nowIdx === -1) nowIdx = 0;
  const hourly = rawHourly.slice(nowIdx);

  // ── Header: temp + icon + feels-like (small, left), stat grid (right) ──
  // The temp block used to run the header's full width with the precip
  // headline sentence right-aligned opposite it — shrunk down here to make
  // room for a Wind/UV/Humidity/Pressure stat grid (same label/value
  // pattern the medium widget's statLine() already uses), since those are
  // concrete numbers every refresh has, where the headline sentence was
  // still a stub (see the now-removed describePrecipTrend — dropped along
  // with its call site rather than left orphaned; the "Moderate rain at…"
  // status row below still carries the near-term precip story).
  const header = widget.addStack();
  header.centerAlignContent();

  const tempCol = header.addStack();
  tempCol.layoutVertically();
  const tempRow = tempCol.addStack();
  tempRow.centerAlignContent();
  const tempText = tempRow.addText(fmtTemp(c.temp));
  tempText.font = Font.boldSystemFont(28);
  tempText.textColor = new Color(COLORS.skyText);
  tempRow.addSpacer(6);
  const sfi = SFSymbol.named(symbol);
  sfi.applyFont(Font.systemFont(20));
  const iconEl = tempRow.addImage(sfi.image);
  iconEl.imageSize = new Size(24, 24);
  iconEl.tintColor = new Color(color);
  const feelsText = tempCol.addText(`FEELS LIKE ${fmtTemp(c.feelsLike)}`);
  feelsText.font = Font.semiboldSystemFont(10);
  feelsText.textColor = new Color(COLORS.skyMuted);

  header.addSpacer();

  // Two columns — Wind/UV on the left, Humidity/Pressure on the right —
  // rather than one 4-row column, so Wind/UV visually sit to the left of
  // Humidity/Pressure as asked, instead of just earlier in a single list.
  const statGrid = header.addStack();
  statGrid.spacing = 14;
  const statColumn = (rows) => {
    const col = statGrid.addStack();
    col.layoutVertically();
    col.spacing = 3;
    rows.forEach(([label, value]) => {
      const row = col.addStack();
      row.centerAlignContent();
      const l = row.addText(label);
      l.font = Font.semiboldSystemFont(9);
      l.textColor = new Color(COLORS.skyMuted);
      row.addSpacer(8);
      const v = row.addText(value);
      v.font = Font.semiboldSystemFont(11);
      v.textColor = new Color(COLORS.skyText);
    });
  };
  statColumn([
    ["WIND", c.windSpeed != null ? `${Math.round(c.windSpeed)} km/h` : "—"],
    ["UV", c.uvIndex != null ? `${Math.round(c.uvIndex)}` : "—"],
  ]);
  statColumn([
    ["HUMIDITY", c.humidity != null ? `${Math.round(c.humidity)}%` : "—"],
    ["PRESSURE", c.pressure != null ? `${Math.round(c.pressure)} hPa` : "—"],
  ]);

  widget.addSpacer(6);

  // ── Precip status line + near-term intensity rail ──────────────────────
  // Only fires for rain forecast TODAY (local Pacific/Auckland calendar
  // day) — hourly spans up to 5 days, and a rain hour 3 days out doesn't
  // belong on a status line that reads like a right-now warning ("Moderate
  // rain at 17:00"). Comparing the hour's own local date to today's,
  // rather than just capping the search to the first N hours, means this
  // still correctly finds nothing once today rolls into a dry tomorrow,
  // even right before midnight.
  const todayKey = new Date().toLocaleDateString("en-NZ", { timeZone: "Pacific/Auckland" });
  const rainIdx = hourly.findIndex((h) => {
    if ((h.qpf || 0) <= 0.1) return false;
    const hourKey = new Date(h.validTimeUtc * 1000).toLocaleDateString("en-NZ", { timeZone: "Pacific/Auckland" });
    return hourKey === todayKey;
  });
  if (rainIdx !== -1) {
    const nextRainHour = hourly[rainIdx];
    const statusRow = widget.addStack();
    statusRow.centerAlignContent();
    const { label } = precipIntensityLabel(nextRainHour.qpf);
    const statusText = statusRow.addText(`${label} at ${fmtHourMin(nextRainHour.validTimeUtc)}`);
    statusText.font = Font.semiboldSystemFont(10);
    statusText.textColor = new Color(COLORS.skyCyan);
    statusText.lineLimit = 1;
    statusRow.addSpacer();

    // Rail opens on rainIdx — the same hour the status text names — so the
    // window always contains the event instead of always showing "now
    // through +9h" regardless of where the rain actually falls.
    const barW = 130, barH = 15;
    const barImg = renderPrecipBar(hourly, rainIdx, barW, barH);
    const barEl = statusRow.addImage(barImg);
    barEl.imageSize = new Size(barW, barH);

    widget.addSpacer(6);
  }

  // ── Hourly panel: next ~36h, hour-of-day axis ───────────────────────────
  // 36h (not a full day) matches the reference's proportions — enough to
  // carry "this evening through tomorrow" without the curve compressing so
  // much per-hour detail disappears.
  //
  // Panel heights are still conservative, just less so than before: iOS's
  // SMALLEST large-widget frame (iPhone SE, 329×345pt) has to fit header +
  // status row + both panels + all the spacers between them with room to
  // spare, because ListWidget clips silently rather than shrinking or
  // scrolling — any overflow just gets cut from the bottom with no error.
  // Shrinking the header down to a 2-row stat grid and the precip rail
  // down to 15pt (see their own comments) freed up real slack in that
  // budget, which goes here: the hourly panel gets 2x the daily panel's
  // share of it (22pt vs 11pt over the old shared 100pt), since it carries
  // more per-hour value labels and reads better with more vertical room,
  // while the status row above keeps its own height untouched either way.
  const hourlyPanel = hourly.slice(0, 36);
  const HOURLY_PANEL_HEIGHT = 122;
  const DAILY_PANEL_HEIGHT = 111;

  // Each panel sits in its own horizontal stack with a flexible spacer on
  // both sides, rather than being addImage()'d straight onto the widget's
  // own vertical stack. LARGE_CONTENT_WIDTH targets the SMALLEST large-
  // widget frame (see its own comment) so the image is narrower than the
  // available width on bigger phones — without the spacers, ListWidget
  // left-aligns that leftover space instead of splitting it evenly, which
  // is what made the charts look left-adjusted on an actual device rather
  // than centered/full-bleed like the reference.
  const centeredImage = (img, size) => {
    const row = widget.addStack();
    row.addSpacer();
    const imgEl = row.addImage(img);
    imgEl.imageSize = size;
    row.addSpacer();
  };

  if (hourlyPanel.length >= 12) {
    const img = renderChartPanel(hourlyPanel, { width: LARGE_CONTENT_WIDTH, height: HOURLY_PANEL_HEIGHT, mode: "hourly" });
    centeredImage(img, new Size(LARGE_CONTENT_WIDTH, HOURLY_PANEL_HEIGHT));
    widget.addSpacer(5);
  }

  // ── Multi-day panel: everything the worker returns (5 days), day axis ──
  // The reference shows 7 days; Open-Meteo's free tier this worker calls
  // only returns 5 (see workers/pws-proxy.js buildOMUrl forecast_days=5),
  // so this panel is 5 days wide rather than 7 — a data-availability limit,
  // not a design choice.
  if (hourly.length >= 24 && daily.length) {
    const img = renderChartPanel(hourly, { width: LARGE_CONTENT_WIDTH, height: DAILY_PANEL_HEIGHT, mode: "daily", daily });
    centeredImage(img, new Size(LARGE_CONTENT_WIDTH, DAILY_PANEL_HEIGHT));
  }

  return widget;
}

async function run() {
  let widget;
  try {
    const data = await fetchWeather();
    widget =
      config.widgetFamily === "large"
        ? buildLargeWidget(data)
        : config.widgetFamily === "medium"
        ? buildMediumWidget(data)
        : buildSmallWidget(data);
  } catch (err) {
    // Offline / worker down: render a minimal error widget rather than
    // crashing silently to a blank homescreen tile.
    widget = new ListWidget();
    addBackground(widget);
    widget.setPadding(14, 14, 14, 14);
    const t = widget.addText("WeatherTempo");
    t.font = Font.boldSystemFont(14);
    t.textColor = textColor();
    widget.addSpacer(4);
    const e = widget.addText(`Couldn't load: ${err.message || err}`);
    e.font = Font.systemFont(11);
    e.textColor = mutedColor();
  }

  widget.refreshAfterDate = new Date(Date.now() + REFRESH_MINUTES * 60 * 1000);

  if (config.runsInWidget) {
    Script.setWidget(widget);
  } else {
    // Running the script manually inside Scriptable — show a preview.
    if (config.widgetFamily === "large") {
      await widget.presentLarge();
    } else if (config.widgetFamily === "medium") {
      await widget.presentMedium();
    } else {
      await widget.presentSmall();
    }
  }
  Script.complete();
}

await run();