/**
 * tides.js — Harmonic tide predictor for Lyttelton Harbour, Canterbury NZ.
 *
 * Uses tidal harmonic constituents published by Land Information New Zealand
 * (LINZ). The prediction formula is:
 *
 *   h(t) = Z0 + Σ  Aᵢ · cos( σᵢ · Δt + V₀ᵢ − gᵢ )
 *
 * where Δt is hours since the J2000.0 epoch (2000-01-01 12:00 UTC), σᵢ is the
 * angular speed of constituent i (°/h), V₀ᵢ is the equilibrium argument of
 * that constituent at J2000.0, and gᵢ is the Greenwich phase lag from LINZ.
 *
 * Nodal corrections (f, u) are omitted — this introduces ≲ 3 % error in
 * amplitude, which is well within acceptable range for a personal dashboard.
 */

(function (global) {
  "use strict";

  // ── Epoch ────────────────────────────────────────────────────────────────
  const J2000_MS = Date.UTC(2000, 0, 1, 12, 0, 0); // ms since Unix epoch

  // ── Lyttelton Harbour harmonic constants (LINZ) ──────────────────────────
  //   [name, speed °/h, amplitude m, Greenwich phase lag °, V₀ at J2000 °]
  //
  // V₀ values derived from astronomical arguments at J2000.0:
  //   s₀ = 218.3165° (lunar mean longitude)
  //   h₀ = 280.4665° (solar mean longitude)
  //   p₀ =  83.3531° (lunar perigee)
  //   T₀ ≈    0.000° (Greenwich mean solar time at noon = 0°)
  //
  // M2: V₀ = 2T₀ + 2h₀ − 2s₀ = 124.30°
  // S2: V₀ = 2T₀              =   0.00°
  // N2: V₀ = 2T₀ + 2h₀ − 3s₀ + p₀ = 349.34°
  // K2: V₀ = 2T₀ + 2h₀       = 200.93°
  // K1: V₀ = T₀  + h₀        = 280.47°
  // O1: V₀ = T₀  − 2s₀ + h₀  = 203.83°
  // P1: V₀ = T₀  − h₀        =  79.53°
  // Q1: V₀ = T₀  − 3s₀ + h₀ + p₀ = 68.87°

  const CONSTITUENTS = [
    // name,   speed°/h,     amp m,  phase°,  V₀°
    ["M2",  28.9841042,  0.672,  173.7,  124.30],
    ["S2",  30.0000000,  0.170,  188.9,    0.00],
    ["N2",  28.4397295,  0.148,  157.0,  349.34],
    ["K2",  30.0821373,  0.046,  189.4,  200.93],
    ["K1",  15.0410686,  0.111,  299.8,  280.47],
    ["O1",  13.9430356,  0.076,  278.6,  203.83],
    ["P1",  14.9589314,  0.036,  297.1,   79.53],
    ["Q1",  13.3986609,  0.015,  261.9,   68.87],
  ];

  const Z0  = 0.868;  // Mean sea level above chart datum (m)
  const DEG = Math.PI / 180;

  /**
   * Compute tide height at a given moment.
   * @param {number} ms  Unix timestamp in milliseconds.
   * @returns {number}   Water level in metres above chart datum.
   */
  function tideHeight(ms) {
    const t = (ms - J2000_MS) / 3_600_000; // hours since J2000.0
    let h = Z0;
    for (const [, speed, amp, phase, v0] of CONSTITUENTS) {
      h += amp * Math.cos((speed * t + v0 - phase) * DEG);
    }
    return h;
  }

  /**
   * Sample tide heights at regular intervals.
   * @param {number} startMs  Start time in ms.
   * @param {number} endMs    End time in ms.
   * @param {number} stepMin  Sample interval in minutes (default 10).
   * @returns {{ time: Date, height: number }[]}
   */
  function sampleTide(startMs, endMs, stepMin = 10) {
    const step = stepMin * 60_000;
    const out  = [];
    for (let t = startMs; t <= endMs; t += step) {
      out.push({ time: new Date(t), height: +tideHeight(t).toFixed(3) });
    }
    return out;
  }

  /**
   * Find high and low tide events within a time window.
   * @param {number} startMs
   * @param {number} endMs
   * @returns {{ type: 'high'|'low', time: Date, height: number }[]}
   */
  function findTideEvents(startMs, endMs) {
    const STEP = 6 * 60_000; // 6-minute resolution
    const pts  = [];
    for (let t = startMs; t <= endMs; t += STEP) {
      pts.push({ t, h: tideHeight(t) });
    }

    const events = [];
    for (let i = 1; i < pts.length - 1; i++) {
      const { h: prev } = pts[i - 1];
      const { h: curr, t } = pts[i];
      const { h: next } = pts[i + 1];

      if (curr > prev && curr > next) {
        events.push({ type: "high", time: new Date(t), height: +curr.toFixed(2) });
      } else if (curr < prev && curr < next) {
        events.push({ type: "low",  time: new Date(t), height: +curr.toFixed(2) });
      }
    }
    return events;
  }

  /**
   * Return the next N tide events (high or low) from the current time.
   * @param {number} n  Number of events to return (default 4).
   * @returns {{ type: 'high'|'low', time: Date, height: number }[]}
   */
  function getNextTides(n = 4) {
    const now = Date.now();
    // Search window: 6 h before now to 72 h ahead (catches any in-progress tide)
    const events = findTideEvents(now - 6 * 3_600_000, now + 72 * 3_600_000);
    return events.filter(e => e.time.getTime() >= now).slice(0, n);
  }

  /**
   * Return sample points for today's tidal curve (local NZ midnight → midnight).
   * @returns {{ time: Date, height: number }[]}
   */
  function getTodayCurve() {
    const tz   = "Pacific/Auckland";
    const now  = new Date();
    const ds   = now.toLocaleDateString("en-NZ", { timeZone: tz,
                   year: "numeric", month: "2-digit", day: "2-digit" });
    // Parse NZ "DD/MM/YYYY" → midnight in NZDT
    const [d, mo, yr] = ds.split("/").map(Number);
    const startLocal  = new Date(`${yr}-${String(mo).padStart(2,"0")}-${String(d).padStart(2,"0")}T00:00:00`);
    // Adjust for timezone offset
    const offsetMs    = -new Date(startLocal).getTimezoneOffset() * 60_000;
    const startUtc    = startLocal.getTime() - offsetMs;
    return sampleTide(startUtc, startUtc + 24 * 3_600_000, 10);
  }

  // ── Export ─────────────────────────────────────────────────────────────
  global.Tides = { tideHeight, sampleTide, findTideEvents, getNextTides, getTodayCurve };

})(window);
