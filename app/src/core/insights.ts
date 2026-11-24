/**
 * Pure calculations behind the chart and its strips. Nothing here touches a
 * view or canvas, so every rule is unit-tested in Jest and runs identically on
 * iOS (Hermes) and web. Ported from the website's insights.js, which in turn
 * mirrored the SwiftUI app's WeatherTempoKit; this is now the only copy.
 *
 * Hours are the Worker's hourly objects ({ validTimeUtc, temperature, … }).
 */
import type {
  Hour, SkyPhase, SkyStop, Warning, WarningLevel, WarningTimes,
} from "./types";

export interface Tendency {
  direction: "steady" | "rising" | "falling";
  /** 0 steady, 1 slowly, 2 quickly, 3 rapidly. */
  strength: number;
  /** hPa per 3 h. */
  change: number;
}
export interface TendencyRun {
  start: number; end: number;
  direction: Tendency["direction"];
  maxStrength: number;
  label: string;
}
export interface WeekDay {
  start: number; end: number;
  label: string; glyph: string;
  low: number | null; high: number | null;
  maxChance: number | null; totalMm: number; sunshineHours: number;
}
export interface SunProtection {
  ongoing: boolean; from: string; until: string; peak: number; sentence: string;
}

const RAD = Math.PI / 180;

// ── Time formatting (local to the forecast's time zone) ──────────────────
/** 24-hour clock time in `tz`: "15:00", "00:05" (midnight is 00:00, never 24:00). */
export function clock(utcSec: number, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false })
    .formatToParts(new Date(utcSec * 1000));
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0) % 24;
  const m = parts.find((p) => p.type === "minute")?.value ?? "00";
  return `${String(h).padStart(2, "0")}:${m}`;
}

/** An hour slot as a 24-hour time: "15:00", "00:00". */
export function hourLabel(utcSec: number, tz: string): string {
  return clock(utcSec, tz);
}

/** Calendar day key in `tz`, for grouping hours by local day. */
export function dayKey(utcSec: number, tz: string): string {
  return new Date(utcSec * 1000).toLocaleDateString("en-NZ", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
  });
}

export function weekday(utcSec: number, tz: string, long?: boolean): string {
  return new Date(utcSec * 1000).toLocaleDateString("en-NZ", {
    timeZone: tz, weekday: long ? "long" : "short",
  });
}

/** First hour at or after now (0 if the whole series is in the past). */
export function nowIndex(hours: Hour[], nowSec: number): number {
  const i = hours.findIndex(h => (h.validTimeUtc || 0) >= nowSec);
  return i < 0 ? 0 : i;
}

// ── Sun position ─────────────────────────────────────────────────────────
/**
 * Sun elevation in degrees (negative below the horizon) at `utcSec` for a
 * place in degrees (south/west negative). Low-precision Astronomical Almanac
 * formulas, good to ~0.1°: far finer than a chart pixel.
 */
export function solarElevation(utcSec: number, lat: number, lon: number): number {
  const n = utcSec / 86400 + 2440587.5 - 2451545.0;          // days since J2000.0
  const meanLon   = 280.460 + 0.9856474 * n;
  const anomaly   = (357.528 + 0.9856003 * n) * RAD;
  const eclLon    = (meanLon + 1.915 * Math.sin(anomaly) + 0.020 * Math.sin(2 * anomaly)) * RAD;
  const obliquity = (23.439 - 0.0000004 * n) * RAD;

  const decl = Math.asin(Math.sin(obliquity) * Math.sin(eclLon));
  const ra   = Math.atan2(Math.cos(obliquity) * Math.sin(eclLon), Math.cos(eclLon));
  const sidereal = (280.46061837 + 360.98564736629 * n) % 360;
  const ha  = sidereal * RAD + lon * RAD - ra;

  const la = lat * RAD;
  const s  = Math.sin(la) * Math.sin(decl) + Math.cos(la) * Math.cos(decl) * Math.cos(ha);
  return Math.asin(Math.max(-1, Math.min(1, s))) / RAD;
}

// Sunrise/sunset (-0.833°), end of civil (-6°) and nautical (-12°) twilight.
const SKY_THRESHOLDS: { elevation: number; phase: SkyPhase }[] = [
  { elevation: -0.833, phase: "day" },
  { elevation: -6,     phase: "twilight" },
  { elevation: -12,    phase: "night" },
];

export function nearestPhase(e: number): SkyPhase { return e > -3.4 ? "day" : e > -9 ? "twilight" : "night"; }

/**
 * Background gradient stops as { t (UTC sec), phase } where the sun crosses
 * each threshold, from the first hour's start to the last hour's end.
 * null without coordinates (the chart then falls back to hourly day/night).
 */
export function skyStops(hours: Hour[], lat?: number | null, lon?: number | null): SkyStop[] | null {
  if (lat == null || lon == null || !hours.length) return null;
  const t0 = hours[0].validTimeUtc, t1 = hours[hours.length - 1].validTimeUtc + 3600;
  const elev = (t: number) => solarElevation(t, lat, lon);

  const stops: SkyStop[] = [{ t: t0, phase: nearestPhase(elev(t0)) }];
  const STEP = 600;   // 10 min: twilight bands last 30+ min, so no crossing is missed
  let a = t0, ea = elev(a);
  while (a < t1) {
    const b = Math.min(a + STEP, t1), eb = elev(b);
    let crossed = SKY_THRESHOLDS.filter(th => (ea - th.elevation) * (eb - th.elevation) < 0);
    if (eb > ea) crossed = crossed.reverse();   // rising: lowest threshold first
    for (const th of crossed) {
      let lo = a, hi = b;
      for (let k = 0; k < 12; k++) {             // bisect to well under a minute
        const mid = (lo + hi) / 2;
        if ((elev(mid) - th.elevation) * (ea - th.elevation) > 0) lo = mid; else hi = mid;
      }
      stops.push({ t: (lo + hi) / 2, phase: th.phase });
    }
    a = b; ea = eb;
  }
  stops.push({ t: t1, phase: nearestPhase(elev(t1)) });
  return stops;
}

/** Share (0–1) of hour `h` with the sun up: four samples through the hour. */
export function daylightFraction(h: Hour, lat?: number | null, lon?: number | null): number {
  if (lat == null || lon == null) return h.dayOrNight === "D" ? 1 : 0;
  const t = h.validTimeUtc;
  return [450, 1350, 2250, 3150].filter(o => solarElevation(t + o, lat, lon) > -0.833).length / 4;
}

/**
 * How sunny each hour is, 0–1: daylight share × clear sky. A clear daylight
 * hour is 1, half-cloudy 0.5, night 0. Unknown cloud counts as no sun.
 */
export function sunshine(hours: Hour[], lat?: number | null, lon?: number | null): number[] {
  return hours.map(h => h.cloudCover == null ? 0
    : daylightFraction(h, lat, lon) * (1 - Math.max(0, Math.min(100, h.cloudCover)) / 100));
}

/** Sun height (degrees above -0.833°) at which the chart's glow is full strength. */
export const FULL_GLOW_ELEVATION = 10;

/**
 * Sunshine glow along the chart as { h (hours from the series start), value }:
 * a stop every 15 min, cloud blended between hour centres and scaled by sun
 * height, so the glow brightens after sunrise and fades into sunset.
 */
export function glowStops(hours: Hour[], lat?: number | null, lon?: number | null): { h: number; value: number }[] {
  if (!hours.length) return [];
  if (lat == null || lon == null) {
    return sunshine(hours, lat, lon).map((v, i) => ({ h: i + 0.5, value: v }));
  }
  const clear = (i: number): number | null => (i >= 0 && i < hours.length && hours[i].cloudCover != null)
    ? 1 - Math.max(0, Math.min(100, hours[i].cloudCover)) / 100 : null;
  const clearAt = (hIn: number): number => {
    const a = Math.floor(hIn - 0.5), f = hIn - 0.5 - a;
    const x = clear(a), y = clear(a + 1);
    if (x != null && y != null) return x + (y - x) * f;
    return x ?? y ?? 0;
  };
  const t0 = hours[0].validTimeUtc;
  const out: { h: number; value: number }[] = [];
  for (let k = 0; k <= hours.length * 4; k++) {
    const hIn = k / 4;
    const e = solarElevation(t0 + hIn * 3600, lat, lon);
    const light = Math.max(0, Math.min(1, (e + 0.833) / FULL_GLOW_ELEVATION));
    out.push({ h: hIn, value: light * clearAt(hIn) });
  }
  return out;
}

// ── Dew point ────────────────────────────────────────────────────────────
/** Magnus formula (Alduchov-Eskridge constants), good to ~0.1° in weather ranges. */
export function dewPoint(t?: number | null, rh?: number | null): number | null {
  if (t == null || rh == null || rh <= 0 || rh > 100) return null;
  const a = 17.62, b = 243.12;
  const g = Math.log(rh / 100) + a * t / (b + t);
  return b * g / (a - g);
}

/** How muggy a dew point feels (the scale the US NWS uses). */
export function dewComfort(d: number): string {
  return d < 10 ? "Dry" : d < 16 ? "Comfortable" : d < 21 ? "Sticky" : "Oppressive";
}

// ── Pressure tendency ────────────────────────────────────────────────────
/**
 * Bands marine and aviation forecasts use (hPa per 3 h):
 * steady < 0.5, slowly < 1.6, quickly < 3.6, rapidly beyond.
 */
export function pressureTendency(changePer3h: number): Tendency {
  const m = Math.abs(changePer3h);
  const strength = m < 0.5 ? 0 : m < 1.6 ? 1 : m < 3.6 ? 2 : 3;
  const direction = strength === 0 ? "steady" : changePer3h > 0 ? "rising" : "falling";
  return { direction, strength, change: changePer3h };
}

export function tendencyLabel(direction: Tendency["direction"], strength: number): string {
  if (direction === "steady") return "Steady";
  return `${direction === "rising" ? "Rising" : "Falling"} ${["", "slowly", "quickly", "rapidly"][strength]}`;
}

/**
 * Tendency per hour from the change since 3 h earlier (scaled to 3 h when
 * fewer earlier hours exist; at the very start, looking forward instead).
 * null where pressure is missing.
 */
export function pressureTendencies(hours: Hour[]): (Tendency | null)[] {
  return hours.map((h, i) => {
    const p = h.pressureMeanSeaLevel;
    if (p == null) return null;
    for (let back = 3; back >= 1; back--) {
      if (i - back < 0) continue;
      const q = hours[i - back].pressureMeanSeaLevel;
      if (q != null) return pressureTendency((p - q) * 3 / back);
    }
    for (let ahead = 1; ahead <= 3 && i + ahead < hours.length; ahead++) {
      const q = hours[i + ahead].pressureMeanSeaLevel;
      if (q != null) return pressureTendency((q - p) * 3 / ahead);
    }
    return null;
  });
}

/** Runs of hours with the same direction, for labelling the strip. */
export function tendencyRuns(tendencies: (Tendency | null)[]): TendencyRun[] {
  const runs: TendencyRun[] = [];
  let i = 0;
  while (i < tendencies.length) {
    const first = tendencies[i];
    if (!first) { i++; continue; }
    const start = i;
    let strength = first.strength;
    for (let t = tendencies[i]; i < tendencies.length && t && t.direction === first.direction; t = tendencies[++i]) {
      strength = Math.max(strength, t.strength);
    }
    runs.push({ start, end: i, direction: first.direction, maxStrength: strength,
                label: tendencyLabel(first.direction, strength) });
  }
  return runs;
}

// ── Week overview ────────────────────────────────────────────────────────
/** Indices (>= 1) where the local calendar day changes. */
export function dayBoundaries(hours: Hour[], tz: string): number[] {
  const out: number[] = [];
  for (let i = 1; i < hours.length; i++) {
    if (dayKey(hours[i - 1].validTimeUtc, tz) !== dayKey(hours[i].validTimeUtc, tz)) out.push(i);
  }
  return out;
}

/**
 * One column per local calendar day of the series: label, the weather glyph
 * around 1pm (or the middle hour), low/high, rain, and sunshine hours.
 * `glyphFor(iconCode, dayOrNight)` comes from the page's own icon mapping.
 */
export function weekDays(
  hours: Hour[], tz: string, lat: number | null | undefined, lon: number | null | undefined,
  glyphFor: (iconCode: number | null | undefined, dayOrNight: string | null | undefined) => string,
): WeekDay[] {
  if (!hours.length) return [];
  const bounds = [0, ...dayBoundaries(hours, tz), hours.length];
  const sun = sunshine(hours, lat, lon);
  const days: WeekDay[] = [];
  for (let b = 0; b < bounds.length - 1; b++) {
    const start = bounds[b], end = bounds[b + 1];
    const slice = hours.slice(start, end);
    const temps = slice.map(h => h.temperature).filter(v => v != null);
    const chances = slice.map(h => h.precipChance).filter(v => v != null);
    const icon = slice.find(h => +new Date(h.validTimeUtc * 1000)
      .toLocaleString("en-NZ", { timeZone: tz, hour: "numeric", hour12: false }) % 24 === 13)
      || hours[Math.floor((start + end - 1) / 2)];
    days.push({
      start, end,
      label: weekday(hours[start].validTimeUtc, tz, false),
      glyph: glyphFor(icon.iconCode, icon.dayOrNight),
      low:  temps.length ? Math.min(...temps) : null,
      high: temps.length ? Math.max(...temps) : null,
      maxChance: chances.length ? Math.max(...chances) : null,
      totalMm: slice.reduce((s, h) => s + (h.qpf || 0), 0),
      sunshineHours: sun.slice(start, end).reduce((s, v) => s + v, 0),
    });
  }
  return days;
}

/** "6h"; a trace of sun shows as "<1h" rather than rounding away to nothing. */
export function sunHoursLabel(h: number): string {
  return h > 0 && h < 0.5 ? "<1h" : `${Math.round(h)}h`;
}

// ── Next hours summary ───────────────────────────────────────────────────
export const NEXT_HOURS_WINDOW = 12;
/** SunSmart NZ's line: from UV 3, cover up, hat, sunscreen. */
export const SUN_PROTECTION_UV = 3;

/** Rainy = a measurable amount *and* a fair chance, so a 10 % trace isn't "rain from 3pm". */
export function isRainy(h: Hour): boolean { return (h.qpf || 0) > 0.1 && (h.precipChance ?? 100) >= 40; }

export function rainLabel(qpf: number): string {
  return qpf >= 4 ? "Heavy rain" : qpf >= 1 ? "Moderate rain" : "Light rain";
}

export function uvCategory(uv: number): string {
  const r = Math.round(uv);
  return r < 3 ? "low" : r < 6 ? "moderate" : r < 8 ? "high" : r < 11 ? "very high" : "extreme";
}

/**
 * The stretch of UV 3+ under way or starting within the window, followed to
 * its end (it may run past the window). null when there's none.
 */
export function sunProtection(hours: Hour[], now: number, tz: string, window = NEXT_HOURS_WINDOW): SunProtection | null {
  if (now >= hours.length) return null;
  const high = (i: number) => (hours[i].uvIndex || 0) >= SUN_PROTECTION_UV;
  const first = Math.max(0, now - 1);           // include the hour in progress
  const last  = Math.min(hours.length, now + window);
  let r = -1;
  for (let i = first; i < last; i++) if (high(i)) { r = i; break; }
  if (r < 0) return null;
  let e = r;
  while (e < hours.length && high(e)) e++;
  const peak = Math.max(...hours.slice(r, e).map(h => h.uvIndex || 0));
  const ongoing = r < now;
  const from  = hourLabel(hours[r].validTimeUtc, tz);
  const until = hourLabel(hours[e - 1].validTimeUtc + 3600, tz);
  return {
    ongoing, from, until, peak,
    sentence: `Sun protection ${ongoing ? `until ${until}` : `${from} to ${until}`} ` +
              `(UV up to ${Math.round(peak)}, ${uvCategory(peak)})`,
  };
}

export function rainSentence(hours: Hour[], a: number, b: number, tz: string): string {
  const span = b - a;
  let r = -1;
  for (let i = a; i < b; i++) if (isRainy(hours[i])) { r = i; break; }
  if (r < 0) return `Dry for the next ${span} hour${span === 1 ? "" : "s"}`;
  let e = r;
  while (e < hours.length && isRainy(hours[e])) e++;
  const label = rainLabel(Math.max(...hours.slice(r, e).map(h => h.qpf || 0)));
  const at = (i: number) => hourLabel(hours[i].validTimeUtc, tz);
  if (r === a) return e < b ? `${label} easing by ${at(e)}` : `${label} for the next ${span} hours`;
  if (e > b) return `${label} from ${at(r)}`;
  const d = e - r;
  return `${label} from ${at(r)}, about ${d} hour${d === 1 ? "" : "s"}`;
}

/** The bigger of the coming rise or fall if it's at least 2°, otherwise "staying around". */
export function temperatureSentence(hours: Hour[], a: number, b: number, tz: string): string | null {
  const temps: [number, number][] = [];
  for (let i = a; i < b; i++) { const v = hours[i].temperature; if (v != null) temps.push([i, v]); }
  if (temps.length < 2) return null;
  const first = temps[0];
  const hi = temps.reduce((m, x) => x[1] > m[1] ? x : m);
  const lo = temps.reduce((m, x) => x[1] < m[1] ? x : m);
  const rise = hi[1] - first[1], fall = first[1] - lo[1];
  const at = (i: number) => hourLabel(hours[i].validTimeUtc, tz);
  if (rise >= 2 && rise >= fall) return `Warming to ${Math.round(hi[1])}° by ${at(hi[0])}`;
  if (fall >= 2) return `Cooling to ${Math.round(lo[1])}° by ${at(lo[0])}`;
  return `Staying around ${Math.round(first[1])}°`;
}

/** Only worth a mention from 50 km/h (a "strong" gust on the Beaufort scale). */
export function gustSentence(hours: Hour[], a: number, b: number, tz: string): string | null {
  let peak: [number, number] | null = null;
  for (let i = a; i < b; i++) {
    const g = hours[i].windGust;
    if (g != null && (!peak || g > peak[1])) peak = [i, g];
  }
  if (!peak || peak[1] < 50) return null;
  return `Gusts to ${Math.round(peak[1])} km/h around ${hourLabel(hours[peak[0]].validTimeUtc, tz)}`;
}

/**
 * The sentence about MetService warnings for the summary, or null to leave
 * them out. `warnings` are in force or upcoming, most severe first; each has
 * { headline, level: "yellow"|"orange"|"red", onset, expires } (UTC seconds,
 * either may be null). The warnings card already lists them in full above
 * the chart, so this is only about whether the one-line summary should
 * *also* mention them.
 */
export function warningSentence(_warnings: Warning[], _nowSec: number, _tz: string): string | null {
  // TODO(you): decide if and how the summary mentions warnings. See the
  // notes in the conversation; returning null keeps the summary as the iOS
  // app has it (rain, temperature, gusts, sun protection).
  return null;
}

/**
 * e.g. "Light rain from 4pm, about 2 hours. Warming to 17° by 3pm."
 * Most important first: warnings (if any), rain, temperature, strong gusts,
 * sun protection. null when there are no future hours to talk about.
 */
export function nextHoursSummary(hours: Hour[], nowSec: number, tz: string, warnings: Warning[] = []): string | null {
  const a = nowIndex(hours, nowSec);
  if (a >= hours.length) return null;
  const b = Math.min(hours.length, a + NEXT_HOURS_WINDOW);
  const parts = [
    warningSentence(warnings, nowSec, tz),
    rainSentence(hours, a, b, tz),
    temperatureSentence(hours, a, b, tz),
    gustSentence(hours, a, b, tz),
    sunProtection(hours, a, tz)?.sentence,
  ].filter(Boolean);
  return parts.map(s => s + ".").join(" ");
}

// ── Warnings ─────────────────────────────────────────────────────────────
export const LEVEL_RANK: Record<WarningLevel, number> = { yellow: 0, orange: 1, red: 2 };

/** "Until 9pm", "Until Sat 3am", "From Fri 12pm to 9pm", "In force now". */
export function warningTiming(w: WarningTimes, nowSec: number, tz: string): string {
  const when = (t: number, ref: number): string => dayKey(t, tz) === dayKey(ref, tz)
    ? hourLabel(t, tz) : `${weekday(t, tz, false)} ${hourLabel(t, tz)}`;
  if (w.onset && w.onset > nowSec) {
    return w.expires ? `From ${when(w.onset, nowSec)} to ${when(w.expires, w.onset)}`
                     : `From ${when(w.onset, nowSec)}`;
  }
  if (w.expires) return `Until ${when(w.expires, nowSec)}`;
  return "In force now";
}
