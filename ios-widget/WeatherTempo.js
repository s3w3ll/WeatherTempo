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

// Wind direction-arrow glyph. windDirection is degrees clockwise from
// north (meteorological convention); DrawContext has no path-rotate
// transform, so each vertex is rotated by hand around the arrow's center
// using the same (dir - 90) → radians conversion documented in src/chart.js
// → drawWindIndicators(), so it points the same way the web chart does.
function drawWindArrow(draw, cx, cy, dirDeg, size) {
  const angle = ((dirDeg - 90) * Math.PI) / 180;
  const tail = rotatePoint(cx - size, cy, cx, cy, angle);
  const head = rotatePoint(cx + size, cy, cx, cy, angle);
  const wing1 = rotatePoint(cx + size * 0.35, cy - size * 0.55, cx, cy, angle);
  const wing2 = rotatePoint(cx + size * 0.35, cy + size * 0.55, cx, cy, angle);

  draw.setStrokeColor(new Color(COLORS.wind));
  draw.setLineWidth(1.4);

  const shaft = new Path();
  shaft.move(tail);
  shaft.addLine(head);
  draw.addPath(shaft);
  draw.strokePath();

  const arrowhead = new Path();
  arrowhead.move(wing1);
  arrowhead.addLine(head);
  arrowhead.addLine(wing2);
  draw.addPath(arrowhead);
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

  // Row layout, top to bottom: cloud wave, raindrops, temp/wind zone,
  // precip+UV bars, axis labels.
  const cloudTop = 2, cloudBot = 20;
  const dropY = cloudBot + 8;
  const tempTop = dropY + 10;
  const axisH = 14;
  const precipH = Math.max(20, height * 0.16);
  const tempBot = height - precipH - axisH - 4;
  const precipTop = tempBot + 4;
  const precipBot = height - axisH;
  const axisY = height - axisH + 2;

  const temps = hourly.map((h) => h.temperature);
  const feels = hourly.map((h) => h.temperatureFeelsLike ?? h.temperature);
  const minT = Math.min(...temps, ...feels) - 2;
  const maxT = Math.max(...temps, ...feels) + 4; // headroom for hi° labels above the peak

  drawCloudWave(draw, hourly, xAt, cloudTop, cloudBot - cloudTop);
  drawRaindrops(draw, hourly, xAt, dropY);

  // Wind shares the temp zone's own pixel range rather than a separate
  // strip — see the original design note this carries forward: a fixed
  // 0–90 km/h scale barely moves for Christchurch's usual 10–25 km/h, so
  // it gets its own auto-scaled min/max sharing the tall zone instead.
  const smoothedWind = movingAverage(hourly.map((h) => h.windSpeed || 0), WIND_SMOOTH_WINDOW);
  const minW = Math.max(0, Math.min(...smoothedWind) - 2);
  const maxW = Math.max(...smoothedWind) + 2;

  // Day-boundary separators
  const days = mode === "daily" ? Math.min(daily.length, Math.round(n / hoursPerDay)) : Math.ceil(n / hoursPerDay);
  draw.setStrokeColor(new Color("#ffffff", 0.14));
  draw.setLineWidth(1);
  for (let d = 1; d < Math.ceil(n / hoursPerDay); d++) {
    const idx = d * hoursPerDay;
    if (idx >= n) break;
    const x = xAt(idx);
    const sep = new Path();
    sep.move(new Point(x, tempTop));
    sep.addLine(new Point(x, precipBot));
    draw.addPath(sep);
    draw.strokePath();
  }

  // Feels-like — dotted cyan line, drawn first so the solid temp curve and
  // its fill sit above it, matching the reference's layering.
  const feelsPts = feels.map((v, i) => new Point(xAt(i), scaleY(v, minT, maxT, tempTop, tempBot)));
  strokeDashedPolyline(draw, feelsPts, 1.6, 3.4, new Color(COLORS.skyCyan, 0.9), 1.6);

  // Temperature area fill + curve — translucent over the sky gradient
  // rather than a solid navy backdrop (see function comment).
  const tempPts = hourly.map((h, i) => new Point(xAt(i), scaleY(h.temperature, minT, maxT, tempTop, tempBot)));
  const fillPath = smoothPath(tempPts);
  fillPath.addLine(new Point(width, tempBot));
  fillPath.addLine(new Point(0, tempBot));
  fillPath.closeSubpath();
  draw.setFillColor(new Color(COLORS.tempLine, 0.35));
  draw.addPath(fillPath);
  draw.fillPath();

  draw.setStrokeColor(new Color(COLORS.tempLine));
  draw.setLineWidth(2.2);
  draw.addPath(smoothPath(tempPts));
  draw.strokePath();

  // Wind — dashed red line, own auto-scaled axis sharing the temp zone's
  // pixel range (see minW/maxW above), plus one direction arrow per day at
  // a representative early-afternoon hour (every hour would be too dense).
  const windPts = smoothedWind.map((v, i) => new Point(xAt(i), scaleY(v, minW, maxW, tempTop, tempBot)));
  strokeDashedPolyline(draw, windPts, 4, 3, new Color(COLORS.wind, 0.9), 1.6);
  for (let d = 0; d * hoursPerDay < n; d++) {
    const idx = Math.min(d * hoursPerDay + 13, n - 1);
    const h = hourly[idx];
    const cx = xAt(idx);
    const cy = scaleY(smoothedWind[idx], minW, maxW, tempTop, tempBot);
    drawWindArrow(draw, cx, cy, h.windDirection || 0, 5);
  }

  // Precipitation bars (blue) + UV bars (green), side by side per hour —
  // the old renderer dropped UV to a per-day badge below the chart; the
  // reference draws it right in the strip, so it does here too.
  const barW = Math.max(1, (width / n) * 0.6);
  hourly.forEach((h, i) => {
    const pct = (h.precipChance || 0) / 100;
    const barH = pct * (precipBot - precipTop);
    if (barH >= 1) {
      const barPath = new Path();
      barPath.addRect(new Rect(xAt(i) - barW / 2, precipBot - barH, barW, barH));
      draw.setFillColor(new Color(COLORS.precip, 0.75));
      draw.addPath(barPath);
      draw.fillPath();
    }
    const uvH = Math.min(1, (h.uvIndex || 0) / 11) * (precipBot - precipTop) * 0.7; // UV 11 = WHO "extreme", so scale 0–11 not 0–100
    if (uvH >= 1) {
      const uvPath = new Path();
      uvPath.addRect(new Rect(xAt(i) - barW / 4, precipBot - uvH, barW / 2, uvH));
      draw.setFillColor(new Color(COLORS.uv, 0.85));
      draw.addPath(uvPath);
      draw.fillPath();
    }
  });

  if (mode === "daily") {
    // Per-day hi/lo plotted directly on the curve's peak/trough, and a day
    // name centered under each day — uses daily[]'s max/min as the source
    // of truth for the label text, the hourly slice only to find where to
    // place it.
    draw.setTextAlignedCenter();
    for (let d = 0; d < days; d++) {
      const start = d * hoursPerDay;
      const slice = hourly.slice(start, start + hoursPerDay);
      if (!slice.length || !daily[d]) continue;
      let hiIdx = 0, loIdx = 0;
      slice.forEach((h, i) => {
        if (h.temperature > slice[hiIdx].temperature) hiIdx = i;
        if (h.temperature < slice[loIdx].temperature) loIdx = i;
      });

      const hiX = xAt(start + hiIdx);
      const hiY = scaleY(slice[hiIdx].temperature, minT, maxT, tempTop, tempBot);
      draw.setFont(Font.boldSystemFont(9));
      draw.setTextColor(new Color(COLORS.skyText));
      draw.drawTextInRect(`${Math.round(daily[d].temperatureMax)}°`, new Rect(hiX - 16, hiY - 15, 32, 11));

      const loX = xAt(start + loIdx);
      const loY = scaleY(slice[loIdx].temperature, minT, maxT, tempTop, tempBot);
      draw.setFont(Font.systemFont(8));
      draw.setTextColor(new Color(COLORS.skyMuted));
      draw.drawTextInRect(`${Math.round(daily[d].temperatureMin)}°`, new Rect(loX - 16, loY + 4, 32, 11));

      const mid = xAt(Math.min(start + 12, n - 1));
      const dayLabel = new Date(hourly[Math.min(start, n - 1)].validTimeUtc * 1000)
        .toLocaleString("en-NZ", { weekday: "short", timeZone: "Pacific/Auckland" })
        .toUpperCase();
      draw.setFont(Font.mediumSystemFont(9));
      draw.setTextColor(new Color(COLORS.skyMuted));
      draw.drawTextInRect(dayLabel, new Rect(mid - 20, axisY, 40, axisH));
    }
  } else {
    // Hour-of-day labels every 6 hours, with a day-name chip standing in
    // for "0" at each midnight — mirrors the reference's "18 FRI 6 12 18
    // SAT" axis exactly.
    draw.setFont(Font.mediumSystemFont(9));
    draw.setTextAlignedCenter();
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

// White "cloud cover" wave — two crossing sine-ish strokes whose amplitude
// tracks hourly cloudCover%, standing in for the reference's cloud-texture
// band. A literal cloud-puff texture isn't practical in DrawContext's path
// API, so this leans on the same crossing-lines motif the reference uses
// rather than trying to render actual clouds.
function drawCloudWave(draw, hourly, xAt, top, rowH) {
  const n = hourly.length;
  const mid = top + rowH / 2;
  const amp = rowH * 0.4;
  const line1 = [], line2 = [];
  for (let i = 0; i < n; i++) {
    const cloud = (hourly[i].cloudCover || 0) / 100;
    const a = amp * (0.2 + cloud * 0.8);
    const phase = (i / 5) * Math.PI;
    line1.push(new Point(xAt(i), mid - Math.sin(phase) * a));
    line2.push(new Point(xAt(i), mid + Math.sin(phase + 0.7) * a));
  }
  draw.setStrokeColor(new Color("#ffffff", 0.8));
  draw.setLineWidth(1.5);
  draw.addPath(smoothPath(line1));
  draw.strokePath();
  draw.addPath(smoothPath(line2));
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

// Rounded intensity rail for the next few hours (renderPrecipStatusRow) —
// a compressed version of the reference's "17 18 19" gradient bar. Segment
// fills are plain rects rather than clipped to the track's rounded corners
// (DrawContext has no clip-path call), so the very first/last segment can
// show square corners under the rounded track outline at small sizes —
// acceptable at this scale, not worth a manual corner mask.
function renderPrecipBar(hourly, width, height) {
  const draw = new DrawContext();
  draw.size = new Size(width, height);
  draw.opaque = false;
  draw.respectScreenScale = true;

  const hours = hourly.slice(0, 9);
  const n = hours.length;
  if (!n) return draw.getImage();

  const trackTop = height * 0.3;
  const trackH = height * 0.4;
  const track = new Path();
  track.addRoundedRect(new Rect(0, trackTop, width, trackH), trackH / 2, trackH / 2);
  draw.setFillColor(new Color("#ffffff", 0.14));
  draw.addPath(track);
  draw.fillPath();

  const segW = width / n;
  hours.forEach((h, i) => {
    const { color } = precipIntensityLabel(h.qpf);
    if (!color) return;
    const seg = new Path();
    seg.addRect(new Rect(i * segW, trackTop, segW + 0.5, trackH));
    draw.setFillColor(new Color(color, 0.95));
    draw.addPath(seg);
    draw.fillPath();
  });

  draw.setFont(Font.mediumSystemFont(10));
  draw.setTextColor(new Color(COLORS.skyText));
  draw.setTextAlignedCenter();
  for (let i = 0; i < n; i += 3) {
    const hourLabel = new Date(hours[i].validTimeUtc * 1000)
      .toLocaleString("en-NZ", { hour: "numeric", hour12: false, timeZone: "Pacific/Auckland" });
    draw.drawTextInRect(hourLabel, new Rect(i * segW, 0, segW, trackTop));
  }

  return draw.getImage();
}

// ─────────────────────────────────────────────────────────────────────────
// The one genuinely subjective piece of this whole recreation: turning the
// next several hours of qpf/precipChance into a headline sentence like the
// reference's "0.9 mm/h light rain for 3 hours, then moderate rain". There
// isn't a single correct phrasing — how many hours ahead to look, when a
// trend is worth calling out vs. just noise, whether to lead with the rate
// or the duration — so this is deliberately left for you to write rather
// than guessed at. `hourly` is the same array renderChartPanel gets (each
// hour has .qpf mm/h, .precipChance %, .validTimeUtc unix seconds);
// `current` is data.current (temp, feelsLike, condition, …).
//
// Until you fill this in, buildLargeWidget falls back to just showing
// data.current.condition, so the widget still works either way.
// ─────────────────────────────────────────────────────────────────────────
function describePrecipTrend(hourly, current) {
  // TODO(you): build the narrative sentence. `precipIntensityLabel(qpf)`
  // above already classifies an hour's mm/h into light/moderate/heavy — you
  // likely want to walk forward through `hourly`, find how long the
  // current band holds, and note the next band it changes to.
  return current.condition || "";
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
// device (roughly 329–364pt frame width; this widget pads 18pt each side —
// see buildLargeWidget's setPadding), and Scriptable gives no API to ask a
// widget its actual rendered size before drawing into it. So this targets
// the smallest common frame (329pt, matching preview.html's "large" frame
// and the original design's own assumption) rather than the largest —
// undersizing wastes a little edge margin on bigger phones; oversizing
// would clip the chart's right edge on smaller ones, which is worse.
const LARGE_CONTENT_WIDTH = 293;

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
  widget.setPadding(14, 18, 8, 18);

  const c = data.current;
  const hourly = data.hourly || [];
  const daily = data.daily || [];
  const { symbol, color } = iconForCondition(c.iconCode);

  // ── Header: big current temp + feels-like, icon, condition summary ─────
  const header = widget.addStack();
  header.centerAlignContent();

  const tempCol = header.addStack();
  tempCol.layoutVertically();
  const tempText = tempCol.addText(fmtTemp(c.temp));
  tempText.font = Font.boldSystemFont(40);
  tempText.textColor = new Color(COLORS.skyText);
  const feelsText = tempCol.addText(`FEELS LIKE ${fmtTemp(c.feelsLike)}`);
  feelsText.font = Font.semiboldSystemFont(11);
  feelsText.textColor = new Color(COLORS.skyMuted);

  header.addSpacer(10);
  const sfi = SFSymbol.named(symbol);
  sfi.applyFont(Font.systemFont(30));
  const iconEl = header.addImage(sfi.image);
  iconEl.imageSize = new Size(36, 36);
  iconEl.tintColor = new Color(color);

  header.addSpacer();
  const summaryText = header.addText(describePrecipTrend(hourly, c));
  summaryText.font = Font.systemFont(15);
  summaryText.textColor = new Color(COLORS.skyText);
  summaryText.rightAlignText();
  summaryText.lineLimit = 2;
  summaryText.minimumScaleFactor = 0.75;

  widget.addSpacer(8);

  // ── Precip status line + near-term intensity rail ──────────────────────
  const nextRainHour = hourly.find((h) => (h.qpf || 0) > 0.1);
  if (nextRainHour) {
    const statusRow = widget.addStack();
    statusRow.centerAlignContent();
    const { label } = precipIntensityLabel(nextRainHour.qpf);
    const statusText = statusRow.addText(`${label} at ${fmtHourMin(nextRainHour.validTimeUtc)}`);
    statusText.font = Font.semiboldSystemFont(13);
    statusText.textColor = new Color(COLORS.skyCyan);
    statusText.lineLimit = 1;
    statusRow.addSpacer();

    const barW = 130, barH = 22;
    const barImg = renderPrecipBar(hourly, barW, barH);
    const barEl = statusRow.addImage(barImg);
    barEl.imageSize = new Size(barW, barH);

    widget.addSpacer(8);
  }

  // ── Hourly panel: next ~36h, hour-of-day axis ───────────────────────────
  // 36h (not a full day) matches the reference's proportions — enough to
  // carry "this evening through tomorrow" without the curve compressing so
  // much per-hour detail disappears.
  const hourlyPanel = hourly.slice(0, 36);
  const PANEL_HEIGHT = 116;
  if (hourlyPanel.length >= 12) {
    const img = renderChartPanel(hourlyPanel, { width: LARGE_CONTENT_WIDTH, height: PANEL_HEIGHT, mode: "hourly" });
    const imgEl = widget.addImage(img);
    imgEl.imageSize = new Size(LARGE_CONTENT_WIDTH, PANEL_HEIGHT);
    widget.addSpacer(6);
  }

  // ── Multi-day panel: everything the worker returns (5 days), day axis ──
  // The reference shows 7 days; Open-Meteo's free tier this worker calls
  // only returns 5 (see workers/pws-proxy.js buildOMUrl forecast_days=5),
  // so this panel is 5 days wide rather than 7 — a data-availability limit,
  // not a design choice.
  if (hourly.length >= 24 && daily.length) {
    const img = renderChartPanel(hourly, { width: LARGE_CONTENT_WIDTH, height: PANEL_HEIGHT, mode: "daily", daily });
    const imgEl = widget.addImage(img);
    imgEl.imageSize = new Size(LARGE_CONTENT_WIDTH, PANEL_HEIGHT);
  }

  widget.addSpacer();

  const footer = widget.addText(`Updated ${fmtUpdatedAgo(data.meta.updated)}`);
  footer.font = Font.systemFont(8);
  footer.textColor = new Color(COLORS.skyMuted, 0.8);

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