/**
 * Pure display logic behind the conditions card: formatting, icons, today's
 * aggregates, UV and pressure summaries. Every function takes the time zone
 * (and "now" where it matters) as arguments, so tests are deterministic and
 * the same code serves iOS and web.
 */
import type { Current, DailyDay, HourlyHour } from "./payload";

export const MOON_EMOJI: Record<string, string> = {
  NM: "🌑", WNM: "🌑", WXC: "🌒", FQ: "🌓", WXG: "🌔", FM: "🌕", WNG: "🌖", LQ: "🌗", WNC: "🌘",
};

/** TWC-style icon code → emoji. 45 (showers) and 4 (thunder) are what the Worker's wmoToIcon() sends. */
export function iconFor(iconCode: number | null | undefined, dayOrNight?: string | null): string {
  const day = dayOrNight !== "N";
  const code = Number(iconCode);
  if (code === 32 || code === 36) return "☀️";
  if (code === 31) return "🌙";
  if (code === 30 || code === 34) return day ? "⛅" : "☁️";
  if (code === 29 || code === 33 || code === 27 || code === 28) return day ? "🌥️" : "☁️";
  if (code === 26) return "☁️";
  if (code === 9 || code === 11 || code === 45) return "🌦️";
  if (code === 12 || code === 39 || code === 40) return "🌧️";
  if ([13, 14, 15, 16, 41, 42, 43, 46].includes(code)) return "❄️";
  if ([4, 17, 18, 35, 37, 38, 47].includes(code)) return "⛈️";
  if ([19, 20, 21, 22].includes(code)) return "🌫️";
  if (code === 23 || code === 24) return "💨";
  return day ? "⛅" : "☁️";
}

export function degToCard(deg: number): string {
  const dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return dirs[Math.round(deg / 22.5) % 16];
}

// ── Time formatting ─────────────────────────────────────────────────────────
function fmt(utcSec: number | null | undefined, tz: string, opts: Intl.DateTimeFormatOptions): string {
  if (!utcSec) return "—";
  return new Date(utcSec * 1000).toLocaleTimeString("en-NZ", { timeZone: tz, ...opts });
}
/** "1:02 pm" */
export const fmtShortTime = (utcSec: number | null | undefined, tz: string) =>
  fmt(utcSec, tz, { hour: "numeric", minute: "2-digit", hour12: true });
/** "1 pm" */
export const fmtHourOnly = (utcSec: number | null | undefined, tz: string) =>
  fmt(utcSec, tz, { hour: "numeric", hour12: true });
/** "1pm" (no space) */
export const fmtHourCompact = (utcSec: number, tz: string) => fmtHourOnly(utcSec, tz).replace(/ (am|pm)$/i, "$1");

/** "just now", "12 min ago", "3h ago". */
export function fmtRelative(iso: string | undefined | null, nowMs: number): string {
  if (!iso) return "—";
  const diff = (nowMs - new Date(iso).getTime()) / 60000;
  if (diff < 2) return "just now";
  if (diff < 60) return `${Math.round(diff)} min ago`;
  return `${Math.round(diff / 60)}h ago`;
}

/**
 * "Station reported 1:02 pm" (or "Forecast model, 1:00 pm" where no station
 * supplied the reading), with the age added once it is an hour or more old.
 */
export function observedLabel(
  observedUtc: number | null | undefined, source: string | undefined, tz: string, nowMs: number,
): string | null {
  if (!observedUtc) return null;
  const lead = source === "pws" ? "Station reported " : source === "open-meteo" ? "Forecast model, " : null;
  if (!lead) return null;
  const ageMin = (nowMs / 1000 - observedUtc) / 60;
  const age = ageMin >= 60 ? ` · ${fmtRelative(new Date(observedUtc * 1000).toISOString(), nowMs)}` : "";
  return lead + fmtShortTime(observedUtc, tz) + age;
}

export function isDaytime(c: Current, nowSec: number): boolean {
  if (!c.sunriseUtc || !c.sunsetUtc) return true;
  return nowSec >= c.sunriseUtc && nowSec < c.sunsetUtc;
}

// ── Day selection helpers ───────────────────────────────────────────────────
const dayStr = (utcSec: number, tz: string) =>
  new Date(utcSec * 1000).toLocaleDateString("en-NZ", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });

/** Hours falling on the local calendar day of `nowSec`. */
export function todayHours<T extends { validTimeUtc: number }>(hourly: T[], tz: string, nowSec: number): T[] {
  const today = dayStr(nowSec, tz);
  return hourly.filter((h) => h.validTimeUtc && dayStr(h.validTimeUtc, tz) === today);
}

// ── Hourly strip ────────────────────────────────────────────────────────────
export interface HourCell {
  time: string; icon: string; temp: string; precip: string | null; now: boolean;
}

/** `count` cells starting from the hour in progress ("Now"). */
export function hourlyStrip(hourly: HourlyHour[], tz: string, nowSec: number, count = 10): HourCell[] {
  let start = hourly.findIndex((h) => (h.validTimeUtc || 0) >= nowSec);
  if (start < 0) start = 0;
  if (start > 0) start -= 1;
  return hourly.slice(start, start + count).map((h, i) => ({
    time: i === 0 ? "Now" : fmtHourCompact(h.validTimeUtc, tz),
    icon: iconFor(h.iconCode, h.dayOrNight),
    temp: h.temperature != null ? `${Math.round(h.temperature)}°` : "—",
    precip: (h.precipChance ?? 0) >= 10 ? `${h.precipChance}%` : null,
    now: i === 0,
  }));
}

// ── Today aggregates ────────────────────────────────────────────────────────
export function todayAggregates(hourly: HourlyHour[], tz: string, nowSec: number) {
  const slots = todayHours(hourly, tz, nowSec);
  if (!slots.length) return { rainMm: null, peakChance: null, peakGust: null };
  return {
    rainMm: +slots.reduce((s, h) => s + (h.qpf || 0), 0).toFixed(1),
    peakChance: Math.max(...slots.map((h) => h.precipChance || 0)),
    peakGust: Math.max(...slots.map((h) => h.windGust || 0)),
  } as { rainMm: number | null; peakChance: number | null; peakGust: number | null };
}

/** Pressure now vs 3 hours ago: steady inside ±0.5 hPa. */
export function pressureTrend(hourly: HourlyHour[], nowSec: number): "rising" | "falling" | "steady" | null {
  if (!hourly.length) return null;
  const closest = (target: number): HourlyHour | null =>
    hourly.reduce<HourlyHour | null>((best, h) => {
      if (!h.validTimeUtc || h.pressureMeanSeaLevel == null) return best;
      return Math.abs(h.validTimeUtc - target) < Math.abs((best?.validTimeUtc ?? Infinity) - target) ? h : best;
    }, null);
  const nowSlot = closest(nowSec);
  const pastSlot = closest(nowSec - 3 * 3600);
  if (!nowSlot || !pastSlot || nowSlot === pastSlot) return null;
  const delta = nowSlot.pressureMeanSeaLevel! - pastSlot.pressureMeanSeaLevel!;
  if (Math.abs(delta) < 0.5) return "steady";
  return delta > 0 ? "rising" : "falling";
}

export function uvLabel(raw: number | null | undefined): string {
  if (raw == null) return "—";
  const idx = Math.round(raw);   // the Worker sends fractions (7.15); show whole UV like every UV service
  if (idx <= 2) return `${idx} Low`;
  if (idx <= 5) return `${idx} Med`;
  if (idx <= 7) return `${idx} High`;
  if (idx <= 10) return `${idx} V.High`;
  return `${idx} Extreme`;
}

/** Today's peak UV and the contiguous "10am–3pm" window of UV 3+ (null when none). */
export function uvInfo(hourly: HourlyHour[], tz: string, nowSec: number) {
  const hours = todayHours(hourly, tz, nowSec);
  const peakUV = hours.length ? Math.max(...hours.map((h) => h.uvIndex ?? 0)) : null;
  const high = hours.filter((h) => (h.uvIndex ?? 0) >= 3);
  let uvWindow: string | null = null;
  if (high.length) {
    uvWindow = `${fmtHourCompact(high[0].validTimeUtc, tz)}–${fmtHourCompact(high[high.length - 1].validTimeUtc + 3600, tz)}`;
  }
  return { peakUV, uvWindow };
}

export interface HighLow {
  high: { temp: number | null; utcSec: number | null };
  low: { temp: number | null; utcSec: number | null };
}

/**
 * Today's high and the coming overnight low. Uses calendarDay values from
 * daily[0] (never null, unlike temperatureMax once the peak has passed); the
 * time of the high is shown only while the forecast peak is within 1° of it.
 */
export function todayHighLow(hourly: HourlyHour[], daily: DailyDay[], tz: string, nowSec: number): HighLow | null {
  const d0 = daily[0], d1 = daily[1];
  const calMax = d0?.calendarDayTemperatureMax ?? null;
  const hours = todayHours(hourly, tz, nowSec);
  const temps = hours.map((h) => h.temperature).filter((t): t is number => t != null);

  let hiTime: number | null = null;
  if (hours.length && calMax != null) {
    const fHi = hours.reduce((a, b) => ((a.temperature ?? -Infinity) > (b.temperature ?? -Infinity) ? a : b));
    if (fHi.temperature != null && Math.abs(fHi.temperature - calMax) <= 1) hiTime = fHi.validTimeUtc;
  }
  const highTemp = calMax ?? (temps.length ? Math.max(...temps) : null);

  const nightStart = d0?.sunsetTimeUtc ?? null;
  const nightEnd = d1?.sunriseTimeUtc ?? null;
  const night = nightStart && nightEnd
    ? hourly.filter((h) => h.validTimeUtc && h.temperature != null && h.validTimeUtc >= nightStart && h.validTimeUtc < nightEnd)
    : [];
  const loSlot = night.length ? night.reduce((a, b) => (a.temperature! < b.temperature! ? a : b)) : null;
  const lowTemp = loSlot?.temperature ?? (temps.length ? Math.min(...temps) : null);

  if (highTemp == null && lowTemp == null) return null;
  return {
    high: { temp: highTemp, utcSec: hiTime },
    low: { temp: lowTemp, utcSec: loSlot?.validTimeUtc ?? null },
  };
}

/** Cloud cover: the hour at or just before now (30 min grace), else the first. */
export function currentCloud(hourly: HourlyHour[], nowSec: number): number | null {
  const h = hourly.find((x) => (x.validTimeUtc || 0) >= nowSec - 1800) ?? hourly[0];
  return h?.cloudCover ?? null;
}
