/**
 * Data for the week overview strip above the chart: one column per day, its
 * width that day's share of the forecast hours so the strip maps
 * proportionally onto the whole chart. Ported from renderWeekStrip().
 */
import { iconFor } from "./display";
import { sunHoursLabel, weekDays } from "./insights";
import type { HourlyHour } from "./payload";

export interface WeekStripDay {
  /** First hour index of the day (where a tap should scroll the chart to). */
  start: number;
  /** Flex weight: the number of hours in the column. */
  hours: number;
  label: string;
  glyph: string;
  hi: string;
  lo: string;
  sun: string;
  /** Temperature range bar on the shared scale, percent from the top / of the height. */
  barTop: number;
  barHeight: number;
  /** Spoken description for VoiceOver. */
  a11y: string;
}

export function weekStripDays(
  hourly: HourlyHour[], tz: string, lat?: number | null, lon?: number | null,
): WeekStripDay[] {
  const days = weekDays(hourly, tz, lat, lon, (code, dn) => iconFor(code, dn));
  if (!days.length) return [];

  const temps = hourly.map((h) => h.temperature).filter((v): v is number => v != null);
  const lo = Math.min(...temps);
  const hi = Math.max(Math.max(...temps), lo + 1);
  const span = hi - lo;

  return days.map((d) => {
    const sunN = Math.round(d.sunshineHours);
    const sunSpoken = sunN === 0
      ? (d.sunshineHours > 0 ? "little sunshine" : "no sunshine")
      : `about ${sunN} hour${sunN === 1 ? "" : "s"} of sunshine`;
    return {
      start: d.start,
      hours: d.end - d.start,
      label: d.label,
      glyph: d.glyph,
      hi: d.high != null ? `${Math.round(d.high)}°` : "—",
      lo: d.low != null ? `${Math.round(d.low)}°` : "—",
      sun: sunHoursLabel(d.sunshineHours),
      barTop: d.high != null ? ((hi - d.high) / span) * 100 : 0,
      barHeight: d.high != null && d.low != null ? Math.max(0, ((d.high - d.low) / span) * 100) : 0,
      a11y: [
        d.label,
        sunSpoken,
        d.high != null ? `high ${Math.round(d.high)} degrees` : null,
        d.low != null ? `low ${Math.round(d.low)} degrees` : null,
        d.maxChance != null && d.maxChance >= 20 ? `${Math.round(d.maxChance)} percent chance of rain` : null,
      ].filter(Boolean).join(", "),
    };
  });
}
