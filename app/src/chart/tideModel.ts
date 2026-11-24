/**
 * Geometry for the tide mini-curve in the tides card: today's 48 h curve from
 * local midnight, with high/low dots, a "now" marker and hover lookups. Pure,
 * like model.ts. Ported from drawTideMiniChart() in the website's app.js.
 */
import { findTideEvents, getTodayCurve, tideHeight } from "../core/tides";
import { skyStops } from "../core/insights";
import type { SkyPhase, TideEvent } from "../core/types";
import type { Pt } from "./curve";

export const TIDE_PAD_V = 8;
export const TIDE_HIGH_COLOR = "#ffa820";
export const TIDE_LOW_COLOR = "#3ee5ff";

export interface TideChartModel {
  W: number; H: number;
  startMs: number; spanMs: number;
  /** The curve, one point every 10 minutes. */
  pts: Pt[];
  events: (TideEvent & { x: number; y: number })[];
  now: { x: number; y: number } | null;
  /** Day / twilight / night bands across the chart (position 0–1), same source as the weather chart; empty without coordinates. */
  sky: { pos: number; phase: SkyPhase }[];
  hMin: number; hMax: number;
  /** x → time (ms) and time → x. */
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

export function buildTideModel(
  portId: string, tz: string, nowMs: number, W: number, H: number, lat?: number | null, lon?: number | null,
): TideChartModel | null {
  const curve = getTodayCurve(portId, tz, 48, nowMs);
  if (curve.length < 2) return null;
  const startMs = curve[0].time.getTime();
  const spanMs = curve[curve.length - 1].time.getTime() - startMs;
  const raw = findTideEvents(portId, startMs, startMs + spanMs);

  const heights = curve.map((p) => p.height);
  const hMin = Math.min(...heights) - 0.1;
  const hMax = Math.max(...heights) + 0.1;
  const yOf = (h: number) => H - TIDE_PAD_V - ((h - hMin) / (hMax - hMin)) * (H - TIDE_PAD_V * 2);
  const xOfMs = (ms: number) => ((ms - startMs) / spanMs) * W;

  // skyStops spans first hour .. last hour + 1h, so hand it the two ends of the curve.
  const sky = (skyStops([{ validTimeUtc: startMs / 1000 }, { validTimeUtc: (startMs + spanMs) / 1000 - 3600 }], lat, lon) ?? [])
    .map((s) => ({ pos: Math.max(0, Math.min(1, (s.t * 1000 - startMs) / spanMs)), phase: s.phase }));

  const nfrac = (nowMs - startMs) / spanMs;
  return {
    W, H, startMs, spanMs, hMin, hMax, sky,
    pts: curve.map((p, i) => ({ x: (i / (curve.length - 1)) * W, y: yOf(p.height) })),
    events: raw.map((e) => ({ ...e, x: xOfMs(e.time.getTime()), y: yOf(e.height) })),
    now: nfrac >= 0 && nfrac <= 1 ? { x: nfrac * W, y: yOf(tideHeight(portId, nowMs)!) } : null,
    timeAt: (x) => startMs + Math.max(0, Math.min(1, x / W)) * spanMs,
    hover(x) {
      const timeMs = startMs + Math.max(0, Math.min(1, x / W)) * spanMs;
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
