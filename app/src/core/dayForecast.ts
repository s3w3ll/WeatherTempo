/**
 * Data behind the four "tomorrow … day 4" cards and the hourly table. Pure:
 * time zone and "now" are arguments. Ported from buildDayForecast() and
 * renderHourlyTable() in the website's app.js.
 */
import { degToCard, fmtHourCompact, uvLabel } from "./display";
import type { DailyDay, HourlyHour } from "./payload";

export interface Extreme { val: number | null; utcSec: number | null }

export interface DayForecast {
  label: string;
  /** "19 Mar" */
  date: string;
  sunrise: number | null;
  sunset: number | null;
  temp: { max: Extreme; min: Extreme };
  humidity: { max: Extreme; min: Extreme };
  wind: { speed: number | null; cardinal: string | null; utcSec: number | null };
  precip: { totalMm: number | null; maxChance: number | null };
  uv: { peak: number | null; window: string | null };
  pressure: { max: Extreme; min: Extreme };
}

const dateKey = (ts: number, tz: string) =>
  new Date(ts * 1000).toLocaleDateString("en-NZ", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });

/** The hour with the largest `fn` (first wins ties); null for an empty list. */
function maxBy<T>(arr: T[], fn: (h: T) => number | null | undefined): T | null {
  if (!arr.length) return null;
  return arr.reduce((best, h) => ((fn(h) ?? -Infinity) > (fn(best) ?? -Infinity) ? h : best), arr[0]);
}
function minBy<T>(arr: T[], fn: (h: T) => number | null | undefined): T | null {
  if (!arr.length) return null;
  return arr.reduce((best, h) => ((fn(h) ?? Infinity) < (fn(best) ?? Infinity) ? h : best), arr[0]);
}

/**
 * One forecast day. `dayIndex` 1 = tomorrow, 2 = the day after (daily[0] is
 * today). Null when daily[dayIndex] doesn't exist.
 */
export function buildDayForecast(
  dayIndex: number, hourly: HourlyHour[], daily: DailyDay[], tz: string, nowSec: number,
): DayForecast | null {
  const d = daily[dayIndex];
  if (!d) return null;

  // The day is identified by its sunrise; without one, by the clock plus an offset.
  const refTs = d.sunriseTimeUtc ?? Math.round(nowSec) + dayIndex * 86400;
  const targetKey = dateKey(refTs, tz);
  const slots = hourly.filter((h) => h.validTimeUtc && dateKey(h.validTimeUtc, tz) === targetKey);

  const label = dayIndex === 1
    ? "Tomorrow"
    : new Date(refTs * 1000).toLocaleDateString("en-NZ", { timeZone: tz, weekday: "long" });
  const date = new Date(refTs * 1000).toLocaleDateString("en-NZ", { timeZone: tz, day: "numeric", month: "short" });

  const hiSlot = maxBy(slots, (h) => h.temperature);

  // Overnight low: this sunset → the next sunrise (crosses the calendar boundary).
  const nextD = daily[dayIndex + 1];
  const nightStart = d.sunsetTimeUtc || null;
  const nightEnd = nextD?.sunriseTimeUtc || null;
  const night = nightStart && nightEnd
    ? hourly.filter((h) => h.validTimeUtc && h.validTimeUtc >= nightStart && h.validTimeUtc < nightEnd)
    : [];
  const loSlot = night.length ? minBy(night, (h) => h.temperature) : minBy(slots, (h) => h.temperature);

  const humHi = maxBy(slots, (h) => h.relativeHumidity);
  const humLo = minBy(slots, (h) => h.relativeHumidity);
  const windSlot = maxBy(slots, (h) => h.windSpeed);
  const presHi = maxBy(slots, (h) => h.pressureMeanSeaLevel);
  const presLo = minBy(slots, (h) => h.pressureMeanSeaLevel);

  const uvs = slots.map((h) => h.uvIndex).filter((v): v is number => v != null);
  const uvSlots = slots.filter((h) => (h.uvIndex || 0) >= 3);

  const ext = (slot: HourlyHour | null, v: number | null | undefined): Extreme =>
    ({ val: slot ? v ?? null : null, utcSec: slot ? slot.validTimeUtc : null });

  return {
    label, date,
    sunrise: d.sunriseTimeUtc || null,
    sunset: d.sunsetTimeUtc || null,
    temp: {
      max: { val: d.calendarDayTemperatureMax ?? null, utcSec: hiSlot ? hiSlot.validTimeUtc : null },
      min: { val: loSlot?.temperature ?? d.calendarDayTemperatureMin ?? null, utcSec: loSlot ? loSlot.validTimeUtc : null },
    },
    humidity: { max: ext(humHi, humHi?.relativeHumidity), min: ext(humLo, humLo?.relativeHumidity) },
    wind: {
      speed: windSlot ? windSlot.windSpeed ?? null : null,
      cardinal: windSlot ? windSlot.windDirectionCardinal || (windSlot.windDirection != null ? degToCard(windSlot.windDirection) : null) : null,
      utcSec: windSlot ? windSlot.validTimeUtc : null,
    },
    precip: {
      totalMm: slots.length ? +slots.reduce((s, h) => s + (h.qpf || 0), 0).toFixed(1) : null,
      maxChance: slots.length ? Math.max(...slots.map((h) => h.precipChance || 0)) : null,
    },
    uv: {
      peak: uvs.length ? Math.max(...uvs) : null,
      window: uvSlots.length
        ? `${fmtHourCompact(uvSlots[0].validTimeUtc, tz)}–${fmtHourCompact(uvSlots[uvSlots.length - 1].validTimeUtc + 3600, tz)}`
        : null,
    },
    pressure: { max: ext(presHi, presHi?.pressureMeanSeaLevel), min: ext(presLo, presLo?.pressureMeanSeaLevel) },
  };
}

// ── Hourly table ────────────────────────────────────────────────────────────
export type HourlyTableRow =
  | { kind: "day"; key: string; label: string }
  | { kind: "hour"; key: string; isDay: boolean; isNow: boolean; cells: string[] };

export const HOURLY_COLUMNS = [
  "Time", "Cond.", "Temp", "Feels", "Humidity", "Wind", "Gust", "Cloud", "Rain%", "QPF", "Pressure", "UV",
] as const;

/** Five days of rows, with a day heading each time the local date changes. */
export function hourlyTableRows(hourly: HourlyHour[], tz: string, nowSec: number, maxHours = 5 * 24): HourlyTableRow[] {
  const fmt = (v: number | null | undefined, u: string) => (v != null ? `${Math.round(v)}${u}` : "—");
  const fmt1 = (v: number | null | undefined, u: string) => (v != null ? `${v.toFixed(1)}${u}` : "—");
  const rows: HourlyTableRow[] = [];
  let lastDay: string | null = null;

  for (const h of hourly.slice(0, maxHours)) {
    if (!h.validTimeUtc) continue;
    const date = new Date(h.validTimeUtc * 1000);
    const day = date.toLocaleDateString("en-NZ", { timeZone: tz, weekday: "short", month: "short", day: "numeric" });
    const time = date.toLocaleTimeString("en-NZ", { timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true });
    const isNow = Math.abs(h.validTimeUtc - nowSec) < 1800;

    if (day !== lastDay) {
      lastDay = day;
      rows.push({ kind: "day", key: `d${h.validTimeUtc}`, label: day });
    }
    rows.push({
      kind: "hour", key: `h${h.validTimeUtc}`, isDay: h.dayOrNight === "D", isNow,
      cells: [
        isNow ? "Now" : time,
        h.wxPhraseMedium || "—",
        fmt1(h.temperature, "°"),
        fmt1(h.temperatureFeelsLike, "°"),
        fmt(h.relativeHumidity, "%"),
        h.windSpeed != null ? `${Math.round(h.windSpeed)} km/h ${h.windDirectionCardinal || ""}`.trim() : "—",
        fmt(h.windGust, " km/h"),
        fmt(h.cloudCover, "%"),
        fmt(h.precipChance, "%"),
        h.qpf != null && h.qpf > 0 ? `${h.qpf.toFixed(1)} mm` : "—",
        fmt1(h.pressureMeanSeaLevel, " hPa"),
        h.uvIndex != null ? uvLabel(h.uvIndex) : "—",
      ],
    });
  }
  return rows;
}
