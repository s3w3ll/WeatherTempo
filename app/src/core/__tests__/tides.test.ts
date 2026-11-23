import { findTideEvents, getNextTides, getTodayCurve, localMidnightUtc, tideHeight } from "../tides";
import { TIDE_PORTS } from "../tidePorts";
import linz from "../__fixtures__/linz-new-brighton-2026.json";

type Official = { t: number; type: "high" | "low"; m: number };
const official = linz as Official[];
const MIN = 60_000;

describe("New Brighton vs the official LINZ 2026 table", () => {
  // Predict the whole year once, then match each official event to the
  // nearest predicted event of the same type.
  const start = Date.UTC(2025, 11, 31, 0, 0);
  const end = Date.UTC(2026, 11, 31, 23, 59);
  const predicted = findTideEvents("new-brighton", start, end);

  const errors = official.map((o) => {
    let best = Infinity;
    let bestH = NaN;
    for (const p of predicted) {
      if (p.type !== o.type) continue;
      const d = Math.abs(p.time.getTime() - o.t);
      if (d < best) { best = d; bestH = p.height; }
    }
    return { minutes: best / MIN, dh: bestH - o.m };
  });

  it("covers the full table", () => {
    expect(official.length).toBeGreaterThan(1400);
  });

  it("matches every high and low within 12 minutes", () => {
    expect(Math.max(...errors.map((e) => e.minutes))).toBeLessThan(12);
  });

  it("is within ~3 minutes RMS", () => {
    const rms = Math.sqrt(errors.reduce((s, e) => s + e.minutes ** 2, 0) / errors.length);
    expect(rms).toBeLessThan(3);
  });

  it("heights agree with the table (0.1 m rounded) to 0.2 m", () => {
    expect(Math.max(...errors.map((e) => Math.abs(e.dh)))).toBeLessThan(0.2);
  });

  it("gets 24 Nov 2026 right: highs 04:22 and 16:46 NZDT", () => {
    const at = (h: number, m: number, d = 23) => Date.UTC(2026, 10, d, h, m); // NZDT = UTC+13
    const near = (target: number) =>
      predicted.find((p) => p.type === "high" && Math.abs(p.time.getTime() - target) < 30 * MIN)!;
    expect(Math.abs(near(at(15, 22)).time.getTime() - at(15, 22))).toBeLessThan(5 * MIN);
    expect(Math.abs(near(at(3, 46, 24)).time.getTime() - at(3, 46, 24))).toBeLessThan(5 * MIN);
  });
});

describe("predictor basics", () => {
  it("returns null / empty for an unknown port", () => {
    expect(tideHeight("atlantis", 0)).toBeNull();
    expect(findTideEvents("atlantis", 0, 1e9)).toEqual([]);
    expect(getNextTides("atlantis")).toEqual([]);
    expect(getTodayCurve("atlantis")).toEqual([]);
  });

  it("alternates high and low, roughly 6 h apart", () => {
    const ev = findTideEvents("new-brighton", Date.UTC(2026, 5, 1), Date.UTC(2026, 5, 8));
    for (let i = 1; i < ev.length; i++) {
      expect(ev[i].type).not.toBe(ev[i - 1].type);
      const gap = (ev[i].time.getTime() - ev[i - 1].time.getTime()) / 3_600_000;
      expect(gap).toBeGreaterThan(5);
      expect(gap).toBeLessThan(7.5);
    }
  });

  it("getNextTides returns only future events, in order", () => {
    // 13:00 NZDT on 24 Nov: the next event is the 16:46 high.
    const now = Date.UTC(2026, 10, 24, 0, 0);
    const next = getNextTides("new-brighton", 4, now);
    expect(next).toHaveLength(4);
    expect(next.every((e) => e.time.getTime() >= now)).toBe(true);
    expect(next[0].type).toBe("high");
    expect(Math.abs(next[0].time.getTime() - Date.UTC(2026, 10, 24, 3, 46))).toBeLessThan(5 * MIN);
  });

  it("every port can predict", () => {
    for (const id of Object.keys(TIDE_PORTS)) {
      expect(findTideEvents(id, Date.UTC(2026, 0, 1), Date.UTC(2026, 0, 3)).length).toBeGreaterThan(3);
    }
  });
});

describe("local midnight / today's curve", () => {
  const iso = (ms: number) => new Date(ms).toISOString();

  it("is 11:00 UTC the previous day in NZ summer (UTC+13)", () => {
    expect(iso(localMidnightUtc(Date.UTC(2026, 10, 24, 3, 0), "Pacific/Auckland"))).toBe("2026-11-23T11:00:00.000Z");
  });
  it("is 12:00 UTC the previous day in NZ winter (UTC+12)", () => {
    expect(iso(localMidnightUtc(Date.UTC(2026, 6, 10, 3, 0), "Pacific/Auckland"))).toBe("2026-07-09T12:00:00.000Z");
  });
  it("handles the day DST starts (27 Sep 2026): midnight is still UTC+12", () => {
    expect(iso(localMidnightUtc(Date.UTC(2026, 8, 27, 5, 0), "Pacific/Auckland"))).toBe("2026-09-26T12:00:00.000Z");
  });
  it("handles the day DST ends (5 Apr 2026): midnight is still UTC+13", () => {
    expect(iso(localMidnightUtc(Date.UTC(2026, 3, 5, 5, 0), "Pacific/Auckland"))).toBe("2026-04-04T11:00:00.000Z");
  });
  it("curve starts at that midnight and spans 48 h every 10 min", () => {
    const c = getTodayCurve("new-brighton", "Pacific/Auckland", 48, Date.UTC(2026, 10, 24, 3, 0));
    expect(iso(c[0].time.getTime())).toBe("2026-11-23T11:00:00.000Z");
    expect(c).toHaveLength(48 * 6 + 1);
  });
});
