import { buildTideModel, layoutTideCards, TIDE_PAD_V } from "../tideModel";

const TZ = "Pacific/Auckland";
const NOW = Date.UTC(2026, 10, 24, 0, 0);   // 1pm NZDT, Tue 24 Nov 2026
const W = 400, H = 200;

describe("tide mini-chart model", () => {
  const m = buildTideModel("new-brighton", TZ, NOW, W, H)!;

  it("is null for an unknown port", () => {
    expect(buildTideModel("atlantis", TZ, NOW, W, H)).toBeNull();
  });
  it("spans 48 h from local midnight, filling the width", () => {
    expect(new Date(m.startMs).toISOString()).toBe("2026-11-23T11:00:00.000Z");
    expect(m.spanMs).toBe(48 * 3_600_000);
    expect(m.pts).toHaveLength(289);
    expect(m.pts[0].x).toBe(0);
    expect(m.pts[m.pts.length - 1].x).toBeCloseTo(W, 6);
  });
  it("keeps the curve inside the vertical padding, high water at the top", () => {
    const ys = m.pts.map((p) => p.y);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(TIDE_PAD_V);
    expect(Math.max(...ys)).toBeLessThanOrEqual(H - TIDE_PAD_V);
    const high = m.events.filter((e) => e.type === "high")[0];
    const low = m.events.filter((e) => e.type === "low")[0];
    expect(high.y).toBeLessThan(low.y);
  });
  it("places events and 'now' proportionally in time", () => {
    expect(m.events.length).toBeGreaterThanOrEqual(7);
    for (const e of m.events) expect(e.x).toBeCloseTo(((e.time.getTime() - m.startMs) / m.spanMs) * W, 6);
    expect(m.now!.x).toBeCloseTo((13 / 48) * W, 6);      // 13 h into the 48 h
  });
  it("hover reports time, height and a nearby high/low", () => {
    const hi = m.events.find((e) => e.type === "high" && e.time.getTime() > NOW)!;   // the 4:46pm high
    const h = m.hover(hi.x);
    expect(h.near).toBe("high");
    expect(h.height).toBeGreaterThan(2);
    expect(Math.abs(h.timeMs - hi.time.getTime())).toBeLessThan(m.spanMs / W + 1);
    // Midway between a high and the next low (~3 h) is more than 90 min from both.
    const lo = m.events.find((e) => e.type === "low" && e.time.getTime() > hi.time.getTime())!;
    const mid = m.hover((hi.x + lo.x) / 2);
    expect(mid.near).toBeNull();
  });
  it("hover clamps outside the chart", () => {
    expect(m.hover(-50).timeMs).toBe(m.startMs);
    expect(m.hover(W + 50).timeMs).toBe(m.startMs + m.spanMs);
  });
});

describe("tide chart sky bands", () => {
  it("covers the 48 h span with day and night, and is empty without coordinates", () => {
    const withSky = buildTideModel("new-brighton", TZ, NOW, 800, 200, -43.53, 172.64)!;
    expect(withSky.sky.length).toBeGreaterThan(4);
    expect(withSky.sky[0].pos).toBe(0);
    expect(withSky.sky[withSky.sky.length - 1].pos).toBe(1);
    expect(withSky.sky.map((s) => s.phase)).toEqual(expect.arrayContaining(["day", "night"]));
    expect(withSky.sky.every((s, i, a) => i === 0 || s.pos >= a[i - 1].pos)).toBe(true);
    expect(buildTideModel("new-brighton", TZ, NOW, 800, 200)!.sky).toEqual([]);
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
