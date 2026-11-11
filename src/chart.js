/**
 * chart.js — WeatherGraph-style canvas chart renderer.
 *
 * Layers (bottom → top):
 *   1. Background: sky gradient (day / twilight / night from the sun's real
 *      position), sunshine glow by cloud cover, grid, zone separators
 *   2. Warning shade (MetService warnings in force)
 *   3. Cloud cover (blurred translucent shapes)
 *   4. Freezing line (0°, when in range)
 *   5. UV curve (own 0–12 scale, UV 3+ filled)
 *   6. Temperature area, temperature line, feels-like line, dew point line
 *   7. Pressure line (secondary axis, dashed)
 *   8. Wind: speed area + line, gusts, direction arrows
 *   9. Precipitation: chance area, qpf bars, chance line
 *  10. Day dividers, "Now" marker, time axis, day axis
 *  11. Temperature labels at day highs / night lows
 *  12. Warning strip along the top edge
 *
 * Pure calculations (sun position, dew point, pressure tendency) live in
 * insights.js, which must load first. The iOS app's MeteogramRenderer is a
 * layer-by-layer port of this file; keep the two in step.
 */

(function (global) {
  "use strict";

  const WI = global.WeatherInsights;

  // ── Layout constants ─────────────────────────────────────────────────────
  // px per hour is computed per instance in _setup() as this._pph, from the
  // scroll container's width, so that meta.days days fill the visible area.
  // The canvas holds the whole forecast; the rest is reached by scrolling.

  const ZONE = {
    top:         0,
    cloudTop:    8,
    cloudBot:    50,
    tempTop:     45,
    tempBot:    224,   // main zone  — 224 px (70% of 320 px data area)
    windTop:    228,   // wind zone  —  48 px (15%), 4 px gap above
    windBot:    276,
    precipTop:  280,   // precip zone — 48 px (15%), 4 px gap above
    precipBot:  328,
    timeTop:    332,   // hour labels
    dayAxisTop: 348,   // day name strip
    height:     364,
  };

  const PAD = { left: 6, right: 6 };

  /** Height of the pressure trend strip drawn under the chart. */
  const PRESSURE_STRIP_H = 16;

  // ── Palettes ─────────────────────────────────────────────────────────────
  // Same values as ChartPalette.light / .dark in the iOS app. Arrays are
  // [r, g, b, a] where the alpha gets scaled at draw time.
  const LIGHT = {
    bg:           "#f5f8fc",
    // Daytime base is a pale neutral warm: the sunshine glow adds the gold on
    // top only where the sky is clear, so overcast days look grey, not sunny.
    bgDay:        "rgba(255,228,190,0.22)",
    bgNight:      "rgba(20,40,80,0.14)",
    bgTwilight:   "rgba(190,120,160,0.18)",
    tempFillTop:  "rgba(255,140,20,0.28)",
    tempFillBot:  "rgba(255,160,30,0.04)",
    tempLine:     "#ea7c1c",
    feelsLine:    "rgba(10,165,200,0.85)",
    pressLine:    "rgba(20,40,80,0.30)",
    nowLine:      "rgba(20,40,80,0.55)",
    nowLabel:     "rgba(20,40,80,0.75)",
    grid:         "rgba(20,40,80,0.07)",
    dayDiv:       "rgba(20,40,80,0.10)",
    zoneSep:      "rgba(255,255,255,0.28)",
    text:         "#1a2640",
    textMuted:    "#56708e",
    halo:         "rgba(245,248,252,0.8)",
    cloud:        "rgba(255,255,255,0.95)",
    dayAxisBg:    "rgba(0,0,0,0.18)",
    windFillTop:  "rgba(220,60,50,0.22)",
    windFillBot:  "rgba(220,60,50,0.03)",
    windLine:     "rgba(255,90,70,0.60)",
    windShadow:   "rgba(255,80,60,0.35)",
    windArrow:    "rgba(255,90,70,0.85)",
    gustLine:     "rgba(200,50,40,0.55)",
    precipTop:    "rgba(60,150,255,0.22)",
    precipBot:    "rgba(60,150,255,0.02)",
    precipLine:   "rgba(60,150,255,0.85)",
    precipShadow: "rgba(60,150,255,0.4)",
    hoverLine:    "rgba(20,40,80,0.55)",
    freezingLine: "rgba(40,110,220,0.55)",
    dewLine:      "rgba(30,120,200,0.70)",
    uvLine:       "rgba(150,70,200,0.85)",
    uvFill:       "rgba(150,70,200,0.10)",
    sunGlow:      [255, 190, 60, 0.50],
    pressSteady:  "rgba(10,20,38,0.06)",
    pressText:    "#0a1426",
  };

  const DARK = {
    bg:           "#101723",
    bgDay:        "rgba(255,210,150,0.06)",
    bgNight:      "rgba(0,0,0,0.30)",
    bgTwilight:   "rgba(150,90,160,0.18)",
    tempFillTop:  "rgba(255,140,20,0.30)",
    tempFillBot:  "rgba(255,160,30,0.03)",
    tempLine:     "#f58c2d",
    feelsLine:    "rgba(60,200,235,0.9)",
    pressLine:    "rgba(255,255,255,0.35)",
    nowLine:      "rgba(255,255,255,0.55)",
    nowLabel:     "rgba(255,255,255,0.85)",
    grid:         "rgba(255,255,255,0.06)",
    dayDiv:       "rgba(255,255,255,0.10)",
    zoneSep:      "rgba(255,255,255,0.10)",
    text:         "#e2e8f2",
    textMuted:    "#96aac4",
    halo:         "rgba(16,23,35,0.85)",
    cloud:        "rgba(200,215,235,0.35)",
    dayAxisBg:    "rgba(255,255,255,0.06)",
    windFillTop:  "rgba(240,80,70,0.25)",
    windFillBot:  "rgba(240,80,70,0.03)",
    windLine:     "rgba(255,110,95,0.75)",
    windShadow:   "rgba(255,80,60,0.35)",
    windArrow:    "rgba(255,120,100,0.9)",
    gustLine:     "rgba(255,130,120,0.6)",
    precipTop:    "rgba(80,165,255,0.28)",
    precipBot:    "rgba(80,165,255,0.03)",
    precipLine:   "rgba(100,180,255,0.9)",
    precipShadow: "rgba(60,150,255,0.4)",
    hoverLine:    "rgba(255,255,255,0.6)",
    freezingLine: "rgba(110,170,255,0.7)",
    dewLine:      "rgba(90,170,240,0.8)",
    uvLine:       "rgba(190,120,240,0.9)",
    uvFill:       "rgba(190,120,240,0.14)",
    sunGlow:      [255, 190, 60, 0.22],
    pressSteady:  "rgba(245,248,252,0.06)",
    pressText:    "#f5f8fc",
  };

  /** MetService colours (their yellow vanishes on a light card, so amber stands in). */
  const WARN_RGB = { yellow: [226, 168, 0], orange: [240, 120, 20], red: [220, 40, 50] };
  const PRESS_RGB = { rising: [37, 99, 216], falling: [214, 100, 30] };

  const rgba = ([r, g, b], a) => `rgba(${r},${g},${b},${a})`;

  // ── Utility ──────────────────────────────────────────────────────────────
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function lerp(a, b, t)    { return a + (b - a) * t; }

  function escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, c =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }

  function precipColor(intensity) {
    // intensity 0-1 maps sky-blue → deep-blue
    const r = Math.round(lerp(80,  40, intensity));
    const g = Math.round(lerp(170, 100, intensity));
    const b = Math.round(lerp(255, 220, intensity));
    return `rgb(${r},${g},${b})`;
  }

  /**
   * Catmull-Rom → Bezier smooth curve.
   * Draws a smooth path through `pts` (array of {x, y}).
   * If `startNew` is false, continues from the current point.
   */
  function smoothPath(ctx, pts, startNew = true) {
    if (pts.length < 2) return;
    if (startNew) ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) {
      const p0 = pts[Math.max(0, i - 2)];
      const p1 = pts[i - 1];
      const p2 = pts[i];
      const p3 = pts[Math.min(pts.length - 1, i + 1)];
      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = p2.y - (p3.y - p1.y) / 6;
      ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
    }
  }

  // ── WeatherChart class ───────────────────────────────────────────────────
  class WeatherChart {
    /**
     * @param {HTMLCanvasElement} canvas
     * @param {object[]} hours  Hourly forecast data array (the whole forecast).
     * @param {object}   meta   {
     *   days      — how many days fill the visible width (zoom)
     *   lat, lon  — place, for sunrise/sunset/twilight from the sun's position
     *   warnings  — MetService warnings: { headline, level, onset, expires }
     *   dark      — use the dark palette
     *   tz        — IANA time zone for labels (default Pacific/Auckland)
     * }
     */
    constructor(canvas, hours, meta = {}) {
      this.canvas = canvas;
      this.hours  = hours;
      this.meta   = meta;
      this.P      = meta.dark ? DARK : LIGHT;
      this.tz     = meta.tz || "Pacific/Auckland";
      this._dpr   = window.devicePixelRatio || 1;
      this._setup();
    }

    // ── Setup ──────────────────────────────────────────────────────────────
    _setup() {
      const { hours } = this;
      const days     = (this.meta && this.meta.days) || 2;
      const viewport = (this.canvas.parentElement && this.canvas.parentElement.clientWidth) || 900;
      // Sanity floor only: 5 days on a phone is ~3 px/hour and must still fit.
      this._pph = Math.max(2, (viewport - PAD.left - PAD.right) / (days * 24));
      const W = PAD.left + hours.length * this._pph + PAD.right;
      const H = ZONE.height;

      this.canvas.style.width  = W + "px";
      this.canvas.style.height = H + "px";
      this.canvas.width  = Math.round(W * this._dpr);
      this.canvas.height = Math.round(H * this._dpr);

      this.ctx = this.canvas.getContext("2d");
      this.ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);

      this.W = W;
      this.H = H;

      // Dew point per hour (computed: the Worker sends temperature + humidity)
      this._dew = hours.map(h => WI.dewPoint(h.temperature, h.relativeHumidity));

      // Temperature range spans temp, feels-like and dew point (one shared scale)
      const all = [
        ...hours.map(h => h.temperature),
        ...hours.map(h => h.temperatureFeelsLike),
        ...this._dew,
      ].filter(v => v != null);
      this._tMin  = (all.length ? Math.min(...all) : 8) - 2;
      this._tMax  = (all.length ? Math.max(...all) : 18) + 2;

      // Pressure range
      const pvals = hours.map(h => h.pressureMeanSeaLevel).filter(v => v != null);
      this._pMin  = pvals.length ? Math.min(...pvals) - 2 : 1000;
      this._pMax  = pvals.length ? Math.max(...pvals) + 2 : 1030;

      // Max precipitation for bar scaling
      this._qMax  = Math.max(1, ...hours.map(h => h.qpf || 0));

      // "Now" index
      this._nowIdx = WI.nowIndex(hours, Date.now() / 1000);

      // Labels every 3 h need 10+ px/hour; zoomed out they thin to every
      // 6/12/24 h so they stay ~30 px apart instead of running together.
      this._labelStride = [3, 6, 12].find(s => this._pph * s >= 30) || 24;
      // Wind arrows (~10 px wide) every 3 h, spaced out in 3 h steps when zoomed out.
      this._arrowEvery  = Math.max(1, Math.ceil(18 / this._pph / 3)) * 3;

      this._warningSpans = this._spans(this.meta.warnings || []);
    }

    // ── Coordinate helpers ────────────────────────────────────────────────
    hourX(i)   { return PAD.left + i * this._pph + this._pph / 2; }
    tempY(t)   { return ZONE.tempBot - (t - this._tMin) / (this._tMax - this._tMin) * (ZONE.tempBot - ZONE.tempTop); }
    pressY(p)  { return ZONE.tempBot - (p - this._pMin) / (this._pMax - this._pMin) * (ZONE.tempBot - ZONE.tempTop); }

    /** UV on its own 0–12 scale across the lower 40% of the main zone. */
    uvY(uv)    { return ZONE.tempBot - clamp(uv, 0, 12) / 12 * (ZONE.tempBot - ZONE.tempTop) * 0.4; }

    /** x for a UTC time, with hour i's centre at hours[i].validTimeUtc. */
    timeX(t)   { return this.hourX(0) + (t - this.hours[0].validTimeUtc) / 3600 * this._pph; }

    /** Hour index nearest a canvas x, clamped to the data. */
    hourAt(x)  { return clamp(Math.round((x - PAD.left - this._pph / 2) / this._pph), 0, this.hours.length - 1); }

    // ── Render entry point ─────────────────────────────────────────────────
    render() {
      const { ctx } = this;
      ctx.clearRect(0, 0, this.W, this.H);
      if (!this.hours.length) return;

      this._drawBackground();
      this._drawWarningShade();
      this._drawCloudCover();
      this._drawFreezingLine();
      this._drawUV();
      this._drawTemperatureArea();
      this._drawTemperatureLine();
      this._drawFeelsLikeLine();
      this._drawDewPointLine();
      this._drawPressureLine();
      this.drawWindIndicators(ctx, this.hours, this._windLayout());
      this._drawPrecipBars();
      this._drawDayDividers();
      this._drawNowMarker();
      this._drawTimeAxis();
      this._drawDayAxis();
      this._drawTempLabels();
      this._drawWarningStrip();
    }

    // ── 1. Background ─────────────────────────────────────────────────────
    _drawBackground() {
      const { ctx, W, H, hours, P } = this;

      ctx.fillStyle = P.bg;
      ctx.fillRect(0, 0, W, H);

      // Day/night, blended across each sunrise and sunset so dawn and dusk read
      // as a short twilight rather than a hard edge. With coordinates the stops
      // come from the sun's real position; without, from each hour's flag.
      const phaseColor = { day: P.bgDay, twilight: P.bgTwilight, night: P.bgNight };
      const sky = WI.skyStops(hours, this.meta.lat, this.meta.lon);
      const grad = ctx.createLinearGradient(0, 0, W, 0);
      if (sky) {
        const t0 = hours[0].validTimeUtc;
        for (const s of sky) {
          grad.addColorStop(clamp((PAD.left + (s.t - t0) / 3600 * this._pph) / W, 0, 1), phaseColor[s.phase]);
        }
      } else {
        hours.forEach((h, i) => grad.addColorStop(clamp(this.hourX(i) / W, 0, 1),
          h.dayOrNight === "D" ? P.bgDay : P.bgNight));
      }
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);

      this._drawSunGlow();

      // Subtle horizontal grid lines in temp zone
      ctx.strokeStyle = P.grid;
      ctx.lineWidth   = 0.5;
      const step = Math.ceil(Math.max(1, (this._tMax - this._tMin) / 5));
      for (let t = Math.ceil(this._tMin); t <= this._tMax; t += step) {
        const y = this.tempY(t);
        ctx.beginPath();
        ctx.moveTo(0, y); ctx.lineTo(W, y);
        ctx.stroke();
      }

      // Swimlane separator lines between main / wind / precip zones
      ctx.strokeStyle = P.zoneSep;
      ctx.lineWidth   = 2;
      [ZONE.windTop, ZONE.precipTop].forEach(y => {
        ctx.beginPath();
        ctx.moveTo(0, y); ctx.lineTo(W, y);
        ctx.stroke();
      });
    }

    /**
     * Warm glow over the sky part of the main zone, as strong as the hour is
     * clear: brightest at the top, fading towards the temperature floor. Drawn
     * on a scratch canvas so the vertical fade can mask the horizontal colour.
     */
    _drawSunGlow() {
      const { ctx, W, P } = this;
      const stops = WI.glowStops(this.hours, this.meta.lat, this.meta.lon);
      if (!stops.some(s => s.value > 0)) return;

      const h   = ZONE.tempBot;
      const off = document.createElement("canvas");
      off.width  = Math.max(1, Math.round(W * this._dpr));
      off.height = Math.round(h * this._dpr);
      const o = off.getContext("2d");
      o.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);

      const [r, g, b, a] = P.sunGlow;
      const hg = o.createLinearGradient(0, 0, W, 0);
      for (const s of stops) {
        hg.addColorStop(clamp((PAD.left + s.h * this._pph) / W, 0, 1), `rgba(${r},${g},${b},${(a * s.value).toFixed(3)})`);
      }
      o.fillStyle = hg;
      o.fillRect(0, 0, W, h);

      o.globalCompositeOperation = "destination-in";
      const vg = o.createLinearGradient(0, 0, 0, h);
      vg.addColorStop(0,    "rgba(0,0,0,1)");
      vg.addColorStop(0.55, "rgba(0,0,0,0.6)");
      vg.addColorStop(1,    "rgba(0,0,0,0.15)");
      o.fillStyle = vg;
      o.fillRect(0, 0, W, h);

      ctx.drawImage(off, 0, 0, W, h);
    }

    // ── 2. Warnings ───────────────────────────────────────────────────────
    /**
     * Where each warning sits: clamped to the data area, ones entirely outside
     * dropped, least severe first so the most severe is drawn on top.
     */
    _spans(warnings) {
      const { hours } = this;
      if (!hours.length) return [];
      const first = hours[0].validTimeUtc - 1800;
      const last  = hours[hours.length - 1].validTimeUtc + 1800;
      return warnings
        .filter(w => WARN_RGB[w.level])
        .slice()
        .sort((a, b) => WI.LEVEL_RANK[a.level] - WI.LEVEL_RANK[b.level])
        .map(w => {
          const start = Math.max(w.onset   || first, first);
          const end   = Math.min(w.expires || last,  last);
          return end > start
            ? { headline: w.headline, level: w.level, start, end, x0: this.timeX(start), x1: this.timeX(end) }
            : null;
        })
        .filter(Boolean);
    }

    /** The most severe warning in force during hour i (for the tooltip). */
    warningAt(i) {
      const t = this.hours[i]?.validTimeUtc;
      if (t == null) return null;
      return this._warningSpans.slice().reverse().find(s => s.start <= t && t < s.end) || null;
    }

    /** Light tint over the data zones, dashed edges, for the hours in force. */
    _drawWarningShade() {
      const { ctx } = this;
      for (const s of this._warningSpans) {
        const c = WARN_RGB[s.level];
        ctx.fillStyle = rgba(c, 0.13);
        ctx.fillRect(s.x0, 0, s.x1 - s.x0, ZONE.precipBot);
        ctx.save();
        ctx.strokeStyle = rgba(c, 0.55);
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        for (const x of [s.x0, s.x1]) {
          ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, ZONE.precipBot); ctx.stroke();
        }
        ctx.restore();
      }
    }

    /** Solid strip in the warning's colour along the top, drawn last so nothing covers it. */
    _drawWarningStrip() {
      const { ctx } = this;
      const h = Math.min(4, Math.max(3, ZONE.cloudTop - 1));   // clear of the NOW label
      for (const s of this._warningSpans) {
        ctx.fillStyle = rgba(WARN_RGB[s.level], 1);
        ctx.fillRect(s.x0, 0, s.x1 - s.x0, h);
      }
    }

    // ── 3. Cloud cover ────────────────────────────────────────────────────
    _drawCloudCover() {
      const { ctx, hours } = this;
      const zoneH = ZONE.cloudBot - ZONE.cloudTop;

      ctx.save();
      ctx.filter = "blur(4px)";

      // Walk hours, grouping consecutive cloudy hours into runs
      let i = 0;
      while (i < hours.length) {
        if ((hours[i].cloudCover || 0) < 10) { i++; continue; }

        const start = i;
        while (i < hours.length && (hours[i].cloudCover || 0) >= 10) i++;
        const end = i; // exclusive

        // Bottom-edge control points (hour centres, y = proportional to cc)
        const pts = [];
        for (let j = start; j < end; j++) {
          pts.push({ x: this.hourX(j), y: ZONE.cloudTop + zoneH * (hours[j].cloudCover / 100) });
        }

        const xLeft  = PAD.left + start * this._pph;
        const xRight = PAD.left + end   * this._pph;

        ctx.beginPath();
        ctx.moveTo(xLeft, ZONE.cloudTop);          // top-left corner
        ctx.lineTo(pts[0].x, pts[0].y);            // down to first bottom point
        smoothPath(ctx, pts, false);               // smooth bottom edge
        ctx.lineTo(xRight, ZONE.cloudTop);         // back up to top-right
        ctx.closePath();

        ctx.fillStyle = this.P.cloud;
        ctx.fill();
      }

      ctx.filter = "none";
      ctx.restore();
    }

    // ── 4. Freezing line ──────────────────────────────────────────────────
    /** Dashed 0° line with a small label, only when 0° is inside the plotted range. */
    _drawFreezingLine() {
      if (this._tMin > 0 || this._tMax < 0) return;
      const { ctx, W, P } = this;
      const y = this.tempY(0);
      ctx.save();
      ctx.strokeStyle = P.freezingLine;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = P.freezingLine;
      ctx.font = "bold 9px -apple-system, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("0°", 14, y - 2);
      ctx.restore();
    }

    // ── 5. UV ─────────────────────────────────────────────────────────────
    /** Daylight stretches with UV above zero, plus the zero either side. */
    _uvRuns() {
      const { hours } = this;
      const runs = [];
      let i = 0;
      while (i < hours.length) {
        if ((hours[i].uvIndex || 0) <= 0) { i++; continue; }
        const start = Math.max(0, i - 1);
        while (i < hours.length && (hours[i].uvIndex || 0) > 0) i++;
        runs.push([start, Math.min(hours.length, i + 1)]);
      }
      return runs;
    }

    /** UV curve in the lower main zone with the 3+ "sun protection" part filled. */
    _drawUV() {
      const { ctx, hours, P } = this;
      const floor = this.uvY(0), protect = this.uvY(3);
      for (const [a, b] of this._uvRuns()) {
        const pts = [];
        for (let i = a; i < b; i++) pts.push({ x: this.hourX(i), y: this.uvY(hours[i].uvIndex || 0) });
        if (pts.length < 2) continue;
        const first = pts[0], last = pts[pts.length - 1];

        // Fill only where UV >= 3: the area under the curve, clipped above the 3 line
        ctx.save();
        ctx.beginPath();
        ctx.rect(first.x, 0, last.x - first.x, protect);
        ctx.clip();
        ctx.beginPath();
        smoothPath(ctx, pts);
        ctx.lineTo(last.x, floor);
        ctx.lineTo(first.x, floor);
        ctx.closePath();
        ctx.fillStyle = P.uvFill;
        ctx.fill();
        ctx.restore();

        ctx.save();
        ctx.beginPath();
        smoothPath(ctx, pts);
        ctx.strokeStyle = P.uvLine;
        ctx.lineWidth = 1.5;
        ctx.lineJoin = "round";
        ctx.stroke();

        // Peak label: "UV 6"
        let peak = a;
        for (let i = a; i < b; i++) if ((hours[i].uvIndex || 0) > (hours[peak].uvIndex || 0)) peak = i;
        const uv = hours[peak].uvIndex || 0;
        if (uv >= 1) {
          ctx.fillStyle = P.uvLine;
          ctx.font = "bold 8px -apple-system, sans-serif";
          ctx.textAlign = "center";
          ctx.fillText(`UV ${Math.round(uv)}`, this.hourX(peak), this.uvY(uv) - 4);
        }
        ctx.restore();
      }
    }

    // ── 6. Temperature area ───────────────────────────────────────────────
    _drawTemperatureArea() {
      const { ctx, hours, P } = this;
      const tPts = hours.map((h, i) => ({ x: this.hourX(i), y: this.tempY(h.temperature ?? 0) }));
      const fPts = hours.map((h, i) => ({ x: this.hourX(i), y: this.tempY(h.temperatureFeelsLike ?? 0) }));

      const grad = ctx.createLinearGradient(0, ZONE.tempTop, 0, ZONE.tempBot);
      grad.addColorStop(0, P.tempFillTop);
      grad.addColorStop(1, P.tempFillBot);

      ctx.save();
      ctx.beginPath();
      smoothPath(ctx, tPts);
      smoothPath(ctx, [...fPts].reverse(), false);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.restore();
    }

    _drawTemperatureLine() {
      const { ctx, hours } = this;
      const pts = hours.map((h, i) => ({ x: this.hourX(i), y: this.tempY(h.temperature ?? 0) }));
      ctx.save();
      ctx.beginPath();
      smoothPath(ctx, pts);
      ctx.strokeStyle = this.P.tempLine;
      ctx.lineWidth   = 2.5;
      ctx.lineJoin    = "round";
      ctx.stroke();
      ctx.restore();
    }

    _drawFeelsLikeLine() {
      const { ctx, hours } = this;
      const pts = hours.map((h, i) => ({ x: this.hourX(i), y: this.tempY(h.temperatureFeelsLike ?? 0) }));
      ctx.save();
      ctx.beginPath();
      smoothPath(ctx, pts);
      ctx.strokeStyle = this.P.feelsLine;
      ctx.lineWidth   = 1.5;
      ctx.setLineDash([5, 5]);
      ctx.stroke();
      ctx.restore();
    }

    /** Dotted dew point line on the temperature scale. */
    _drawDewPointLine() {
      const { ctx } = this;
      const pts = this._dew
        .map((d, i) => d != null ? { x: this.hourX(i), y: this.tempY(d) } : null)
        .filter(Boolean);
      if (pts.length < 2) return;
      ctx.save();
      ctx.beginPath();
      smoothPath(ctx, pts);
      ctx.strokeStyle = this.P.dewLine;
      ctx.lineWidth = 1.2;
      ctx.lineCap = "round";
      ctx.setLineDash([0.5, 3.5]);
      ctx.stroke();
      ctx.restore();
    }

    // ── 7. Pressure line (right-aligned scale) ────────────────────────────
    _drawPressureLine() {
      const { ctx, hours } = this;
      const pts = hours
        .map((h, i) => h.pressureMeanSeaLevel != null
          ? { x: this.hourX(i), y: this.pressY(h.pressureMeanSeaLevel) }
          : null)
        .filter(Boolean);
      if (pts.length < 2) return;

      ctx.save();
      ctx.beginPath();
      smoothPath(ctx, pts);
      ctx.strokeStyle = this.P.pressLine;
      ctx.lineWidth   = 1.2;
      ctx.setLineDash([3, 6]);
      ctx.stroke();
      ctx.restore();
    }

    // ── 9. Precipitation: qpf bars + precipChance line/area ───────────────
    // Two separate visual channels:
    //   • precipChance (probability) → line + semi-transparent area
    //     y-axis: 0% = precipBot, 100% = precipTop (spans the full zone height)
    //   • qpf (actual amount)        → solid bars, height proportional to _qMax
    // Drawing order: area fill → bars → line (probability context behind, facts in front)
    _drawPrecipBars() {
      const { ctx, hours, P } = this;
      const barW  = Math.max(2, this._pph * 0.45);
      const zoneH = ZONE.precipBot - ZONE.precipTop;

      const probY = pct => ZONE.precipBot - (pct / 100) * zoneH;
      const pts = hours.map((h, i) => ({ x: this.hourX(i), y: probY(h.precipChance || 0) }));

      // ── Pass 1: precipChance area fill ─────────────────────────────────
      const areaGrad = ctx.createLinearGradient(0, ZONE.precipTop, 0, ZONE.precipBot);
      areaGrad.addColorStop(0, P.precipTop);
      areaGrad.addColorStop(1, P.precipBot);
      ctx.beginPath();
      smoothPath(ctx, pts);
      ctx.lineTo(pts[pts.length - 1].x, ZONE.precipBot);
      ctx.lineTo(pts[0].x,              ZONE.precipBot);
      ctx.closePath();
      ctx.fillStyle = areaGrad;
      ctx.fill();

      // ── Pass 2: qpf bars (actual rain only) ─────────────────────────────
      for (let i = 0; i < hours.length; i++) {
        const qpf = hours[i].qpf || 0;
        if (qpf <= 0) continue;
        const intensity = clamp(qpf / this._qMax, 0, 1);
        const height    = Math.max(2, zoneH * intensity);
        const x         = this.hourX(i) - barW / 2;
        ctx.fillStyle   = precipColor(intensity);
        ctx.globalAlpha = 0.90;
        ctx.beginPath();
        ctx.roundRect(x, ZONE.precipBot - height, barW, height, [2, 2, 0, 0]);
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      // ── Pass 3: precipChance line (drawn last — always visible above bars) ─
      ctx.beginPath();
      smoothPath(ctx, pts);
      ctx.strokeStyle = P.precipLine;
      ctx.lineWidth   = 1.5;
      ctx.shadowColor = P.precipShadow;
      ctx.shadowBlur  = 3;
      ctx.stroke();
      ctx.shadowBlur  = 0;
    }

    // ── 8. Wind indicators ─────────────────────────────────────────────────
    /**
     * Draw wind speed and direction indicators along the wind zone.
     *
     * Called with:
     *   ctx     – CanvasRenderingContext2D, already scaled for HiDPI.
     *   hours   – the hourly data array; each element has:
     *               .windSpeed      km/h
     *               .windDirection  degrees (meteorological: 0=N, 90=E, 180=S, 270=W)
     *               .windGust       km/h (may be null)
     *   layout  – pre-computed helpers:
     *               .x(i)      → canvas X centre for hour i
     *               .midY      → vertical centre of the wind zone
     *               .height    → total height of wind zone
     *               .interval  → hours between arrows (3, more when zoomed out)
     *
     * The WeatherGraph style draws:
     *   • Speed as a filled area + line, gusts as a thin dashed line above it
     *   • Every `interval` hours: a small filled arrowhead pointing in the
     *     direction the wind is BLOWING TOWARD (i.e. 180° from "from")
     */
    drawWindIndicators(ctx, hours, layout) {
      ctx.save();
      const P = this.P;

      const INTERVAL = layout.interval || 3;
      const MAX_SPD  = 90;  // km/h ceiling — 30 km/h lands at exactly 1/3 height
      const zoneH    = ZONE.windBot - ZONE.windTop;

      // Map speed → Y inside the wind zone (0 km/h = windBot, MAX_SPD = windTop)
      const windY = spd => ZONE.windBot - (clamp(spd || 0, 0, MAX_SPD) / MAX_SPD) * zoneH;

      const pts = hours.map((h, i) => ({ x: layout.x(i), y: windY(h.windSpeed || 0) }));

      // ── Pass 1: fill area under speed curve ─────────────────────────────
      const fillGrad = ctx.createLinearGradient(0, ZONE.windTop, 0, ZONE.windBot);
      fillGrad.addColorStop(0, P.windFillTop);
      fillGrad.addColorStop(1, P.windFillBot);
      ctx.beginPath();
      smoothPath(ctx, pts);
      ctx.lineTo(pts[pts.length - 1].x, ZONE.windBot);
      ctx.lineTo(pts[0].x, ZONE.windBot);
      ctx.closePath();
      ctx.fillStyle = fillGrad;
      ctx.fill();

      // ── Pass 1b: gusts, thin dashed line (clamped to the zone like speed) ─
      const gustPts = hours
        .map((h, i) => h.windGust != null ? { x: layout.x(i), y: windY(h.windGust) } : null)
        .filter(Boolean);
      if (gustPts.length >= 2) {
        ctx.beginPath();
        smoothPath(ctx, gustPts);
        ctx.strokeStyle = P.gustLine;
        ctx.lineWidth   = 1;
        ctx.setLineDash([3, 2]);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // ── Pass 2: speed line ───────────────────────────────────────────────
      ctx.beginPath();
      smoothPath(ctx, pts);
      ctx.strokeStyle = P.windLine;
      ctx.lineWidth   = 1.5;
      ctx.shadowColor = P.windShadow;
      ctx.shadowBlur  = 3;
      ctx.stroke();
      ctx.shadowBlur  = 0;

      // ── Pass 3: direction arrows centred on the speed line ───────────────
      const L = 5; // fixed arrow half-length in px
      for (let i = 0; i < hours.length; i += INTERVAL) {
        const h = hours[i];
        if (h.windSpeed == null) continue;

        const x = layout.x(i);
        const y = windY(h.windSpeed);

        ctx.strokeStyle = P.windArrow;
        ctx.fillStyle   = P.windArrow;
        ctx.lineWidth   = 1.5;

        // windDirection = direction wind comes FROM → point arrow toward destination
        const angleDeg = (h.windDirection || 0) + 180;
        const rad      = angleDeg * Math.PI / 180;
        const dx = Math.sin(rad) * L;
        const dy = -Math.cos(rad) * L;

        // Shaft: tail → tip, centred at (x, y)
        ctx.beginPath();
        ctx.moveTo(x - dx * 0.6, y - dy * 0.6);
        ctx.lineTo(x + dx * 0.6, y + dy * 0.6);
        ctx.stroke();

        // Filled arrowhead at tip
        const tipX = x + dx * 0.6;
        const tipY = y  + dy * 0.6;
        const hw   = clamp(L * 0.45, 2.5, 4);
        const px   = -dy / L * hw;
        const py   =  dx / L * hw;
        ctx.beginPath();
        ctx.moveTo(tipX + dx * 0.5, tipY + dy * 0.5);
        ctx.lineTo(tipX - dx * 0.3 + px, tipY - dy * 0.3 + py);
        ctx.lineTo(tipX - dx * 0.3 - px, tipY - dy * 0.3 - py);
        ctx.closePath();
        ctx.fill();
      }

      ctx.restore();
    }

    /** Pre-compute wind zone layout helpers. */
    _windLayout() {
      const self = this;
      return {
        x:        (i) => self.hourX(i),
        midY:     (ZONE.windTop + ZONE.windBot) / 2,
        height:   ZONE.windBot - ZONE.windTop,
        interval: self._arrowEvery,
      };
    }

    // ── 10. Day dividers ───────────────────────────────────────────────────
    _dayBoundaries() {
      if (!this._bounds) this._bounds = WI.dayBoundaries(this.hours, this.tz);
      return this._bounds;
    }

    _drawDayDividers() {
      const { ctx } = this;
      ctx.save();
      ctx.strokeStyle = this.P.dayDiv;
      ctx.lineWidth   = 1;
      for (const i of this._dayBoundaries()) {
        const x = this.hourX(i) - this._pph / 2;
        ctx.beginPath();
        ctx.moveTo(x, ZONE.tempTop); ctx.lineTo(x, ZONE.precipBot);
        ctx.stroke();
      }
      ctx.restore();
    }

    // ── 11. Now marker ─────────────────────────────────────────────────────
    _drawNowMarker() {
      const { ctx, H, P } = this;
      const x = this.hourX(this._nowIdx);

      const grad = ctx.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0,   "rgba(255,255,255,0)");
      grad.addColorStop(0.2, P.nowLine);
      grad.addColorStop(0.8, P.nowLine);
      grad.addColorStop(1,   "rgba(255,255,255,0)");

      ctx.save();
      ctx.strokeStyle = grad;
      ctx.lineWidth   = 1.5;
      ctx.beginPath();
      ctx.moveTo(x, 0); ctx.lineTo(x, H);
      ctx.stroke();

      // "NOW" label (white disappeared against the white cloud band)
      ctx.fillStyle = P.nowLabel;
      ctx.font      = "bold 9px -apple-system, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("NOW", x, 14);

      ctx.beginPath();
      ctx.arc(x, ZONE.tempTop + 4, 3, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      ctx.restore();
    }

    // ── 12. Time axis ──────────────────────────────────────────────────────
    _drawTimeAxis() {
      const { ctx, hours } = this;
      ctx.save();
      ctx.textAlign = "center";
      ctx.font      = "10px -apple-system, sans-serif";
      ctx.fillStyle = this.P.textMuted;

      for (let i = 0; i < hours.length; i++) {
        const ts = hours[i].validTimeUtc;
        if (!ts) continue;
        // % 24 guards against the ICU quirk where midnight returns "24" not "0"
        const hour = +new Date(ts * 1000).toLocaleString("en-NZ", { timeZone: this.tz, hour: "numeric", hour12: false }) % 24;
        if (hour % this._labelStride !== 0) continue;
        const lbl = hour === 0 ? "12am" : hour === 12 ? "12pm" : hour > 12 ? `${hour - 12}pm` : `${hour}am`;
        ctx.fillText(lbl, this.hourX(i), ZONE.timeTop + 13);
      }
      ctx.restore();
    }

    // ── 13. Temperature labels: day highs & night lows ────────────────────
    _drawTempLabels() {
      const { ctx, hours, P, W } = this;

      // Split into contiguous day/night runs, label max of each day-run and min of each night-run
      const markers = [];
      let runStart = 0;
      for (let i = 1; i <= hours.length; i++) {
        const ended = i === hours.length || hours[i].dayOrNight !== hours[runStart].dayOrNight;
        if (!ended) continue;
        const isDay  = hours[runStart].dayOrNight === "D";
        let pickIdx  = runStart;
        for (let j = runStart + 1; j < i; j++) {
          const t = hours[j].temperature ?? 0;
          const p = hours[pickIdx].temperature ?? 0;
          if (isDay ? t > p : t < p) pickIdx = j;
        }
        markers.push({ idx: pickIdx, kind: isDay ? "high" : "low" });
        runStart = i;
      }

      ctx.save();
      ctx.textAlign = "center";

      for (const { idx, kind } of markers) {
        const t      = hours[idx].temperature ?? 0;
        const x      = this.hourX(idx);
        const curveY = this.tempY(t);
        const isHigh = kind === "high";
        const color  = isHigh ? P.tempLine : P.feelsLine;
        const STEM   = 10; // px from curve to label base
        const labelY = isHigh ? curveY - STEM - 14 : curveY + STEM + 14;
        const stemY1 = isHigh ? curveY - 4  : curveY + 4;
        const stemY2 = isHigh ? labelY + 4  : labelY - 4;
        const lbl    = `${Math.round(t)}°`;
        // Keep the label inside the chart: a high/low on the first or last
        // hour would otherwise be half cut off (dot and stem stay true).
        const labelX = clamp(x, 14, W - 14);

        ctx.save();
        ctx.beginPath();
        ctx.arc(x, curveY, 3.5, 0, Math.PI * 2);
        ctx.fillStyle   = color;
        ctx.strokeStyle = P.halo;
        ctx.lineWidth   = 2;
        ctx.stroke();
        ctx.fill();
        ctx.restore();

        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth   = 1;
        ctx.globalAlpha = 0.5;
        ctx.setLineDash([2, 2]);
        ctx.beginPath();
        ctx.moveTo(x, stemY1);
        ctx.lineTo(x, stemY2);
        ctx.stroke();
        ctx.restore();

        ctx.save();
        ctx.font        = "bold 11px -apple-system, sans-serif";
        ctx.lineWidth   = 3;
        ctx.strokeStyle = P.halo;
        ctx.strokeText(lbl, labelX, labelY);
        ctx.fillStyle   = color;
        ctx.fillText(lbl, labelX, labelY);
        ctx.restore();
      }

      ctx.restore();
    }

    // ── 12b. Day axis (below hours) ────────────────────────────────────────
    _drawDayAxis() {
      const { ctx, hours, W, P } = this;
      ctx.save();

      ctx.fillStyle = P.dayAxisBg;
      ctx.fillRect(0, ZONE.dayAxisTop, W, ZONE.height - ZONE.dayAxisTop);

      ctx.strokeStyle = P.dayDiv;
      ctx.lineWidth   = 1;
      ctx.beginPath();
      ctx.moveTo(0, ZONE.dayAxisTop);
      ctx.lineTo(W, ZONE.dayAxisTop);
      ctx.stroke();

      const boundaries = [0, ...this._dayBoundaries(), hours.length];

      ctx.textAlign = "center";
      for (let b = 0; b < boundaries.length - 1; b++) {
        const startI = boundaries[b];
        const endI   = boundaries[b + 1] - 1;

        const x0   = this.hourX(startI) - this._pph / 2;
        const x1   = this.hourX(endI)   + this._pph / 2;
        const pixW = x1 - x0;
        if (pixW < 24) continue;   // a sliver of a day at either end: no room for a name

        const weekday = new Date((hours[startI].validTimeUtc || 0) * 1000).toLocaleDateString("en-NZ", {
          timeZone: this.tz,
          weekday:  pixW > 100 ? "long" : "short",
        });

        ctx.font      = "bold 9px -apple-system, sans-serif";
        ctx.fillStyle = P.text;
        ctx.fillText(weekday, (x0 + x1) / 2, ZONE.dayAxisTop + 12);

        if (b > 0) {
          ctx.strokeStyle = P.dayDiv;
          ctx.beginPath();
          ctx.moveTo(x0, ZONE.dayAxisTop);
          ctx.lineTo(x0, ZONE.height);
          ctx.stroke();
        }
      }

      ctx.restore();
    }

    // ── Pressure trend strip ───────────────────────────────────────────────
    /**
     * Thin strip under the chart, aligned hour-for-hour with it: blue when
     * pressure is rising, orange when falling, stronger for faster change,
     * runs labelled where there's room. Drawn into its own canvas so the
     * chart's 364 px zone layout stays untouched.
     */
    renderPressureStrip(canvas) {
      const { W, P } = this;
      const H = PRESSURE_STRIP_H, pph = this._pph;
      canvas.style.width  = W + "px";
      canvas.style.height = H + "px";
      canvas.width  = Math.round(W * this._dpr);
      canvas.height = Math.round(H * this._dpr);
      const ctx = canvas.getContext("2d");
      ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);

      const tendencies = WI.pressureTendencies(this.hours);
      const ALPHA = [0.10, 0.22, 0.45, 0.75];

      // Merge neighbouring hours in the same band into one rectangle:
      // per-hour translucent cells show seams where they meet.
      let i = 0;
      while (i < tendencies.length) {
        const t = tendencies[i];
        if (!t) { i++; continue; }
        const start = i;
        while (i < tendencies.length && tendencies[i] &&
               tendencies[i].direction === t.direction && tendencies[i].strength === t.strength) i++;
        ctx.fillStyle = t.direction === "steady" ? P.pressSteady : rgba(PRESS_RGB[t.direction], ALPHA[t.strength]);
        ctx.fillRect(PAD.left + start * pph, 2, (i - start) * pph, H - 4);
      }

      ctx.font = "600 8px -apple-system, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (const run of WI.tendencyRuns(tendencies)) {
        if (run.direction === "steady") continue;
        const x0 = PAD.left + run.start * pph, w = (run.end - run.start) * pph;
        const arrow = run.direction === "rising" ? "▲" : "▼";
        const text = w >= 90 ? `${arrow} ${run.label}` : w >= 14 ? arrow : "";
        if (!text) continue;
        ctx.fillStyle = run.maxStrength === 3 ? "#ffffff" : P.pressText;
        ctx.fillText(text, x0 + w / 2, H / 2 + 0.5);
      }
    }

    // ── Hover tooltip ──────────────────────────────────────────────────────
    /**
     * Attach cursor-line + tooltip hover to the chart scroll container.
     * Creates an overlay canvas for the hover line (avoids repainting the
     * main canvas) and a floating <div> for the data tooltip.
     * @param {HTMLElement} scrollContainer
     */
    initHover(scrollContainer, signal) {
      const hours = this.hours;
      const self  = this;
      const P     = this.P;

      const overlay = document.createElement("canvas");
      overlay.style.cssText =
        "position:absolute;top:0;left:0;pointer-events:none;" +
        `width:${this.W}px;height:${this.H}px;`;
      overlay.width  = Math.round(this.W * this._dpr);
      overlay.height = Math.round(this.H * this._dpr);
      scrollContainer.style.position = "relative";
      scrollContainer.appendChild(overlay);
      const oc = overlay.getContext("2d");
      oc.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);

      // Tooltip element (fixed to viewport so positioning is simple)
      const tip = document.createElement("div");
      tip.id = "chart-tooltip";
      tip.style.position = "fixed";
      document.body.appendChild(tip);

      const clear = P.hoverLine.replace(/[\d.]+\)$/, "0)");

      function showHover(e) {
        const rect   = scrollContainer.getBoundingClientRect();
        const mouseX = e.clientX - rect.left + scrollContainer.scrollLeft;
        const i      = self.hourAt(mouseX);
        const h      = hours[i];

        oc.clearRect(0, 0, self.W, self.H);
        const x    = self.hourX(i);
        const grad = oc.createLinearGradient(0, 0, 0, self.H);
        grad.addColorStop(0,    clear);
        grad.addColorStop(0.08, P.hoverLine);
        grad.addColorStop(0.92, P.hoverLine);
        grad.addColorStop(1,    clear);
        oc.save();
        oc.strokeStyle = grad;
        oc.lineWidth   = 1;
        oc.beginPath();
        oc.moveTo(x, 0);
        oc.lineTo(x, self.H);
        oc.stroke();

        const ty = self.tempY(h.temperature ?? 0);
        oc.fillStyle = P.tempLine;
        oc.beginPath();
        oc.arc(x, ty, 4, 0, Math.PI * 2);
        oc.fill();
        oc.restore();

        const ts = h.validTimeUtc
          ? new Date(h.validTimeUtc * 1000).toLocaleString("en-NZ", {
              timeZone: self.tz, weekday: "short", month: "short",
              day: "numeric", hour: "numeric", minute: "2-digit", hour12: true,
            })
          : "";

        tip.innerHTML     = self._tooltipHTML(h, ts, i);
        tip.style.display = "block";

        // Show tooltip to the left; flip right when near the left edge
        const TIP_W    = 210;
        const flip     = e.clientX - TIP_W - 20 < 0;
        tip.style.left = (flip ? e.clientX + 16 : e.clientX - TIP_W - 12) + "px";
        tip.style.top  = (e.clientY - 20) + "px";
      }

      function hideHover() {
        oc.clearRect(0, 0, self.W, self.H);
        tip.style.display = "none";
      }

      scrollContainer.addEventListener("mousemove",  showHover, { signal });
      scrollContainer.addEventListener("mouseleave", hideHover, { signal });
    }

    /** @private HTML content for the hover tooltip. */
    _tooltipHTML(h, ts, i) {
      const row  = (lbl, val) =>
        `<div class="tt-row"><span class="tt-label">${lbl}</span><span class="tt-val">${val}</span></div>`;
      const fmt  = (v, unit) => v != null ? `${v}${unit}` : "—";
      const fmtR = (v, unit) => v != null ? `${Math.round(v)}${unit}` : "—";
      const card = h.windDirectionCardinal || "";
      const wind = h.windSpeed != null ? `${h.windSpeed} km/h ${card}`.trim() : "—";
      const dew  = this._dew[i];
      const warn = this.warningAt(i);
      return [
        `<div class="tt-time">${ts}</div>`,
        warn ? row("Warning", `<span style="color:${rgba(WARN_RGB[warn.level], 1)}">●</span> ${escapeHTML(warn.headline)}`) : "",
        row("Temp",          fmtR(h.temperature,          "°")),
        row("Feels like",    fmtR(h.temperatureFeelsLike, "°")),
        row("Condition",     h.wxPhraseMedium || "—"),
        row("Humidity",      fmt(h.relativeHumidity,      "%")),
        row("Dew point",     dew != null ? `${Math.round(dew)}° ${WI.dewComfort(dew)}` : "—"),
        row("Wind",          wind),
        row("Gusts",         h.windGust != null ? `${h.windGust} km/h` : "—"),
        row("Rain chance",   fmt(h.precipChance,          "%")),
        row("Precipitation", h.qpf > 0    ? `${h.qpf} mm` : "—"),
        row("Pressure",      h.pressureMeanSeaLevel != null
          ? `${Math.round(h.pressureMeanSeaLevel)} hPa` : "—"),
        row("UV index",      h.uvIndex != null ? String(h.uvIndex) : "—"),
        row("Cloud cover",   fmt(h.cloudCover,            "%")),
      ].join("");
    }

    // ── Scroll helpers ─────────────────────────────────────────────────────
    /** Scroll so "now" is ~30% from the left edge. */
    scrollToNow(scrollContainer) {
      scrollContainer.scrollLeft = this.hourX(this._nowIdx) - scrollContainer.clientWidth * 0.3;
    }

    /** Scroll so hour `i` sits at the left edge. */
    scrollToHour(scrollContainer, i, smooth) {
      scrollContainer.scrollTo({ left: PAD.left + i * this._pph, behavior: smooth ? "smooth" : "auto" });
    }

    /** The UTC time at the left edge of the view (hour i's left edge is hours[i].validTimeUtc). */
    timeAtScroll(scrollLeft) {
      return this.hours[0].validTimeUtc + (scrollLeft - PAD.left) / this._pph * 3600;
    }

    /** Scroll so UTC time `t` sits at the left edge: restores a place saved with timeAtScroll(). */
    scrollToTime(scrollContainer, t) {
      scrollContainer.scrollLeft = PAD.left + (t - this.hours[0].validTimeUtc) / 3600 * this._pph;
    }

    /** The part of the series in view, as fractions 0–1 of all hours. */
    visibleFraction(scrollLeft, viewport) {
      const total = this.hours.length * this._pph;
      if (total <= 0) return [0, 1];
      const a = clamp((scrollLeft - PAD.left) / total, 0, 1);
      const b = clamp((scrollLeft + viewport - PAD.left) / total, a, 1);
      return [a, b];
    }

    /** First hour to scroll to so the window is centred on `fraction` of the series. */
    browseStartHour(fraction, viewport) {
      const vis    = Math.min(this.hours.length, Math.round((viewport - PAD.left - PAD.right) / this._pph));
      const centre = clamp(fraction, 0, 1) * this.hours.length;
      return clamp(Math.round(centre - vis / 2), 0, Math.max(0, this.hours.length - vis));
    }
  }

  global.WeatherChart = WeatherChart;

})(window);
