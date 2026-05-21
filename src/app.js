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

  // ── Weather icon (iconCode → emoji) ──────────────────────────────────────
  function iconFor(iconCode, dayOrNight) {
    const day  = dayOrNight !== "N";
    const code = +iconCode;
    if (code === 32 || code === 36) return "☀️";
    if (code === 31) return "🌙";
    if (code === 30 || code === 34) return day ? "⛅" : "☁️";
    if (code === 29 || code === 33 || code === 27 || code === 28) return day ? "🌥️" : "☁️";
    if (code === 26) return "☁️";
    if (code === 9  || code === 11) return "🌦️";
    if (code === 12 || code === 39 || code === 40) return "🌧️";
    if ([13,14,15,16,41,42,43,46].includes(code)) return "❄️";
    if ([17,18,35,37,38,47].includes(code)) return "⛈️";
    if ([19,20,21,22].includes(code)) return "🌫️";
    if (code === 23 || code === 24) return "💨";
    return day ? "⛅" : "☁️";
  }

  function isDaytime(c) {
    if (!c.sunriseUtc || !c.sunsetUtc) return true;
    const now = Date.now() / 1000;
    return now >= c.sunriseUtc && now < c.sunsetUtc;
  }

  // ── Hourly strip ──────────────────────────────────────────────────────────
  function renderHourlyStrip(hourly, count = 10) {
    const stripEl = document.getElementById("hourly-strip");
    if (!stripEl) return;
    const nowSec = Date.now() / 1000;
    let startIdx = hourly.findIndex(h => (h.validTimeUtc || 0) >= nowSec);
    if (startIdx < 0) startIdx = 0;
    if (startIdx > 0) startIdx -= 1;
    const slice = hourly.slice(startIdx, startIdx + count);
    stripEl.innerHTML = slice.map((h, i) => {
      const time = i === 0 ? "Now" : new Date(h.validTimeUtc * 1000)
        .toLocaleTimeString("en-NZ", { timeZone: TZ, hour: "numeric", hour12: true })
        .replace(/ (am|pm)$/i, "$1");
      const temp   = h.temperature != null ? `${Math.round(h.temperature)}°` : "—";
      const icon   = iconFor(h.iconCode, h.dayOrNight);
      const chance = h.precipChance ?? 0;
      const showPp = chance >= 10;
      return `<div class="hour-cell${i === 0 ? " now" : ""}">
        <span class="hour-time">${time}</span>
        <span class="hour-icon" aria-hidden="true">${icon}</span>
        <span class="hour-temp">${temp}</span>
        <span class="hour-precip ${showPp ? "" : "zero"}">${showPp ? chance + "%" : "·"}</span>
      </div>`;
    }).join("");
  }

  // ── Today aggregates (rain, gust, cloud, peak wind) ───────────────────────
  function todayAggregates(hourly) {
    const nowDate = new Date().toLocaleDateString("en-NZ", {
      timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
    });
    const slots = hourly.filter(h => {
      if (!h.validTimeUtc) return false;
      return new Date(h.validTimeUtc * 1000)
        .toLocaleDateString("en-NZ", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }) === nowDate;
    });
    if (!slots.length) return { rainMm: null, peakChance: null, peakGust: null };
    return {
      rainMm:     +slots.reduce((s, h) => s + (h.qpf || 0), 0).toFixed(1),
      peakChance: Math.max(...slots.map(h => h.precipChance || 0)),
      peakGust:   Math.max(...slots.map(h => h.windGust  || 0)),
    };
  }

  // ── Pressure trend (3 h delta) ────────────────────────────────────────────
  function pressureTrend(hourly, currentPressure) {
    if (currentPressure == null) return null;
    const nowSec = Date.now() / 1000;
    const past = hourly.find(h => h.validTimeUtc && Math.abs(h.validTimeUtc - (nowSec - 3 * 3600)) < 1800);
    if (!past || past.pressureMeanSeaLevel == null) return null;
    const delta = currentPressure - past.pressureMeanSeaLevel;
    if (Math.abs(delta) < 0.5) return "steady";
    return delta > 0 ? "rising" : "falling";
  }

  // ── UV label ─────────────────────────────────────────────────────────────
  function uvLabel(idx) {
    if (idx == null) return "—";
    if (idx <= 2)  return `${idx} Low`;
    if (idx <= 5)  return `${idx} Med`;
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
    const highHours = todayHours.filter(h => (h.uvIndex ?? 0) >= 3);
    let uvWindow = null;
    if (highHours.length) {
      const fmt = utcSec => new Date(utcSec * 1000)
        .toLocaleTimeString("en-NZ", { timeZone: TZ, hour: "numeric", hour12: true })
        .replace(/ (am|pm)$/i, '$1');
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

  // ── Day forecast data builder ─────────────────────────────────────────
  /**
   * Computes extrema and times for a single forecast day.
   *
   * @param {number} dayIndex - 1 = tomorrow, 2 = day after (daily[0] = today)
   * @param {Array}  hourly   - data.hourly[]
   * @param {Array}  daily    - data.daily[]
   * @returns {object|null}   - null when daily[dayIndex] is unavailable
   */
  function buildDayForecast(dayIndex, hourly, daily) {
    const d = (daily || [])[dayIndex];
    if (!d) return null;

    // ── Date key helper (same pattern as todayHighLow / uvInfo) ──────────
    const dateKey = function(ts) {
      return new Date(ts * 1000).toLocaleDateString("en-NZ", {
        timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
      });
    };

    // Primary: derive date from sunrise; fallback: client clock + offset
    const refTs = d.sunriseTimeUtc != null
      ? d.sunriseTimeUtc
      : Math.round(Date.now() / 1000) + dayIndex * 86400;

    const targetKey = dateKey(refTs);
    const slots = (hourly || []).filter(h => h.validTimeUtc && dateKey(h.validTimeUtc) === targetKey);

    // ── Label ─────────────────────────────────────────────────────────────
    const label = dayIndex === 1
      ? "Tomorrow"
      : new Date(refTs * 1000).toLocaleDateString("en-NZ", { timeZone: TZ, weekday: "long" });

    // ── Date display ("19 Mar") ───────────────────────────────────────────
    const date = new Date(refTs * 1000).toLocaleDateString("en-NZ", {
      timeZone: TZ, day: "numeric", month: "short",
    });

    // ── Helpers ───────────────────────────────────────────────────────────
    const pick = function(arr, fn) {
      if (!arr.length) return null;
      return arr.reduce(function(best, h) { return fn(h) > fn(best) ? h : best; }, arr[0]);
    };
    const pickMin = function(arr, fn) {
      if (!arr.length) return null;
      return arr.reduce(function(best, h) { return fn(h) < fn(best) ? h : best; }, arr[0]);
    };

    // ── Temperature (val from daily, time from hourly max/min slot) ───────
    const hiSlot = slots.length ? pick(slots, function(h) { return h.temperature; }) : null;
    const loSlot = slots.length ? pickMin(slots, function(h) { return h.temperature; }) : null;

    // ── Humidity ──────────────────────────────────────────────────────────
    const humHiSlot = slots.length ? pick(slots, function(h) { return h.relativeHumidity; }) : null;
    const humLoSlot = slots.length ? pickMin(slots, function(h) { return h.relativeHumidity; }) : null;

    // ── Wind (highest windSpeed) ───────────────────────────────────────────
    const windSlot = slots.length ? pick(slots, function(h) { return h.windSpeed; }) : null;

    // ── Precip ────────────────────────────────────────────────────────────
    const totalMm = slots.length
      ? +slots.reduce(function(s, h) { return s + (h.qpf || 0); }, 0).toFixed(1)
      : null;
    const maxChance = slots.length
      ? Math.max.apply(null, slots.map(function(h) { return h.precipChance || 0; }))
      : null;

    // ── UV ────────────────────────────────────────────────────────────────
    const peakUV = slots.length
      ? (function() {
          var max = -Infinity;
          slots.forEach(function(h) { if (h.uvIndex != null && h.uvIndex > max) max = h.uvIndex; });
          return max === -Infinity ? null : max;
        })()
      : null;

    const uvFmt = function(ts) {
      return new Date(ts * 1000)
        .toLocaleTimeString("en-NZ", { timeZone: TZ, hour: "numeric", hour12: true })
        .replace(/ (am|pm)$/i, "$1");
    };
    const uvSlots = slots.filter(function(h) { return (h.uvIndex || 0) >= 3; });
    const uvWindow = uvSlots.length
      ? uvFmt(uvSlots[0].validTimeUtc) + "–" + uvFmt(uvSlots[uvSlots.length - 1].validTimeUtc + 3600)
      : null;

    // ── Pressure ──────────────────────────────────────────────────────────
    const presHiSlot = slots.length ? pick(slots, function(h) { return h.pressureMeanSeaLevel; }) : null;
    const presLoSlot = slots.length ? pickMin(slots, function(h) { return h.pressureMeanSeaLevel; }) : null;

    return {
      label,
      date,
      sunrise: d.sunriseTimeUtc  || null,
      sunset:  d.sunsetTimeUtc   || null,
      temp: {
        max: { val: d.calendarDayTemperatureMax, utcSec: hiSlot ? hiSlot.validTimeUtc : null },
        min: { val: d.calendarDayTemperatureMin, utcSec: loSlot ? loSlot.validTimeUtc : null },
      },
      humidity: {
        max: { val: humHiSlot ? humHiSlot.relativeHumidity : null, utcSec: humHiSlot ? humHiSlot.validTimeUtc : null },
        min: { val: humLoSlot ? humLoSlot.relativeHumidity : null, utcSec: humLoSlot ? humLoSlot.validTimeUtc : null },
      },
      wind: {
        speed:   windSlot ? windSlot.windSpeed            : null,
        cardinal: windSlot ? (windSlot.windDirectionCardinal || degToCard(windSlot.windDirection)) : null,
        utcSec:  windSlot ? windSlot.validTimeUtc         : null,
      },
      precip:   { totalMm, maxChance },
      uv:       { peak: peakUV, window: uvWindow },
      pressure: {
        max: { val: presHiSlot ? presHiSlot.pressureMeanSeaLevel : null, utcSec: presHiSlot ? presHiSlot.validTimeUtc : null },
        min: { val: presLoSlot ? presLoSlot.pressureMeanSeaLevel : null, utcSec: presLoSlot ? presLoSlot.validTimeUtc : null },
      },
    };
  }

  // ── Day forecast card renderer ────────────────────────────────────────
  /**
   * Populates a .day-card element from a buildDayForecast() result.
   *
   * @param {HTMLElement} el  - the .day-card div
   * @param {object|null} fc  - forecast object or null
   */
  function renderDayCard(el, fc) {
    if (!el) return;

    // Helper: format utcSec as "2pm", "10am", etc., or "—" when null
    const fmtH = function(utcSec) {
      if (!utcSec) return "—";
      return new Date(utcSec * 1000)
        .toLocaleTimeString("en-NZ", { timeZone: TZ, hour: "numeric", hour12: true })
        .replace(/ (am|pm)$/i, "$1");
    };

    // Helper: format utcSec as "6:32am" (with minutes), or "—"
    const fmtHM = function(utcSec) {
      if (!utcSec) return "—";
      return new Date(utcSec * 1000)
        .toLocaleTimeString("en-NZ", { timeZone: TZ, hour: "numeric", minute: "2-digit", hour12: true })
        .replace(/ (am|pm)$/i, "$1");
    };

    // Render "—" for nulls
    const n = function(v, suffix) {
      return v != null ? v + (suffix || "") : "—";
    };

    if (!fc) {
      el.innerHTML = '<div class="dc-label"><span class="dc-day">—</span></div>';
      return;
    }

    const hiTemp  = fc.temp.max.val != null ? Math.round(fc.temp.max.val) + "°" : "—";
    const loTemp  = fc.temp.min.val != null ? Math.round(fc.temp.min.val) + "°" : "—";
    const hiTime  = fmtH(fc.temp.max.utcSec);
    const loTime  = fmtH(fc.temp.min.utcSec);

    const humHi   = n(fc.humidity.max.val, "%");
    const humHiT  = fmtH(fc.humidity.max.utcSec);
    const humLo   = n(fc.humidity.min.val, "%");
    const humLoT  = fmtH(fc.humidity.min.utcSec);

    const windStr = fc.wind.speed != null
      ? `${fc.wind.speed} km/h ${fc.wind.cardinal || ""} at ${fmtH(fc.wind.utcSec)}`
      : "—";

    const precipStr = (fc.precip.totalMm != null && fc.precip.maxChance != null)
      ? `${fc.precip.totalMm} mm · ${fc.precip.maxChance}%`
      : "—";

    const uvPeak  = fc.uv.peak != null ? uvLabel(fc.uv.peak) : "—";
    const uvWin   = fc.uv.window || "Below 3";

    const presHi  = fc.pressure.max.val != null ? Math.round(fc.pressure.max.val) + " hPa" : "—";
    const presHiT = fmtH(fc.pressure.max.utcSec);
    const presLo  = fc.pressure.min.val != null ? Math.round(fc.pressure.min.val) + " hPa" : "—";
    const presLoT = fmtH(fc.pressure.min.utcSec);

    el.innerHTML = `
      <div class="dc-label">
        <span class="dc-day">${fc.label}</span>
        <span class="dc-date">${fc.date}</span>
      </div>

      <div class="dc-temp-row">
        <div class="dc-temp-half">
          <svg class="dc-arrow up" viewBox="0 0 16 16"><path d="M8 2l5 7H3z"/></svg>
          <span class="dc-temp-val hi">${hiTemp}</span>
          <span class="dc-temp-time">${hiTime}</span>
        </div>
        <div class="dc-temp-half">
          <svg class="dc-arrow down" viewBox="0 0 16 16"><path d="M8 14l5-7H3z"/></svg>
          <span class="dc-temp-val lo">${loTemp}</span>
          <span class="dc-temp-time">${loTime}</span>
        </div>
      </div>

      <div class="dc-row">
        <span class="dc-row-icon">💧</span>
        <span class="dc-row-content">
          <span class="dc-val-muted">Hi</span>
          <span class="dc-val-hum-hi">${humHi}</span>
          <span class="dc-val-muted">${humHiT}</span>
          &nbsp;·&nbsp;
          <span class="dc-val-muted">Lo</span>
          <span class="dc-val-hum-lo">${humLo}</span>
          <span class="dc-val-muted">${humLoT}</span>
        </span>
      </div>

      <hr class="dc-sep">

      <div class="dc-sun-row">
        <div class="dc-sun-item">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent-warm)" stroke-width="2">
            <circle cx="12" cy="12" r="5"/>
            <path d="M12 1v3M12 20v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M1 12h3M20 12h3M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12"/>
          </svg>
          <span class="dc-sun-val">${fmtHM(fc.sunrise)}</span>
        </div>
        <div class="dc-sun-item">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ff8c50" stroke-width="2">
            <circle cx="12" cy="12" r="5"/>
            <path d="M12 1v3M12 20v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M1 12h3M20 12h3M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12"/>
          </svg>
          <span class="dc-sun-val">${fmtHM(fc.sunset)}</span>
        </div>
      </div>

      <hr class="dc-sep">

      <div class="dc-row">
        <span class="dc-row-icon">💨</span>
        <span class="dc-row-content dc-val-wind">${windStr}</span>
      </div>

      <div class="dc-row">
        <span class="dc-row-icon">🌧</span>
        <span class="dc-row-content dc-val-precip">${precipStr}</span>
      </div>

      <div class="dc-row">
        <span class="dc-row-icon">☀️</span>
        <span class="dc-row-content">
          <span class="dc-val-uv">UV ${uvPeak}</span>
          <span class="dc-val-muted"> · ${uvWin}</span>
        </span>
      </div>

      <hr class="dc-sep">

      <div class="dc-pressure-row">
        <svg class="dc-arrow up" viewBox="0 0 16 16"><path d="M8 2l5 7H3z"/></svg>
        <span class="dc-val-pressure">${presHi}</span>
        <span class="dc-val-muted">${presHiT}</span>
      </div>
      <div class="dc-pressure-row">
        <svg class="dc-arrow down" viewBox="0 0 16 16"><path d="M8 14l5-7H3z"/></svg>
        <span class="dc-val-pressure">${presLo}</span>
        <span class="dc-val-muted">${presLoT}</span>
      </div>
    `;
  }

  // ── Populate conditions card ──────────────────────────────────────────────
  function populateCard(data) {
    const c = data.current || {};
    const t = data.today   || {};

    // Header
    const el = id => document.getElementById(id);
    el("last-updated").textContent = fmtRelative(data.meta?.updated);

    // Current temp + condition + icon
    el("current-icon").textContent      = iconFor(c.iconCode, isDaytime(c) ? "D" : "N");
    el("current-temp").textContent      = c.temp  != null ? `${Math.round(c.temp)}°` : "—°";
    el("current-condition").textContent = c.condition || c.cloudPhrase || "—";
    el("current-feels").textContent     = c.feelsLike != null ? `Feels like ${Math.round(c.feelsLike)}°` : "";

    // Hourly strip
    renderHourlyStrip(data.hourly || [], 10);

    // Today aggregates
    const agg = todayAggregates(data.hourly || []);

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
    const gustVal = c.windGust != null ? c.windGust : agg.peakGust;
    el("gust").textContent      = gustVal != null ? `${Math.round(gustVal)} km/h` : "—";
    el("pressure").textContent  = c.pressure   != null ? `${Math.round(c.pressure)} hPa` : "—";
    const trend = pressureTrend(data.hourly || [], c.pressure);
    el("pressure-trend").textContent = trend === "rising" ? "↑ Rising" : trend === "falling" ? "↓ Falling" : trend === "steady" ? "→ Steady" : "Pressure";
    el("dewpoint").textContent  = c.dewPoint  != null ? `${Math.round(c.dewPoint)}°` : "—";

    // Cloud cover — nearest hour at or after now
    const nowSec2 = Date.now() / 1000;
    const curHour = (data.hourly || []).find(h => (h.validTimeUtc || 0) >= nowSec2 - 1800) || (data.hourly || [])[0];
    el("cloud-cover").textContent = curHour?.cloudCover != null ? `${curHour.cloudCover}%` : "—";

    el("rain-today").textContent  = agg.rainMm  != null ? `${agg.rainMm} mm` : "—";
    el("rain-chance").textContent = agg.peakChance != null ? `Peak ${agg.peakChance}%` : "Rain today";

    // UV — current reading + today's peak in brackets + UV≥3 window as sub-label
    const { peakUV, uvWindow } = uvInfo(data.hourly || []);
    el("uv-index").textContent = c.uvIndex != null ? `Current: ${uvLabel(c.uvIndex)}` : "—";
    el("uv-label").textContent = peakUV != null
      ? `Peak: ${uvLabel(peakUV)}${uvWindow ? ` · ${uvWindow}` : ""}`
      : "UV";

    // Astronomy
    el("sunrise").textContent    = fmtShortTime(c.sunriseUtc);
    el("sunset").textContent     = fmtShortTime(c.sunsetUtc);
    el("moon-phase").textContent = t.moonPhase || "—";
    el("moon-emoji").textContent = MOON_EMOJI[t.moonPhaseCode] || "🌕";

    // Tides
    populateTides();

    // Day forecast cards
    renderDayCard(
      document.getElementById("day-card-1"),
      buildDayForecast(1, data.hourly || [], data.daily || [])
    );
    renderDayCard(
      document.getElementById("day-card-2"),
      buildDayForecast(2, data.hourly || [], data.daily || [])
    );
    renderDayCard(
      document.getElementById("day-card-3"),
      buildDayForecast(3, data.hourly || [], data.daily || [])
    );
    renderDayCard(
      document.getElementById("day-card-4"),
      buildDayForecast(4, data.hourly || [], data.daily || [])
    );
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
    el("gust").textContent          = c.windGust  != null ? `${c.windGust} km/h`                      : "—";
    el("pressure").textContent      = c.pressure  != null ? `${Math.round(c.pressure)} hPa`           : "—";
    el("dewpoint").textContent      = c.dewPoint  != null ? `${Math.round(c.dewPoint)}°`              : "—";
    const liveIcon = document.getElementById("current-icon");
    if (liveIcon) liveIcon.textContent = iconFor(c.iconCode, isDaytime(c) ? "D" : "N");
    const { peakUV: livePeak, uvWindow: liveWin } = uvInfo(hourly || []);
    el("uv-index").textContent = c.uvIndex != null ? `Current: ${uvLabel(c.uvIndex)}` : "—";
    el("uv-label").textContent = livePeak != null
      ? `Peak: ${uvLabel(livePeak)}${liveWin ? ` · ${liveWin}` : ""}`
      : "UV";
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

    // ── Tooltip setup ────────────────────────────────────────────────────────
    const section = canvas.closest(".tides-card");
    let tip = document.getElementById("tide-tooltip");
    if (!tip) {
      tip = document.createElement("div");
      tip.id = "tide-tooltip";
      section.appendChild(tip);
    }

    const startMs = pts[0].time.getTime();
    const spanMs  = pts[pts.length - 1].time.getTime() - startMs;

    canvas.onmousemove = (e) => {
      const rect  = canvas.getBoundingClientRect();
      const frac  = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const hoverMs = startMs + frac * spanMs;
      const height  = +Tides.tideHeight(hoverMs).toFixed(2);

      // Find nearest high/low event within ±90 min
      const nearest = events.reduce((best, ev) => {
        const d = Math.abs(ev.time.getTime() - hoverMs);
        return d < (best?.d ?? Infinity) ? { ev, d } : best;
      }, null);
      const nearLabel = nearest && nearest.d < 90 * 60_000
        ? ` · <span style="color:${nearest.ev.type === "high" ? "#ffa820" : "#3ee5ff"}">${nearest.ev.type === "high" ? "High" : "Low"}</span>`
        : "";

      const timeStr = new Date(hoverMs).toLocaleTimeString("en-NZ", {
        timeZone: TZ, hour: "numeric", minute: "2-digit", hour12: true,
      });
      const dateStr = new Date(hoverMs).toLocaleDateString("en-NZ", {
        timeZone: TZ, weekday: "short", day: "numeric", month: "short",
      });

      tip.innerHTML = `
        <div class="tt-time">${dateStr} ${timeStr}${nearLabel}</div>
        <div class="tt-row">
          <span class="tt-label">Height</span>
          <span class="tt-val">${height} m</span>
        </div>`;
      tip.style.display = "block";

      // Position: above canvas, flipped left when near right edge
      const sectionRect = section.getBoundingClientRect();
      const cursorLeft  = e.clientX - sectionRect.left;
      const tipW        = tip.offsetWidth;
      const canvasTop   = canvas.getBoundingClientRect().top - sectionRect.top;
      tip.style.top  = `${canvasTop - tip.offsetHeight - 6}px`;
      tip.style.left = cursorLeft + tipW + 8 > sectionRect.width
        ? `${cursorLeft - tipW - 8}px`
        : `${cursorLeft + 8}px`;
    };

    canvas.onmouseleave = () => { tip.style.display = "none"; };

    const rect = canvas.parentElement.getBoundingClientRect();
    const dpr  = window.devicePixelRatio || 1;
    const W    = rect.width  || 320;
    const H    = rect.height || 180;
    canvas.width  = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width  = W + "px";
    canvas.style.height = H + "px";
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);

    const cs         = getComputedStyle(document.documentElement);
    const curveColor = cs.getPropertyValue('--tide-curve').trim()  || 'rgba(10,140,200,0.9)';
    const fillA      = cs.getPropertyValue('--tide-fill-a').trim() || 'rgba(80,170,220,0.55)';
    const fillB      = cs.getPropertyValue('--tide-fill-b').trim() || 'rgba(140,200,235,0.4)';
    const fillC      = cs.getPropertyValue('--tide-fill-c').trim() || 'rgba(220,235,250,0.15)';
    const canvasBg   = cs.getPropertyValue('--tide-canvas').trim() || 'rgba(225,235,250,0.7)';

    const PAD_V = 8;
    const heights = pts.map(p => p.height);
    const hMin    = Math.min(...heights) - 0.1;
    const hMax    = Math.max(...heights) + 0.1;

    const xOf = (i) => (i / (pts.length - 1)) * W;
    const yOf = (h) => H - PAD_V - ((h - hMin) / (hMax - hMin)) * (H - PAD_V * 2);

    // ── Background
    ctx.fillStyle = canvasBg;
    ctx.fillRect(0, 0, W, H);

    // ── Filled area under curve
    const areaGrad = ctx.createLinearGradient(0, PAD_V, 0, H);
    areaGrad.addColorStop(0,   fillA);
    areaGrad.addColorStop(0.6, fillB);
    areaGrad.addColorStop(1,   fillC);

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
    ctx.strokeStyle = curveColor;
    ctx.lineWidth   = 1.8;
    ctx.shadowColor = curveColor;
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
      sunriseTimeUtc: nowTs + d * 86400 - 3 * 3600,   // approx 3 h before current time
      sunsetTimeUtc:  nowTs + d * 86400 + 6 * 3600,   // approx 6 h after current time
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

    startLiveRefresh(data);
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
