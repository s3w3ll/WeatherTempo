/**
 * app.js — Initialises the WeatherTempo dashboard.
 *
 * Flow:
 *  1. Read selected location from localStorage (default: christchurch).
 *  2. Fetch full weather payload from Cloudflare Worker (?location=id).
 *  3. Populate the conditions card (current temp, high/low + times, stats,
 *     astronomy, tides).
 *  4. Render the WeatherGraph-style canvas chart.
 *
 * If the Worker is unavailable, fall back to synthetic sample data
 * (all temperatures = 101°, visibly fake).
 */

(function () {
  "use strict";

  // Set dynamically from selected location on boot
  let TZ = "Pacific/Auckland";

  // ── Worker (full-payload, multi-location) ────────────────────────────────
  const WORKER_URL = "https://weathertempo-pws-proxy.forgesync.workers.dev";
  const REFRESH_INTERVAL_MS = 5 * 60 * 1000;   // 5 minutes

  // ── Location config (mirrors src/locations.js for use inside this IIFE) ─
  const LOCATIONS = [
    { id: "kaitaia",          name: "Kaitaia",          region: "New Zealand", lat: -35.1136, lon: 173.2655, timezone: "Pacific/Auckland", pwsStation: null,       tidePort: "auckland",      tideLabel: "Kaitaia — Tides" },
    { id: "whangarei",        name: "Whangārei",        region: "New Zealand", lat: -35.7275, lon: 174.3236, timezone: "Pacific/Auckland", pwsStation: null,       tidePort: "auckland",      tideLabel: "Whangārei — Tides" },
    { id: "auckland",         name: "Auckland",         region: "New Zealand", lat: -36.8485, lon: 174.7633, timezone: "Pacific/Auckland", pwsStation: null,       tidePort: "auckland",      tideLabel: "Auckland — Tides" },
    { id: "tauranga",         name: "Tauranga",         region: "New Zealand", lat: -37.6878, lon: 176.1651, timezone: "Pacific/Auckland", pwsStation: null,       tidePort: "tauranga",     tideLabel: "Tauranga — Tides" },
    { id: "hamilton",         name: "Hamilton",         region: "New Zealand", lat: -37.7870, lon: 175.2793, timezone: "Pacific/Auckland", pwsStation: null,       tidePort: null,            tideLabel: null },
    { id: "gisborne",         name: "Gisborne",         region: "New Zealand", lat: -38.6623, lon: 178.0176, timezone: "Pacific/Auckland", pwsStation: null,       tidePort: "gisborne",     tideLabel: "Gisborne — Tides" },
    { id: "rotorua",          name: "Rotorua",          region: "New Zealand", lat: -38.1368, lon: 176.2497, timezone: "Pacific/Auckland", pwsStation: null,       tidePort: null,            tideLabel: null },
    { id: "taupo",            name: "Taupō",            region: "New Zealand", lat: -38.6857, lon: 176.0702, timezone: "Pacific/Auckland", pwsStation: null,       tidePort: null,            tideLabel: null },
    { id: "new-plymouth",     name: "New Plymouth",     region: "New Zealand", lat: -39.0556, lon: 174.0752, timezone: "Pacific/Auckland", pwsStation: null,       tidePort: "new-plymouth", tideLabel: "New Plymouth — Tides" },
    { id: "napier",           name: "Napier",           region: "New Zealand", lat: -39.4928, lon: 176.9120, timezone: "Pacific/Auckland", pwsStation: null,       tidePort: "napier",       tideLabel: "Napier — Tides" },
    { id: "palmerston-north", name: "Palmerston North", region: "New Zealand", lat: -40.3523, lon: 175.6082, timezone: "Pacific/Auckland", pwsStation: null,       tidePort: null,            tideLabel: null },
    { id: "masterton",        name: "Masterton",        region: "New Zealand", lat: -40.9522, lon: 175.6583, timezone: "Pacific/Auckland", pwsStation: null,       tidePort: null,            tideLabel: null },
    { id: "nelson",           name: "Nelson",           region: "New Zealand", lat: -41.2706, lon: 173.2840, timezone: "Pacific/Auckland", pwsStation: null,       tidePort: "nelson",       tideLabel: "Nelson — Tides" },
    { id: "wellington",       name: "Wellington",       region: "New Zealand", lat: -41.2865, lon: 174.7762, timezone: "Pacific/Auckland", pwsStation: null,       tidePort: "wellington",   tideLabel: "Wellington — Tides" },
    { id: "blenheim",         name: "Blenheim",         region: "New Zealand", lat: -41.5134, lon: 173.9612, timezone: "Pacific/Auckland", pwsStation: null,       tidePort: "blenheim",     tideLabel: "Blenheim — Tides" },
    { id: "westport",         name: "Westport",         region: "New Zealand", lat: -41.7500, lon: 171.5997, timezone: "Pacific/Auckland", pwsStation: null,       tidePort: "westport",     tideLabel: "Westport — Tides" },
    { id: "tekapo",           name: "Tekapo",           region: "New Zealand", lat: -44.0053, lon: 170.4775, timezone: "Pacific/Auckland", pwsStation: null,       tidePort: null,            tideLabel: null },
    { id: "franz-josef",      name: "Franz Josef",      region: "New Zealand", lat: -43.3884, lon: 170.1815, timezone: "Pacific/Auckland", pwsStation: null,       tidePort: null,            tideLabel: null },
    { id: "christchurch",     name: "Christchurch",     region: "New Zealand", lat: -43.5321, lon: 172.6362, timezone: "Pacific/Auckland", pwsStation: "ICHRIS810", tidePort: "lyttelton",  tideLabel: "New Brighton Beach — Tides" },
    { id: "geraldine",        name: "Geraldine",        region: "New Zealand", lat: -44.0900, lon: 171.2356, timezone: "Pacific/Auckland", pwsStation: null,       tidePort: null,            tideLabel: null },
    { id: "timaru",           name: "Timaru",           region: "New Zealand", lat: -44.3960, lon: 171.2553, timezone: "Pacific/Auckland", pwsStation: null,       tidePort: "timaru",       tideLabel: "Timaru — Tides" },
    { id: "queenstown",       name: "Queenstown",       region: "New Zealand", lat: -45.0312, lon: 168.6626, timezone: "Pacific/Auckland", pwsStation: null,       tidePort: null,            tideLabel: null },
    { id: "dunedin",          name: "Dunedin",          region: "New Zealand", lat: -45.8788, lon: 170.5028, timezone: "Pacific/Auckland", pwsStation: null,       tidePort: "dunedin",      tideLabel: "Dunedin — Tides" },
    { id: "invercargill",     name: "Invercargill",     region: "New Zealand", lat: -46.4132, lon: 168.3538, timezone: "Pacific/Auckland", pwsStation: null,       tidePort: "invercargill", tideLabel: "Invercargill — Tides" },
  ];

  function getLocation(id) {
    return LOCATIONS.find(l => l.id === id) ?? LOCATIONS.find(l => l.id === "christchurch");
  }

  // Current active location (set on boot / location change)
  let currentLocation = getLocation("christchurch");

  // ── Error Handling & Resilient Data Fetching ────────────────────────────────
  const DataFetcher = {
    // Configuration
    FETCH_TIMEOUT_MS: 10000,        // 10 second timeout
    MAX_RETRIES: 2,                 // Try 3 times total (1 initial + 2 retries)
    RETRY_DELAY_MS: 1000,           // Start with 1 second delay
    STALENESS_WARNING_MS: 30 * 60 * 1000,  // Warn if data older than 30 min
    STALENESS_ERROR_MS: 2 * 60 * 60 * 1000, // Error if data older than 2 hours

    /**
     * Fetch with timeout support (AbortController polyfill for older browsers).
     */
    async fetchWithTimeout(url, timeoutMs = this.FETCH_TIMEOUT_MS) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const resp = await fetch(url, {
          signal: controller.signal,
          cache: "no-store"
        });
        clearTimeout(timeoutId);
        return resp;
      } catch (err) {
        clearTimeout(timeoutId);
        if (err.name === 'AbortError') {
          throw new Error(`Request timeout after ${timeoutMs}ms`);
        }
        throw err;
      }
    },

    /**
     * Validate that fetched data is well-formed and recent.
     */
    validateData(data) {
      const errors = [];

      // Structure validation
      if (!data || typeof data !== 'object') {
        errors.push("Invalid data structure");
        return errors;
      }

      if (!data.current) errors.push("Missing current conditions");
      if (!data.hourly || !Array.isArray(data.hourly)) errors.push("Missing hourly array");
      if (data.hourly && data.hourly.length < 10) errors.push("Insufficient hourly data");

      // Temperature sanity check (detect the 101° bug)
      if (data.current && data.current.temp !== undefined) {
        const temp = data.current.temp;
        if (temp < -50 || temp > 60) {
          errors.push(`Temperature out of range: ${temp}°C`);
        }
      }

      // Staleness check
      if (data.meta && data.meta.updated) {
        const age = Date.now() - new Date(data.meta.updated).getTime();
        if (age > this.STALENESS_ERROR_MS) {
          errors.push(`Data is ${Math.round(age / 3600000)} hours old`);
        } else if (age > this.STALENESS_WARNING_MS) {
          console.warn(`[WeatherTempo] Data is ${Math.round(age / 60000)} minutes old`);
        }
      }

      return errors;
    },

    /**
     * Attempt to fetch from Worker with retry logic.
     * TODO: Implement your retry strategy
     */
    async fetchFromWorker(locationId) {
      const url = `${WORKER_URL}?location=${encodeURIComponent(locationId)}`;
      let lastError;

      // TODO: Implement retry strategy
      // Decision point: How should retries behave?
      //
      // Options:
      // 1. Exponential backoff: delay = baseDelay * (2 ^ attemptNumber)
      //    Pro: Gives server time to recover
      //    Con: Slower total retry time
      //
      // 2. Fixed delay: same delay between each retry
      //    Pro: Simpler, faster total retry time
      //    Con: May overwhelm recovering server
      //
      // 3. No delay: retry immediately
      //    Pro: Fastest recovery on transient errors
      //    Con: May waste retries on persistent failures
      //
      // Implement your strategy below (current: exponential backoff):

      for (let attempt = 0; attempt <= this.MAX_RETRIES; attempt++) {
        try {
          console.log(`[WeatherTempo] Fetching from Worker (attempt ${attempt + 1}/${this.MAX_RETRIES + 1})...`);

          const resp = await this.fetchWithTimeout(url);

          if (!resp.ok) {
            throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
          }

          const data = await resp.json();

          if (data.error) {
            throw new Error(data.error);
          }

          const validationErrors = this.validateData(data);
          if (validationErrors.length > 0) {
            throw new Error(`Validation failed: ${validationErrors.join(', ')}`);
          }

          console.log(`[WeatherTempo] ✓ Worker fetch successful`);
          return { success: true, data, source: 'worker' };

        } catch (err) {
          lastError = err;
          console.warn(`[WeatherTempo] Worker attempt ${attempt + 1} failed:`, err.message);

          // If not the last attempt, wait before retry
          if (attempt < this.MAX_RETRIES) {
            const delay = this.RETRY_DELAY_MS * Math.pow(2, attempt); // Exponential backoff
            console.log(`[WeatherTempo] Retrying in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }
      }

      return { success: false, error: lastError, source: 'worker' };
    },

    /**
     * Fallback: try to fetch local data/weather.json (for offline/backup).
     */
    async fetchFromLocal() {
      try {
        console.log(`[WeatherTempo] Trying local fallback: data/weather.json`);

        const resp = await this.fetchWithTimeout('/data/weather.json');

        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}`);
        }

        const data = await resp.json();

        const validationErrors = this.validateData(data);
        if (validationErrors.length > 0) {
          console.warn(`[WeatherTempo] Local data validation warnings:`, validationErrors);
          // Still use it, but warn user
        }

        console.log(`[WeatherTempo] ✓ Local fallback successful (may be stale)`);
        return { success: true, data, source: 'local-fallback' };

      } catch (err) {
        console.error(`[WeatherTempo] Local fallback failed:`, err.message);
        return { success: false, error: err, source: 'local' };
      }
    },

    /**
     * Master fetch strategy: Worker → Local → Sample Data.
     */
    async fetch(locationId) {
      // Try Worker first
      let result = await this.fetchFromWorker(locationId);
      if (result.success) {
        return result;
      }

      console.warn(`[WeatherTempo] Worker unavailable, trying local fallback...`);

      // Try local JSON
      result = await this.fetchFromLocal();
      if (result.success) {
        return result;
      }

      // Last resort: generate fake sample data
      console.error(`[WeatherTempo] All data sources failed. Using synthetic sample data.`);
      return {
        success: true,
        data: generateSampleData(),
        source: 'sample-data',
        error: 'All data sources unavailable'
      };
    }
  };

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
  function pressureTrend(hourly) {
    if (!hourly.length) return null;
    const nowSec = Date.now() / 1000;
    const closest = (target) => hourly.reduce((best, h) => {
      if (!h.validTimeUtc || h.pressureMeanSeaLevel == null) return best;
      return Math.abs(h.validTimeUtc - target) < Math.abs((best?.validTimeUtc ?? Infinity) - target) ? h : best;
    }, null);
    const nowSlot  = closest(nowSec);
    const pastSlot = closest(nowSec - 3 * 3600);
    if (!nowSlot || !pastSlot || nowSlot === pastSlot) return null;
    const delta = nowSlot.pressureMeanSeaLevel - pastSlot.pressureMeanSeaLevel;
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
    const d0  = (daily || [])[0];
    const d1  = (daily || [])[1];
    const calMax = d0?.calendarDayTemperatureMax ?? null;

    // Filter today's hours from the hourly forecast (contains only future hours)
    const nowDate = new Date().toLocaleDateString("en-NZ", {
      timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
    });
    const todayHours = hourly.filter(h => {
      if (!h.validTimeUtc) return false;
      return new Date(h.validTimeUtc * 1000)
        .toLocaleDateString("en-NZ", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }) === nowDate;
    });

    // High: calendar-day max with time from forecast if still upcoming
    let hiTime = null;
    if (todayHours.length) {
      const fHi = todayHours.reduce((a, b) => (a.temperature > b.temperature ? a : b));
      if (calMax != null && Math.abs(fHi.temperature - calMax) <= 1) hiTime = fHi.validTimeUtc;
    }
    const highTemp = calMax ?? (todayHours.length ? Math.max(...todayHours.map(h => h.temperature)) : null);

    // Overnight low: tonight's sunset → tomorrow's sunrise
    const nightStart = d0?.sunsetTimeUtc ?? null;
    const nightEnd   = d1?.sunriseTimeUtc ?? null;
    const nightHours = (nightStart && nightEnd)
      ? hourly.filter(h => h.validTimeUtc && h.validTimeUtc >= nightStart && h.validTimeUtc < nightEnd)
      : [];
    const loSlot = nightHours.length
      ? nightHours.reduce((a, b) => (a.temperature < b.temperature ? a : b))
      : null;
    const lowTemp = loSlot?.temperature ?? (todayHours.length ? Math.min(...todayHours.map(h => h.temperature)) : null);
    const loTime  = loSlot?.validTimeUtc ?? null;

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

    // Overnight low: sunset tonight → next-day sunrise (spans calendar boundary)
    const nextD = (daily || [])[dayIndex + 1];
    const nightStart = d.sunsetTimeUtc || null;
    const nightEnd   = nextD ? (nextD.sunriseTimeUtc || null) : null;
    const nightSlots = (nightStart && nightEnd)
      ? (hourly || []).filter(function(h) {
          return h.validTimeUtc && h.validTimeUtc >= nightStart && h.validTimeUtc < nightEnd;
        })
      : [];
    const loSlot = nightSlots.length
      ? pickMin(nightSlots, function(h) { return h.temperature; })
      : (slots.length ? pickMin(slots, function(h) { return h.temperature; }) : null);

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
        min: { val: loSlot ? loSlot.temperature : d.calendarDayTemperatureMin, utcSec: loSlot ? loSlot.validTimeUtc : null },
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
    const trend = pressureTrend(data.hourly || []);
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
    populateTides(currentLocation.tidePort);

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

    renderHourlyTable(data.hourly || []);
  }

  function renderHourlyTable(hourly) {
    const tbody  = document.getElementById("hourly-table-body");
    const toggle = document.getElementById("hourly-table-toggle");
    const wrap   = document.getElementById("hourly-table-wrap");
    if (!tbody) return;

    toggle.addEventListener("click", () => {
      const open = wrap.classList.toggle("open");
      toggle.setAttribute("aria-expanded", open);
    });

    const nowSec  = Date.now() / 1000;
    const maxHrs  = 5 * 24;
    const slots   = hourly.slice(0, maxHrs);
    const fmt     = (v, u) => v != null ? `${Math.round(v)}${u}` : "—";
    const fmt1    = (v, u) => v != null ? `${v.toFixed(1)}${u}` : "—";

    let lastDay = null;
    const rows  = [];

    slots.forEach(h => {
      if (!h.validTimeUtc) return;
      const date     = new Date(h.validTimeUtc * 1000);
      const dayKey   = date.toLocaleDateString("en-NZ", { timeZone: TZ, weekday: "short", month: "short", day: "numeric" });
      const timeStr  = date.toLocaleTimeString("en-NZ", { timeZone: TZ, hour: "numeric", minute: "2-digit", hour12: true });
      const isNow    = Math.abs(h.validTimeUtc - nowSec) < 1800;
      const isDay    = h.dayOrNight === "D";

      if (dayKey !== lastDay) {
        lastDay = dayKey;
        const divRow = document.createElement("tr");
        divRow.className = "hr-day-label";
        const td = document.createElement("td");
        td.colSpan = 12;
        td.textContent = dayKey;
        divRow.appendChild(td);
        rows.push(divRow);
      }

      const tr = document.createElement("tr");
      tr.className = isDay ? "hr-day" : "hr-night";

      const cells = [
        { cls: isNow ? "hr-time hr-now" : "hr-time",  val: isNow ? "Now" : timeStr },
        { cls: "",                                      val: h.wxPhraseMedium || "—" },
        { cls: "hr-temp",   val: fmt1(h.temperature, "°") },
        { cls: "hr-feels",  val: fmt1(h.temperatureFeelsLike, "°") },
        { cls: "",          val: fmt(h.relativeHumidity, "%") },
        { cls: "hr-wind",   val: h.windSpeed != null ? `${Math.round(h.windSpeed)} km/h ${h.windDirectionCardinal || ""}` : "—" },
        { cls: "hr-wind",   val: fmt(h.windGust, " km/h") },
        { cls: "",          val: fmt(h.cloudCover, "%") },
        { cls: "hr-precip", val: fmt(h.precipChance, "%") },
        { cls: "hr-precip", val: h.qpf != null && h.qpf > 0 ? `${h.qpf.toFixed(1)} mm` : "—" },
        { cls: "",          val: fmt1(h.pressureMeanSeaLevel, " hPa") },
        { cls: "",          val: h.uvIndex != null ? uvLabel(h.uvIndex) : "—" },
      ];

      cells.forEach(({ cls, val }) => {
        const td = document.createElement("td");
        if (cls) td.className = cls;
        td.textContent = val;
        tr.appendChild(td);
      });

      rows.push(tr);
    });

    tbody.append(...rows);
  }

  function degToCard(deg) {
    const dirs = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];
    return dirs[Math.round(deg / 22.5) % 16];
  }

  // ── Live refresh helpers ──────────────────────────────────────────────────

  /**
   * Start the 5-minute live refresh loop.
   * Fires one tick immediately on page load (no cold-start delay).
   * On each tick: re-fetch full payload from Worker and re-render the card.
   * Errors are swallowed — existing card values remain visible.
   */
  function startLiveRefresh(onData) {
    if (!WORKER_URL) return;

    let intervalId = null;

    async function tick() {
      try {
        const url  = `${WORKER_URL}?location=${encodeURIComponent(currentLocation.id)}`;
        const resp = await fetch(url, { cache: "no-store" });
        if (!resp.ok) throw new Error(`Worker HTTP ${resp.status}`);
        const data = await resp.json();
        if (data.error) throw new Error(data.error);
        if (!data.hourly || data.hourly.length < 10) throw new Error("empty payload");
        onData(data);
      } catch (err) {
        console.warn("[WeatherTempo] Live refresh failed:", err.message);
      }
    }

    function start() {
      tick();
      intervalId = setInterval(tick, REFRESH_INTERVAL_MS);
    }

    function stop() {
      clearInterval(intervalId);
    }

    start();
    return { start, stop };
  }

  // ── Tides ─────────────────────────────────────────────────────────────────
  function populateTides(portId) {
    const section = document.getElementById("tides-section");
    if (!portId) {
      if (section) section.style.display = "none";
      return;
    }
    if (section) section.style.display = "";

    const list   = document.getElementById("tides-list");
    const canvas = document.getElementById("tide-mini-chart");

    const events = Tides.getNextTides(portId, 4);

    if (!events || !events.length) {
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

    drawTideMiniChart(canvas, portId);
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
  function drawTideMiniChart(canvas, portId) {
    const pts    = Tides.getTodayCurve(portId);
    if (!pts || !pts.length) return;
    const events = Tides.findTideEvents(
      portId,
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
      const height  = +Tides.tideHeight(portId, hoverMs).toFixed(2);

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
      const ny = yOf(Tides.tideHeight(portId, now));
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
    const baseMs = Math.floor(Date.now() / 3_600_000) * 3_600_000;

    for (let i = 0; i < 120; i++) {
      const ts  = Math.round((baseMs + i * 3_600_000) / 1000);
      const lh  = (+new Date(ts * 1000).toLocaleString("en-NZ", { timeZone: TZ, hour: "numeric", hour12: false }) + 24) % 24;
      const cc  = Math.max(0, Math.min(90, Math.round(35 + 30 * Math.sin(i * 0.12 + 1.5))));
      const pp  = Math.max(0, Math.min(80, Math.round(20 + 25 * Math.sin(i * 0.10 + 2))));
      const qpf = pp > 45 ? +(0.4 * Math.sin(i * 0.10 + 2)).toFixed(2) : 0;

      hours.push({
        validTimeUtc:          ts,
        temperature:           101,
        temperatureFeelsLike:  101,
        relativeHumidity:      Math.max(40, Math.min(90, Math.round(65 - 10 * Math.cos(2 * Math.PI * (lh - 14) / 24)))),
        windSpeed:             Math.round(13 + 5 * Math.sin(i * 0.2)),
        windDirection:         Math.round(240 + 20 * Math.sin(i * 0.15)),
        windDirectionCardinal: "WSW",
        windGust:              Math.round(16 + 5 * Math.abs(Math.sin(i * 0.2))),
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

    const daily = Array.from({ length: 5 }, (_, d) => ({
      calendarDayTemperatureMax: 101,
      calendarDayTemperatureMin: 101,
      temperatureMax:            101,
      temperatureMin:            101,
      sunriseTimeUtc: nowTs + d * 86400 - 3 * 3600,
      sunsetTimeUtc:  nowTs + d * 86400 + 6 * 3600,
    }));

    return {
      meta:    { updated: new Date().toISOString(), location: `${currentLocation.name}, New Zealand (sample)`, lat: currentLocation.lat, lon: currentLocation.lon },
      current: {
        temp: 101, feelsLike: 101,
        humidity: hours[0].relativeHumidity, pressure: hours[0].pressureMeanSeaLevel,
        windSpeed: hours[0].windSpeed, windGust: hours[0].windGust,
        windDirection: hours[0].windDirection, windCardinal: "WSW",
        uvIndex: hours[0].uvIndex, cloudPhrase: hours[0].wxPhraseMedium,
        condition: hours[0].wxPhraseMedium, iconCode: hours[0].iconCode,
        sunriseUtc: nowTs - 3 * 3600,
        sunsetUtc:  nowTs + 6 * 3600,
        tempMax24h: 101, tempMin24h: 101,
      },
      today:  { moonPhase: "Waxing Crescent", moonPhaseCode: "WXC", moonPhaseDay: 5 },
      hourly: hours,
      daily,
    };
  }

  // ── Settings panel ────────────────────────────────────────────────────────
  function initSettingsPanel(onLocationSelect) {
    const btn   = document.getElementById("settings-btn");
    const panel = document.getElementById("settings-panel");
    const list  = document.getElementById("settings-location-list");
    const close = document.getElementById("settings-close");

    if (!btn || !panel || !list) return;

    // Populate location list
    list.innerHTML = LOCATIONS.map(loc => `
      <button class="settings-loc-item${loc.id === currentLocation.id ? " active" : ""}"
              data-id="${loc.id}">
        <span class="settings-loc-name">${loc.name}</span>
        <span class="settings-loc-region">${loc.region}</span>
      </button>
    `).join("");

    function updateActive() {
      list.querySelectorAll(".settings-loc-item").forEach(el => {
        el.classList.toggle("active", el.dataset.id === currentLocation.id);
      });
    }

    list.addEventListener("click", e => {
      const item = e.target.closest(".settings-loc-item");
      if (!item) return;
      const locId = item.dataset.id;
      if (locId === currentLocation.id) { panel.classList.remove("open"); return; }
      currentLocation = getLocation(locId);
      TZ = currentLocation.timezone;
      try { localStorage.setItem("weatherTempo.location", locId); } catch (_) {}
      updateActive();
      panel.classList.remove("open");
      onLocationSelect();
    });

    btn.addEventListener("click", () => panel.classList.toggle("open"));
    if (close) close.addEventListener("click", () => panel.classList.remove("open"));
    panel.addEventListener("click", e => {
      if (e.target === panel) panel.classList.remove("open");
    });
  }

  // ── Update page meta for selected location ────────────────────────────────
  function applyLocationMeta() {
    const nameEl = document.getElementById("location-name");
    if (nameEl) nameEl.textContent = `${currentLocation.name}, ${currentLocation.region}`;
    document.title = `WeatherTempo — ${currentLocation.name}`;

    const tidesLabel = document.getElementById("tides-label");
    if (tidesLabel && currentLocation.tideLabel) tidesLabel.textContent = currentLocation.tideLabel;
  }

  // ── Status banner for errors/warnings ─────────────────────────────────────
  function updateStatusBanner(level, message) {
    let banner = document.getElementById("status-banner");

    // Clear banner
    if (!message || level === "success") {
      if (banner) banner.remove();
      return;
    }

    // Create banner if needed
    if (!banner) {
      banner = document.createElement("div");
      banner.id = "status-banner";
      banner.className = "status-banner";
      const header = document.querySelector(".header");
      if (header && header.nextSibling) {
        header.parentNode.insertBefore(banner, header.nextSibling);
      } else {
        document.body.insertBefore(banner, document.body.firstChild);
      }
    }

    // Update banner content and style
    banner.className = `status-banner status-banner--${level}`;
    banner.textContent = message;
  }

  // ── Boot ──────────────────────────────────────────────────────────────────
  async function boot() {
    // Restore persisted location
    try {
      const stored = localStorage.getItem("weatherTempo.location");
      if (stored) {
        const loc = getLocation(stored);
        if (loc) { currentLocation = loc; TZ = loc.timezone; }
      }
    } catch (_) {}

    applyLocationMeta();

    let liveRefresh = null;

    const zoomSel = document.getElementById("chart-zoom");
    // Restore persisted zoom
    if (zoomSel) {
      try {
        const stored = localStorage.getItem("weatherTempo.chartDays");
        const validValues = Array.from(zoomSel.options).map(o => o.value);
        if (stored && validValues.includes(stored)) zoomSel.value = stored;
      } catch (_) {}
    }

    async function loadAndRender() {
      // Show loading state
      updateStatusBanner("loading", "Fetching weather data…");

      // Fetch data using resilient fetcher
      const result = await DataFetcher.fetch(currentLocation.id);

      // Update UI based on result
      if (result.source === 'worker') {
        updateStatusBanner("success", null); // Clear banner
      } else if (result.source === 'local-fallback') {
        const age = result.data.meta?.updated
          ? Math.round((Date.now() - new Date(result.data.meta.updated).getTime()) / 60000)
          : '?';
        updateStatusBanner("warning", `Using cached data (${age} min old) — live data unavailable`);
      } else if (result.source === 'sample-data') {
        updateStatusBanner("error", `⚠️ All data sources failed — showing synthetic sample data`);
      }

      // Clear hourly table body on re-render (location switch)
      const tbody = document.getElementById("hourly-table-body");
      if (tbody) tbody.innerHTML = "";

      populateCard(result.data);
      initChart(result.data.hourly, result.data.current, zoomSel ? +zoomSel.value : 2);

      return result.data;
    }

    let currentData = await loadAndRender();

    // Zoom selector
    if (zoomSel) {
      zoomSel.addEventListener("change", () => {
        initChart(currentData.hourly, currentData.current, +zoomSel.value);
        try { localStorage.setItem("weatherTempo.chartDays", zoomSel.value); } catch (_) {}
      });
    }

    // Resize observer
    let resizeTimer;
    let roFirstRun = true;
    const chartSection = document.querySelector(".chart-section");
    if (chartSection && window.ResizeObserver) {
      new ResizeObserver(() => {
        if (roFirstRun) { roFirstRun = false; return; }
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
          initChart(currentData.hourly, currentData.current, zoomSel ? +zoomSel.value : 2);
        }, 150);
      }).observe(chartSection);
    }

    // Live refresh loop — re-renders card on each tick with fresh Worker data
    liveRefresh = startLiveRefresh(data => {
      currentData = data;
      const tbody = document.getElementById("hourly-table-body");
      if (tbody) tbody.innerHTML = "";
      populateCard(data);
      initChart(data.hourly, data.current, zoomSel ? +zoomSel.value : 2);
      const t = data.meta?.updated
        ? new Date(data.meta.updated).toLocaleTimeString("en-NZ", { timeZone: TZ, hour: "numeric", minute: "2-digit", hour12: true })
        : null;
      if (t) {
        const el = document.getElementById("last-updated");
        if (el) el.textContent = `Live · ${t}`;
      }
    });

    // Settings panel — on location change, stop old refresh, reload, restart
    initSettingsPanel(async () => {
      if (liveRefresh) liveRefresh.stop();
      applyLocationMeta();
      currentData = await loadAndRender();
      liveRefresh = startLiveRefresh(data => {
        currentData = data;
        const tbody = document.getElementById("hourly-table-body");
        if (tbody) tbody.innerHTML = "";
        populateCard(data);
        initChart(data.hourly, data.current, zoomSel ? +zoomSel.value : 2);
      });
    });
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
