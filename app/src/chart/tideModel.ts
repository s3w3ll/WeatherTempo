/**
 * Geometry for the tide chart: the same time axis as the weather chart (same
 * first hour, pixels per hour and padding), so with both set to the same zoom
 * their x-axes line up exactly. Pure, like model.ts.
 */
import { dayBoundaries, solarElevation } from "../core/insights";
import { findTideEvents, sampleTide, tideHeight } from "../core/tides";
import type { TideEvent } from "../core/types";
import type { Pt } from "./curve";
import { PAD, clamp } from "./model";

export const TIDE_PAD_V = 8;
export const TIDE_HIGH_COLOR = "#ffa820";
export const TIDE_LOW_COLOR = "#3ee5ff";

export type RGB = [number, number, number];
const lighten = (c: RGB, f: number): RGB => c.map((v) => Math.round(v + (255 - v) * f)) as RGB;
const LIGHTEN = 0.2;       // night: base colours lightened 20% toward white
const DAY_LIGHTEN = 0.4;   // day: lightened further, 40%
/** Daylight and night shading: lightest at the edges of each period, a touch darker at its midpoint. */
export const SHADE = {
  dayLight: lighten([0xff, 0xde, 0xa3], DAY_LIGHTEN),     // base #ffdea3 (sunrise / sunset)
  dayDark: lighten([0xe0, 0xc3, 0x8f], DAY_LIGHTEN),      // base #e0c38f, slightly darker at solar noon
  nightLight: lighten([0xd5, 0xdb, 0xe5], LIGHTEN),   // base #d5dbe5 (dusk / dawn)
  nightDark: lighten([0xbb, 0xc1, 0xca], LIGHTEN),    // base #bbc1ca, slightly darker at the dead of night
};
const mix = (a: RGB, b: RGB, t: number): RGB => [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t)) as RGB;
const TWILIGHT_DEG = 6;   // civil twilight: the band that blends night into day

/** Background colour for a sun elevation; `peak` / `depth` are how high / low the sun gets in the span. */
export function shadeFor(elev: number, peak: number, depth: number): RGB {
  if (elev >= 0) return mix(SHADE.dayLight, SHADE.dayDark, clamp(elev / peak, 0, 1));
  if (elev > -TWILIGHT_DEG) return mix(SHADE.nightLight, SHADE.dayLight, (elev + TWILIGHT_DEG) / TWILIGHT_DEG);
  return mix(SHADE.nightLight, SHADE.nightDark, clamp((-TWILIGHT_DEG - elev) / depth, 0, 1));
}

export interface TideChartInput {
  /** UTC seconds of the weather chart's first hour: the shared x origin. */
  t0Sec: number;
  /** How many hourly columns the weather chart has (the shared x extent). */
  hours: number;
  /** Days that fill the visible width, as on the weather chart. */
  days: number;
  viewportWidth: number;
  H: number;
  lat?: number | null;
  lon?: number | null;
  /** The weather chart's hour timestamps and time zone, for day dividers and labels identical to its own. */
  hourTimes?: number[];
  tz?: string;
}

export interface TideDayColumn { x0: number; x1: number; label: string; divider: boolean }

export interface TideChartModel {
  W: number; H: number;
  pph: number;
  startMs: number; endMs: number;
  /** The curve, one point every 10 minutes. */
  pts: Pt[];
  events: (TideEvent & { x: number; y: number })[];
  now: { x: number; y: number } | null;
  hMin: number; hMax: number;
  /** Background colour stops across the chart (position 0-1) following the sun; empty without coordinates. */
  shade: { pos: number; rgb: RGB }[];
  /** x of each local midnight, and one labelled column per local day (as on the weather chart). */
  dividers: number[];
  dayCols: TideDayColumn[];
  xOf(ms: number): number;
  timeAt(x: number): number;
  hover(x: number): TideHover;
}

export interface TideHover {
  timeMs: number;
  /** Metres, 2 d.p. */
  height: number;
  /** A high/low within 90 minutes of the pointer, if any. */
  near: "high" | "low" | null;
}

export function buildTideModel(portId: string, nowMs: number, o: TideChartInput): TideChartModel | null {
  const startMs = o.t0Sec * 1000;
  const endMs = startMs + o.hours * 3_600_000;
  const curve = sampleTide(portId, startMs, endMs, 10);
  if (curve.length < 2 || o.hours < 1) return null;

  // Same x mapping as the weather chart's timeX(): hour 0 is centred half an hour-width in.
  const pph = Math.max(2, (o.viewportWidth - PAD.left - PAD.right) / (o.days * 24));
  const W = PAD.left + o.hours * pph + PAD.right;
  const xOf = (ms: number) => PAD.left + pph / 2 + ((ms - startMs) / 3_600_000) * pph;

  const raw = findTideEvents(portId, startMs, endMs);
  const heights = curve.map((p) => p.height);
  const hMin = Math.min(...heights) - 0.1;
  const hMax = Math.max(...heights) + 0.1;
  const yOf = (h: number) => o.H - TIDE_PAD_V - ((h - hMin) / (hMax - hMin)) * (o.H - TIDE_PAD_V * 2);

  // Colour follows the sun's height: light gold at sunrise/sunset, a little darker toward noon; pale
  // blue-grey at dusk/dawn, a little darker toward midnight.
  const shade: { pos: number; rgb: RGB }[] = [];
  if (o.lat != null && o.lon != null) {
    const STEP = 15 * 60_000;
    const samples: { ms: number; e: number }[] = [];
    for (let t = startMs; t <= endMs; t += STEP) samples.push({ ms: t, e: solarElevation(t / 1000, o.lat, o.lon) });
    const peak = Math.max(1, ...samples.map((x) => x.e));
    const depth = Math.max(1, -TWILIGHT_DEG - Math.min(...samples.map((x) => x.e)));
    for (const x of samples) shade.push({ pos: clamp(xOf(x.ms) / W, 0, 1), rgb: shadeFor(x.e, peak, depth) });
  }

  // Day dividers and day columns, computed exactly as the weather chart does from its hours.
  const hx = (i: number) => PAD.left + i * pph + pph / 2;
  const times = o.hourTimes ?? [];
  const hourObjs = times.map((t) => ({ validTimeUtc: t }));
  const tz = o.tz ?? "Pacific/Auckland";
  const bounds = times.length ? dayBoundaries(hourObjs, tz) : [];
  const dividers = bounds.map((i) => hx(i) - pph / 2);
  const dayCols: TideDayColumn[] = [];
  if (times.length) {
    const edges = [0, ...bounds, times.length];
    for (let b = 0; b < edges.length - 1; b++) {
      const x0 = hx(edges[b]) - pph / 2;
      const x1 = hx(edges[b + 1] - 1) + pph / 2;
      const w = x1 - x0;
      if (w < 24) continue;   // a sliver of a day at either end: no room for a name
      const label = new Date(times[edges[b]] * 1000).toLocaleDateString("en-NZ", { timeZone: tz, weekday: w > 100 ? "long" : "short" });
      dayCols.push({ x0, x1, label, divider: b > 0 });
    }
  }

  const timeAt = (x: number) => clamp(startMs + ((x - PAD.left - pph / 2) / pph) * 3_600_000, startMs, endMs);
  const nx = xOf(nowMs);
  return {
    W, H: o.H, pph, startMs, endMs, hMin, hMax, shade, dividers, dayCols, xOf, timeAt,
    pts: curve.map((p) => ({ x: xOf(p.time.getTime()), y: yOf(p.height) })),
    events: raw.map((e) => ({ ...e, x: xOf(e.time.getTime()), y: yOf(e.height) })),
    now: nowMs >= startMs && nowMs <= endMs ? { x: nx, y: yOf(tideHeight(portId, nowMs)!) } : null,
    hover(x) {
      const timeMs = timeAt(x);
      const nearest = raw.reduce<{ e: TideEvent; d: number } | null>((best, e) => {
        const d = Math.abs(e.time.getTime() - timeMs);
        return d < (best?.d ?? Infinity) ? { e, d } : best;
      }, null);
      return {
        timeMs,
        height: +tideHeight(portId, timeMs)!.toFixed(2),
        near: nearest && nearest.d < 90 * 60_000 ? nearest.e.type : null,
      };
    },
  };
}

/** Scroll offset that puts "now" about 30% in from the left (like the weather chart). */
export function tideScrollForNow(m: TideChartModel, nowMs: number, viewport: number): number {
  return Math.max(0, m.xOf(nowMs) - viewport * 0.3);
}

/**
 * The events that get a card: from `fromMs` on, thinned so neighbours are at
 * least `minGap` px apart (zoomed out, every card would overlap), in order.
 */
export function cardEvents(
  m: TideChartModel, fromMs: number, minGap: number, type?: "high" | "low",
): (TideEvent & { x: number; y: number })[] {
  const out: (TideEvent & { x: number; y: number })[] = [];
  for (const e of m.events) {
    if (e.time.getTime() < fromMs || (type && e.type !== type)) continue;
    if (out.length && e.x - out[out.length - 1].x < minGap) continue;
    out.push(e);
  }
  return out;
}

/**
 * Left edges for cards that each sit under their own point (xs ascending),
 * centred where they can be and nudged apart when points are too close, always
 * inside 0..W, never overlapping, and in the same left-to-right order.
 */
export function layoutTideCards(xs: number[], W: number, cardW: number, gap: number): number[] {
  const maxLeft = Math.max(0, W - cardW);
  const lefts = xs.map((x) => Math.min(Math.max(0, x - cardW / 2), maxLeft));
  for (let i = 1; i < lefts.length; i++) lefts[i] = Math.max(lefts[i], lefts[i - 1] + cardW + gap);
  // If the sweep pushed the last card off the right edge, pull the run back in.
  for (let i = lefts.length - 1; i >= 0; i--) {
    const limit = i === lefts.length - 1 ? maxLeft : lefts[i + 1] - cardW - gap;
    lefts[i] = Math.min(lefts[i], limit);
  }
  return lefts.map((l) => Math.max(0, l));
}
