/**
 * Geometry for the tide chart: the same time axis as the weather chart (same
 * first hour, pixels per hour and padding), so with both set to the same zoom
 * their x-axes line up exactly. Pure, like model.ts.
 */
import { skyStops } from "../core/insights";
import { findTideEvents, sampleTide, tideHeight } from "../core/tides";
import type { SkyPhase, TideEvent } from "../core/types";
import type { Pt } from "./curve";
import { PAD, clamp } from "./model";

export const TIDE_PAD_V = 8;
export const TIDE_HIGH_COLOR = "#ffa820";
export const TIDE_LOW_COLOR = "#3ee5ff";

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
}

export interface TideChartModel {
  W: number; H: number;
  pph: number;
  startMs: number; endMs: number;
  /** The curve, one point every 10 minutes. */
  pts: Pt[];
  events: (TideEvent & { x: number; y: number })[];
  now: { x: number; y: number } | null;
  hMin: number; hMax: number;
  /** Day / twilight / night bands across the chart (position 0-1); empty without coordinates. */
  sky: { pos: number; phase: SkyPhase }[];
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

  // skyStops spans first hour .. last hour + 1h, so hand it the two ends of the curve.
  const sky = (skyStops([{ validTimeUtc: o.t0Sec }, { validTimeUtc: endMs / 1000 - 3600 }], o.lat, o.lon) ?? [])
    .map((s) => ({ pos: clamp(xOf(s.t * 1000) / W, 0, 1), phase: s.phase }));

  const timeAt = (x: number) => clamp(startMs + ((x - PAD.left - pph / 2) / pph) * 3_600_000, startMs, endMs);
  const nx = xOf(nowMs);
  return {
    W, H: o.H, pph, startMs, endMs, hMin, hMax, sky, xOf, timeAt,
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
export function cardEvents(m: TideChartModel, fromMs: number, minGap: number): (TideEvent & { x: number; y: number })[] {
  const out: (TideEvent & { x: number; y: number })[] = [];
  for (const e of m.events) {
    if (e.time.getTime() < fromMs) continue;
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
