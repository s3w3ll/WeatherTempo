/**
 * app.js — Initialises the WeatherTempo dashboard.
 *
 * Flow:
 *  1. Fetch data/weather.json (generated every 30 min by GitHub Actions).
 *  2. Populate the conditions card (current temp, high/low + times, stats,
 *     astronomy, tides).
 *  3. Render the WeatherGraph-style canvas chart.
 *  4. Draw the tide mini-chart (see TODO below).
 *
 * If the JSON is empty or unavailable, fall back to synthetic sample data
 * so the page always renders something useful.
 */

(function () {
  "use strict";

  const TZ = "Pacific/Auckland";

  // ── Live refresh (Cloudflare Worker proxy) ───────────────────────────────
  // Paste the Worker URL here after running `npx wrangler deploy` in /workers.
  // Leave blank to disable live refresh (card shows JSON data only).
  const WORKER_URL = "https://weathertempo-pws-proxy.forgesync.workers.dev";
  const REFRESH_INTERVAL_MS = 5 * 60 * 1000;   // 5 minutes

  // ── Formatters ───────────────────────────────────────────────────────────
  function fmtTime(utcSec, opts = {}) {
    if (!utcSec) return "—";
    return new Date(utcSec * 1000).toLocaleTimeString("en-NZ", { timeZone: TZ, ...opts });
  }

  function fmtShortTime(utcSec) {
    return fmtTime(utcSec, { hour: "numeric", minute: "2-digit", hour12: true });
  }

  function fmtHourOnly(utcSec) {
    return fmtTime(utcSec, { hour: "numeric", hour12: true });
  }

  function fmtRelative(isoStr) {
    if (!isoStr) return "—";
    const diff = (Date.now() - new Date(isoStr).getTime()) / 60000; // minutes
    if (diff < 2)  return "just now";
    if (diff < 60) return `${Math.round(diff)} min ago`;
    const h = Math.round(diff / 60);
    return `${h}h ago`;
  }

  // ── Moon phase ──────────────────────────────────────────────────────────
  const MOON_EMOJI = {
    NM: "🌑", WNM: "🌑",
    WXC: "🌒",
    FQ:  "🌓",
    WXG: "🌔",
    FM:  "🌕",
    WNG: "🌖",
    LQ:  "🌗",
    WNC: "🌘",
  };

  // ── UV label ─────────────────────────────────────────────────────────────
  function uvLabel(idx) {
    if (idx == null) return "—";
    if (idx <= 2)  return `${idx} Low`;
    if (idx <= 5)  return `${idx} Mod`;
    if (idx <= 7)  return `${idx} High`;
    if (idx <= 10) return `${idx} V.High`;
    return `${idx} Extreme`;
  }

  // ── UV info (today's peak + UV≥4 window) ─────────────────────────────────
  /**
   * Returns:
   *   peakUV   — highest UV index in today's remaining forecast hours
   *   uvWindow — "10am–3pm" string covering all contiguous UV≥4 hours today,
   *              or null when UV stays below 4 all day
   */
  function uvInfo(hourly) {
    const nowDate = new Date().toLocaleDateString("en-NZ", {
      timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
    });
    const todayHours = hourly.filter(h => {
      if (!h.validTimeUtc) return false;
      return new Date(h.validTimeUtc * 1000)
        .toLocaleDateString("en-NZ", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }) === nowDate;
    });

    const peakUV = todayHours.length
      ? Math.max(...todayHours.map(h => h.uvIndex ?? 0))
      : null;

    // Build the UV≥4 window: first start → last slot end (start + 1 hour)
    const highHours = todayHours.filter(h => (h.uvIndex ?? 0) >= 4);
    let uvWindow = null;
    if (highHours.length) {
      const fmt = utcSec => new Date(utcSec * 1000)
        .toLocaleTimeString("en-NZ", { timeZone: TZ, hour: "numeric", hour12: true });
      const startTs = highHours[0].validTimeUtc;
      const endTs   = highHours[highHours.length - 1].validTimeUtc + 3600; // +1 hour
      uvWindow = `${fmt(startTs)}–${fmt(endTs)}`;
    }

    return { peakUV, uvWindow };
  }

  // ── Today high/low ────────────────────────────────────────────────────────
  // Uses calendarDayTemperatureMax/Min from daily[0] for midnight-to-midnight
  // accuracy (these values never go null, unlike temperatureMax which goes null
  // after the daily peak has passed). Times of occurrence are derived from the
  // hourly forecast window only when the peak is still upcoming (i.e. the
  // forecast's max/min is within 1° of the calendar-day value).
  function todayHighLow(hourly, daily) {
    const d0     = (daily || [])[0];
    const calMax = d0?.calendarDayTemperatureMax ?? null;
    const calMin = d0?.calendarDayTemperatureMin ?? null;

    // Filter today's hours from the hourly forecast (contains only future hours)
    const nowDate = new Date().toLocaleDateString("en-NZ", {
      timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
    });
    const todayHours = hourly.filter(h => {
      if (!h.validTimeUtc) return false;
      return new Date(h.validTimeUtc * 1000)
        .toLocaleDateString("en-NZ", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }) === nowDate;
    });

    // Resolve times: only show a time if the extremum is still in the forecast
    // window — if the forecast peak matches the calendar-day peak (within 1°),
    // the event is upcoming; otherwise it already occurred ("—" is shown).
    let hiTime = null, loTime = null;
    if (todayHours.length) {
      const fHi = todayHours.reduce((a, b) => (a.temperature > b.temperature ? a : b));
      const fLo = todayHours.reduce((a, b) => (a.temperature < b.temperature ? a : b));
      if (calMax != null && Math.abs(fHi.temperature - calMax) <= 1) hiTime = fHi.validTimeUtc;
      if (calMin != null && Math.abs(fLo.temperature - calMin) <= 1) loTime = fLo.validTimeUtc;
    }

    // Fall back to hourly-only values if daily data isn't present
    const highTemp = calMax ?? (todayHours.length ? Math.max(...todayHours.map(h => h.temperature)) : null);
    const lowTemp  = calMin ?? (todayHours.length ? Math.min(...todayHours.map(h => h.temperature)) : null);

    if (highTemp == null && lowTemp == null) return null;
    return {
      high: { temp: highTemp, utcSec: hiTime },
      low:  { temp: lowTemp,  utcSec: loTime },
    };
  }

  // ── Populate conditions card ──────────────────────────────────────────────
  function populateCard(data) {
    const c = data.current || {};
    const t = data.today   || {};

    // Header
    const el = id => document.getElementById(id);
    el("last-updated").textContent = fmtRelative(data.meta?.updated);

    // Current temp + condition
    el("current-temp").textContent     = c.temp  != null ? `${Math.round(c.temp)}°` : "—°";
    el("current-condition").textContent = c.condition || c.cloudPhrase || "—";
    el("current-feels").textContent    = c.feelsLike != null ? `Feels like ${Math.round(c.feelsLike)}°` : "";

    // Today high / low — uses calendarDay values from daily[0] for whole-day accuracy
    const hl = todayHighLow(data.hourly || [], data.daily || []);
    if (hl) {
      el("today-high").textContent      = `${Math.round(hl.high.temp)}°`;
      el("today-high-time").textContent = fmtHourOnly(hl.high.utcSec);
      el("today-low").textContent       = `${Math.round(hl.low.temp)}°`;
      el("today-low-time").textContent  = fmtHourOnly(hl.low.utcSec);
    } else if (c.tempMax24h != null) {
      el("today-high").textContent = `${Math.round(c.tempMax24h)}°`;
      el("today-low").textContent  = `${Math.round(c.tempMin24h)}°`;
    }

    // Stats
    el("humidity").textContent  = c.humidity  != null ? `${c.humidity}%` : "—";
    el("wind").textContent      = c.windSpeed != null ? `${c.windSpeed} km/h` : "—";
    el("wind-dir").textContent  = c.windCardinal || (c.windDirection != null ? degToCard(c.windDirection) : "");
    el("pressure").textContent  = c.pressure   != null ? `${Math.round(c.pressure)} hPa` : "—";

    // UV — current reading + today's peak in brackets + UV≥4 window as sub-label
    const { peakUV, uvWindow } = uvInfo(data.hourly || []);
    const uvBase = uvLabel(c.uvIndex);
    const uvPeak = (peakUV != null && peakUV > (c.uvIndex ?? -1)) ? ` (${uvLabel(peakUV)})` : "";
    el("uv-index").textContent = c.uvIndex != null ? `${uvBase}${uvPeak}` : "—";
    el("uv-label").textContent = uvWindow ? `UV · ${uvWindow}` : "UV";

    // Astronomy
    el("sunrise").textContent    = fmtShortTime(c.sunriseUtc);
    el("sunset").textContent     = fmtShortTime(c.sunsetUtc);
    el("moon-phase").textContent = t.moonPhase || "—";
    el("moon-emoji").textContent = MOON_EMOJI[t.moonPhaseCode] || "🌕";

    // Tides
    populateTides();
  }

  function degToCard(deg) {
    const dirs = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];
    return dirs[Math.round(deg / 22.5) % 16];
  }

  // ── Live refresh helpers ──────────────────────────────────────────────────

  /**
   * Merge live PWS payload onto existing data.current, preserving fields the
   * Worker does not supply (condition, sunriseUtc, sunsetUtc, moonPhase, …).
   */
  function buildCurrentFromPws(payload, existing) {
    return Object.assign({}, existing, {
      temp:          payload.temp,
      feelsLike:     payload.feelsLike,
      humidity:      payload.humidity,
      windSpeed:     payload.windSpeed,
      windGust:      payload.windGust,
      windDirection: payload.windDirection,
      windCardinal:  payload.windCardinal,
      pressure:      payload.pressure,
      uvIndex:       payload.uvIndex,
      // Only overwrite condition when Worker returned one — preserves weather.json
      // value as fallback if Open-Meteo is temporarily unavailable.
      ...(payload.condition != null && { condition: payload.condition }),
    });
  }

  /**
   * Push live values to the DOM — only the 7 elements that the Worker covers.
   * Does NOT touch: current-condition, today-high/low, sunrise, sunset, moon-*.
   * hourly — the forecast array (unchanged between ticks, used for UV peak/window).
   */
  function updateLiveFields(c, fetchedAt, hourly) {
    const el = id => document.getElementById(id);
    el("current-temp").textContent  = c.temp      != null ? `${Math.round(c.temp)}°`                  : "—°";
    el("current-feels").textContent = c.feelsLike != null ? `Feels like ${Math.round(c.feelsLike)}°`  : "";
    el("humidity").textContent      = c.humidity  != null ? `${c.humidity}%`                          : "—";
    el("wind").textContent          = c.windSpeed != null ? `${c.windSpeed} km/h`                     : "—";
    el("wind-dir").textContent      = c.windCardinal || (c.windDirection != null ? degToCard(c.windDirection) : "");
    el("pressure").textContent      = c.pressure  != null ? `${Math.round(c.pressure)} hPa`           : "—";
    const { peakUV: livePeak, uvWindow: liveWin } = uvInfo(hourly || []);
    const liveBase  = uvLabel(c.uvIndex);
    const livePkStr = (livePeak != null && livePeak > (c.uvIndex ?? -1)) ? ` (${uvLabel(livePeak)})` : "";
    el("uv-index").textContent = c.uvIndex != null ? `${liveBase}${livePkStr}` : "—";
    el("uv-label").textContent = liveWin ? `UV · ${liveWin}` : "UV";
    if (c.condition) el("current-condition").textContent = c.condition;

    // Replace "28 min ago" with "Live · 11:14 am" after first successful tick.
    // obsTimeUtc = when the station recorded; fetchedAt = when Worker ran (fallback).
    if (fetchedAt) {
      const t = new Date(fetchedAt).toLocaleTimeString("en-NZ", {
        timeZone: TZ, hour: "numeric", minute: "2-digit", hour12: true,
      });
      el("last-updated").textContent = `Live · ${t}`;
    }
  }

  /**
   * Start the 5-minute live refresh loop.
   * Fires one tick immediately on page load (no cold-start delay).
   * Errors are swallowed — existing card values remain visible.
   */
  function startLiveRefresh(data) {
    if (!WORKER_URL) return;   // Worker not yet deployed — silently skip

    async function tick() {
      try {
        const resp = await fetch(WORKER_URL, { cache: "no-store" });
        if (!resp.ok) throw new Error(`Worker HTTP ${resp.status}`);
        const payload = await resp.json();
        if (payload.error) throw new Error(payload.error);
        data.current = buildCurrentFromPws(payload, data.current);
        // Prefer obsTimeUtc (when station recorded) over fetchedAt (when Worker ran)
        const displayTs = payload.obsTimeUtc ?? payload.fetchedAt;
        updateLiveFields(data.current, displayTs, data.hourly);
      } catch (err) {
        console.warn("[WeatherTempo] Live refresh failed:", err.message);
        // Silent fail — card keeps showing last known values
      }
    }

    tick();                               // immediate first read
    setInterval(tick, REFRESH_INTERVAL_MS);
  }

  // ── Tides ─────────────────────────────────────────────────────────────────
  function populateTides() {
    const list   = document.getElementById("tides-list");
    const canvas = document.getElementById("tide-mini-chart");

    const events = Tides.getNextTides(4);

    if (!events.length) {
      list.innerHTML = '<span class="tide-loading">No tide data available</span>';
      return;
    }

    list.innerHTML = events.map(ev => {
      const isHigh  = ev.type === "high";
      const emoji   = isHigh ? "🌊" : "🏖️";
      const typeStr = isHigh ? "High Tide" : "Low Tide";
      const timeStr = ev.time.toLocaleTimeString("en-NZ", { timeZone: TZ, hour: "numeric", minute: "2-digit", hour12: true });
      return `
        <div class="tide-event">
          <span class="tide-event-icon">${emoji}</span>
          <div class="tide-info">
            <div class="tide-type">${typeStr}</div>
            <div class="tide-time">${timeStr}</div>
          </div>
          <span class="tide-height">${ev.height.toFixed(1)} m</span>
        </div>`;
    }).join("");

    drawTideMiniChart(canvas);
  }

  // ── Tide mini-chart ───────────────────────────────────────────────────────
  /**
   * Draw today's tidal curve on the small canvas in the conditions card.
   *
   * You are invited to implement (or replace) this function!
   *
   * The canvas is 280 × 56 px (logical; HiDPI-scaled below).
   * `pts` is an array of { time: Date, height: number } sampled every 10 min.
   * `events` contains today's { type, time, height } high/low tide objects.
   *
   * Ideas to explore:
   *   • Fill the area under the curve with a gradient (deep ocean tones)
   *   • Annotate high/low tide times with small vertical ticks + labels
   *   • Add a "now" marker showing the current water level
   *   • Use a soft glow effect on the line with ctx.shadowBlur
   */
  function drawTideMiniChart(canvas) {
    const pts    = Tides.getTodayCurve();
    const events = Tides.findTideEvents(
      pts[0].time.getTime(),
      pts[pts.length - 1].time.getTime()
    );

    const dpr = window.devicePixelRatio || 1;
    const W   = canvas.offsetWidth  || 280;
    const H   = canvas.offsetHeight || 56;

    canvas.width  = W * dpr;
    canvas.height = H * dpr;
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);

    const PAD_V = 8;
    const heights = pts.map(p => p.height);
    const hMin    = Math.min(...heights) - 0.1;
    const hMax    = Math.max(...heights) + 0.1;

    const xOf = (i) => (i / (pts.length - 1)) * W;
    const yOf = (h) => H - PAD_V - ((h - hMin) / (hMax - hMin)) * (H - PAD_V * 2);

    // ── Background
    ctx.fillStyle = "rgba(5,15,30,0.6)";
    ctx.fillRect(0, 0, W, H);

    // ── Filled area under curve
    const areaGrad = ctx.createLinearGradient(0, PAD_V, 0, H);
    areaGrad.addColorStop(0,   "rgba(30,140,200,0.5)");
    areaGrad.addColorStop(0.6, "rgba(10,60,120,0.35)");
    areaGrad.addColorStop(1,   "rgba(5,20,50,0.1)");

    ctx.beginPath();
    ctx.moveTo(xOf(0), yOf(pts[0].height));
    for (let i = 1; i < pts.length; i++) {
      const p0 = pts[Math.max(0, i - 2)];
      const p1 = pts[i - 1];
      const p2 = pts[i];
      const p3 = pts[Math.min(pts.length - 1, i + 1)];
      const x1 = xOf(i - 1), y1 = yOf(p1.height);
      const x2 = xOf(i),     y2 = yOf(p2.height);
      const cp1x = x1 + (x2 - xOf(Math.max(0, i - 2))) / 6;
      const cp1y = y1 + (y2 - yOf(p0.height)) / 6;
      const cp2x = x2 - (xOf(Math.min(pts.length - 1, i + 1)) - x1) / 6;
      const cp2y = y2 - (yOf(p3.height) - y1) / 6;
      ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, x2, y2);
    }
    ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath();
    ctx.fillStyle = areaGrad;
    ctx.fill();

    // ── Curve line
    ctx.beginPath();
    ctx.moveTo(xOf(0), yOf(pts[0].height));
    for (let i = 1; i < pts.length; i++) {
      const p0 = pts[Math.max(0, i - 2)];
      const p1 = pts[i - 1];
      const p2 = pts[i];
      const p3 = pts[Math.min(pts.length - 1, i + 1)];
      const x1 = xOf(i - 1), y1 = yOf(p1.height);
      const x2 = xOf(i),     y2 = yOf(p2.height);
      const cp1x = x1 + (x2 - xOf(Math.max(0, i - 2))) / 6;
      const cp1y = y1 + (y2 - yOf(p0.height)) / 6;
      const cp2x = x2 - (xOf(Math.min(pts.length - 1, i + 1)) - x1) / 6;
      const cp2y = y2 - (yOf(p3.height) - y1) / 6;
      ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, x2, y2);
    }
    ctx.strokeStyle = "rgba(60,200,255,0.9)";
    ctx.lineWidth   = 1.8;
    ctx.shadowColor = "rgba(60,200,255,0.5)";
    ctx.shadowBlur  = 4;
    ctx.stroke();
    ctx.shadowBlur  = 0;

    // ── High / low tide markers
    const start = pts[0].time.getTime();
    const span  = pts[pts.length - 1].time.getTime() - start;
    events.forEach(ev => {
      const frac = (ev.time.getTime() - start) / span;
      const ex   = frac * W;
      const ey   = yOf(ev.height);
      ctx.fillStyle = ev.type === "high" ? "#ffa820" : "#3ee5ff";
      ctx.beginPath();
      ctx.arc(ex, ey, 3, 0, Math.PI * 2);
      ctx.fill();
    });

    // ── "Now" marker
    const now   = Date.now();
    const nfrac = (now - start) / span;
    if (nfrac >= 0 && nfrac <= 1) {
      const nx = nfrac * W;
      const ny = yOf(Tides.tideHeight(now));
      ctx.strokeStyle = "rgba(255,255,255,0.7)";
      ctx.lineWidth   = 1;
      ctx.setLineDash([2, 3]);
      ctx.beginPath(); ctx.moveTo(nx, 0); ctx.lineTo(nx, H); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "#ffffff";
      ctx.beginPath(); ctx.arc(nx, ny, 3, 0, Math.PI * 2); ctx.fill();
    }
  }

  // ── Chart ─────────────────────────────────────────────────────────────────
  function initChart(hourly, currentMeta, days = 2) {
    const canvas = document.getElementById("weather-chart");
    const scroll = document.getElementById("chart-scroll");
    if (!canvas || !hourly.length) return;

    // ── Cleanup previous render ─────────────────────────────────────────────
    // Aborting the shared controller removes ALL drag + hover listeners added
    // by the last call in a single shot — no listener accumulation on zoom change.
    if (initChart._abort) initChart._abort.abort();
    scroll.querySelectorAll("canvas:not(#weather-chart)").forEach(c => c.remove());
    const oldTip = document.getElementById("chart-tooltip");
    if (oldTip) oldTip.remove();

    const ac  = new AbortController();
    initChart._abort = ac;
    const sig = ac.signal;

    // Slice to exactly days×24 hours so the canvas is exactly one viewport wide
    // with no hidden data scrollable off to the right.
    const sliced = hourly.slice(0, days * 24);

    const chart = new WeatherChart(canvas, sliced, {
      sunriseUtc: currentMeta?.sunriseUtc,
      sunsetUtc:  currentMeta?.sunsetUtc,
      days,
    });
    chart.render();
    chart.scrollToNow(scroll);
    chart.initHover(scroll, sig);

    // Enable drag-to-scroll — AbortController ensures cleanup on re-init
    let isDown = false, startX = 0, startLeft = 0;
    scroll.addEventListener("mousedown", e => {
      isDown = true; startX = e.pageX; startLeft = scroll.scrollLeft;
    }, { signal: sig });
    window.addEventListener("mouseup",   () => { isDown = false; }, { signal: sig });
    window.addEventListener("mousemove", e => {
      if (!isDown) return;
      scroll.scrollLeft = startLeft - (e.pageX - startX);
    }, { signal: sig });
  }

  // ── Sample / fallback data ────────────────────────────────────────────────
  /**
   * Generates synthetic hourly data for 5 days starting from now.
   * Used when weather.json hasn't been populated by CI yet.
   */
  function generateSampleData() {
    const hours  = [];
    const baseMs = Math.floor(Date.now() / 3_600_000) * 3_600_000; // current whole hour

    for (let i = 0; i < 120; i++) {
      const ts      = Math.round((baseMs + i * 3_600_000) / 1000);
      const lh      = (+new Date(ts * 1000).toLocaleString("en-NZ", { timeZone: TZ, hour: "numeric", hour12: false }) + 24) % 24;
      const cos_arg = 2 * Math.PI * (lh - 14) / 24;
      const temp    = +(18 + 7  * Math.cos(cos_arg)).toFixed(1);
      const feels   = +(temp - 1.5 + Math.sin(i * 0.3) * 0.8).toFixed(1);
      const cc      = Math.max(0, Math.min(90, Math.round(35 + 30 * Math.sin(i * 0.12 + 1.5))));
      const pp      = Math.max(0, Math.min(80, Math.round(20 + 25 * Math.sin(i * 0.10 + 2))));
      const qpf     = pp > 45 ? +(0.4 * Math.sin(i * 0.10 + 2)).toFixed(2) : 0;

      hours.push({
        validTimeUtc:          ts,
        temperature:           temp,
        temperatureFeelsLike:  feels,
        relativeHumidity:      Math.max(40, Math.min(90, Math.round(65 - 10 * Math.cos(cos_arg)))),
        windSpeed:             Math.round(13 + 5  * Math.sin(i * 0.2)),
        windDirection:         Math.round(240 + 20 * Math.sin(i * 0.15)),
        windDirectionCardinal: "WSW",
        windGust:              Math.round(16 + 5  * Math.abs(Math.sin(i * 0.2))),
        cloudCover:            cc,
        qpf:                   qpf,
        precipChance:          pp,
        precipType:            "rain",
        pressureMeanSeaLevel:  +(1013 + 4 * Math.sin(i * 0.03)).toFixed(1),
        uvIndex:               (lh >= 7 && lh <= 18) ? Math.max(0, Math.round(7 * Math.sin(Math.PI * (lh - 6) / 12))) : 0,
        iconCode:              cc < 30 ? 32 : cc < 60 ? 30 : 26,
        dayOrNight:            (lh >= 7 && lh < 19) ? "D" : "N",
        wxPhraseMedium:        cc < 25 ? "Sunny" : cc < 60 ? "Partly Cloudy" : "Mostly Cloudy",
      });
    }

    const nowTs = Math.round(Date.now() / 1000);

    // Build a daily entry per day — calendarDayTemperatureMax/Min are the
    // midnight-to-midnight extrema of the cosine curve (peak 25° at 2pm, 11° at 2am)
    const daily = Array.from({ length: 5 }, (_, d) => ({
      calendarDayTemperatureMax: 25 - d * 0.5,   // slight cooling trend
      calendarDayTemperatureMin: 11 - d * 0.3,
      temperatureMax:            25 - d * 0.5,
      temperatureMin:            11 - d * 0.3,
    }));

    return {
      meta:    { updated: new Date().toISOString(), location: "Christchurch, New Zealand (sample)", lat: -43.5321, lon: 172.6362 },
      current: {
        temp: hours[0].temperature, feelsLike: hours[0].temperatureFeelsLike,
        humidity: hours[0].relativeHumidity, pressure: hours[0].pressureMeanSeaLevel,
        windSpeed: hours[0].windSpeed, windGust: hours[0].windGust,
        windDirection: hours[0].windDirection, windCardinal: "WSW",
        uvIndex: hours[0].uvIndex, cloudPhrase: hours[0].wxPhraseMedium,
        condition: hours[0].wxPhraseMedium, iconCode: hours[0].iconCode,
        sunriseUtc: nowTs - 3 * 3600,   // approximate: 3 h ago
        sunsetUtc:  nowTs + 6 * 3600,   // approximate: 6 h ahead
      },
      today:  { moonPhase: "Waxing Crescent", moonPhaseCode: "WXC", moonPhaseDay: 5 },
      hourly: hours,
      daily,
    };
  }

  // ── Boot ──────────────────────────────────────────────────────────────────
  async function boot() {
    let data;
    try {
      const resp = await fetch("data/weather.json");
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      data = await resp.json();
      // Fall back to sample if hourly array is empty
      if (!data.hourly || data.hourly.length < 10) throw new Error("empty");
    } catch (e) {
      console.warn("Using sample data:", e.message);
      data = generateSampleData();
    }

    populateCard(data);

    // Read initial zoom value from the dropdown (default 2 from HTML selected attr)
    const zoomSel = document.getElementById("chart-zoom");
    initChart(data.hourly, data.current, zoomSel ? +zoomSel.value : 2);

    // Re-render chart when zoom level changes
    if (zoomSel) {
      zoomSel.addEventListener("change", () => {
        initChart(data.hourly, data.current, +zoomSel.value);
      });
    }

    startLiveRefresh(data);
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
