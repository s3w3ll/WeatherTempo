// WeatherTempo — Scriptable iOS Widget
// ---------------------------------------------------------------------------
// Renders live Christchurch conditions from the WeatherTempo Cloudflare
// Worker on a home-screen widget. Small/medium show a current-conditions
// card; large adds a 5-day WeatherGraph-style meteogram (temp curve with
// daily hi/lo, cloud shading, rain bars, plus a per-day Wind/UV badge
// strip) rendered via DrawContext — see renderMeteogramImage() below.
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
const CHART_DAYS = 5; // the worker returns exactly 5 days of hourly + daily data
const CHART_HOURS = CHART_DAYS * 24;
const WIND_SMOOTH_WINDOW = 5; // hours averaged per point on the wind line — wind is noisier hour-to-hour than temp, so it gets an extra smoothing pass the temp curve doesn't need

// Palette lifted from src/chart.js CHART_COLORS so the widget matches the
// web dashboard's look.
const COLORS = {
  bgLight: "#f5f8fc",
  bgDark: "#0e1420",
  chartBg: "#1c2c4a",    // dark navy — the meteogram's own background (see renderMeteogramImage)
  tempLine: "#ea7c1c",   // orange — temperature
  wind: "#e5484d",       // red — wind, matches chart.js's wind-zone line color
  precip: "#2563d8",     // blue — precipitation
  textLight: "#1a2640",
  textDark: "#e8edf5",
  mutedLight: "#56708e",
  mutedDark: "#8fa3bf",
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
// 5-day chart, curated rather than literal: cramming Temp + Wind + Cloud +
// Rain + UV as five independent zones across 120 hourly points would be
// illegible at ~300×180px. So the chart carries what reads at a glance —
// temp curve (with each day's hi/lo plotted right on the curve, like the
// WeatherGraph reference), wind sharing that same zone as a dashed,
// auto-scaled dual-axis overlay (own min/max, same pixel range as temp —
// see the minW/maxW comment below), cloud as background shading, and rain
// bars — and only UV drops off the chart entirely, surfacing instead as a
// per-day badge below (see buildLargeWidget); one peak-UV number per day
// carries as much useful info as a full line would (UV only matters near
// its daily peak) without adding a fourth zone.
// ─────────────────────────────────────────────────────────────────────────
function renderMeteogramImage(hourly, daily, width, height) {
  const draw = new DrawContext();
  draw.size = new Size(width, height);
  draw.opaque = true;
  draw.respectScreenScale = true;

  // Chart background: always a fixed dark navy (COLORS.chartBg — matches
  // the WeatherGraph reference's own dark meteogram), regardless of the
  // phone's system theme. A transparent image let dark mode's near-black
  // widget background show through and crush contrast; a plain white fill
  // fixed that but ran too bright/washed-out against a dark home screen.
  // Every color drawn into this image is chosen for this backdrop — the
  // header/day-strip above and below it still follow the phone's real
  // theme via Color.dynamic, so only the chart itself has a fixed look.
  const bgFill = new Path();
  bgFill.addRect(new Rect(0, 0, width, height));
  draw.setFillColor(new Color(COLORS.chartBg));
  draw.addPath(bgFill);
  draw.fillPath();

  const n = hourly.length;
  const hoursPerDay = 24;
  const days = Math.min(daily.length, Math.round(n / hoursPerDay));
  const xAt = (i) => (i / (n - 1)) * width;

  const temps = hourly.map((h) => h.temperature);
  const minT = Math.min(...temps) - 2;
  const maxT = Math.max(...temps) + 4; // headroom for the hi° labels above the peak

  // Zones: temp (which wind now shares — see below) on top, precip strip
  // below, compressed for widget size. No separate hour/day axis row here
  // — the day-strip drawn below this image (buildLargeWidget) already
  // labels each day, so a second row of day names here would just repeat
  // it for free height the curve/rain rows can use instead.
  const precipH = height * 0.18;
  const tempTop = 18; // headroom for hi° labels
  const tempBot = height - precipH - 6;
  const precipTop = tempBot + 6;
  const precipBot = height;

  // Wind shares the temp zone's own pixel range (tempTop–tempBot) rather
  // than getting a separate strip — a fixed 0–90 km/h scale in a thin row
  // left Christchurch's usual 10–25 km/h barely moving the line. Sharing
  // the tall zone with its own auto-scaled min/max (like temp's) gives it
  // real vertical resolution, and lines up each day's wind visually
  // against that same day's temp — a proper dual-axis overlay, not two
  // independent charts.
  const smoothedWind = movingAverage(hourly.map((h) => h.windSpeed || 0), WIND_SMOOTH_WINDOW);
  const minW = Math.max(0, Math.min(...smoothedWind) - 2);
  const maxW = Math.max(...smoothedWind) + 2;

  // Cloud-cover background shading (subtle, one thin column per hour) —
  // the pale overlay bands in the web chart, simplified to flat opacity
  // rather than a gradient (DrawContext has no path-gradient fill).
  const cloudSegW = width / n + 0.6;
  hourly.forEach((h, i) => {
    const cloudPct = (h.cloudCover || 0) / 100;
    if (cloudPct < 0.05) return;
    const p = new Path();
    p.addRect(new Rect(xAt(i) - cloudSegW / 2, tempTop, cloudSegW, tempBot - tempTop));
    draw.setFillColor(new Color("#ffffff", cloudPct * 0.14));
    draw.addPath(p);
    draw.fillPath();
  });

  // Day-boundary separators
  draw.setStrokeColor(new Color(COLORS.mutedDark, 0.3));
  draw.setLineWidth(1);
  for (let d = 1; d < days; d++) {
    const x = xAt(d * hoursPerDay);
    const sep = new Path();
    sep.move(new Point(x, tempTop));
    sep.addLine(new Point(x, precipBot));
    draw.addPath(sep);
    draw.strokePath();
  }

  // Temperature area fill + curve
  const tempPts = hourly.map((h, i) => new Point(xAt(i), scaleY(h.temperature, minT, maxT, tempTop, tempBot)));
  const fillPath = smoothPath(tempPts);
  fillPath.addLine(new Point(width, tempBot));
  fillPath.addLine(new Point(0, tempBot));
  fillPath.closeSubpath();
  draw.setFillColor(new Color(COLORS.tempLine, 0.2));
  draw.addPath(fillPath);
  draw.fillPath();

  draw.setStrokeColor(new Color(COLORS.tempLine));
  draw.setLineWidth(2.2);
  draw.addPath(smoothPath(tempPts));
  draw.strokePath();

  // Wind — dashed line sharing the temp zone's pixel range but its own
  // auto-scaled (minW–maxW) value axis, so it's a real dual-axis overlay:
  // same vertical space as temp, different meaning per pixel. Dashed
  // (rather than solid, like chart.js's separate wind row) so it doesn't
  // read as a second temperature line where the two curves cross. Plotted
  // from smoothedWind, not raw windSpeed — see movingAverage()'s comment.
  // Drawn before the hi/lo labels so those stay legible on top if a
  // crossing lands near one.
  const windPts = smoothedWind.map((v, i) => new Point(xAt(i), scaleY(v, minW, maxW, tempTop, tempBot)));
  strokeDashedPolyline(draw, windPts, 4, 3, new Color(COLORS.wind, 0.85), 1.6);

  // One direction arrow per day — all 120 points would be far too dense,
  // so arrows land on the same representative hour (early afternoon) the
  // day-strip badges below use. Direction comes from the raw hour (a
  // direction doesn't benefit from averaging the way a speed does), but
  // the arrow's y-position uses the smoothed speed so it sits on the line.
  for (let d = 0; d < days; d++) {
    const idx = Math.min(d * hoursPerDay + 13, n - 1);
    const h = hourly[idx];
    const cx = xAt(idx);
    const cy = scaleY(smoothedWind[idx], minW, maxW, tempTop, tempBot);
    drawWindArrow(draw, cx, cy, h.windDirection || 0, 5);
  }

  // Per-day hi/lo, plotted directly on the curve at that day's peak/trough
  // — uses the worker's daily[] max/min (source of truth) for the label
  // text, but the hourly slice's peak/trough index for where to place it.
  // Drawn last, each behind a small background halo, so the label stays
  // readable wherever the wind line happens to cross near it.
  draw.setTextAlignedCenter();
  for (let d = 0; d < days; d++) {
    const start = d * hoursPerDay;
    const slice = hourly.slice(start, start + hoursPerDay);
    let hiIdx = 0, loIdx = 0;
    slice.forEach((h, i) => {
      if (h.temperature > slice[hiIdx].temperature) hiIdx = i;
      if (h.temperature < slice[loIdx].temperature) loIdx = i;
    });

    const hiX = xAt(start + hiIdx);
    const hiY = scaleY(slice[hiIdx].temperature, minT, maxT, tempTop, tempBot);
    const hiRect = new Rect(hiX - 16, hiY - 15, 32, 11);
    draw.setFont(Font.boldSystemFont(9));
    draw.setTextColor(new Color(COLORS.tempLine));
    draw.drawTextInRect(`${Math.round(daily[d].temperatureMax)}°`, hiRect);

    const loX = xAt(start + loIdx);
    const loY = scaleY(slice[loIdx].temperature, minT, maxT, tempTop, tempBot);
    const loRect = new Rect(loX - 16, loY + 4, 32, 11);
    draw.setFont(Font.systemFont(8));
    draw.setTextColor(new Color(COLORS.mutedDark));
    draw.drawTextInRect(`${Math.round(daily[d].temperatureMin)}°`, loRect);
  }

  // Precipitation-chance bars
  const barW = Math.max(1, (width / n) * 0.6);
  draw.setFillColor(new Color(COLORS.precip, 0.7));
  hourly.forEach((h, i) => {
    const pct = (h.precipChance || 0) / 100;
    const barH = pct * (precipBot - precipTop);
    if (barH < 1) return;
    const barPath = new Path();
    barPath.addRect(new Rect(xAt(i) - barW / 2, precipBot - barH, barW, barH));
    draw.addPath(barPath);
    draw.fillPath();
  });

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

function buildLargeWidget(data) {
  const widget = new ListWidget();
  addBackground(widget);
  // Tighter margins than the other sizes — the WeatherGraph reference runs
  // its chart almost edge-to-edge, and every point of padding here is a
  // point the meteogram below doesn't get.
  widget.setPadding(10, 10, 8, 10);

  const c = data.current;
  const { symbol, color } = iconForCondition(c.iconCode);

  const header = widget.addStack();
  header.centerAlignContent();

  const left = header.addStack();
  left.layoutVertically();
  const tempRow = left.addStack();
  tempRow.centerAlignContent();
  const tempText = tempRow.addText(fmtTemp(c.temp));
  tempText.font = Font.boldSystemFont(30);
  tempText.textColor = textColor();
  tempRow.addSpacer(6);
  const sfi = SFSymbol.named(symbol);
  sfi.applyFont(Font.systemFont(22));
  const iconEl = tempRow.addImage(sfi.image);
  iconEl.imageSize = new Size(24, 24);
  iconEl.tintColor = new Color(color);
  const feels = left.addText(`Feels like ${fmtTemp(c.feelsLike)}`);
  feels.font = Font.systemFont(11);
  feels.textColor = mutedColor();

  header.addSpacer();

  const right = header.addStack();
  right.layoutVertically();
  const loc = right.addText(LOCATION_LABEL.toUpperCase());
  loc.font = Font.mediumSystemFont(10);
  loc.textColor = mutedColor();
  loc.rightAlignText();
  const cond = right.addText(c.condition || "");
  cond.font = Font.systemFont(11);
  cond.textColor = textColor();
  cond.lineLimit = 1;
  cond.rightAlignText();

  widget.addSpacer(4);

  // 5-day meteogram — temp curve + hi/lo + cloud shading + rain bars.
  // Sized to fill essentially all the width/height the tighter padding
  // above frees up, so the chart — not the chrome around it — dominates
  // the widget, matching the reference screenshot's proportions.
  const hourly = (data.hourly || []).slice(0, CHART_HOURS);
  const daily = data.daily || [];
  if (hourly.length >= 24 && daily.length) {
    const chartWidth = 309;
    const chartHeight = 206; // leaves a little clearance below the day-strip/footer — see buildLargeWidget's padding comment
    const img = renderMeteogramImage(hourly, daily, chartWidth, chartHeight);
    const chartStack = widget.addStack();
    chartStack.addSpacer();
    const imgEl = chartStack.addImage(img);
    imgEl.imageSize = new Size(chartWidth, chartHeight);
    chartStack.addSpacer();
  }

  widget.addSpacer(4);

  // Per-day strip: icon + Wind/UV badges — the two series dropped from the
  // chart itself (see renderMeteogramImage's comment) surface here instead,
  // as one representative number per day rather than a plotted line.
  if (daily.length && hourly.length) {
    const stripRow = widget.addStack();
    const dayCount = Math.min(daily.length, Math.floor(hourly.length / 24));
    for (let d = 0; d < dayCount; d++) {
      const start = d * 24;
      const slice = hourly.slice(start, start + 24);
      const repHour = slice[13] || slice[Math.floor(slice.length / 2)];
      const maxWind = Math.round(Math.max(...slice.map((h) => h.windSpeed || 0)));
      const maxUV = Math.round(Math.max(...slice.map((h) => h.uvIndex || 0)));
      const { symbol: daySym, color: dayColor } = iconForCondition(repHour.iconCode);

      const dayCol = stripRow.addStack();
      dayCol.layoutVertically();
      dayCol.centerAlignContent();

      const dayLabel = dayCol.addText(
        new Date(repHour.validTimeUtc * 1000)
          .toLocaleString("en-NZ", { weekday: "short", timeZone: "Pacific/Auckland" })
          .toUpperCase()
      );
      dayLabel.font = Font.mediumSystemFont(9);
      dayLabel.textColor = mutedColor();

      const sfi = SFSymbol.named(daySym);
      sfi.applyFont(Font.systemFont(14));
      const iconEl = dayCol.addImage(sfi.image);
      iconEl.imageSize = new Size(16, 16);
      iconEl.tintColor = new Color(dayColor);

      const badge = dayCol.addText(`${maxWind}km · UV${maxUV}`);
      badge.font = Font.systemFont(8);
      badge.textColor = mutedColor();

      if (d < dayCount - 1) stripRow.addSpacer();
    }
  }

  widget.addSpacer();

  const footer = widget.addText(`Updated ${fmtUpdatedAgo(data.meta.updated)}`);
  footer.font = Font.systemFont(9);
  footer.textColor = mutedColor();

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