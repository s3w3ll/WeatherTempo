// WeatherTempo — Scriptable iOS Widget
// ---------------------------------------------------------------------------
// Renders live Christchurch conditions from the WeatherTempo Cloudflare
// Worker on a home-screen widget. Small/medium show a current-conditions
// card; large adds a WeatherGraph-style meteogram (temp curve + precip
// bars) rendered via DrawContext — see renderMeteogramImage() below.
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
const CHART_HOURS = 16; // how many hourly points the large-widget meteogram plots

// Palette lifted from src/chart.js CHART_COLORS so the widget matches the
// web dashboard's look.
const COLORS = {
  bgLight: "#f5f8fc",
  bgDark: "#0e1420",
  tempLine: "#ea7c1c",   // orange — temperature
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

// DrawContext has no native dashed-stroke option, so this walks each
// segment of the polyline in dashLen/gapLen increments, stroking only the
// "on" pieces — used for the feels-like line (cyan dashed in chart.js).
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

function renderMeteogramImage(hourly, width, height) {
  const draw = new DrawContext();
  draw.size = new Size(width, height);
  draw.opaque = false;
  draw.respectScreenScale = true;

  const n = hourly.length;
  const xAt = (i) => (i / (n - 1)) * width;

  const allTemps = hourly.map((h) => h.temperature).concat(hourly.map((h) => h.temperatureFeelsLike));
  const minT = Math.min(...allTemps) - 1;
  const maxT = Math.max(...allTemps) + 1;

  // Zones, echoing chart.js's ZONE split (temp zone on top, precip strip
  // below, axis labels at the very bottom) but compressed for widget size.
  const axisH = 14;
  const precipH = height * 0.2;
  const tempTop = 2;
  const tempBot = height - axisH - precipH - 6;
  const precipTop = tempBot + 6;
  const precipBot = height - axisH;

  // Temperature area fill + curve
  const tempPts = hourly.map((h, i) => new Point(xAt(i), scaleY(h.temperature, minT, maxT, tempTop, tempBot)));
  const fillPath = smoothPath(tempPts);
  fillPath.addLine(new Point(width, tempBot));
  fillPath.addLine(new Point(0, tempBot));
  fillPath.closeSubpath();
  draw.setFillColor(new Color(COLORS.tempLine, 0.22));
  draw.addPath(fillPath);
  draw.fillPath();

  draw.setStrokeColor(new Color(COLORS.tempLine));
  draw.setLineWidth(2.5);
  draw.addPath(smoothPath(tempPts));
  draw.strokePath();

  // Feels-like dashed line
  const feelsPts = hourly.map((h, i) => new Point(xAt(i), scaleY(h.temperatureFeelsLike, minT, maxT, tempTop, tempBot)));
  strokeDashedPolyline(draw, feelsPts, 5, 4, new Color("#5fd0e0"), 1.5);

  // Precipitation-chance bars
  const barW = Math.max(2, (width / n) * 0.5);
  draw.setFillColor(new Color(COLORS.precip, 0.75));
  hourly.forEach((h, i) => {
    const pct = (h.precipChance || 0) / 100;
    const barH = pct * (precipBot - precipTop);
    if (barH < 1) return;
    const barPath = new Path();
    barPath.addRect(new Rect(xAt(i) - barW / 2, precipBot - barH, barW, barH));
    draw.addPath(barPath);
    draw.fillPath();
  });

  // Hour-of-day axis labels, every 4th point
  draw.setFont(Font.systemFont(9));
  draw.setTextColor(new Color(COLORS.mutedLight));
  draw.setTextAlignedCenter();
  hourly.forEach((h, i) => {
    if (i % 4 !== 0) return;
    const label = new Date(h.validTimeUtc * 1000)
      .toLocaleString("en-NZ", { hour: "numeric", hour12: true, timeZone: "Pacific/Auckland" })
      .replace(" ", "")
      .toLowerCase();
    draw.drawTextInRect(label, new Rect(xAt(i) - 18, height - axisH + 1, 36, axisH - 1));
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
  widget.setPadding(14, 16, 10, 16);

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

  widget.addSpacer(8);

  // Meteogram — next CHART_HOURS hours of temp/feels-like/precip chance.
  const hourly = (data.hourly || []).slice(0, CHART_HOURS);
  if (hourly.length >= 2) {
    const chartWidth = 300;
    const chartHeight = 230;
    const img = renderMeteogramImage(hourly, chartWidth, chartHeight);
    const chartStack = widget.addStack();
    chartStack.addSpacer();
    const imgEl = chartStack.addImage(img);
    imgEl.imageSize = new Size(chartWidth, chartHeight);
    chartStack.addSpacer();
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