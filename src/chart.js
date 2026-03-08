/**
 * chart.js — WeatherGraph-style canvas chart renderer.
 *
 * Layers (bottom → top):
 *   1. Background (day/night gradient bands)
 *   2. Cloud cover (blurred translucent ellipses)
 *   3. Temperature area (smooth filled region between temp & feels-like)
 *   4. Temperature line (orange smooth curve)
 *   5. Feels-like line (cyan dashed)
 *   6. Precipitation bars (green → amber → red)
 *   7. Wind indicators  ← **user contribution below**
 *   8. Pressure line (secondary axis, dashed)
 *   9. "Now" marker (vertical gradient line)
 *  10. Day dividers + labels
 *  11. Time axis (hours)
 *  12. Temperature labels at peaks/troughs
 */

(function (global) {
  "use strict";

  // ── Layout constants ─────────────────────────────────────────────────────
  // PX_PER_HOUR is now computed per-instance in _setup() as this._pph.
  // The value is derived from the scroll-container viewport width so that
  // exactly meta.days days fill the visible area without scrolling.

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

  // ── Colour helpers ───────────────────────────────────────────────────────
  const C = {
    bg:         "#09131f",
    bgDay:      "rgba(28,74,150,0.14)",
    tempFill:   ["rgba(255,160,30,0.05)", "rgba(255,140,20,0.38)"],
    tempLine:   "#ffa820",
    feelsLine:  "rgba(60,220,255,0.75)",
    precipLow:  "#30d67a",
    precipMid:  "#f0b030",
    precipHi:   "#ff5055",
    pressLine:  "rgba(255,255,255,0.32)",
    nowLine:    "rgba(255,255,255,0.65)",
    grid:       "rgba(255,255,255,0.06)",
    dayDiv:     "rgba(255,255,255,0.10)",
    text:       "#e4eaf4",
    textMuted:  "#5a7a9a",
  };

  // ── Utility ──────────────────────────────────────────────────────────────
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function lerp(a, b, t)    { return a + (b - a) * t; }

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
   * If `close` is true, closes the path after last point.
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
     * @param {object[]} hours  Hourly forecast data array.
     * @param {object}   meta   { sunriseUtc, sunsetUtc } (UTC unix seconds)
     */
    constructor(canvas, hours, meta = {}) {
      this.canvas = canvas;
      this.hours  = hours;
      this.meta   = meta;
      this._dpr   = window.devicePixelRatio || 1;
      this._setup();
    }

    // ── Setup ──────────────────────────────────────────────────────────────
    _setup() {
      const { hours } = this;
      // Compute px-per-hour from the scroll-container viewport width so that
      // exactly meta.days days fill the visible area without horizontal scrolling.
      const days     = (this.meta && this.meta.days) || 2;
      const viewport = (this.canvas.parentElement && this.canvas.parentElement.clientWidth) || 900;
      this._pph = Math.max(8, (viewport - PAD.left - PAD.right) / (days * 24));
      const W = PAD.left + hours.length * this._pph + PAD.right;
      const H = ZONE.height;

      this.canvas.style.width  = W + "px";
      this.canvas.style.height = H + "px";
      this.canvas.width  = W * this._dpr;
      this.canvas.height = H * this._dpr;

      this.ctx = this.canvas.getContext("2d");
      this.ctx.scale(this._dpr, this._dpr);

      this.W = W;
      this.H = H;

      // Compute temperature range across all hours
      const temps = hours.map(h => h.temperature).filter(v => v != null);
      const feels = hours.map(h => h.temperatureFeelsLike).filter(v => v != null);
      const all   = [...temps, ...feels];
      this._tMin  = Math.min(...all) - 2;
      this._tMax  = Math.max(...all) + 2;

      // Compute pressure range
      const pvals = hours.map(h => h.pressureMeanSeaLevel).filter(v => v != null);
      this._pMin  = pvals.length ? Math.min(...pvals) - 2 : 1000;
      this._pMax  = pvals.length ? Math.max(...pvals) + 2 : 1030;

      // Max precipitation for bar scaling
      const qpfs  = hours.map(h => h.qpf || 0);
      this._qMax  = Math.max(1, ...qpfs);

      // "Now" index
      const nowSec = Date.now() / 1000;
      this._nowIdx = hours.findIndex(h => (h.validTimeUtc || 0) >= nowSec);
      if (this._nowIdx < 0) this._nowIdx = 0;
    }

    // ── Coordinate helpers ────────────────────────────────────────────────
    hourX(i)   { return PAD.left + i * this._pph + this._pph / 2; }
    tempY(t)   { return ZONE.tempBot - (t - this._tMin) / (this._tMax - this._tMin) * (ZONE.tempBot - ZONE.tempTop); }
    pressY(p)  { return ZONE.tempBot - (p - this._pMin) / (this._pMax - this._pMin) * (ZONE.tempBot - ZONE.tempTop); }

    // ── Render entry point ─────────────────────────────────────────────────
    render() {
      const { ctx } = this;
      ctx.clearRect(0, 0, this.W, this.H);

      this._drawBackground();
      this._drawCloudCover();
      this._drawTemperatureArea();
      this._drawTemperatureLine();
      this._drawFeelsLikeLine();
      this._drawPressureLine();
      this.drawWindIndicators(ctx, this.hours, this._windLayout());
      this._drawPrecipBars();
      this._drawDayDividers();
      this._drawNowMarker();
      this._drawTimeAxis();
      this._drawDayAxis();
      this._drawTempLabels();
    }

    // ── 1. Background ─────────────────────────────────────────────────────
    _drawBackground() {
      const { ctx, W, H, hours } = this;

      // Base dark fill
      ctx.fillStyle = C.bg;
      ctx.fillRect(0, 0, W, H);

      // Subtle day bands
      for (let i = 0; i < hours.length; i++) {
        if (hours[i].dayOrNight === "D") {
          ctx.fillStyle = C.bgDay;
          ctx.fillRect(PAD.left + i * this._pph, 0, this._pph, H);
        }
      }

      // Subtle horizontal grid lines in temp zone
      ctx.strokeStyle = C.grid;
      ctx.lineWidth   = 0.5;
      const step = Math.ceil((this._tMax - this._tMin) / 5);
      for (let t = Math.ceil(this._tMin); t <= this._tMax; t += step) {
        const y = this.tempY(t);
        ctx.beginPath();
        ctx.moveTo(0, y); ctx.lineTo(W, y);
        ctx.stroke();
      }

      // Swimlane separator lines between main / wind / precip zones
      ctx.strokeStyle = "rgba(255,255,255,0.28)";
      ctx.lineWidth   = 2;
      [ZONE.windTop, ZONE.precipTop].forEach(y => {
        ctx.beginPath();
        ctx.moveTo(0, y); ctx.lineTo(W, y);
        ctx.stroke();
      });
    }

    // ── 2. Cloud cover ────────────────────────────────────────────────────
    _drawCloudCover() {
      const { ctx, hours } = this;
      ctx.save();
      ctx.filter = "blur(18px)";
      for (let i = 0; i < hours.length; i++) {
        const cc = (hours[i].cloudCover || 0) / 100;
        if (cc < 0.15) continue;
        const x  = this.hourX(i);
        const ry = 14 * cc;
        ctx.fillStyle = `rgba(210,230,255,${cc * 0.22})`;
        ctx.beginPath();
        ctx.ellipse(x, (ZONE.cloudTop + ZONE.cloudBot) / 2, this._pph * 0.7, ry, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.filter = "none";
      ctx.restore();
    }

    // ── 3. Temperature area ───────────────────────────────────────────────
    _drawTemperatureArea() {
      const { ctx, hours } = this;
      const tPts = hours.map((h, i) => ({ x: this.hourX(i), y: this.tempY(h.temperature ?? 0) }));
      const fPts = hours.map((h, i) => ({ x: this.hourX(i), y: this.tempY(h.temperatureFeelsLike ?? 0) }));

      const grad = ctx.createLinearGradient(0, ZONE.tempTop, 0, ZONE.tempBot);
      grad.addColorStop(0, C.tempFill[1]);
      grad.addColorStop(1, C.tempFill[0]);

      ctx.save();
      ctx.beginPath();
      smoothPath(ctx, tPts);
      smoothPath(ctx, [...fPts].reverse(), false);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.restore();
    }

    // ── 4. Temperature line ───────────────────────────────────────────────
    _drawTemperatureLine() {
      const { ctx, hours } = this;
      const pts = hours.map((h, i) => ({ x: this.hourX(i), y: this.tempY(h.temperature ?? 0) }));
      ctx.save();
      ctx.beginPath();
      smoothPath(ctx, pts);
      ctx.strokeStyle = C.tempLine;
      ctx.lineWidth   = 2.5;
      ctx.lineJoin    = "round";
      ctx.stroke();
      ctx.restore();
    }

    // ── 5. Feels-like line ────────────────────────────────────────────────
    _drawFeelsLikeLine() {
      const { ctx, hours } = this;
      const pts = hours.map((h, i) => ({ x: this.hourX(i), y: this.tempY(h.temperatureFeelsLike ?? 0) }));
      ctx.save();
      ctx.beginPath();
      smoothPath(ctx, pts);
      ctx.strokeStyle = C.feelsLine;
      ctx.lineWidth   = 1.5;
      ctx.setLineDash([5, 5]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    // ── 6. Pressure line (right-aligned scale) ────────────────────────────
    _drawPressureLine() {
      const { ctx, hours } = this;
      const pts = hours
        .map((h, i) => h.pressureMeanSeaLevel != null
          ? { x: this.hourX(i), y: this.pressY(h.pressureMeanSeaLevel) }
          : null)
        .filter(Boolean);
      if (!pts.length) return;

      ctx.save();
      ctx.beginPath();
      smoothPath(ctx, pts);
      ctx.strokeStyle = C.pressLine;
      ctx.lineWidth   = 1.2;
      ctx.setLineDash([3, 6]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    // ── 7. Precipitation: qpf bars + precipChance line/area ───────────────
    // Two separate visual channels:
    //   • precipChance (probability) → amber Catmull-Rom line + semi-transparent area
    //     y-axis: 0% = precipBot, 100% = precipTop (spans the full zone height)
    //   • qpf (actual amount)        → solid bars, height proportional to _qMax
    // Drawing order: area fill → bars → line (probability context behind, facts in front)
    _drawPrecipBars() {
      const { ctx, hours } = this;
      const barW  = Math.max(2, this._pph * 0.45);
      const zoneH = ZONE.precipBot - ZONE.precipTop;

      // Map precipChance percentage to canvas y within the precip zone
      const probY = pct => ZONE.precipBot - (pct / 100) * zoneH;

      // Build point array once — reused for both area fill and line stroke
      const pts = hours.map((h, i) => ({
        x: this.hourX(i),
        y: probY(h.precipChance || 0),
      }));

      // ── Pass 1: precipChance area fill ─────────────────────────────────
      const areaGrad = ctx.createLinearGradient(0, ZONE.precipTop, 0, ZONE.precipBot);
      areaGrad.addColorStop(0,   "rgba(60,150,255,0.22)");
      areaGrad.addColorStop(1,   "rgba(60,150,255,0.02)");
      ctx.beginPath();
      smoothPath(ctx, pts);
      ctx.lineTo(pts[pts.length - 1].x, ZONE.precipBot);   // down to bottom-right
      ctx.lineTo(pts[0].x,              ZONE.precipBot);   // across to bottom-left
      ctx.closePath();
      ctx.fillStyle = areaGrad;
      ctx.fill();

      // ── Pass 2: qpf bars (actual rain only — skips probability-only hours) ─
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
      ctx.strokeStyle = "rgba(60,150,255,0.85)";
      ctx.lineWidth   = 1.5;
      ctx.shadowColor = "rgba(60,150,255,0.4)";
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
     *               .x(i)   → canvas X centre for hour i
     *               .midY   → vertical centre of the wind zone (288 px)
     *               .height → total height of wind zone (33 px)
     *
     * The WeatherGraph style draws:
     *   • A dashed red/pink horizontal baseline across the zone
     *   • Every 3rd hour: a small filled arrowhead pointing in the
     *     direction the wind is BLOWING TOWARD (i.e. 180° from "from")
     *   • Arrow size scales with wind speed
     *
     * Feel free to experiment — wind barbs, colour-coded circles, or
     * flowing streamlines all work well here.
     */
    drawWindIndicators(ctx, hours, layout) {
      ctx.save();

      const INTERVAL = 3;   // draw an arrow every 3rd hour
      const MAX_SPD  = 90;  // km/h ceiling — 30 km/h lands at exactly 1/3 height
      const zoneH    = ZONE.windBot - ZONE.windTop;

      // Map speed → Y inside the wind zone (0 km/h = windBot, MAX_SPD = windTop)
      const windY = spd => ZONE.windBot - (clamp(spd || 0, 0, MAX_SPD) / MAX_SPD) * zoneH;

      // Build point array for the speed curve
      const pts = hours.map((h, i) => ({
        x: layout.x(i),
        y: windY(h.windSpeed || 0),
      }));

      // ── Pass 1: fill area under speed curve ─────────────────────────────
      const fillGrad = ctx.createLinearGradient(0, ZONE.windTop, 0, ZONE.windBot);
      fillGrad.addColorStop(0, "rgba(220,60,50,0.22)");
      fillGrad.addColorStop(1, "rgba(220,60,50,0.03)");
      ctx.beginPath();
      smoothPath(ctx, pts);
      ctx.lineTo(pts[pts.length - 1].x, ZONE.windBot);
      ctx.lineTo(pts[0].x, ZONE.windBot);
      ctx.closePath();
      ctx.fillStyle = fillGrad;
      ctx.fill();

      // ── Pass 2: speed line ───────────────────────────────────────────────
      ctx.beginPath();
      smoothPath(ctx, pts);
      ctx.strokeStyle = "rgba(255,90,70,0.60)";
      ctx.lineWidth   = 1.5;
      ctx.shadowColor = "rgba(255,80,60,0.35)";
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

        ctx.strokeStyle = "rgba(255,90,70,0.85)";
        ctx.fillStyle   = "rgba(255,90,70,0.85)";
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
        x:      (i) => self.hourX(i),
        midY:   (ZONE.windTop + ZONE.windBot) / 2,
        height: ZONE.windBot - ZONE.windTop,
      };
    }

    // ── 9. Day dividers ────────────────────────────────────────────────────
    _drawDayDividers() {
      const { ctx, H, hours } = this;
      ctx.save();
      for (let i = 1; i < hours.length; i++) {
        const h   = hours[i];
        const h0  = hours[i - 1];
        // Detect local midnight crossing (UTC→NZ date change)
        const d0  = new Date((h0.validTimeUtc || 0) * 1000).toLocaleDateString("en-NZ", { timeZone: "Pacific/Auckland" });
        const d1  = new Date((h.validTimeUtc  || 0) * 1000).toLocaleDateString("en-NZ", { timeZone: "Pacific/Auckland" });
        if (d0 === d1) continue;

        const x = this.hourX(i) - this._pph / 2;

        // Vertical divider (day name is now rendered in _drawTimeAxis at midnight)
        ctx.strokeStyle = C.dayDiv;
        ctx.lineWidth   = 1;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(x, ZONE.tempTop); ctx.lineTo(x, ZONE.precipBot);
        ctx.stroke();
      }
      ctx.restore();
    }

    // ── 10. Now marker ─────────────────────────────────────────────────────
    _drawNowMarker() {
      const { ctx, H } = this;
      const idx = this._nowIdx;
      if (idx < 0) return;

      const x = this.hourX(idx);

      // Gradient vertical line
      const grad = ctx.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0,   "rgba(255,255,255,0)");
      grad.addColorStop(0.2, C.nowLine);
      grad.addColorStop(0.8, C.nowLine);
      grad.addColorStop(1,   "rgba(255,255,255,0)");

      ctx.save();
      ctx.strokeStyle = grad;
      ctx.lineWidth   = 1.5;
      ctx.beginPath();
      ctx.moveTo(x, 0); ctx.lineTo(x, H);
      ctx.stroke();

      // "NOW" label
      ctx.fillStyle = "rgba(255,255,255,0.7)";
      ctx.font      = "bold 9px -apple-system, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("NOW", x, 14);

      // Small circle
      ctx.beginPath();
      ctx.arc(x, ZONE.tempTop + 4, 3, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      ctx.restore();
    }

    // ── 11. Time axis ──────────────────────────────────────────────────────
    _drawTimeAxis() {
      const { ctx, hours } = this;
      ctx.save();
      ctx.textAlign = "center";

      for (let i = 0; i < hours.length; i++) {
        const ts = hours[i].validTimeUtc;
        if (!ts) continue;

        const d    = new Date(ts * 1000);
        // % 24 guards against the ICU quirk where midnight returns "24" not "0"
        const hour = +d.toLocaleString("en-NZ", { timeZone: "Pacific/Auckland", hour: "numeric", hour12: false }) % 24;

        // Show label every 3 hours
        if (hour % 3 !== 0) continue;

        const x = this.hourX(i);

        if (hour === 0) {
          // Midnight — the day axis strip handles day labelling; show "12am" like any hour
          ctx.font      = "10px -apple-system, sans-serif";
          ctx.fillStyle = C.textMuted;
          ctx.fillText("12am", x, ZONE.timeTop + 13);
        } else {
          const lbl = hour === 12 ? "12pm" : hour > 12 ? `${hour - 12}pm` : `${hour}am`;
          ctx.font      = "10px -apple-system, sans-serif";
          ctx.fillStyle = C.textMuted;
          ctx.fillText(lbl, x, ZONE.timeTop + 13);
        }
      }
      ctx.restore();
    }

    // ── 12. Temperature labels at peaks & troughs ─────────────────────────
    _drawTempLabels() {
      const { ctx, hours } = this;
      ctx.save();
      ctx.font       = "bold 11px -apple-system, sans-serif";
      ctx.textAlign  = "center";
      ctx.lineWidth  = 3;

      for (let i = 1; i < hours.length - 1; i++) {
        const prev = hours[i - 1].temperature ?? 0;
        const curr = hours[i].temperature     ?? 0;
        const next = hours[i + 1].temperature ?? 0;

        const isPeak   = curr > prev && curr > next;
        const isTrough = curr < prev && curr < next;

        if (!isPeak && !isTrough) continue;

        const x    = this.hourX(i);
        const y    = this.tempY(curr) + (isPeak ? -6 : 14);
        const lbl  = `${Math.round(curr)}°`;

        ctx.strokeStyle = "rgba(9,19,31,0.7)";
        ctx.strokeText(lbl, x, y);
        ctx.fillStyle   = isPeak ? C.tempLine : C.feelsLine;
        ctx.fillText(lbl, x, y);
      }
      ctx.restore();
    }

    // ── 11b. Day axis (below hours) ────────────────────────────────────────
    _drawDayAxis() {
      const { ctx, hours, W } = this;
      ctx.save();

      // Slightly darkened background strip
      ctx.fillStyle = "rgba(0,0,0,0.18)";
      ctx.fillRect(0, ZONE.dayAxisTop, W, ZONE.height - ZONE.dayAxisTop);

      // Top border
      ctx.strokeStyle = C.dayDiv;
      ctx.lineWidth   = 1;
      ctx.beginPath();
      ctx.moveTo(0, ZONE.dayAxisTop);
      ctx.lineTo(W, ZONE.dayAxisTop);
      ctx.stroke();

      // Collect first hour-index for each calendar day
      const boundaries = [0];
      for (let i = 1; i < hours.length; i++) {
        const d0 = new Date((hours[i - 1].validTimeUtc || 0) * 1000)
          .toLocaleDateString("en-NZ", { timeZone: "Pacific/Auckland" });
        const d1 = new Date((hours[i].validTimeUtc  || 0) * 1000)
          .toLocaleDateString("en-NZ", { timeZone: "Pacific/Auckland" });
        if (d0 !== d1) boundaries.push(i);
      }
      boundaries.push(hours.length); // sentinel

      ctx.textAlign = "center";
      for (let b = 0; b < boundaries.length - 1; b++) {
        const startI = boundaries[b];
        const endI   = boundaries[b + 1] - 1;

        const x0   = this.hourX(startI) - this._pph / 2;
        const x1   = this.hourX(endI)   + this._pph / 2;
        const cx   = (x0 + x1) / 2;
        const pixW = x1 - x0;

        const d       = new Date((hours[startI].validTimeUtc || 0) * 1000);
        const weekday = d.toLocaleDateString("en-NZ", {
          timeZone: "Pacific/Auckland",
          weekday:  pixW > 100 ? "long" : "short",
        });

        ctx.font      = "bold 9px -apple-system, sans-serif";
        ctx.fillStyle = C.text;
        ctx.fillText(weekday, cx, ZONE.dayAxisTop + 12);

        // Vertical divider between days
        if (b > 0) {
          const divX = this.hourX(boundaries[b]) - this._pph / 2;
          ctx.strokeStyle = C.dayDiv;
          ctx.lineWidth   = 1;
          ctx.beginPath();
          ctx.moveTo(divX, ZONE.dayAxisTop);
          ctx.lineTo(divX, ZONE.height);
          ctx.stroke();
        }
      }

      ctx.restore();
    }

    // ── Hover tooltip ──────────────────────────────────────────────────────
    /**
     * Attach cursor-line + tooltip hover to the chart scroll container.
     * Creates an overlay canvas for the hover line (avoids repainting the
     * main canvas) and a floating <div> for the data tooltip.
     * @param {HTMLElement} scrollContainer
     */
    initHover(scrollContainer, signal) {
      const section = scrollContainer.parentElement; // .chart-section
      const hours   = this.hours;
      const self    = this;
      const TZ      = "Pacific/Auckland";

      // Overlay canvas (pointer-events: none — mouse passes through)
      const overlay = document.createElement("canvas");
      overlay.style.cssText =
        "position:absolute;top:0;left:0;pointer-events:none;" +
        `width:${this.W}px;height:${this.H}px;`;
      overlay.width  = this.W * this._dpr;
      overlay.height = this.H * this._dpr;
      scrollContainer.style.position = "relative";
      scrollContainer.appendChild(overlay);
      const oc = overlay.getContext("2d");
      oc.scale(this._dpr, this._dpr);

      // Tooltip element (absolute within chart-section)
      const tip = document.createElement("div");
      tip.id = "chart-tooltip";
      section.appendChild(tip);

      function showHover(e) {
        const rect   = scrollContainer.getBoundingClientRect();
        const mouseX = e.clientX - rect.left + scrollContainer.scrollLeft;
        const rawIdx = Math.round((mouseX - PAD.left - self._pph / 2) / self._pph);
        const i      = Math.max(0, Math.min(hours.length - 1, rawIdx));
        const h      = hours[i];

        // Draw cursor line on overlay canvas
        oc.clearRect(0, 0, self.W, self.H);
        const x    = self.hourX(i);
        const grad = oc.createLinearGradient(0, 0, 0, self.H);
        grad.addColorStop(0,    "rgba(255,255,255,0)");
        grad.addColorStop(0.08, "rgba(255,255,255,0.55)");
        grad.addColorStop(0.92, "rgba(255,255,255,0.55)");
        grad.addColorStop(1,    "rgba(255,255,255,0)");
        oc.save();
        oc.strokeStyle = grad;
        oc.lineWidth   = 1;
        oc.beginPath();
        oc.moveTo(x, 0);
        oc.lineTo(x, self.H);
        oc.stroke();

        // Dot on the temperature curve
        const ty = self.tempY(h.temperature ?? 0);
        oc.fillStyle = C.tempLine;
        oc.beginPath();
        oc.arc(x, ty, 4, 0, Math.PI * 2);
        oc.fill();
        oc.restore();

        // Build and position the tooltip
        const ts = h.validTimeUtc
          ? new Date(h.validTimeUtc * 1000).toLocaleString("en-NZ", {
              timeZone: TZ, weekday: "short", month: "short",
              day: "numeric", hour: "numeric", minute: "2-digit", hour12: true,
            })
          : "";

        tip.innerHTML     = self._tooltipHTML(h, ts);
        tip.style.display = "block";

        // Flip tooltip left when near the right edge
        const sectionRect = section.getBoundingClientRect();
        const cursorLeft  = e.clientX - sectionRect.left;
        const TIP_W       = 210;
        const flip        = cursorLeft + TIP_W + 20 > sectionRect.width;
        tip.style.left    = (flip ? cursorLeft - TIP_W - 12 : cursorLeft + 16) + "px";
        tip.style.top     = "24px";
      }

      function hideHover() {
        oc.clearRect(0, 0, self.W, self.H);
        tip.style.display = "none";
      }

      scrollContainer.addEventListener("mousemove",  showHover,  { signal });
      scrollContainer.addEventListener("mouseleave", hideHover, { signal });
    }

    /** @private HTML content for the hover tooltip. */
    _tooltipHTML(h, ts) {
      const row  = (lbl, val) =>
        `<div class="tt-row"><span class="tt-label">${lbl}</span><span class="tt-val">${val}</span></div>`;
      const fmt  = (v, unit) => v != null ? `${v}${unit}` : "—";
      const fmtR = (v, unit) => v != null ? `${Math.round(v)}${unit}` : "—";
      const card = h.windDirectionCardinal || "";
      const wind = h.windSpeed != null ? `${h.windSpeed} km/h ${card}`.trim() : "—";
      return [
        `<div class="tt-time">${ts}</div>`,
        row("Temp",          fmtR(h.temperature,          "°")),
        row("Feels like",    fmtR(h.temperatureFeelsLike, "°")),
        row("Condition",     h.wxPhraseMedium || "—"),
        row("Humidity",      fmt(h.relativeHumidity,      "%")),
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

    // ── Scroll helper ─────────────────────────────────────────────────────
    /**
     * Scroll the parent container so "now" is ~30% from the left edge.
     * @param {HTMLElement} scrollContainer
     */
    scrollToNow(scrollContainer) {
      const nowX = this.hourX(this._nowIdx);
      scrollContainer.scrollLeft = nowX - scrollContainer.clientWidth * 0.3;
    }
  }

  global.WeatherChart = WeatherChart;

})(window);
