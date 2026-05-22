/**
 * tides.js — Harmonic tide predictor for NZ coastal ports.
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
 *
 * V₀ values at J2000.0 (used identically for all ports):
 *   M2: 124.30°  S2:   0.00°  N2: 349.34°  K2: 200.93°
 *   K1: 280.47°  O1: 203.83°  P1:  79.53°  Q1:  68.87°
 */

(function (global) {
  "use strict";

  const J2000_MS = Date.UTC(2000, 0, 1, 12, 0, 0);
  const DEG = Math.PI / 180;

  // ── LINZ harmonic constants by port ────────────────────────────────────────
  // Each entry: { Z0 (m), constituents: [ [name, speed°/h, amp m, phase°, V₀°] ] }
  // Sources: LINZ Tide Tables, NZ Hydrographic Authority.
  const PORTS = {

    // Auckland (Waitemata Harbour)
    auckland: {
      Z0: 1.372,
      constituents: [
        ["M2", 28.9841042, 1.062, 184.3, 124.30],
        ["S2", 30.0000000, 0.237, 199.1,   0.00],
        ["N2", 28.4397295, 0.225, 167.1, 349.34],
        ["K2", 30.0821373, 0.064, 200.0, 200.93],
        ["K1", 15.0410686, 0.138, 207.9, 280.47],
        ["O1", 13.9430356, 0.091, 175.0, 203.83],
        ["P1", 14.9589314, 0.043, 204.5,  79.53],
        ["Q1", 13.3986609, 0.020, 158.5,  68.87],
      ],
    },

    // Tauranga
    tauranga: {
      Z0: 0.795,
      constituents: [
        ["M2", 28.9841042, 0.604, 189.9, 124.30],
        ["S2", 30.0000000, 0.133, 209.3,   0.00],
        ["N2", 28.4397295, 0.126, 174.1, 349.34],
        ["K2", 30.0821373, 0.036, 209.8, 200.93],
        ["K1", 15.0410686, 0.083, 259.5, 280.47],
        ["O1", 13.9430356, 0.055, 237.9, 203.83],
        ["P1", 14.9589314, 0.025, 256.8,  79.53],
        ["Q1", 13.3986609, 0.012, 220.6,  68.87],
      ],
    },

    // Gisborne
    gisborne: {
      Z0: 0.869,
      constituents: [
        ["M2", 28.9841042, 0.606, 186.4, 124.30],
        ["S2", 30.0000000, 0.141, 208.4,   0.00],
        ["N2", 28.4397295, 0.126, 170.4, 349.34],
        ["K2", 30.0821373, 0.038, 209.0, 200.93],
        ["K1", 15.0410686, 0.120, 273.6, 280.47],
        ["O1", 13.9430356, 0.083, 251.2, 203.83],
        ["P1", 14.9589314, 0.036, 271.0,  79.53],
        ["Q1", 13.3986609, 0.018, 234.5,  68.87],
      ],
    },

    // New Plymouth (Port Taranaki)
    "new-plymouth": {
      Z0: 1.498,
      constituents: [
        ["M2", 28.9841042, 1.064, 166.0, 124.30],
        ["S2", 30.0000000, 0.218, 183.5,   0.00],
        ["N2", 28.4397295, 0.215, 150.7, 349.34],
        ["K2", 30.0821373, 0.059, 184.0, 200.93],
        ["K1", 15.0410686, 0.072, 197.3, 280.47],
        ["O1", 13.9430356, 0.048, 168.7, 203.83],
        ["P1", 14.9589314, 0.021, 195.4,  79.53],
        ["Q1", 13.3986609, 0.010, 152.7,  68.87],
      ],
    },

    // Napier
    napier: {
      Z0: 0.820,
      constituents: [
        ["M2", 28.9841042, 0.565, 200.2, 124.30],
        ["S2", 30.0000000, 0.131, 222.9,   0.00],
        ["N2", 28.4397295, 0.117, 184.2, 349.34],
        ["K2", 30.0821373, 0.035, 223.7, 200.93],
        ["K1", 15.0410686, 0.118, 281.0, 280.47],
        ["O1", 13.9430356, 0.081, 257.0, 203.83],
        ["P1", 14.9589314, 0.035, 278.1,  79.53],
        ["Q1", 13.3986609, 0.017, 240.2,  68.87],
      ],
    },

    // Nelson
    nelson: {
      Z0: 1.979,
      constituents: [
        ["M2", 28.9841042, 1.524, 208.4, 124.30],
        ["S2", 30.0000000, 0.354, 225.2,   0.00],
        ["N2", 28.4397295, 0.308, 191.9, 349.34],
        ["K2", 30.0821373, 0.096, 226.1, 200.93],
        ["K1", 15.0410686, 0.092, 258.3, 280.47],
        ["O1", 13.9430356, 0.062, 228.0, 203.83],
        ["P1", 14.9589314, 0.028, 256.4,  79.53],
        ["Q1", 13.3986609, 0.013, 211.8,  68.87],
      ],
    },

    // Wellington
    wellington: {
      Z0: 0.596,
      constituents: [
        ["M2", 28.9841042, 0.419, 323.3, 124.30],
        ["S2", 30.0000000, 0.096, 341.4,   0.00],
        ["N2", 28.4397295, 0.087, 306.4, 349.34],
        ["K2", 30.0821373, 0.026, 342.7, 200.93],
        ["K1", 15.0410686, 0.079, 259.8, 280.47],
        ["O1", 13.9430356, 0.054, 232.1, 203.83],
        ["P1", 14.9589314, 0.023, 256.5,  79.53],
        ["Q1", 13.3986609, 0.011, 215.5,  68.87],
      ],
    },

    // Blenheim (Wairau Bar / Cloudy Bay)
    blenheim: {
      Z0: 1.154,
      constituents: [
        ["M2", 28.9841042, 0.840, 261.0, 124.30],
        ["S2", 30.0000000, 0.196, 278.4,   0.00],
        ["N2", 28.4397295, 0.173, 244.4, 349.34],
        ["K2", 30.0821373, 0.053, 279.5, 200.93],
        ["K1", 15.0410686, 0.079, 272.0, 280.47],
        ["O1", 13.9430356, 0.054, 242.3, 203.83],
        ["P1", 14.9589314, 0.023, 269.5,  79.53],
        ["Q1", 13.3986609, 0.011, 225.8,  68.87],
      ],
    },

    // Westport
    westport: {
      Z0: 1.070,
      constituents: [
        ["M2", 28.9841042, 0.847, 201.4, 124.30],
        ["S2", 30.0000000, 0.178, 220.5,   0.00],
        ["N2", 28.4397295, 0.175, 185.2, 349.34],
        ["K2", 30.0821373, 0.048, 221.3, 200.93],
        ["K1", 15.0410686, 0.071, 247.3, 280.47],
        ["O1", 13.9430356, 0.048, 218.4, 203.83],
        ["P1", 14.9589314, 0.021, 244.8,  79.53],
        ["Q1", 13.3986609, 0.010, 202.0,  68.87],
      ],
    },

    // Lyttelton (Christchurch)
    lyttelton: {
      Z0: 0.868,
      constituents: [
        ["M2", 28.9841042, 0.672, 173.7, 124.30],
        ["S2", 30.0000000, 0.170, 188.9,   0.00],
        ["N2", 28.4397295, 0.148, 157.0, 349.34],
        ["K2", 30.0821373, 0.046, 189.4, 200.93],
        ["K1", 15.0410686, 0.111, 299.8, 280.47],
        ["O1", 13.9430356, 0.076, 278.6, 203.83],
        ["P1", 14.9589314, 0.036, 297.1,  79.53],
        ["Q1", 13.3986609, 0.015, 261.9,  68.87],
      ],
    },

    // Timaru
    timaru: {
      Z0: 0.869,
      constituents: [
        ["M2", 28.9841042, 0.635, 177.8, 124.30],
        ["S2", 30.0000000, 0.157, 194.2,   0.00],
        ["N2", 28.4397295, 0.135, 161.7, 349.34],
        ["K2", 30.0821373, 0.042, 194.8, 200.93],
        ["K1", 15.0410686, 0.111, 302.5, 280.47],
        ["O1", 13.9430356, 0.076, 280.9, 203.83],
        ["P1", 14.9589314, 0.036, 299.7,  79.53],
        ["Q1", 13.3986609, 0.016, 264.5,  68.87],
      ],
    },

    // Dunedin (Port Chalmers)
    dunedin: {
      Z0: 0.645,
      constituents: [
        ["M2", 28.9841042, 0.491, 164.0, 124.30],
        ["S2", 30.0000000, 0.115, 181.3,   0.00],
        ["N2", 28.4397295, 0.104, 148.3, 349.34],
        ["K2", 30.0821373, 0.031, 181.8, 200.93],
        ["K1", 15.0410686, 0.099, 291.1, 280.47],
        ["O1", 13.9430356, 0.067, 268.2, 203.83],
        ["P1", 14.9589314, 0.030, 288.4,  79.53],
        ["Q1", 13.3986609, 0.014, 252.0,  68.87],
      ],
    },

    // Invercargill (Bluff)
    invercargill: {
      Z0: 0.558,
      constituents: [
        ["M2", 28.9841042, 0.491, 195.3, 124.30],
        ["S2", 30.0000000, 0.113, 215.1,   0.00],
        ["N2", 28.4397295, 0.103, 178.5, 349.34],
        ["K2", 30.0821373, 0.031, 216.0, 200.93],
        ["K1", 15.0410686, 0.075, 279.4, 280.47],
        ["O1", 13.9430356, 0.051, 251.2, 203.83],
        ["P1", 14.9589314, 0.022, 276.7,  79.53],
        ["Q1", 13.3986609, 0.010, 235.0,  68.87],
      ],
    },
  };

  /**
   * Compute tide height at a given moment for the specified port.
   * @param {string} portId  Key in PORTS map.
   * @param {number} ms      Unix timestamp in milliseconds.
   * @returns {number|null}  Water level in metres above chart datum, or null if port unknown.
   */
  function tideHeight(portId, ms) {
    const port = PORTS[portId];
    if (!port) return null;
    const t = (ms - J2000_MS) / 3_600_000;
    let h = port.Z0;
    for (const [, speed, amp, phase, v0] of port.constituents) {
      h += amp * Math.cos((speed * t + v0 - phase) * DEG);
    }
    return h;
  }

  /**
   * Sample tide heights at regular intervals.
   * @param {string} portId
   * @param {number} startMs
   * @param {number} endMs
   * @param {number} stepMin  Sample interval in minutes (default 10).
   * @returns {{ time: Date, height: number }[]}
   */
  function sampleTide(portId, startMs, endMs, stepMin = 10) {
    if (!PORTS[portId]) return [];
    const step = stepMin * 60_000;
    const out  = [];
    for (let t = startMs; t <= endMs; t += step) {
      out.push({ time: new Date(t), height: +tideHeight(portId, t).toFixed(3) });
    }
    return out;
  }

  /**
   * Find high and low tide events within a time window.
   * @param {string} portId
   * @param {number} startMs
   * @param {number} endMs
   * @returns {{ type: 'high'|'low', time: Date, height: number }[]}
   */
  function findTideEvents(portId, startMs, endMs) {
    if (!PORTS[portId]) return [];
    const STEP = 6 * 60_000;
    const pts  = [];
    for (let t = startMs; t <= endMs; t += STEP) {
      pts.push({ t, h: tideHeight(portId, t) });
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
   * @param {string} portId
   * @param {number} n  Number of events to return (default 4).
   * @returns {{ type: 'high'|'low', time: Date, height: number }[]}
   */
  function getNextTides(portId, n = 4) {
    if (!PORTS[portId]) return [];
    const now    = Date.now();
    const events = findTideEvents(portId, now - 6 * 3_600_000, now + 72 * 3_600_000);
    return events.filter(e => e.time.getTime() >= now).slice(0, n);
  }

  /**
   * Return sample points for the tidal curve starting at local NZ midnight today.
   * @param {string} portId
   * @param {string} timezone  IANA timezone string (default "Pacific/Auckland").
   * @param {number} hours     Duration in hours from midnight (default 48).
   * @returns {{ time: Date, height: number }[]}
   */
  function getTodayCurve(portId, timezone = "Pacific/Auckland", hours = 48) {
    if (!PORTS[portId]) return [];
    const now = new Date();
    const ds  = now.toLocaleDateString("en-NZ", { timeZone: timezone,
                  year: "numeric", month: "2-digit", day: "2-digit" });
    const [d, mo, yr] = ds.split("/").map(Number);
    const startLocal  = new Date(`${yr}-${String(mo).padStart(2,"0")}-${String(d).padStart(2,"0")}T00:00:00`);
    const offsetMs    = -new Date(startLocal).getTimezoneOffset() * 60_000;
    const startUtc    = startLocal.getTime() - offsetMs;
    return sampleTide(portId, startUtc, startUtc + hours * 3_600_000, 10);
  }

  // ── Export ─────────────────────────────────────────────────────────────────
  global.Tides = { tideHeight, sampleTide, findTideEvents, getNextTides, getTodayCurve };

})(window);
