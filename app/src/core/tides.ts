/**
 * Harmonic tide predictor for NZ coastal ports.
 *
 *   h(t) = Z0 + Σ Aᵢ · cos( σᵢ · Δt + V₀ᵢ − gᵢ )
 *
 * Δt is hours since J2000.0 (2000-01-01 12:00 UTC), σᵢ the constituent speed
 * (°/h), V₀ᵢ its equilibrium argument at J2000.0 and gᵢ the Greenwich phase lag.
 * Nodal corrections (f, u) are not applied, so a port fitted to one year's
 * table (New Brighton, 2026) slowly drifts in other years. See tidePorts.ts.
 */
import { TIDE_PORTS } from "./tidePorts";
import type { TideEvent, TideSample } from "./types";

const J2000_MS = Date.UTC(2000, 0, 1, 12, 0, 0);
const DEG = Math.PI / 180;
const HOUR_MS = 3_600_000;

/** Water level in metres above chart datum, or null if the port is unknown. */
export function tideHeight(portId: string, ms: number): number | null {
  const port = TIDE_PORTS[portId];
  if (!port) return null;
  const t = (ms - J2000_MS) / HOUR_MS;
  let h = port.Z0;
  for (const [, speed, amp, phase, v0] of port.constituents) {
    h += amp * Math.cos((speed * t + v0 - phase) * DEG);
  }
  return h;
}

/** Heights at a regular interval (default every 10 minutes). */
export function sampleTide(portId: string, startMs: number, endMs: number, stepMin = 10): TideSample[] {
  if (!TIDE_PORTS[portId]) return [];
  const step = stepMin * 60_000;
  const out: TideSample[] = [];
  for (let t = startMs; t <= endMs; t += step) {
    out.push({ time: new Date(t), height: +tideHeight(portId, t)!.toFixed(3) });
  }
  return out;
}

/**
 * Highs and lows in a window. Samples every 6 minutes, then refines each
 * turning point with a parabola through its three samples, so times are good
 * to about a minute rather than being stuck on the 6-minute grid.
 */
export function findTideEvents(portId: string, startMs: number, endMs: number): TideEvent[] {
  if (!TIDE_PORTS[portId]) return [];
  const STEP = 6 * 60_000;
  const pts: { t: number; h: number }[] = [];
  for (let t = startMs; t <= endMs; t += STEP) pts.push({ t, h: tideHeight(portId, t)! });

  const events: TideEvent[] = [];
  for (let i = 1; i < pts.length - 1; i++) {
    const prev = pts[i - 1].h, curr = pts[i].h, next = pts[i + 1].h;
    const isHigh = curr > prev && curr > next;
    const isLow = curr < prev && curr < next;
    if (!isHigh && !isLow) continue;
    const denom = prev - 2 * curr + next;
    const shift = denom === 0 ? 0 : (0.5 * (prev - next)) / denom;   // in steps, within ±0.5
    const t = pts[i].t + shift * STEP;
    const h = tideHeight(portId, t)!;
    events.push({ type: isHigh ? "high" : "low", time: new Date(t), height: +h.toFixed(2) });
  }
  return events;
}

/** The next `n` highs/lows from `nowMs` (default: now). */
export function getNextTides(portId: string, n = 4, nowMs: number = Date.now()): TideEvent[] {
  if (!TIDE_PORTS[portId]) return [];
  return findTideEvents(portId, nowMs - 6 * HOUR_MS, nowMs + 72 * HOUR_MS)
    .filter((e) => e.time.getTime() >= nowMs)
    .slice(0, n);
}

/** Offset of `tz` from UTC at instant `ms`, in milliseconds (NZDT = +13 h). */
function zoneOffsetMs(ms: number, tz: string): number {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23",
    year: "numeric", month: "numeric", day: "numeric",
    hour: "numeric", minute: "numeric", second: "numeric",
  }).formatToParts(new Date(ms));
  const v = (type: string) => Number(p.find((x) => x.type === type)!.value);
  return Date.UTC(v("year"), v("month") - 1, v("day"), v("hour"), v("minute"), v("second")) - Math.floor(ms / 1000) * 1000;
}

/** UTC instant of local midnight at the start of `nowMs`'s calendar day in `tz`. */
export function localMidnightUtc(nowMs: number, tz: string): number {
  const off = zoneOffsetMs(nowMs, tz);
  const local = new Date(nowMs + off);
  const guess = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  // Offset at midnight can differ from now's if DST changed earlier today.
  let utc = guess - zoneOffsetMs(guess - off, tz);
  utc = guess - zoneOffsetMs(utc, tz);
  return utc;
}

/**
 * Curve from local midnight today for `hours` (default 48), every 10 minutes.
 * Unlike the website's version this does not depend on the device's own
 * time zone, so it is right for a phone set to anywhere.
 */
export function getTodayCurve(
  portId: string, timezone = "Pacific/Auckland", hours = 48, nowMs: number = Date.now(),
): TideSample[] {
  if (!TIDE_PORTS[portId]) return [];
  const start = localMidnightUtc(nowMs, timezone);
  return sampleTide(portId, start, start + hours * HOUR_MS, 10);
}
