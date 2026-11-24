/**
 * Chart geometry, computed with no drawing API. Everything the Skia renderer
 * puts on screen is derived here (a method-for-method port of chart.js), so the
 * layout rules are unit-tested and the renderer stays a thin set of draw calls.
 */
import {
  dayBoundaries, dewComfort, dewPoint, glowStops, LEVEL_RANK, nowIndex, pressureTendencies, skyStops,
  tendencyRuns,
} from "../core/insights";
import type { HourlyHour } from "../core/payload";
import type { SkyPhase, Warning, WarningLevel } from "../core/types";
import { type Pt } from "./curve";

// Swimlane meteogram, 364 px tall: main 70% / wind 15% / precip 15%, 4 px gaps.
export const ZONE = {
  top: 0,
  cloudTop: 8, cloudBot: 50,
  tempTop: 45, tempBot: 224,
  windTop: 228, windBot: 276,
  precipTop: 280, precipBot: 328,
  timeTop: 332, dayAxisTop: 348,
  height: 364,
} as const;
export const PAD = { left: 6, right: 6 } as const;
export const PRESSURE_STRIP_H = 16;
const MAX_WIND = 90;   // km/h ceiling: 30 km/h lands at exactly 1/3 height

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export interface ChartInput {
  hours: HourlyHour[];
  /** How many days fill the visible width (zoom). */
  days: number;
  /** Width of the scroll viewport in px. */
  viewportWidth: number;
  lat?: number | null;
  lon?: number | null;
  warnings?: (Warning & { id?: string })[];
  tz: string;
  nowSec: number;
}

export interface WarningSpan {
  headline: string; level: WarningLevel; start: number; end: number; x0: number; x1: number;
}

export interface ChartModel {
  input: ChartInput;
  hours: HourlyHour[];
  tz: string;
  pph: number;
  W: number;
  H: number;
  dew: (number | null)[];
  tMin: number; tMax: number; pMin: number; pMax: number; qMax: number;
  nowIdx: number;
  labelStride: number;
  arrowEvery: number;
  spans: WarningSpan[];
  hourX(i: number): number;
  tempY(t: number): number;
  pressY(p: number): number;
  uvY(uv: number): number;
  timeX(t: number): number;
  hourAt(x: number): number;
}

/** Local hour 0–23 (the `% 24` guards the ICU quirk where midnight returns "24"). */
export function localHour(utcSec: number, tz: string): number {
  return Number(new Date(utcSec * 1000).toLocaleString("en-NZ", { timeZone: tz, hour: "numeric", hour12: false })) % 24;
}

export function buildChartModel(input: ChartInput): ChartModel {
  const { hours, days, viewportWidth, tz, nowSec } = input;
  // Sanity floor only: 5 days on a phone is ~3 px/hour and must still fit.
  const pph = Math.max(2, (viewportWidth - PAD.left - PAD.right) / (days * 24));
  const W = PAD.left + hours.length * pph + PAD.right;
  const H = ZONE.height;

  const dew = hours.map((h) => dewPoint(h.temperature, h.relativeHumidity));

  // One temperature scale shared by temp, feels-like and dew point.
  const all = [...hours.map((h) => h.temperature), ...hours.map((h) => h.temperatureFeelsLike), ...dew]
    .filter((v): v is number => v != null);
  const tMin = (all.length ? Math.min(...all) : 8) - 2;
  const tMax = (all.length ? Math.max(...all) : 18) + 2;

  const pvals = hours.map((h) => h.pressureMeanSeaLevel).filter((v): v is number => v != null);
  const pMin = pvals.length ? Math.min(...pvals) - 2 : 1000;
  const pMax = pvals.length ? Math.max(...pvals) + 2 : 1030;
  const qMax = Math.max(1, ...hours.map((h) => h.qpf || 0));

  const hourX = (i: number) => PAD.left + i * pph + pph / 2;
  const span = ZONE.tempBot - ZONE.tempTop;
  const m: ChartModel = {
    input, hours, tz, pph, W, H, dew, tMin, tMax, pMin, pMax, qMax,
    nowIdx: nowIndex(hours, nowSec),
    // Labels every 3 h need 10+ px/hour; zoomed out they thin to 6/12/24 h.
    labelStride: [3, 6, 12].find((s) => pph * s >= 30) || 24,
    // Wind arrows (~10 px wide) every 3 h, in 3 h steps when zoomed out.
    arrowEvery: Math.max(1, Math.ceil(18 / pph / 3)) * 3,
    spans: [],
    hourX,
    tempY: (t) => ZONE.tempBot - ((t - tMin) / (tMax - tMin)) * span,
    pressY: (p) => ZONE.tempBot - ((p - pMin) / (pMax - pMin)) * span,
    uvY: (uv) => ZONE.tempBot - (clamp(uv, 0, 12) / 12) * span * 0.4,   // own 0–12 scale, lower 40%
    timeX: (t) => hourX(0) + ((t - hours[0].validTimeUtc) / 3600) * pph,
    hourAt: (x) => clamp(Math.round((x - PAD.left - pph / 2) / pph), 0, hours.length - 1),
  };
  m.spans = warningSpans(m, input.warnings ?? []);
  return m;
}

// ── Warnings ────────────────────────────────────────────────────────────────
/** Clamped to the data area, ones entirely outside dropped, least severe first so the worst draws on top. */
export function warningSpans(m: ChartModel, warnings: Warning[]): WarningSpan[] {
  const { hours } = m;
  if (!hours.length) return [];
  const first = hours[0].validTimeUtc - 1800;
  const last = hours[hours.length - 1].validTimeUtc + 1800;
  return warnings
    .filter((w) => w.level in LEVEL_RANK)
    .slice()
    .sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level])
    .flatMap((w) => {
      const start = Math.max(w.onset || first, first);
      const end = Math.min(w.expires || last, last);
      return end > start ? [{ headline: w.headline, level: w.level, start, end, x0: m.timeX(start), x1: m.timeX(end) }] : [];
    });
}

/** The most severe warning in force during hour i (for the tooltip). */
export function warningAt(m: ChartModel, i: number): WarningSpan | null {
  const t = m.hours[i]?.validTimeUtc;
  if (t == null) return null;
  return m.spans.slice().reverse().find((s) => s.start <= t && t < s.end) ?? null;
}

// ── Background ──────────────────────────────────────────────────────────────
export interface GradStop { pos: number; phase: SkyPhase }

/**
 * Horizontal sky gradient stops (position 0–1 across the canvas). With
 * coordinates they come from the sun's true position; without, from each hour's flag.
 */
export function skyGradient(m: ChartModel): GradStop[] {
  const { hours } = m;
  const { lat, lon } = m.input;
  const sky = skyStops(hours, lat, lon);
  if (sky) {
    const t0 = hours[0].validTimeUtc;
    return sky.map((s) => ({ pos: clamp((PAD.left + ((s.t - t0) / 3600) * m.pph) / m.W, 0, 1), phase: s.phase }));
  }
  return hours.map((h, i) => ({ pos: clamp(m.hourX(i) / m.W, 0, 1), phase: (h.dayOrNight === "D" ? "day" : "night") as SkyPhase }));
}

/** Sunshine glow along the chart as { pos 0–1, value 0–1 }; empty when there is no sun at all. */
export function glowGradient(m: ChartModel): { pos: number; value: number }[] {
  const stops = glowStops(m.hours, m.input.lat, m.input.lon);
  if (!stops.some((s) => s.value > 0)) return [];
  return stops.map((s) => ({ pos: clamp((PAD.left + s.h * m.pph) / m.W, 0, 1), value: s.value }));
}

/** y of each temperature grid line. */
export function gridYs(m: ChartModel): number[] {
  const step = Math.ceil(Math.max(1, (m.tMax - m.tMin) / 5));
  const ys: number[] = [];
  for (let t = Math.ceil(m.tMin); t <= m.tMax; t += step) ys.push(m.tempY(t));
  return ys;
}

// ── Series ──────────────────────────────────────────────────────────────────
export function temperaturePts(m: ChartModel): Pt[] {
  return m.hours.map((h, i) => ({ x: m.hourX(i), y: m.tempY(h.temperature ?? 0) }));
}
export function feelsLikePts(m: ChartModel): Pt[] {
  return m.hours.map((h, i) => ({ x: m.hourX(i), y: m.tempY(h.temperatureFeelsLike ?? 0) }));
}
export function dewPts(m: ChartModel): Pt[] {
  return m.dew.flatMap((d, i) => (d != null ? [{ x: m.hourX(i), y: m.tempY(d) }] : []));
}
export function pressurePts(m: ChartModel): Pt[] {
  return m.hours.flatMap((h, i) =>
    h.pressureMeanSeaLevel != null ? [{ x: m.hourX(i), y: m.pressY(h.pressureMeanSeaLevel) }] : []);
}
export const windY = (spd: number | null | undefined) =>
  ZONE.windBot - (clamp(spd || 0, 0, MAX_WIND) / MAX_WIND) * (ZONE.windBot - ZONE.windTop);
export function windPts(m: ChartModel): Pt[] {
  return m.hours.map((h, i) => ({ x: m.hourX(i), y: windY(h.windSpeed || 0) }));
}
export function gustPts(m: ChartModel): Pt[] {
  return m.hours.flatMap((h, i) => (h.windGust != null ? [{ x: m.hourX(i), y: windY(h.windGust) }] : []));
}
export const precipY = (pct: number) =>
  ZONE.precipBot - (pct / 100) * (ZONE.precipBot - ZONE.precipTop);
export function precipChancePts(m: ChartModel): Pt[] {
  return m.hours.map((h, i) => ({ x: m.hourX(i), y: precipY(h.precipChance || 0) }));
}

// ── Cloud cover ─────────────────────────────────────────────────────────────
export interface CloudRun { xLeft: number; xRight: number; pts: Pt[] }

/** Consecutive hours with 10%+ cloud, each a band hanging from the top whose lower edge follows cover. */
export function cloudRuns(m: ChartModel): CloudRun[] {
  const { hours } = m;
  const zoneH = ZONE.cloudBot - ZONE.cloudTop;
  const runs: CloudRun[] = [];
  let i = 0;
  while (i < hours.length) {
    if ((hours[i].cloudCover || 0) < 10) { i++; continue; }
    const start = i;
    while (i < hours.length && (hours[i].cloudCover || 0) >= 10) i++;
    const pts: Pt[] = [];
    for (let j = start; j < i; j++) pts.push({ x: m.hourX(j), y: ZONE.cloudTop + zoneH * ((hours[j].cloudCover || 0) / 100) });
    runs.push({ xLeft: PAD.left + start * m.pph, xRight: PAD.left + i * m.pph, pts });
  }
  return runs;
}

// ── UV ──────────────────────────────────────────────────────────────────────
export interface UvRun {
  pts: Pt[];
  floorY: number;
  /** y of UV 3: the fill shows only above this line (the "sun protection" part). */
  protectY: number;
  peak: { x: number; y: number; uv: number } | null;
}

/** Daylight stretches with UV above zero, plus the zero either side. */
export function uvRuns(m: ChartModel): UvRun[] {
  const { hours } = m;
  const out: UvRun[] = [];
  let i = 0;
  while (i < hours.length) {
    if ((hours[i].uvIndex || 0) <= 0) { i++; continue; }
    const a = Math.max(0, i - 1);
    while (i < hours.length && (hours[i].uvIndex || 0) > 0) i++;
    const b = Math.min(hours.length, i + 1);
    const pts: Pt[] = [];
    for (let k = a; k < b; k++) pts.push({ x: m.hourX(k), y: m.uvY(hours[k].uvIndex || 0) });
    if (pts.length < 2) continue;
    let peak = a;
    for (let k = a; k < b; k++) if ((hours[k].uvIndex || 0) > (hours[peak].uvIndex || 0)) peak = k;
    const uv = hours[peak].uvIndex || 0;
    out.push({
      pts, floorY: m.uvY(0), protectY: m.uvY(3),
      peak: uv >= 1 ? { x: m.hourX(peak), y: m.uvY(uv), uv: Math.round(uv) } : null,
    });
  }
  return out;
}

// ── Precipitation bars ──────────────────────────────────────────────────────
export interface PrecipBar { x: number; y: number; w: number; h: number; intensity: number }

export function precipBars(m: ChartModel): PrecipBar[] {
  const barW = Math.max(2, m.pph * 0.45);
  const zoneH = ZONE.precipBot - ZONE.precipTop;
  return m.hours.flatMap((h, i) => {
    const qpf = h.qpf || 0;
    if (qpf <= 0) return [];
    const intensity = clamp(qpf / m.qMax, 0, 1);
    const height = Math.max(2, zoneH * intensity);
    return [{ x: m.hourX(i) - barW / 2, y: ZONE.precipBot - height, w: barW, h: height, intensity }];
  });
}

// ── Wind arrows ─────────────────────────────────────────────────────────────
export interface WindArrow {
  shaft: [number, number, number, number];
  head: [number, number, number, number, number, number];
}

/** Arrows centred on the speed line, pointing where the wind is blowing TO (180° from "from"). */
export function windArrows(m: ChartModel): WindArrow[] {
  const L = 5;
  const out: WindArrow[] = [];
  for (let i = 0; i < m.hours.length; i += m.arrowEvery) {
    const h = m.hours[i];
    if (h.windSpeed == null) continue;
    const x = m.hourX(i), y = windY(h.windSpeed);
    const rad = (((h.windDirection || 0) + 180) * Math.PI) / 180;
    const dx = Math.sin(rad) * L, dy = -Math.cos(rad) * L;
    const tipX = x + dx * 0.6, tipY = y + dy * 0.6;
    const hw = clamp(L * 0.45, 2.5, 4);
    const px = (-dy / L) * hw, py = (dx / L) * hw;
    out.push({
      shaft: [x - dx * 0.6, y - dy * 0.6, tipX, tipY],
      head: [tipX + dx * 0.5, tipY + dy * 0.5, tipX - dx * 0.3 + px, tipY - dy * 0.3 + py, tipX - dx * 0.3 - px, tipY - dy * 0.3 - py],
    });
  }
  return out;
}

// ── Axes ────────────────────────────────────────────────────────────────────
export function dividerXs(m: ChartModel): number[] {
  return dayBoundaries(m.hours, m.tz).map((i) => m.hourX(i) - m.pph / 2);
}

export function timeLabels(m: ChartModel): { x: number; text: string }[] {
  const out: { x: number; text: string }[] = [];
  m.hours.forEach((h, i) => {
    if (!h.validTimeUtc) return;
    const hour = localHour(h.validTimeUtc, m.tz);
    if (hour % m.labelStride !== 0) return;
    const text = hour === 0 ? "12am" : hour === 12 ? "12pm" : hour > 12 ? `${hour - 12}pm` : `${hour}am`;
    out.push({ x: m.hourX(i), text });
  });
  return out;
}

export interface DayColumn { x0: number; x1: number; label: string; divider: boolean }

export function dayColumns(m: ChartModel): DayColumn[] {
  const bounds = [0, ...dayBoundaries(m.hours, m.tz), m.hours.length];
  const cols: DayColumn[] = [];
  for (let b = 0; b < bounds.length - 1; b++) {
    const x0 = m.hourX(bounds[b]) - m.pph / 2;
    const x1 = m.hourX(bounds[b + 1] - 1) + m.pph / 2;
    const w = x1 - x0;
    if (w < 24) continue;   // a sliver of a day at either end: no room for a name
    const label = new Date((m.hours[bounds[b]].validTimeUtc || 0) * 1000).toLocaleDateString("en-NZ", {
      timeZone: m.tz, weekday: w > 100 ? "long" : "short",
    });
    cols.push({ x0, x1, label, divider: b > 0 });
  }
  return cols;
}

// ── Temperature labels at day highs / night lows ───────────────────────────
export interface TempMarker {
  idx: number; kind: "high" | "low"; x: number; curveY: number;
  labelX: number; labelY: number; stemY1: number; stemY2: number; text: string;
}

export function tempMarkers(m: ChartModel): TempMarker[] {
  const { hours } = m;
  const out: TempMarker[] = [];
  let runStart = 0;
  for (let i = 1; i <= hours.length; i++) {
    if (!(i === hours.length || hours[i].dayOrNight !== hours[runStart].dayOrNight)) continue;
    const isDay = hours[runStart].dayOrNight === "D";
    let pick = runStart;
    for (let j = runStart + 1; j < i; j++) {
      const t = hours[j].temperature ?? 0, p = hours[pick].temperature ?? 0;
      if (isDay ? t > p : t < p) pick = j;
    }
    const t = hours[pick].temperature ?? 0;
    const x = m.hourX(pick), curveY = m.tempY(t);
    const STEM = 10;
    const labelY = isDay ? curveY - STEM - 14 : curveY + STEM + 14;
    out.push({
      idx: pick, kind: isDay ? "high" : "low", x, curveY,
      labelX: clamp(x, 14, m.W - 14),   // a high/low on the first/last hour must not be cut off
      labelY,
      stemY1: isDay ? curveY - 4 : curveY + 4,
      stemY2: isDay ? labelY + 4 : labelY - 4,
      text: `${Math.round(t)}°`,
    });
    runStart = i;
  }
  return out;
}

// ── Pressure strip ──────────────────────────────────────────────────────────
export interface PressureCell { x: number; w: number; direction: "steady" | "rising" | "falling"; strength: number }
export interface PressureLabel { x: number; text: string; strong: boolean }

/** Neighbouring hours in the same band merge into one rectangle (translucent cells would show seams). */
export function pressureCells(m: ChartModel): { cells: PressureCell[]; labels: PressureLabel[] } {
  const t = pressureTendencies(m.hours);
  const cells: PressureCell[] = [];
  let i = 0;
  while (i < t.length) {
    const c = t[i];
    if (!c) { i++; continue; }
    const start = i;
    while (i < t.length && t[i] && t[i]!.direction === c.direction && t[i]!.strength === c.strength) i++;
    cells.push({ x: PAD.left + start * m.pph, w: (i - start) * m.pph, direction: c.direction, strength: c.strength });
  }
  const labels: PressureLabel[] = [];
  for (const run of tendencyRuns(t)) {
    if (run.direction === "steady") continue;
    const x0 = PAD.left + run.start * m.pph, w = (run.end - run.start) * m.pph;
    const arrow = run.direction === "rising" ? "▲" : "▼";
    const text = w >= 90 ? `${arrow} ${run.label}` : w >= 14 ? arrow : "";
    if (text) labels.push({ x: x0 + w / 2, text, strong: run.maxStrength === 3 });
  }
  return { cells, labels };
}
export const PRESSURE_ALPHA = [0.10, 0.22, 0.45, 0.75] as const;

// ── Tooltip ─────────────────────────────────────────────────────────────────
export interface TooltipRow { label: string; value: string; warnLevel?: WarningLevel }

export function tooltip(m: ChartModel, i: number): { time: string; rows: TooltipRow[] } {
  const h = m.hours[i];
  const fmt = (v: number | null | undefined, unit: string) => (v != null ? `${v}${unit}` : "—");
  const fmtR = (v: number | null | undefined, unit: string) => (v != null ? `${Math.round(v)}${unit}` : "—");
  const warn = warningAt(m, i);
  const time = h.validTimeUtc
    ? new Date(h.validTimeUtc * 1000).toLocaleString("en-NZ", {
        timeZone: m.tz, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true,
      })
    : "";
  const rows: TooltipRow[] = [];
  if (warn) rows.push({ label: "Warning", value: warn.headline, warnLevel: warn.level });
  // Related pairs share a row to keep the tooltip short.
  const feels = h.temperatureFeelsLike != null ? ` · feels ${Math.round(h.temperatureFeelsLike)}°` : "";
  const wind = h.windSpeed != null
    ? `${h.windSpeed} km/h ${h.windDirectionCardinal || ""}`.trim() + (h.windGust != null ? ` · gusts ${h.windGust}` : "")
    : (h.windGust != null ? `gusts ${h.windGust} km/h` : "—");
  const rain = h.precipChance != null
    ? `${h.precipChance}%` + ((h.qpf ?? 0) > 0 ? ` · ${h.qpf} mm` : "")
    : ((h.qpf ?? 0) > 0 ? `${h.qpf} mm` : "—");
  rows.push(
    { label: "Temp", value: h.temperature != null ? `${Math.round(h.temperature)}°${feels}` : "—" },
    { label: "Condition", value: h.wxPhraseMedium || "—" },
    { label: "Humidity", value: fmt(h.relativeHumidity, "%") },
    { label: "Wind", value: wind },
    { label: "Rain", value: rain },
    { label: "Pressure", value: fmtR(h.pressureMeanSeaLevel, " hPa") },
    { label: "UV index", value: fmtR(h.uvIndex, "") },
    { label: "Cloud cover", value: fmt(h.cloudCover, "%") },
  );
  return { time, rows };
}

// ── Scroll helpers ──────────────────────────────────────────────────────────
/** Scroll offset that puts "now" ~30% in from the left edge. */
export function scrollForNow(m: ChartModel, viewport: number): number {
  return Math.max(0, m.hourX(m.nowIdx) - viewport * 0.3);
}
/** Scroll offset that puts hour i at the left edge. */
export const scrollForHour = (m: ChartModel, i: number) => PAD.left + i * m.pph;
/** UTC time at the left edge of the view, and its inverse (keeps position across zoom changes). */
export const timeAtScroll = (m: ChartModel, x: number) => m.hours[0].validTimeUtc + ((x - PAD.left) / m.pph) * 3600;
export const scrollForTime = (m: ChartModel, t: number) => PAD.left + ((t - m.hours[0].validTimeUtc) / 3600) * m.pph;

// ── Week strip ↔ chart ──────────────────────────────────────────────────────
/** The part of the series in view, as fractions 0–1 of all hours (drives the strip's frame). */
export function visibleFraction(m: ChartModel, scrollLeft: number, viewport: number): [number, number] {
  const total = m.hours.length * m.pph;
  if (total <= 0) return [0, 1];
  const a = clamp((scrollLeft - PAD.left) / total, 0, 1);
  const b = clamp((scrollLeft + viewport - PAD.left) / total, a, 1);
  return [a, b];
}

/** First hour to scroll to so the window is centred on `fraction` of the series (browsing by dragging the strip). */
export function browseStartHour(m: ChartModel, fraction: number, viewport: number): number {
  const vis = Math.min(m.hours.length, Math.round((viewport - PAD.left - PAD.right) / m.pph));
  const centre = clamp(fraction, 0, 1) * m.hours.length;
  return clamp(Math.round(centre - vis / 2), 0, Math.max(0, m.hours.length - vis));
}
