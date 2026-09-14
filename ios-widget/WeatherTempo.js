// WeatherTempo — Scriptable iOS Widget
// ---------------------------------------------------------------------------
// Renders live Christchurch conditions from the WeatherTempo Cloudflare
// Worker on a home-screen widget. Supports small + medium sizes.
//
// SETUP (one-time):
//   1. Install "Scriptable" from the App Store (free).
//   2. Open Scriptable → tap "+" → paste this whole file → name it
//      "WeatherTempo" (top-left, tap the title).
//   3. Long-press your home screen → "+" → search "Scriptable" → add a
//      widget (small or medium) → tap it → set Script: WeatherTempo,
//      When Interacting: Run Script.
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

async function run() {
  let widget;
  try {
    const data = await fetchWeather();
    widget =
      config.widgetFamily === "medium"
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
    if (config.widgetFamily === "medium") {
      await widget.presentMedium();
    } else {
      await widget.presentSmall();
    }
  }
  Script.complete();
}

await run();
