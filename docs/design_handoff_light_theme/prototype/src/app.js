/**
 * app.js — Initialises the WeatherTempo dashboard.
 */

(function () {
  "use strict";

  const TZ = "Pacific/Auckland";
  const WORKER_URL = "https://weathertempo-pws-proxy.forgesync.workers.dev";
  const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

  // ── Formatters ───────────────────────────────────────────────────────────
  function fmtTime(utcSec, opts = {}) {
    if (!utcSec) return "—";
    return new Date(utcSec * 1000).toLocaleTimeString("en-NZ", { timeZone: TZ, ...opts });
  }
  function fmtShortTime(utcSec) { return fmtTime(utcSec, { hour: "numeric", minute: "2-digit", hour12: true }); }
  function fmtHourOnly(utcSec) { return fmtTime(utcSec, { hour: "numeric", hour12: true }); }

  function fmtRelative(isoStr) {
    if (!isoStr) return "—";
    const diff = (Date.now() - new Date(isoStr).getTime()) / 60000;
    if (diff < 2)  return "just now";
    if (diff < 60) return `${Math.round(diff)} min ago`;
    return `${Math.round(diff / 60)}h ago`;
  }

  /** Format a millisecond gap as "in 3h 14m" / "in 42m" / "now" */
  function fmtCountdown(targetMs) {
    const diff = targetMs - Date.now();
    if (diff <= 0)        return "now";
    if (diff < 60_000)    return "in <1m";
    const totalMin = Math.round(diff / 60_000);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    if (h === 0) return `in ${m}m`;
    if (m === 0) return `in ${h}h`;
    return `in ${h}h ${m}m`;
  }

  // ── Moon phase ──────────────────────────────────────────────────────────
  const MOON_EMOJI = {
    NM: "🌑", WNM: "🌑", WXC: "🌒", FQ:  "🌓",
    WXG: "🌔", FM:  "🌕", WNG: "🌖", LQ:  "🌗", WNC: "🌘",
  };

  // ── Weather icon (TWC iconCode → emoji) ─────────────────────────────────
  function iconFor(iconCode, dayOrNight) {
    const day = dayOrNight !== "N";
    const code = +iconCode;
    if (code === 32 || code === 36) return "☀️";          // Sunny / Hot
    if (code === 31) return "🌙";                          // Clear night
    if (code === 30 || code === 34) return day ? "⛅" : "☁️"; // Partly cloudy
    if (code === 29 || code === 33 || code === 27 || code === 28) return day ? "🌥️" : "☁️"; // Mostly cloudy
    if (code === 26) return "☁️";                          // Overcast
    if (code === 9 || code === 11) return "🌦️";           // Drizzle / showers
    if (code === 12 || code === 39 || code === 40) return "🌧️"; // Rain
    if (code === 13 || code === 14 || code === 15 || code === 16 || code === 41 || code === 42 || code === 43 || code === 46) return "❄️"; // Snow
    if (code === 17 || code === 18 || code === 35 || code === 37 || code === 38 || code === 47) return "⛈️"; // Thunder
    if (code === 19 || code === 20 || code === 21 || code === 22) return "🌫️"; // Fog/haze
    if (code === 23 || code === 24) return "💨";          // Windy
    return day ? "⛅" : "☁️";
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

  function uvInfo(hourly) {
    const nowDate = new Date().toLocaleDateString("en-NZ", {
      timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
    });
    const todayHours = hourly.filter(h => {
      if (!h.validTimeUtc) return false;
      return new Date(h.validTimeUtc * 1000)
        .toLocaleDateString("en-NZ", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }) === nowDate;
    });
    const peakUV = todayHours.length ? Math.max(...todayHours.map(h => h.uvIndex ?? 0)) : null;
    const highHours = todayHours.filter(h => (h.uvIndex ?? 0) >= 3);
    let uvWindow = null;
    if (highHours.length) {
      const fmt = utcSec => new Date(utcSec * 1000)
        .toLocaleTimeString("en-NZ", { timeZone: TZ, hour: "numeric", hour12: true })
        .replace(/ (am|pm)$/i, '$1');
      uvWindow = `${fmt(highHours[0].validTimeUtc)}–${fmt(highHours[highHours.length - 1].validTimeUtc + 3600)}`;
    }
    return { peakUV, uvWindow };
  }

  // ── Today high/low ────────────────────────────────────────────────────────
  function todayHighLow(hourly, daily) {
    const d0     = (daily || [])[0];
    const calMax = d0?.calendarDayTemperatureMax ?? null;
    const calMin = d0?.calendarDayTemperatureMin ?? null;

    const nowDate = new Date().toLocaleDateString("en-NZ", {
      timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
    });
    const todayHours = hourly.filter(h => {
      if (!h.validTimeUtc) return false;
      return new Date(h.validTimeUtc * 1000)
        .toLocaleDateString("en-NZ", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }) === nowDate;
    });

    let hiTime = null, loTime = null;
    if (todayHours.length) {
      const fHi = todayHours.reduce((a, b) => (a.temperature > b.temperature ? a : b));
      const fLo = todayHours.reduce((a, b) => (a.temperature < b.temperature ? a : b));
      if (calMax != null && Math.abs(fHi.temperature - calMax) <= 1) hiTime = fHi.validTimeUtc;
      if (calMin != null && Math.abs(fLo.temperature - calMin) <= 1) loTime = fLo.validTimeUtc;
    }

    const highTemp = calMax ?? (todayHours.length ? Math.max(...todayHours.map(h => h.temperature)) : null);
    const lowTemp  = calMin ?? (todayHours.length ? Math.min(...todayHours.map(h => h.temperature)) : null);
    if (highTemp == null && lowTemp == null) return null;
    return { high: { temp: highTemp, utcSec: hiTime }, low:  { temp: lowTemp,  utcSec: loTime } };
  }

  // ── Day forecast data builder ─────────────────────────────────────────
  function buildDayForecast(dayIndex, hourly, daily) {
    const d = (daily || [])[dayIndex];
    if (!d) return null;

    const dateKey = (ts) => new Date(ts * 1000).toLocaleDateString("en-NZ", {
      timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
    });

    const refTs = d.sunriseTimeUtc != null
      ? d.sunriseTimeUtc
      : Math.round(Date.now() / 1000) + dayIndex * 86400;

    const targetKey = dateKey(refTs);
    const slots = (hourly || []).filter(h => h.validTimeUtc && dateKey(h.validTimeUtc) === targetKey);

    const label = dayIndex === 1
      ? "Tomorrow"
      : new Date(refTs * 1000).toLocaleDateString("en-NZ", { timeZone: TZ, weekday: "long" });
    const date = new Date(refTs * 1000).toLocaleDateString("en-NZ", { timeZone: TZ, day: "numeric", month: "short" });

    const pick = (arr, fn) => arr.length ? arr.reduce((b, h) => fn(h) > fn(b) ? h : b, arr[0]) : null;
    const pickMin = (arr, fn) => arr.length ? arr.reduce((b, h) => fn(h) < fn(b) ? h : b, arr[0]) : null;

    const hiSlot = slots.length ? pick(slots, h => h.temperature) : null;
    const loSlot = slots.length ? pickMin(slots, h => h.temperature) : null;
    const humHiSlot = slots.length ? pick(slots, h => h.relativeHumidity) : null;
    const humLoSlot = slots.length ? pickMin(slots, h => h.relativeHumidity) : null;
    const windSlot  = slots.length ? pick(slots, h => h.windSpeed) : null;

    const totalMm   = slots.length ? +slots.reduce((s, h) => s + (h.qpf || 0), 0).toFixed(1) : null;
    const maxChance = slots.length ? Math.max(...slots.map(h => h.precipChance || 0)) : null;

    const peakUV = slots.length
      ? (function() { let max = -Infinity; slots.forEach(h => { if (h.uvIndex != null && h.uvIndex > max) max = h.uvIndex; }); return max === -Infinity ? null : max; })()
      : null;

    const uvFmt = ts => new Date(ts * 1000)
      .toLocaleTimeString("en-NZ", { timeZone: TZ, hour: "numeric", hour12: true })
      .replace(/ (am|pm)$/i, "$1");
    const uvSlots = slots.filter(h => (h.uvIndex || 0) >= 3);
    const uvWindow = uvSlots.length
      ? uvFmt(uvSlots[0].validTimeUtc) + "–" + uvFmt(uvSlots[uvSlots.length - 1].validTimeUtc + 3600)
      : null;

    const presHiSlot = slots.length ? pick(slots, h => h.pressureMeanSeaLevel) : null;
    const presLoSlot = slots.length ? pickMin(slots, h => h.pressureMeanSeaLevel) : null;

    return {
      label, date,
      sunrise: d.sunriseTimeUtc || null,
      sunset:  d.sunsetTimeUtc  || null,
      temp: {
        max: { val: d.calendarDayTemperatureMax, utcSec: hiSlot ? hiSlot.validTimeUtc : null },
        min: { val: d.calendarDayTemperatureMin, utcSec: loSlot ? loSlot.validTimeUtc : null },
      },
      humidity: {
        max: { val: humHiSlot ? humHiSlot.relativeHumidity : null, utcSec: humHiSlot ? humHiSlot.validTimeUtc : null },
        min: { val: humLoSlot ? humLoSlot.relativeHumidity : null, utcSec: humLoSlot ? humLoSlot.validTimeUtc : null },
      },
      wind: {
        speed:    windSlot ? windSlot.windSpeed : null,
        cardinal: windSlot ? (windSlot.windDirectionCardinal || degToCard(windSlot.windDirection)) : null,
        utcSec:   windSlot ? windSlot.validTimeUtc : null,
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
  function renderDayCard(el, fc) {
    if (!el) return;
    const fmtH = utcSec => !utcSec ? "—" :
      new Date(utcSec * 1000).toLocaleTimeString("en-NZ", { timeZone: TZ, hour: "numeric", hour12: true }).replace(/ (am|pm)$/i, "$1");
    const fmtHM = utcSec => !utcSec ? "—" :
      new Date(utcSec * 1000).toLocaleTimeString("en-NZ", { timeZone: TZ, hour: "numeric", minute: "2-digit", hour12: true }).replace(/ (am|pm)$/i, "$1");
    const n = (v, suffix) => v != null ? v + (suffix || "") : "—";

    if (!fc) {
      el.innerHTML = '<div class="dc-label"><span class="dc-day">—</span></div>';
      return;
    }

    const hiTemp = fc.temp.max.val != null ? Math.round(fc.temp.max.val) + "°" : "—";
    const loTemp = fc.temp.min.val != null ? Math.round(fc.temp.min.val) + "°" : "—";
    const hiTime = fmtH(fc.temp.max.utcSec);
    const loTime = fmtH(fc.temp.min.utcSec);
    const humHi  = n(fc.humidity.max.val, "%");
    const humHiT = fmtH(fc.humidity.max.utcSec);
    const humLo  = n(fc.humidity.min.val, "%");
    const humLoT = fmtH(fc.humidity.min.utcSec);

    const windStr = fc.wind.speed != null
      ? `${fc.wind.speed} km/h ${fc.wind.cardinal || ""} at ${fmtH(fc.wind.utcSec)}`
      : "—";
    const precipStr = (fc.precip.totalMm != null && fc.precip.maxChance != null)
      ? `${fc.precip.totalMm} mm · ${fc.precip.maxChance}%`
      : "—";

    const uvPeak = fc.uv.peak != null ? uvLabel(fc.uv.peak) : "—";
    const uvWin  = fc.uv.window || "Below 3";
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
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--sunset)" stroke-width="2">
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

  // ── Hourly strip (next N hours) ────────────────────────────────────────
  function renderHourlyStrip(hourly, count = 10) {
    const el = document.getElementById("hourly-strip");
    if (!el) return;
    const nowSec = Date.now() / 1000;
    // Find first hour ≥ now; show that + next N-1 hours
    let startIdx = hourly.findIndex(h => (h.validTimeUtc || 0) >= nowSec);
    if (startIdx < 0) startIdx = 0;
    // Step back one so we include the "current" hour as NOW
    if (startIdx > 0) startIdx -= 1;
    const slice = hourly.slice(startIdx, startIdx + count);

    el.innerHTML = slice.map((h, i) => {
      const time = i === 0 ? "Now" : new Date(h.validTimeUtc * 1000)
        .toLocaleTimeString("en-NZ", { timeZone: TZ, hour: "numeric", hour12: true })
        .replace(/ (am|pm)$/i, "$1");
      const temp   = h.temperature != null ? `${Math.round(h.temperature)}°` : "—";
      const icon   = iconFor(h.iconCode, h.dayOrNight);
      const chance = h.precipChance ?? 0;
      const showPp = chance >= 10;
      return `
        <div class="hour-cell${i === 0 ? " now" : ""}">
          <span class="hour-time">${time}</span>
          <span class="hour-icon" aria-hidden="true">${icon}</span>
          <span class="hour-temp">${temp}</span>
          <span class="hour-precip ${showPp ? "" : "zero"}">${showPp ? chance + "%" : "·"}</span>
        </div>`;
    }).join("");
  }

  // ── Today aggregates ────────────────────────────────────────────────────
  function todayAggregates(hourly) {
    const nowDate = new Date().toLocaleDateString("en-NZ", {
      timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
    });
    const todayHours = hourly.filter(h => {
      if (!h.validTimeUtc) return false;
      return new Date(h.validTimeUtc * 1000)
        .toLocaleDateString("en-NZ", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }) === nowDate;
    });
    if (!todayHours.length) return { rainMm: null, peakChance: null, peakWind: null, peakGust: null };
    return {
      rainMm:     +todayHours.reduce((s, h) => s + (h.qpf || 0), 0).toFixed(1),
      peakChance: Math.max(...todayHours.map(h => h.precipChance || 0)),
      peakWind:   Math.max(...todayHours.map(h => h.windSpeed || 0)),
      peakGust:   Math.max(...todayHours.map(h => h.windGust  || 0)),
    };
  }

  /** Compare current pressure to 3-hours-ago to derive a rising/steady/falling trend. */
  function pressureTrend(hourly, currentPressure) {
    if (currentPressure == null) return null;
    const nowSec = Date.now() / 1000;
    const past = hourly.find(h => h.validTimeUtc && Math.abs(h.validTimeUtc - (nowSec - 3 * 3600)) < 1800);
    if (!past || past.pressureMeanSeaLevel == null) return null;
    const delta = currentPressure - past.pressureMeanSeaLevel;
    if (Math.abs(delta) < 0.5) return "steady";
    return delta > 0 ? "rising" : "falling";
  }
  function populateCard(data) {
    const c = data.current || {};
    const t = data.today   || {};
    const el = id => document.getElementById(id);

    el("last-updated").textContent = fmtRelative(data.meta?.updated);

    el("current-temp").textContent      = c.temp  != null ? `${Math.round(c.temp)}°` : "—°";
    el("current-condition").textContent = c.condition || c.cloudPhrase || "—";
    el("current-feels").textContent     = c.feelsLike != null ? `Feels like ${Math.round(c.feelsLike)}°` : "";
    el("current-icon").textContent      = iconFor(c.iconCode, isDaytime(c) ? "D" : "N");

    const hl = todayHighLow(data.hourly || [], data.daily || []);
    if (hl) {
      el("today-high").textContent      = `${Math.round(hl.high.temp)}°`;
      el("today-high-time").textContent = fmtHourOnly(hl.high.utcSec);
      el("today-low").textContent       = `${Math.round(hl.low.temp)}°`;
      el("today-low-time").textContent  = fmtHourOnly(hl.low.utcSec);
    }

    // Hourly strip
    renderHourlyStrip(data.hourly || [], 10);

    // Today aggregates
    const agg = todayAggregates(data.hourly || []);

    el("humidity").textContent  = c.humidity  != null ? `${c.humidity}%` : "—";
    el("wind").textContent      = c.windSpeed != null ? `${c.windSpeed} km/h` : "—";
    el("wind-dir").textContent  = c.windCardinal || (c.windDirection != null ? degToCard(c.windDirection) : "");

    // Gust: current value, fallback to today's peak
    const gustVal = c.windGust != null ? c.windGust : agg.peakGust;
    el("gust").textContent = gustVal != null ? `${Math.round(gustVal)} km/h` : "—";

    el("pressure").textContent  = c.pressure  != null ? `${Math.round(c.pressure)} hPa` : "—";
    const trend = pressureTrend(data.hourly || [], c.pressure);
    const trendArrow = trend === "rising" ? "↑ Rising" : trend === "falling" ? "↓ Falling" : trend === "steady" ? "→ Steady" : "Pressure";
    const ptEl = el("pressure-trend");
    if (ptEl) ptEl.textContent = trendArrow;

    // Dew point
    el("dewpoint").textContent = c.dewPoint != null ? `${Math.round(c.dewPoint)}°` : "—";

    // Cloud cover (current hour from hourly)
    const nowSec = Date.now() / 1000;
    const currentHour = (data.hourly || []).find(h => (h.validTimeUtc || 0) >= nowSec - 1800)
                     || (data.hourly || [])[0];
    el("cloud-cover").textContent = currentHour && currentHour.cloudCover != null
      ? `${currentHour.cloudCover}%` : "—";

    // Rain today
    el("rain-today").textContent = agg.rainMm != null ? `${agg.rainMm} mm` : "—";
    const rcEl = el("rain-chance");
    if (rcEl) rcEl.textContent = agg.peakChance != null ? `Peak ${agg.peakChance}%` : "Rain today";

    const { peakUV, uvWindow } = uvInfo(data.hourly || []);
    const uvBase = uvLabel(c.uvIndex);
    const uvPeak = (peakUV != null && peakUV > (c.uvIndex ?? -1)) ? ` (${uvLabel(peakUV)})` : "";
    el("uv-index").textContent = c.uvIndex != null ? `${uvBase}${uvPeak}` : "—";
    el("uv-label").textContent = uvWindow ? `UV >3 · ${uvWindow}` : "UV >3";

    el("sunrise").textContent    = fmtShortTime(c.sunriseUtc);
    el("sunset").textContent     = fmtShortTime(c.sunsetUtc);
    el("moon-phase").textContent = t.moonPhase || "—";
    el("moon-emoji").textContent = MOON_EMOJI[t.moonPhaseCode] || "🌕";

    populateTides();

    // Render up to 4 future day cards
    for (let i = 1; i <= 4; i++) {
      renderDayCard(
        document.getElementById(`day-card-${i}`),
        buildDayForecast(i, data.hourly || [], data.daily || [])
      );
    }
  }

  function degToCard(deg) {
    const dirs = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];
    return dirs[Math.round(deg / 22.5) % 16];
  }

  /** True when 'now' is between sunrise and sunset for this location. */
  function isDaytime(c) {
    const now = Date.now() / 1000;
    if (c.sunriseUtc && c.sunsetUtc) return now >= c.sunriseUtc && now <= c.sunsetUtc;
    return true;
  }

  // ── Live refresh ──────────────────────────────────────────────────────
  function buildCurrentFromPws(payload, existing) {
    return Object.assign({}, existing, {
      temp: payload.temp, feelsLike: payload.feelsLike,
      humidity: payload.humidity, windSpeed: payload.windSpeed,
      windGust: payload.windGust, windDirection: payload.windDirection,
      windCardinal: payload.windCardinal, pressure: payload.pressure,
      uvIndex: payload.uvIndex,
      ...(payload.condition != null && { condition: payload.condition }),
    });
  }

  function updateLiveFields(c, fetchedAt, hourly) {
    const el = id => document.getElementById(id);
    el("current-temp").textContent  = c.temp      != null ? `${Math.round(c.temp)}°`                  : "—°";
    el("current-feels").textContent = c.feelsLike != null ? `Feels like ${Math.round(c.feelsLike)}°`  : "";
    el("humidity").textContent      = c.humidity  != null ? `${c.humidity}%`                          : "—";
    el("wind").textContent          = c.windSpeed != null ? `${c.windSpeed} km/h`                     : "—";
    el("wind-dir").textContent      = c.windCardinal || (c.windDirection != null ? degToCard(c.windDirection) : "");
    el("pressure").textContent      = c.pressure  != null ? `${Math.round(c.pressure)} hPa`           : "—";

    // New stats — keep in sync on live tick
    const gustEl = el("gust");
    if (gustEl) gustEl.textContent = c.windGust != null ? `${Math.round(c.windGust)} km/h` : gustEl.textContent;
    const dpEl = el("dewpoint");
    if (dpEl && c.dewPoint != null) dpEl.textContent = `${Math.round(c.dewPoint)}°`;
    const iconEl = el("current-icon");
    if (iconEl) iconEl.textContent = iconFor(c.iconCode, isDaytime(c) ? "D" : "N");
    const trend = pressureTrend(hourly || [], c.pressure);
    const ptEl = el("pressure-trend");
    if (ptEl && trend) ptEl.textContent = trend === "rising" ? "↑ Rising" : trend === "falling" ? "↓ Falling" : "→ Steady";

    const { peakUV, uvWindow } = uvInfo(hourly || []);
    const liveBase  = uvLabel(c.uvIndex);
    const livePkStr = (peakUV != null && peakUV > (c.uvIndex ?? -1)) ? ` (${uvLabel(peakUV)})` : "";
    el("uv-index").textContent = c.uvIndex != null ? `${liveBase}${livePkStr}` : "—";
    el("uv-label").textContent = uvWindow ? `UV >3 · ${uvWindow}` : "UV >3";
    if (c.condition) el("current-condition").textContent = c.condition;

    if (fetchedAt) {
      const t = new Date(fetchedAt).toLocaleTimeString("en-NZ", {
        timeZone: TZ, hour: "numeric", minute: "2-digit", hour12: true,
      });
      el("last-updated").textContent = `Live · ${t}`;
    }
  }

  function startLiveRefresh(data) {
    if (!WORKER_URL) return;
    async function tick() {
      try {
        const resp = await fetch(WORKER_URL, { cache: "no-store" });
        if (!resp.ok) throw new Error(`Worker HTTP ${resp.status}`);
        const payload = await resp.json();
        if (payload.error) throw new Error(payload.error);
        data.current = buildCurrentFromPws(payload, data.current);
        const displayTs = payload.obsTimeUtc ?? payload.fetchedAt;
        updateLiveFields(data.current, displayTs, data.hourly);
      } catch (err) {
        console.warn("[WeatherTempo] Live refresh failed:", err.message);
      }
    }
    tick();
    setInterval(tick, REFRESH_INTERVAL_MS);
  }

  // ── Tides ─────────────────────────────────────────────────────────────────
  function populateTides() {
    const list   = document.getElementById("tides-list");
    const canvas = document.getElementById("tide-mini-chart");

    // Now indicator: current height + trend (rising/falling)
    const nowMs   = Date.now();
    const nowH    = Tides.tideHeight(nowMs);
    const nextH   = Tides.tideHeight(nowMs + 30 * 60_000);
    const trend   = nextH > nowH ? "rising" : "falling";
    const trendEl = document.getElementById("tides-now-trend");
    const valEl   = document.getElementById("tides-now-value");
    if (valEl)   valEl.textContent = `${nowH.toFixed(2)} m`;
    if (trendEl) {
      trendEl.textContent = trend === "rising" ? "↑ Rising" : "↓ Falling";
      trendEl.classList.toggle("rising",  trend === "rising");
      trendEl.classList.toggle("falling", trend !== "rising");
    }

    const events = Tides.getNextTides(6);
    if (!events.length) {
      list.innerHTML = '<span class="tide-loading">No tide data available</span>';
      return;
    }

    list.innerHTML = events.map((ev, i) => {
      const isHigh  = ev.type === "high";
      const emoji   = isHigh ? "🌊" : "🏖️";
      const typeStr = isHigh ? "High Tide" : "Low Tide";
      const timeStr = ev.time.toLocaleTimeString("en-NZ", { timeZone: TZ, hour: "numeric", minute: "2-digit", hour12: true });
      const dayStr  = ev.time.toLocaleDateString("en-NZ", { timeZone: TZ, weekday: "short" });
      const today   = new Date().toLocaleDateString("en-NZ", { timeZone: TZ, weekday: "short" });
      const dayLbl  = dayStr === today ? "" : ` <span class="dc-val-muted">${dayStr}</span>`;
      const countdown = fmtCountdown(ev.time.getTime());
      const cls = i === 0 ? "tide-event next" : "tide-event";
      return `
        <div class="${cls}">
          <span class="tide-event-icon">${emoji}</span>
          <div class="tide-info">
            <div class="tide-type">${typeStr}</div>
            <div class="tide-time">${timeStr}${dayLbl}</div>
          </div>
          <span class="tide-height">${ev.height.toFixed(1)} m</span>
          <span class="tide-countdown">${countdown}</span>
        </div>`;
    }).join("");

    drawTideMiniChart(canvas);
  }

  // ── Tide mini-chart ───────────────────────────────────────────────────────
  function drawTideMiniChart(canvas) {
    if (!canvas) return;
    const pts    = Tides.getTodayCurve();
    const events = Tides.findTideEvents(pts[0].time.getTime(), pts[pts.length - 1].time.getTime());

    const section = canvas.closest(".tides-card");
    let tip = document.getElementById("tide-tooltip");
    if (!tip) { tip = document.createElement("div"); tip.id = "tide-tooltip"; section.appendChild(tip); }

    const startMs = pts[0].time.getTime();
    const spanMs  = pts[pts.length - 1].time.getTime() - startMs;
    const cs = getComputedStyle(document.documentElement);
    const colorCurve = cs.getPropertyValue("--tide-curve").trim() || "rgba(60,200,255,0.9)";
    const colorFillA = cs.getPropertyValue("--tide-fill-a").trim();
    const colorFillB = cs.getPropertyValue("--tide-fill-b").trim();
    const colorFillC = cs.getPropertyValue("--tide-fill-c").trim();
    const colorBg    = cs.getPropertyValue("--tide-canvas").trim();
    const colorAccentWarm = cs.getPropertyValue("--accent-warm").trim();
    const colorAccentCyan = cs.getPropertyValue("--accent-cyan").trim();
    const colorText  = cs.getPropertyValue("--text").trim();
    const colorMuted = cs.getPropertyValue("--text-muted").trim();

    canvas.onmousemove = (e) => {
      const rect  = canvas.getBoundingClientRect();
      const frac  = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const hoverMs = startMs + frac * spanMs;
      const height  = +Tides.tideHeight(hoverMs).toFixed(2);
      const nearest = events.reduce((best, ev) => {
        const d = Math.abs(ev.time.getTime() - hoverMs);
        return d < (best?.d ?? Infinity) ? { ev, d } : best;
      }, null);
      const nearLabel = nearest && nearest.d < 90 * 60_000
        ? ` · <span style="color:${nearest.ev.type === "high" ? colorAccentWarm : colorAccentCyan}">${nearest.ev.type === "high" ? "High" : "Low"}</span>`
        : "";
      const timeStr = new Date(hoverMs).toLocaleTimeString("en-NZ", { timeZone: TZ, hour: "numeric", minute: "2-digit", hour12: true });
      const dateStr = new Date(hoverMs).toLocaleDateString("en-NZ", { timeZone: TZ, weekday: "short", day: "numeric", month: "short" });
      tip.innerHTML = `
        <div class="tt-time" style="color:${colorAccentWarm}">${dateStr} ${timeStr}${nearLabel}</div>
        <div class="tt-row">
          <span class="tt-label">Height</span>
          <span class="tt-val">${height} m</span>
        </div>`;
      tip.style.display = "block";

      const sectionRect = section.getBoundingClientRect();
      const tipW        = tip.offsetWidth;
      const canvasRect  = canvas.getBoundingClientRect();
      const cursorLeft  = e.clientX - sectionRect.left;
      const canvasTop   = canvasRect.top - sectionRect.top;
      tip.style.top  = `${canvasTop - tip.offsetHeight - 6}px`;
      tip.style.left = cursorLeft + tipW + 8 > sectionRect.width
        ? `${cursorLeft - tipW - 8}px`
        : `${cursorLeft + 8}px`;
    };
    canvas.onmouseleave = () => { tip.style.display = "none"; };

    const dpr = window.devicePixelRatio || 1;
    const W   = canvas.offsetWidth  || 280;
    const H   = canvas.offsetHeight || 180;
    canvas.width  = W * dpr;
    canvas.height = H * dpr;
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);

    const PAD_V = 20;
    const PAD_H = 10;
    const heights = pts.map(p => p.height);
    const hMin = Math.min(...heights) - 0.15;
    const hMax = Math.max(...heights) + 0.15;
    const xOf = (i) => PAD_H + (i / (pts.length - 1)) * (W - PAD_H * 2);
    const yOf = (h) => H - PAD_V - ((h - hMin) / (hMax - hMin)) * (H - PAD_V * 2);

    ctx.fillStyle = colorBg;
    ctx.fillRect(0, 0, W, H);

    // Horizontal mid-tide grid
    ctx.strokeStyle = colorMuted;
    ctx.globalAlpha = 0.18;
    ctx.lineWidth   = 0.5;
    const midY = yOf((hMin + hMax) / 2);
    ctx.beginPath();
    ctx.setLineDash([3, 4]);
    ctx.moveTo(0, midY); ctx.lineTo(W, midY); ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    // Filled area
    const areaGrad = ctx.createLinearGradient(0, PAD_V, 0, H);
    areaGrad.addColorStop(0,   colorFillA);
    areaGrad.addColorStop(0.6, colorFillB);
    areaGrad.addColorStop(1,   colorFillC);

    const buildPath = () => {
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
    };

    buildPath();
    ctx.lineTo(xOf(pts.length - 1), H); ctx.lineTo(xOf(0), H); ctx.closePath();
    ctx.fillStyle = areaGrad;
    ctx.fill();

    buildPath();
    ctx.strokeStyle = colorCurve;
    ctx.lineWidth   = 2.2;
    ctx.shadowColor = colorCurve;
    ctx.shadowBlur  = 6;
    ctx.stroke();
    ctx.shadowBlur  = 0;

    // High/low markers with labels
    const start = pts[0].time.getTime();
    const span  = pts[pts.length - 1].time.getTime() - start;
    ctx.font = "11px " + (cs.getPropertyValue("--font") || "sans-serif");
    ctx.textAlign = "center";
    events.forEach(ev => {
      const frac = (ev.time.getTime() - start) / span;
      if (frac < 0 || frac > 1) return;
      const ex = xOf(Math.round(frac * (pts.length - 1)));
      const ey = yOf(ev.height);
      const color = ev.type === "high" ? colorAccentWarm : colorAccentCyan;
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(ex, ey, 4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = color;
      const lblY = ev.type === "high" ? ey - 9 : ey + 16;
      ctx.fillText(`${ev.height.toFixed(1)}m`, ex, lblY);
    });

    // "Now" marker
    const now   = Date.now();
    const nfrac = (now - start) / span;
    if (nfrac >= 0 && nfrac <= 1) {
      const nx = PAD_H + nfrac * (W - PAD_H * 2);
      const ny = yOf(Tides.tideHeight(now));
      ctx.strokeStyle = colorText;
      ctx.globalAlpha = 0.5;
      ctx.lineWidth   = 1;
      ctx.setLineDash([2, 3]);
      ctx.beginPath(); ctx.moveTo(nx, 0); ctx.lineTo(nx, H); ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      ctx.fillStyle = colorText;
      ctx.beginPath(); ctx.arc(nx, ny, 4, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = colorBg;
      ctx.lineWidth   = 1.5;
      ctx.stroke();

      // "Now" label
      ctx.font = "10px " + (cs.getPropertyValue("--font") || "sans-serif");
      ctx.fillStyle = colorMuted;
      ctx.textAlign = nfrac > 0.5 ? "right" : "left";
      ctx.fillText("NOW", nx + (nfrac > 0.5 ? -8 : 8), 12);
    }
  }

  // ── Chart ─────────────────────────────────────────────────────────────────
  function initChart(hourly, currentMeta, days = 3) {
    const canvas = document.getElementById("weather-chart");
    const scroll = document.getElementById("chart-scroll");
    if (!canvas || !hourly.length) return;

    if (initChart._abort) initChart._abort.abort();
    scroll.querySelectorAll("canvas:not(#weather-chart)").forEach(c => c.remove());
    const oldTip = document.getElementById("chart-tooltip");
    if (oldTip) oldTip.remove();

    const ac  = new AbortController();
    initChart._abort = ac;
    const sig = ac.signal;

    const sliced = hourly.slice(0, days * 24);
    const chart = new WeatherChart(canvas, sliced, {
      sunriseUtc: currentMeta?.sunriseUtc,
      sunsetUtc:  currentMeta?.sunsetUtc,
      days,
    });
    chart.render();
    chart.scrollToNow(scroll);
    chart.initHover(scroll, sig);

    let isDown = false, startX = 0, startLeft = 0;
    scroll.addEventListener("mousedown", e => { isDown = true; startX = e.pageX; startLeft = scroll.scrollLeft; }, { signal: sig });
    window.addEventListener("mouseup",   () => { isDown = false; }, { signal: sig });
    window.addEventListener("mousemove", e => {
      if (!isDown) return;
      scroll.scrollLeft = startLeft - (e.pageX - startX);
    }, { signal: sig });
  }

  // ── Sample / fallback data ────────────────────────────────────────────────
  function generateSampleData() {
    const hours  = [];
    const baseMs = Math.floor(Date.now() / 3_600_000) * 3_600_000;
    for (let i = 0; i < 120; i++) {
      const ts = Math.round((baseMs + i * 3_600_000) / 1000);
      const lh = (+new Date(ts * 1000).toLocaleString("en-NZ", { timeZone: TZ, hour: "numeric", hour12: false }) + 24) % 24;
      const cos_arg = 2 * Math.PI * (lh - 14) / 24;
      const temp  = +(18 + 7  * Math.cos(cos_arg)).toFixed(1);
      const feels = +(temp - 1.5 + Math.sin(i * 0.3) * 0.8).toFixed(1);
      const cc    = Math.max(0, Math.min(90, Math.round(35 + 30 * Math.sin(i * 0.12 + 1.5))));
      const pp    = Math.max(0, Math.min(80, Math.round(20 + 25 * Math.sin(i * 0.10 + 2))));
      const qpf   = pp > 45 ? +(0.4 * Math.sin(i * 0.10 + 2)).toFixed(2) : 0;
      hours.push({
        validTimeUtc: ts, temperature: temp, temperatureFeelsLike: feels,
        relativeHumidity: Math.max(40, Math.min(90, Math.round(65 - 10 * Math.cos(cos_arg)))),
        windSpeed: Math.round(13 + 5  * Math.sin(i * 0.2)),
        windDirection: Math.round(240 + 20 * Math.sin(i * 0.15)),
        windDirectionCardinal: "WSW",
        windGust: Math.round(16 + 5  * Math.abs(Math.sin(i * 0.2))),
        cloudCover: cc, qpf, precipChance: pp, precipType: "rain",
        pressureMeanSeaLevel: +(1013 + 4 * Math.sin(i * 0.03)).toFixed(1),
        uvIndex: (lh >= 7 && lh <= 18) ? Math.max(0, Math.round(7 * Math.sin(Math.PI * (lh - 6) / 12))) : 0,
        iconCode: cc < 30 ? 32 : cc < 60 ? 30 : 26,
        dayOrNight: (lh >= 7 && lh < 19) ? "D" : "N",
        wxPhraseMedium: cc < 25 ? "Sunny" : cc < 60 ? "Partly Cloudy" : "Mostly Cloudy",
      });
    }
    const nowTs = Math.round(Date.now() / 1000);
    const daily = Array.from({ length: 5 }, (_, d) => ({
      calendarDayTemperatureMax: 25 - d * 0.5,
      calendarDayTemperatureMin: 11 - d * 0.3,
      temperatureMax: 25 - d * 0.5, temperatureMin: 11 - d * 0.3,
      sunriseTimeUtc: nowTs + d * 86400 - 3 * 3600,
      sunsetTimeUtc:  nowTs + d * 86400 + 6 * 3600,
    }));
    return {
      meta: { updated: new Date().toISOString(), location: "Christchurch, New Zealand (sample)", lat: -43.5321, lon: 172.6362 },
      current: {
        temp: hours[0].temperature, feelsLike: hours[0].temperatureFeelsLike,
        humidity: hours[0].relativeHumidity, pressure: hours[0].pressureMeanSeaLevel,
        windSpeed: hours[0].windSpeed, windGust: hours[0].windGust,
        windDirection: hours[0].windDirection, windCardinal: "WSW",
        uvIndex: hours[0].uvIndex, cloudPhrase: hours[0].wxPhraseMedium,
        condition: hours[0].wxPhraseMedium, iconCode: hours[0].iconCode,
        sunriseUtc: nowTs - 3 * 3600, sunsetUtc:  nowTs + 6 * 3600,
      },
      today: { moonPhase: "Waxing Crescent", moonPhaseCode: "WXC", moonPhaseDay: 5 },
      hourly: hours, daily,
    };
  }

  // ── Theme handling ─────────────────────────────────────────────────────
  function getStoredTheme() {
    try { return localStorage.getItem("weatherTempo.theme"); } catch { return null; }
  }
  function storeTheme(t) {
    try { localStorage.setItem("weatherTempo.theme", t); } catch {}
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    storeTheme(theme);
  }

  function initTheme(rerender) {
    const stored = getStoredTheme();
    const initial = stored || (window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
    applyTheme(initial);

    const btn = document.getElementById("theme-toggle");
    if (btn) {
      btn.addEventListener("click", () => {
        const now = document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light";
        applyTheme(now);
        // Re-render canvas-based UI (chart + tide chart) so colors update
        rerender();
      });
    }
  }

  // ── Boot ──────────────────────────────────────────────────────────────────
  async function boot() {
    let data;
    try {
      const resp = await fetch("data/weather.json");
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      data = await resp.json();
      if (!data.hourly || data.hourly.length < 10) throw new Error("empty");
    } catch (e) {
      console.warn("Using sample data:", e.message);
      data = generateSampleData();
    }

    const zoomSel = document.getElementById("chart-zoom");
    if (zoomSel) {
      try {
        const stored = localStorage.getItem("weatherTempo.chartDays");
        const validValues = Array.from(zoomSel.options).map(o => o.value);
        if (stored && validValues.includes(stored)) zoomSel.value = stored;
      } catch (_) {}
    }

    const renderEverything = () => {
      populateCard(data);
      initChart(data.hourly, data.current, zoomSel ? +zoomSel.value : 3);
    };

    // Theme must be applied before first paint so canvases pick up the right colors
    initTheme(() => {
      // Re-populate (redraws the tide canvas) and re-init the forecast chart
      populateCard(data);
      initChart(data.hourly, data.current, zoomSel ? +zoomSel.value : 3);
    });

    renderEverything();

    if (zoomSel) {
      zoomSel.addEventListener("change", () => {
        initChart(data.hourly, data.current, +zoomSel.value);
        try { localStorage.setItem("weatherTempo.chartDays", zoomSel.value); } catch (_) {}
      });
    }

    let resizeTimer;
    let roFirstRun = true;
    const chartSection = document.querySelector(".chart-section");
    if (chartSection && window.ResizeObserver) {
      new ResizeObserver(() => {
        if (roFirstRun) { roFirstRun = false; return; }
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
          initChart(data.hourly, data.current, zoomSel ? +zoomSel.value : 3);
        }, 150);
      }).observe(chartSection);
    }

    // Also redraw tide chart on resize (its container is flexible)
    const tideCard = document.querySelector(".tides-card");
    if (tideCard && window.ResizeObserver) {
      let tideTimer;
      let tideFirst = true;
      new ResizeObserver(() => {
        if (tideFirst) { tideFirst = false; return; }
        clearTimeout(tideTimer);
        tideTimer = setTimeout(() => drawTideMiniChart(document.getElementById("tide-mini-chart")), 120);
      }).observe(tideCard);
    }

    // Refresh tide countdowns every minute
    setInterval(() => {
      const events = Tides.getNextTides(6);
      document.querySelectorAll("#tides-list .tide-event").forEach((el, i) => {
        const ev = events[i];
        if (!ev) return;
        const cd = el.querySelector(".tide-countdown");
        if (cd) cd.textContent = fmtCountdown(ev.time.getTime());
      });
    }, 60_000);

    startLiveRefresh(data);
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
