import {
  dayKey, dewComfort, dewPoint, hourLabel, nextHoursSummary, nowIndex, pressureTendencies,
  pressureTendency, skyStops, solarElevation, sunProtection, sunshine, tendencyRuns,
  warningTiming, weekDays,
} from "../insights";
import type { Hour } from "../types";

const TZ = "Pacific/Auckland";
const CHC = { lat: -43.5321, lon: 172.6362 };
const hr = (utc: number, o: Partial<Hour> = {}): Hour => ({ validTimeUtc: utc, ...o });
const T0 = Date.UTC(2026, 10, 24, 0, 0) / 1000; // 13:00 NZDT

describe("solarElevation", () => {
  it("peaks near 90 − (|lat| − 23.44)° ≈ 69.9° at the December solstice", () => {
    const day = Date.UTC(2026, 11, 21, 0, 0) / 1000;
    let max = -90;
    for (let t = day; t < day + 86400; t += 300) max = Math.max(max, solarElevation(t, CHC.lat, CHC.lon));
    expect(max).toBeGreaterThan(69.6);
    expect(max).toBeLessThan(70.2);
  });
  it("is negative at local midnight", () => {
    expect(solarElevation(Date.UTC(2026, 11, 21, 11, 0) / 1000, CHC.lat, CHC.lon)).toBeLessThan(0);
  });
});

describe("skyStops", () => {
  it("is null without coordinates or hours", () => {
    expect(skyStops([hr(T0)], null, null)).toBeNull();
    expect(skyStops([], CHC.lat, CHC.lon)).toBeNull();
  });
  it("goes night → twilight → day across a sunrise, in time order", () => {
    // 2026-11-23 15:00 UTC = 04:00 NZDT, 24 hourly hours.
    const start = Date.UTC(2026, 10, 23, 15, 0) / 1000;
    const hours = Array.from({ length: 24 }, (_, i) => hr(start + i * 3600));
    const stops = skyStops(hours, CHC.lat, CHC.lon)!;
    expect(stops[0].phase).toBe("night");
    const phases = stops.map((s) => s.phase);
    expect(phases.indexOf("twilight")).toBeGreaterThan(0);
    expect(phases.indexOf("day")).toBeGreaterThan(phases.indexOf("twilight"));
    for (let i = 1; i < stops.length; i++) expect(stops[i].t).toBeGreaterThanOrEqual(stops[i - 1].t);
  });
});

describe("sunshine", () => {
  it("is ~1 for a clear midday hour, 0 at night or with unknown cloud", () => {
    const noon = Date.UTC(2026, 11, 21, 0, 0) / 1000; // 13:00 NZDT
    const [clear, unknown] = sunshine([hr(noon, { cloudCover: 0 }), hr(noon, {})], CHC.lat, CHC.lon);
    expect(clear).toBeCloseTo(1, 5);
    expect(unknown).toBe(0);
    const night = Date.UTC(2026, 11, 20, 12, 0) / 1000; // 01:00 NZDT
    expect(sunshine([hr(night, { cloudCover: 0 })], CHC.lat, CHC.lon)[0]).toBe(0);
  });
});

describe("dew point", () => {
  it("matches the Magnus formula", () => {
    expect(dewPoint(20, 50)).toBeCloseTo(9.27, 1);
    expect(dewPoint(20, 100)).toBeCloseTo(20, 1);
  });
  it("rejects missing or impossible input", () => {
    expect(dewPoint(null, 50)).toBeNull();
    expect(dewPoint(20, 0)).toBeNull();
    expect(dewPoint(20, 101)).toBeNull();
  });
  it("labels comfort bands", () => {
    expect([5, 12, 18, 23].map(dewComfort)).toEqual(["Dry", "Comfortable", "Sticky", "Oppressive"]);
  });
});

describe("pressure tendency", () => {
  it("bands at 0.5 / 1.6 / 3.6 hPa per 3 h", () => {
    expect(pressureTendency(0.4)).toMatchObject({ direction: "steady", strength: 0 });
    expect(pressureTendency(1)).toMatchObject({ direction: "rising", strength: 1 });
    expect(pressureTendency(-2)).toMatchObject({ direction: "falling", strength: 2 });
    expect(pressureTendency(-4)).toMatchObject({ direction: "falling", strength: 3 });
  });
  it("compares with 3 h earlier, and looks forward at the start of the series", () => {
    const hours = [1010, 1010, 1010, 1006, 1002].map((p, i) =>
      hr(T0 + i * 3600, { pressureMeanSeaLevel: p }));
    const t = pressureTendencies(hours);
    expect(t[0]).toMatchObject({ direction: "steady" });
    expect(t[3]).toMatchObject({ direction: "falling", change: -4, strength: 3 });
    expect(t[4]!.change).toBeLessThan(0);
  });
  it("returns null where pressure is missing", () => {
    expect(pressureTendencies([hr(T0), hr(T0 + 3600)])).toEqual([null, null]);
  });
  it("groups runs and keeps the strongest strength", () => {
    const hours = [1010, 1010, 1010, 1010, 1008, 1005].map((p, i) =>
      hr(T0 + i * 3600, { pressureMeanSeaLevel: p }));
    const runs = tendencyRuns(pressureTendencies(hours));
    expect(runs[0].direction).toBe("steady");
    expect(runs[runs.length - 1].direction).toBe("falling");
    expect(runs[runs.length - 1].label).toMatch(/^Falling /);
  });
});

describe("time helpers", () => {
  it("formats hour labels in the forecast zone", () => {
    expect(hourLabel(Date.UTC(2026, 10, 24, 2, 0) / 1000, TZ)).toBe("3pm");
    expect(hourLabel(Date.UTC(2026, 10, 23, 11, 0) / 1000, TZ)).toBe("12am");
  });
  it("groups by the local calendar day, not UTC", () => {
    const a = dayKey(Date.UTC(2026, 10, 23, 10, 59) / 1000, TZ);
    const b = dayKey(Date.UTC(2026, 10, 23, 11, 0) / 1000, TZ);
    expect(a).not.toBe(b);
  });
  it("nowIndex finds the first hour at or after now, else 0", () => {
    const hours = [0, 1, 2].map((i) => hr(T0 + i * 3600));
    expect(nowIndex(hours, T0 + 1)).toBe(1);
    expect(nowIndex(hours, T0 + 99999)).toBe(0);
  });
});

describe("weekDays", () => {
  it("makes one column per local day with low/high and rain", () => {
    const start = Date.UTC(2026, 10, 23, 11, 0) / 1000; // local midnight
    const hours = Array.from({ length: 48 }, (_, i) =>
      hr(start + i * 3600, {
        temperature: 10 + (i === 14 ? 8 : 0),
        precipChance: i < 24 ? 80 : 10,
        qpf: i === 3 ? 2 : 0,
        cloudCover: 50,
      }));
    const days = weekDays(hours, TZ, CHC.lat, CHC.lon, () => "cloud");
    expect(days).toHaveLength(2);
    expect(days[0]).toMatchObject({ start: 0, end: 24, low: 10, high: 18, maxChance: 80, totalMm: 2, glyph: "cloud" });
    expect(days[1].maxChance).toBe(10);
  });
});

describe("nextHoursSummary", () => {
  const now = Date.UTC(2026, 10, 24, 0, 0) / 1000; // 1pm NZDT
  const mk = (f: (i: number) => Partial<Hour>) =>
    Array.from({ length: 24 }, (_, i) =>
      hr(now + i * 3600, { temperature: 15, precipChance: 0, qpf: 0, uvIndex: 0, ...f(i) }));

  it("says dry and steady when nothing is happening", () => {
    expect(nextHoursSummary(mk(() => ({})), now, TZ)).toBe("Dry for the next 12 hours. Staying around 15°.");
  });
  it("describes rain starting later with its length", () => {
    const hours = mk((i) => (i === 3 || i === 4 ? { qpf: 1.5, precipChance: 90 } : {}));
    expect(nextHoursSummary(hours, now, TZ)).toContain("Moderate rain from 4pm, about 2 hours");
  });
  it("ignores a drizzle trace with a low chance", () => {
    const hours = mk((i) => (i === 2 ? { qpf: 0.3, precipChance: 10 } : {}));
    expect(nextHoursSummary(hours, now, TZ)).toMatch(/^Dry/);
  });
  it("mentions warming of 2° or more, and strong gusts from 50 km/h", () => {
    const hours = mk((i) => ({ temperature: 15 + i, windGust: i === 5 ? 62 : 20 }));
    const s = nextHoursSummary(hours, now, TZ)!;
    expect(s).toMatch(/Warming to 26°/);
    expect(s).toContain("Gusts to 62 km/h");
  });
  it("returns null with no future hours", () => {
    expect(nextHoursSummary([], now, TZ)).toBeNull();
  });
});

describe("sunProtection", () => {
  it("covers the stretch of UV 3+ and gives the SunSmart sentence", () => {
    const start = Date.UTC(2026, 10, 23, 19, 0) / 1000; // 8am NZDT
    const hours = [2, 3, 6, 9, 9, 6, 3, 2].map((u, i) => hr(start + i * 3600, { uvIndex: u }));
    const sp = sunProtection(hours, 0, TZ)!;
    expect(sp.ongoing).toBe(false);
    expect(sp.peak).toBe(9);
    expect(sp.sentence).toBe("Sun protection 9am to 3pm (UV up to 9, very high)");
  });
  it("is null when UV never reaches 3", () => {
    const hours = [1, 2, 2].map((u, i) => hr(T0 + i * 3600, { uvIndex: u }));
    expect(sunProtection(hours, 0, TZ)).toBeNull();
  });
});

describe("warningTiming", () => {
  const now = Date.UTC(2026, 10, 24, 0, 0) / 1000; // Tue 24 Nov, 1pm NZDT
  it("in force now with no end", () => expect(warningTiming({}, now, TZ)).toBe("In force now"));
  it("until a time today", () =>
    expect(warningTiming({ expires: now + 8 * 3600 }, now, TZ)).toBe("Until 9pm"));
  it("until a time on another day includes the weekday", () =>
    expect(warningTiming({ expires: now + 14 * 3600 }, now, TZ)).toBe("Until Wed 3am"));
  it("a future onset reads From … to …", () =>
    expect(warningTiming({ onset: now + 3600, expires: now + 5 * 3600 }, now, TZ)).toBe("From 2pm to 6pm"));
});
