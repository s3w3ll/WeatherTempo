import { buildChartModel, dayColumns as dayColumnsOf, dividerXs, PAD } from "../model";
import { buildTideModel, cardEvents, layoutTideCards, tideScrollForNow, TIDE_PAD_V } from "../tideModel";
import { generateSampleData } from "../../core/sample";
import { getLocation } from "../../core/locations";

const TZ = "Pacific/Auckland";
const NOW = Date.UTC(2026, 10, 24, 0, 0);   // 1pm NZDT, Tue 24 Nov 2026
const H = 200;
const loc = getLocation("christchurch");
const sample = generateSampleData(loc, NOW);
const hours = sample.hourly;
const T0 = hours[0].validTimeUtc;
const tide = (days: number, vw = 900, withSky = true) =>
  buildTideModel("new-brighton", NOW, {
    t0Sec: T0, hours: hours.length, days, viewportWidth: vw, H,
    lat: withSky ? loc.lat : null, lon: withSky ? loc.lon : null,
    hourTimes: hours.map((h) => h.validTimeUtc), tz: TZ,
  })!;

describe("tide chart shares the weather chart's x-axis", () => {
  it("has the same width and pixels per hour at the same zoom", () => {
    for (const days of [1, 3, 5]) {
      const w = buildChartModel({ hours, days, viewportWidth: 900, lat: loc.lat, lon: loc.lon, tz: TZ, nowSec: NOW / 1000 });
      const t = tide(days);
      expect(t.pph).toBeCloseTo(w.pph, 9);
      expect(t.W).toBeCloseTo(w.W, 9);
    }
  });
  it("puts any moment at the same x as the weather chart", () => {
    const w = buildChartModel({ hours, days: 5, viewportWidth: 900, tz: TZ, nowSec: NOW / 1000 });
    const t = tide(5);
    for (const i of [0, 7, 50, hours.length - 1]) expect(t.xOf(hours[i].validTimeUtc * 1000)).toBeCloseTo(w.hourX(i), 6);
    expect(t.now!.x).toBeCloseTo(w.timeX(NOW / 1000), 6);
  });
  it("fills the viewport at 5 days with no scroll slack beyond padding", () => {
    const t = tide(5, 900);
    expect(t.W).toBeGreaterThan(900 - 1);
    expect(t.pts[0].x).toBeCloseTo(PAD.left + t.pph / 2, 6);
  });
});

describe("tide chart model", () => {
  const m = tide(3);
  it("is null for an unknown port", () => {
    expect(buildTideModel("atlantis", NOW, { t0Sec: T0, hours: 48, days: 3, viewportWidth: 900, H })).toBeNull();
  });
  it("keeps the curve inside the vertical padding, high water at the top", () => {
    const ys = m.pts.map((p) => p.y);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(TIDE_PAD_V);
    expect(Math.max(...ys)).toBeLessThanOrEqual(H - TIDE_PAD_V);
    const high = m.events.filter((e) => e.type === "high")[0];
    const low = m.events.filter((e) => e.type === "low")[0];
    expect(high.y).toBeLessThan(low.y);
  });
  it("finds the events across the whole span", () => {
    expect(m.events.length).toBeGreaterThanOrEqual(hours.length / 12.5 - 2);
    for (const e of m.events) expect(e.x).toBeCloseTo(m.xOf(e.time.getTime()), 6);
  });
  it("hover reports time, height and a nearby high/low", () => {
    const hi = m.events.find((e) => e.type === "high" && e.time.getTime() > NOW)!;
    const h = m.hover(hi.x);
    expect(h.near).toBe("high");
    expect(h.height).toBeGreaterThan(2);
    expect(Math.abs(h.timeMs - hi.time.getTime())).toBeLessThan(3_600_000 / m.pph + 1);
    const lo = m.events.find((e) => e.type === "low" && e.time.getTime() > hi.time.getTime())!;
    expect(m.hover((hi.x + lo.x) / 2).near).toBeNull();
  });
  it("hover clamps outside the chart", () => {
    expect(m.hover(-50).timeMs).toBe(m.startMs);
    expect(m.hover(1e9).timeMs).toBe(m.endMs);
  });
  it("scrolls so now sits ~30% in, never negative", () => {
    const later = (T0 + 60 * 3600) * 1000;
    expect(tideScrollForNow(m, later, 300)).toBeCloseTo(m.xOf(later) - 90, 6);
    expect(tideScrollForNow(m, T0 * 1000, 900)).toBe(0);
    expect(tideScrollForNow(tide(5), T0 * 1000, 900)).toBe(0);
  });
});

describe("tide card selection", () => {
  it("lists events from now on, thinned to keep cards apart", () => {
    const m = tide(5, 400);
    const all = cardEvents(m, NOW, 0);
    expect(all.every((e) => e.time.getTime() >= NOW)).toBe(true);
    const thin = cardEvents(m, NOW, 70);
    expect(thin.length).toBeLessThan(all.length);
    for (let i = 1; i < thin.length; i++) expect(thin[i].x - thin[i - 1].x).toBeGreaterThanOrEqual(70);
  });
});

describe("tide chart day axis", () => {
  it("has the same dividers and day columns as the weather chart", () => {
    const w = buildChartModel({ hours, days: 5, viewportWidth: 900, lat: loc.lat, lon: loc.lon, tz: TZ, nowSec: NOW / 1000 });
    const t = tide(5);
    expect(t.dayCols.map((c) => [c.label, Math.round(c.x0), Math.round(c.x1)]))
      .toEqual(dayColumnsOf(w).map((c) => [c.label, Math.round(c.x0), Math.round(c.x1)]));
    expect(t.dividers.map(Math.round)).toEqual(dividerXs(w).map(Math.round));
  });
  it("names the days in long form when there is room, short when tight", () => {
    expect(tide(1, 900).dayCols.some((c) => /day$/.test(c.label) && c.label.length > 3)).toBe(true);
    expect(tide(5, 340).dayCols.every((c) => c.label.length === 3)).toBe(true);
  });
  it("has none without hour times", () => {
    const bare = buildTideModel("new-brighton", NOW, { t0Sec: T0, hours: 48, days: 3, viewportWidth: 900, H })!;
    expect(bare.dayCols).toEqual([]);
    expect(bare.dividers).toEqual([]);
  });
});

describe("tide card selection by type", () => {
  it("returns only the requested kind, thinned independently", () => {
    const m = tide(5, 340);
    const highs = cardEvents(m, NOW, 0, "high");
    const lows = cardEvents(m, NOW, 0, "low");
    expect(highs.every((e) => e.type === "high")).toBe(true);
    expect(lows.every((e) => e.type === "low")).toBe(true);
    expect(highs.length).toBeGreaterThan(5);
    expect(lows.length).toBeGreaterThan(5);
  });
});

describe("tide chart sky bands", () => {
  it("covers the span with day and night, and is empty without coordinates", () => {
    const t = tide(5);
    expect(t.sky.length).toBeGreaterThan(4);
    expect(t.sky.map((s) => s.phase)).toEqual(expect.arrayContaining(["day", "night"]));
    expect(t.sky.every((s, i, a) => i === 0 || s.pos >= a[i - 1].pos)).toBe(true);
    expect(tide(5, 900, false).sky).toEqual([]);
  });
});

describe("layoutTideCards", () => {
  it("centres cards under their points when there is room", () => {
    expect(layoutTideCards([100, 300, 500], 600, 80, 6)).toEqual([60, 260, 460]);
  });
  it("pushes crowded cards apart in order, inside the width", () => {
    const l = layoutTideCards([40, 80, 120, 160], 340, 80, 6);
    for (let i = 1; i < l.length; i++) expect(l[i] - l[i - 1]).toBeGreaterThanOrEqual(86);
    expect(l[0]).toBeGreaterThanOrEqual(0);
    expect(l[3] + 80).toBeLessThanOrEqual(340);
  });
  it("pulls a run back from the right edge", () => {
    const l = layoutTideCards([300, 320, 340], 360, 80, 6);
    expect(l[2] + 80).toBeLessThanOrEqual(360);
    expect(l[1] + 80 + 6).toBeLessThanOrEqual(l[2]);
  });
});
