import raw from "../../core/__fixtures__/worker-christchurch.json";
import type { WeatherPayload } from "../../core/payload";
import { areaD, catmullRom, smoothPathD } from "../curve";
import {
  buildChartModel, cloudRuns, dayColumns, dividerXs, glowGradient, gridYs, PAD, pressureCells, precipBars,
  scrollForNow, scrollForTime, skyGradient, tempMarkers, timeAtScroll, timeLabels, tooltip, uvRuns, warningAt,
  windArrows, windY, ZONE, type ChartInput,
} from "../model";

const data = raw as unknown as WeatherPayload;
const hours = data.hourly;
const TZ = "Pacific/Auckland";
const NOW = hours[13].validTimeUtc;   // 1pm NZDT on 24 Nov 2026
const base = (over: Partial<ChartInput> = {}): ChartInput => ({
  hours, days: 3, viewportWidth: 900, lat: data.meta!.lat, lon: data.meta!.lon, tz: TZ, nowSec: NOW, warnings: [], ...over,
});

describe("curve", () => {
  it("passes through every point and clamps the ends", () => {
    const pts = [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 0 }];
    const segs = catmullRom(pts);
    expect(segs.map((s) => s.p)).toEqual([pts[1], pts[2]]);
    // First segment's phantom p0 is p1 itself: c1 = p1 + (p2 - p1)/6
    expect(segs[0].c1).toEqual({ x: 10 / 6, y: 10 / 6 });
  });
  it("emits SVG path data, extendable and closeable", () => {
    const pts = [{ x: 0, y: 5 }, { x: 10, y: 5 }];
    expect(smoothPathD(pts)).toMatch(/^M0 5C/);
    expect(smoothPathD(pts, true)).toMatch(/^C/);
    expect(areaD(pts, 20)).toMatch(/L10 20L0 20Z$/);
    expect(smoothPathD([{ x: 1, y: 1 }])).toBe("");
  });
});

describe("layout", () => {
  const m = buildChartModel(base());
  it("sizes the canvas so `days` days fill the viewport", () => {
    expect(m.pph).toBeCloseTo((900 - PAD.left - PAD.right) / 72, 6);
    expect(m.W).toBeCloseTo(PAD.left + 120 * m.pph + PAD.right, 6);
    expect(m.H).toBe(364);
  });
  it("keeps the zone constants on the 70/15/15 split", () => {
    expect(ZONE.tempBot).toBe(224);
    expect(ZONE.windBot - ZONE.windTop).toBe(48);
    expect(ZONE.precipBot - ZONE.precipTop).toBe(48);
    expect(ZONE.windTop - ZONE.tempBot).toBe(4);
    expect(ZONE.precipTop - ZONE.windBot).toBe(4);
  });
  it("floors px/hour at 2 and thins labels when zoomed out", () => {
    expect(buildChartModel(base({ viewportWidth: 100, days: 5 })).pph).toBe(2);
    expect(buildChartModel(base({ days: 1 })).labelStride).toBe(3);      // 37 px/h
    expect(buildChartModel(base({ days: 3 })).labelStride).toBe(3);      // 12.4 px/h
    expect(buildChartModel(base({ days: 5 })).labelStride).toBe(6);      //  7.4 px/h
    expect(buildChartModel(base({ viewportWidth: 330, days: 5 })).labelStride).toBe(12);
  });
  it("spaces wind arrows ≥ ~18 px apart, in 3 h steps", () => {
    for (const days of [1, 3, 5]) {
      const mm = buildChartModel(base({ days, viewportWidth: 390 }));
      expect(mm.arrowEvery % 3).toBe(0);
      expect(mm.arrowEvery * mm.pph).toBeGreaterThanOrEqual(18 - 1e-9);
    }
  });
  it("maps hours and back", () => {
    for (const i of [0, 5, 60, 119]) expect(m.hourAt(m.hourX(i))).toBe(i);
    expect(m.hourAt(-100)).toBe(0);
    expect(m.hourAt(1e6)).toBe(119);
    expect(m.timeX(hours[7].validTimeUtc)).toBeCloseTo(m.hourX(7), 6);
  });
  it("puts higher values higher up, inside their zones", () => {
    expect(m.tempY(m.tMax)).toBeCloseTo(ZONE.tempTop, 6);
    expect(m.tempY(m.tMin)).toBeCloseTo(ZONE.tempBot, 6);
    expect(windY(0)).toBe(ZONE.windBot);
    expect(windY(90)).toBe(ZONE.windTop);
    expect(windY(500)).toBe(ZONE.windTop);          // clamped
    expect(windY(30)).toBeCloseTo(ZONE.windBot - 16, 6);   // 30 km/h = 1/3 height
    expect(m.uvY(0)).toBe(ZONE.tempBot);
    expect(m.uvY(12)).toBeCloseTo(ZONE.tempBot - (ZONE.tempBot - ZONE.tempTop) * 0.4, 6);
  });
  it("finds now", () => {
    expect(m.nowIdx).toBe(13);
  });
  it("one scale covers temperature, feels-like and dew point", () => {
    const vals = [...hours.map((h) => h.temperature), ...hours.map((h) => h.temperatureFeelsLike), ...m.dew].filter((v): v is number => v != null);
    expect(m.tMin).toBeCloseTo(Math.min(...vals) - 2, 6);
    expect(m.tMax).toBeCloseTo(Math.max(...vals) + 2, 6);
  });
  it("survives an empty series", () => {
    const e = buildChartModel(base({ hours: [] }));
    expect(e.W).toBe(PAD.left + PAD.right);
    expect(e.spans).toEqual([]);
  });
});

describe("layers", () => {
  const m = buildChartModel(base());

  it("sky gradient is ordered, within 0–1, and goes day ↔ night", () => {
    const g = skyGradient(m);
    expect(g.length).toBeGreaterThan(2);
    for (let i = 1; i < g.length; i++) expect(g[i].pos).toBeGreaterThanOrEqual(g[i - 1].pos);
    expect(g.every((s) => s.pos >= 0 && s.pos <= 1)).toBe(true);
    expect(new Set(g.map((s) => s.phase))).toEqual(new Set(["day", "twilight", "night"]));
  });
  it("falls back to each hour's flag without coordinates", () => {
    const g = skyGradient(buildChartModel(base({ lat: null, lon: null })));
    expect(g).toHaveLength(120);
    expect(new Set(g.map((s) => s.phase))).toEqual(new Set(["day", "night"]));
  });
  it("glow exists in daylight only", () => {
    expect(glowGradient(m).some((s) => s.value > 0)).toBe(true);
    const night = hours.slice(0, 4).map((h) => ({ ...h, cloudCover: 0 }));   // midnight–3am
    expect(glowGradient(buildChartModel(base({ hours: night })))).toEqual([]);
  });
  it("grid lines sit inside the temperature zone", () => {
    for (const y of gridYs(m)) {
      expect(y).toBeGreaterThanOrEqual(ZONE.tempTop - 1e-6);
      expect(y).toBeLessThanOrEqual(ZONE.tempBot + 1e-6);
    }
  });
  it("cloud runs cover only 10%+ stretches, bands hang from the top", () => {
    const runs = cloudRuns(m);
    expect(runs.length).toBeGreaterThan(0);
    for (const r of runs) {
      expect(r.xRight).toBeGreaterThan(r.xLeft);
      for (const p of r.pts) {
        expect(p.y).toBeGreaterThanOrEqual(ZONE.cloudTop);
        expect(p.y).toBeLessThanOrEqual(ZONE.cloudBot);
      }
    }
    const synthetic = hours.map((h, i) => ({ ...h, cloudCover: i < 3 || i > 5 ? 0 : 50 }));
    expect(cloudRuns(buildChartModel(base({ hours: synthetic })))).toHaveLength(1);
  });
  it("UV runs bracket the daylight with a zero either side and label the peak", () => {
    const runs = uvRuns(m);
    expect(runs.length).toBeGreaterThanOrEqual(1);
    const r = runs[0];
    expect(r.floorY).toBe(ZONE.tempBot);
    expect(r.protectY).toBeLessThan(r.floorY);
    expect(r.peak!.uv).toBeGreaterThanOrEqual(1);
    expect(r.pts[0].y).toBe(r.floorY);                       // zero before sunrise
    expect(r.pts[r.pts.length - 1].y).toBe(r.floorY);        // zero after sunset
  });
  it("rain bars scale to the heaviest hour and stand on the floor", () => {
    const wet = hours.map((h, i) => ({ ...h, qpf: i === 4 ? 2 : i === 5 ? 1 : 0 }));
    const bars = precipBars(buildChartModel(base({ hours: wet })));
    expect(bars).toHaveLength(2);
    expect(bars[0].intensity).toBe(1);
    expect(bars[0].y + bars[0].h).toBe(ZONE.precipBot);
    expect(bars[0].h).toBe(ZONE.precipBot - ZONE.precipTop);
    expect(bars[1].intensity).toBe(0.5);
    expect(precipBars(buildChartModel(base({ hours: hours.map((h) => ({ ...h, qpf: 0 })) })))).toEqual([]);
  });
  it("wind arrows point where the wind blows to", () => {
    const westerly = hours.map((h) => ({ ...h, windSpeed: 30, windDirection: 270 }));   // from the west → blowing east
    const a = windArrows(buildChartModel(base({ hours: westerly })))[0];
    const [x1, y1, x2, y2] = a.shaft;
    expect(x2).toBeGreaterThan(x1);
    expect(y2).toBeCloseTo(y1, 6);
    const northerly = hours.map((h) => ({ ...h, windSpeed: 30, windDirection: 0 }));    // from the north → blowing south (down)
    const b = windArrows(buildChartModel(base({ hours: northerly })))[0].shaft;
    expect(b[3]).toBeGreaterThan(b[1]);
  });
  it("skips arrows with no wind speed", () => {
    const none = hours.map((h) => ({ ...h, windSpeed: null }));
    expect(windArrows(buildChartModel(base({ hours: none })))).toEqual([]);
  });
  it("day dividers and columns line up with local midnights", () => {
    expect(dividerXs(m)).toHaveLength(4);               // 120 h from local midnight = 5 whole days → 4 interior boundaries
    const cols = dayColumns(m);
    expect(cols.length).toBeGreaterThanOrEqual(5);
    expect(cols[0].divider).toBe(false);
    expect(cols[1].divider).toBe(true);
    expect(cols[0].label).toBe("Tuesday");              // wide enough for the long name at 3 days
    expect(cols[1].x0).toBeCloseTo(m.hourX(24) - m.pph / 2, 6);
  });
  it("time labels land on stride hours", () => {
    const labels = timeLabels(m);
    expect(labels[0].text).toBe("12am");
    expect(labels.map((l) => l.text).slice(0, 4)).toEqual(["12am", "3am", "6am", "9am"]);
    expect(labels[4].text).toBe("12pm");
    expect(labels[5].text).toBe("3pm");
  });
  it("marks one high per day and one low per night, labels kept inside the chart", () => {
    const marks = tempMarkers(m);
    expect(marks.some((x) => x.kind === "high")).toBe(true);
    expect(marks.some((x) => x.kind === "low")).toBe(true);
    for (const k of marks) {
      expect(k.labelX).toBeGreaterThanOrEqual(14);
      expect(k.labelX).toBeLessThanOrEqual(m.W - 14);
      expect(k.text).toMatch(/^-?\d+°$/);
      if (k.kind === "high") expect(k.labelY).toBeLessThan(k.curveY); else expect(k.labelY).toBeGreaterThan(k.curveY);
    }
  });
  it("merges pressure hours in the same band into one cell and labels the long runs", () => {
    const falling = hours.map((h, i) => ({ ...h, pressureMeanSeaLevel: 1020 - i * 0.8 }));   // −2.4 hPa/3 h: "quickly"
    const { cells, labels } = pressureCells(buildChartModel(base({ hours: falling })));
    expect(cells.filter((c) => c.direction === "falling" && c.strength === 2).length).toBe(1);
    expect(labels.some((l) => l.text.startsWith("▼ Falling quickly"))).toBe(true);
    const flat = pressureCells(buildChartModel(base({ hours: hours.map((h) => ({ ...h, pressureMeanSeaLevel: 1015 })) })));
    expect(flat.labels).toEqual([]);
    expect(flat.cells.every((c) => c.direction === "steady")).toBe(true);
  });
});

describe("warnings", () => {
  const t0 = hours[0].validTimeUtc;
  const w = (level: "yellow" | "orange" | "red", onset: number | null, expires: number | null) =>
    ({ headline: `${level} warning`, level, onset, expires });

  it("clamps to the data, drops outsiders and sorts least severe first", () => {
    const m = buildChartModel(base({
      warnings: [
        w("red", t0 + 3600 * 10, t0 + 3600 * 20),
        w("yellow", t0 - 99999, t0 + 3600 * 5),                // started before the data
        w("orange", t0 + 3600 * 500, t0 + 3600 * 510),         // after the data: dropped
        w("yellow", t0 - 99999, t0 - 5000),                    // over before the data: dropped
      ],
    }));
    expect(m.spans.map((s) => s.level)).toEqual(["yellow", "red"]);
    expect(m.spans[0].start).toBe(t0 - 1800);
    expect(m.spans[1].x1).toBeGreaterThan(m.spans[1].x0);
  });
  it("reports the most severe warning in force for an hour", () => {
    const m = buildChartModel(base({ warnings: [w("yellow", t0, t0 + 3600 * 30), w("red", t0 + 3600 * 10, t0 + 3600 * 12)] }));
    expect(warningAt(m, 2)?.level).toBe("yellow");
    expect(warningAt(m, 11)?.level).toBe("red");
    expect(warningAt(m, 60)).toBeNull();
  });
});

describe("tooltip", () => {
  it("formats an hour and flags a warning", () => {
    const t0 = hours[0].validTimeUtc;
    const m = buildChartModel(base({ warnings: [{ headline: "Heavy rain", level: "orange", onset: t0, expires: t0 + 3600 * 30 }] }));
    const tip = tooltip(m, 13);
    expect(tip.time).toMatch(/Tue/);
    expect(tip.rows[0]).toMatchObject({ label: "Warning", value: "Heavy rain", warnLevel: "orange" });
    const get = (l: string) => tip.rows.find((r) => r.label === l)!.value;
    expect(get("Temp")).toMatch(new RegExp(`^${Math.round(hours[13].temperature!)}°`));
    expect(get("Pressure")).toMatch(/hPa$/);
    expect(get("Temp")).toMatch(/^-?\d+° · feels -?\d+°$/);
    expect(get("Wind")).toMatch(/km\/h .*· gusts \d/);
    expect(tip.rows.some((r) => r.label === "Dew point" || r.label === "Gusts" || r.label === "Feels like")).toBe(false);
    expect(get("UV index")).toBe(String(Math.round(hours[13].uvIndex!)));   // whole numbers, not 8.35
  });
  it("uses dashes for missing values", () => {
    const sparse = hours.map((h) => ({ ...h, windGust: null, uvIndex: null, relativeHumidity: null }));
    const tip = tooltip(buildChartModel(base({ hours: sparse })), 0);
    expect(tip.rows.find((r) => r.label === "Wind")!.value).not.toMatch(/gusts/);
    expect(tip.rows.find((r) => r.label === "UV index")!.value).toBe("—");
  });
});

describe("scroll helpers", () => {
  const m = buildChartModel(base());
  it("puts now ~30% in, never negative", () => {
    const later = buildChartModel(base({ nowSec: hours[60].validTimeUtc }));
    expect(scrollForNow(later, 900)).toBeCloseTo(later.hourX(60) - 270, 6);
    expect(scrollForNow(m, 900)).toBe(0);   // now is within 30% of the start: clamped, not negative
  });
  it("round-trips time ↔ scroll (so zoom keeps your place)", () => {
    const t = hours[40].validTimeUtc;
    expect(timeAtScroll(m, scrollForTime(m, t))).toBeCloseTo(t, 3);
    const narrow = buildChartModel(base({ days: 1 }));
    expect(timeAtScroll(narrow, scrollForTime(narrow, t))).toBeCloseTo(t, 3);
  });
});
