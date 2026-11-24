import {
  currentCloud, degToCard, fmtHourCompact, fmtRelative, fmtShortTime, hourlyStrip, iconFor, isDaytime,
  observedLabel, pressureTrend, todayAggregates, todayHighLow, uvInfo, uvLabel,
} from "../display";
import { generateSampleData } from "../sample";
import { isStale, validatePayload } from "../validate";
import type { WeatherPayload } from "../payload";
import { getLocation } from "../locations";
import raw from "../__fixtures__/worker-christchurch.json";

const data = raw as unknown as WeatherPayload;
const TZ = "Pacific/Auckland";
// Fixture hourly[0] is local midnight 24 Nov 2026 (NZDT); hourly[13] is 1pm.
const NOW = data.hourly[13].validTimeUtc;

describe("formatting", () => {
  it("formats times in the forecast zone", () => {
    expect(fmtShortTime(NOW, TZ)).toBe("13:00");
    expect(fmtHourCompact(NOW, TZ)).toBe("13:00");
    expect(fmtShortTime(null, TZ)).toBe("—");
  });
  it("describes age", () => {
    const now = Date.UTC(2026, 10, 24, 0, 0);
    expect(fmtRelative(new Date(now - 30_000).toISOString(), now)).toBe("just now");
    expect(fmtRelative(new Date(now - 12 * 60_000).toISOString(), now)).toBe("12 min ago");
    expect(fmtRelative(new Date(now - 3 * 3_600_000).toISOString(), now)).toBe("3h ago");
    expect(fmtRelative(undefined, now)).toBe("—");
  });
  it("labels who measured the reading, adding age after an hour", () => {
    const nowMs = NOW * 1000;
    expect(observedLabel(NOW - 120, "pws", TZ, nowMs)).toBe("Station reported 12:58");
    expect(observedLabel(NOW, "open-meteo", TZ, nowMs)).toBe("Forecast model, 13:00");
    expect(observedLabel(NOW - 2 * 3600, "pws", TZ, nowMs)).toBe("Station reported 11:00 · 2h ago");
    expect(observedLabel(NOW, "something-else", TZ, nowMs)).toBeNull();
    expect(observedLabel(null, "pws", TZ, nowMs)).toBeNull();
  });
  it("converts degrees to compass points", () => {
    expect([0, 44, 90, 225, 350].map(degToCard)).toEqual(["N", "NE", "E", "SW", "N"]);
  });
});

describe("icons", () => {
  it("maps codes, day vs night", () => {
    expect(iconFor(32)).toBe("☀️");
    expect(iconFor(30, "D")).toBe("⛅");
    expect(iconFor(30, "N")).toBe("☁️");
    expect(iconFor(12)).toBe("🌧️");
    expect(iconFor(4)).toBe("⛈️");
    expect(iconFor(null, "N")).toBe("☁️");
  });
  it("knows whether the sun is up", () => {
    expect(isDaytime({ sunriseUtc: 100, sunsetUtc: 200 }, 150)).toBe(true);
    expect(isDaytime({ sunriseUtc: 100, sunsetUtc: 200 }, 250)).toBe(false);
    expect(isDaytime({}, 250)).toBe(true);
  });
});

describe("conditions card data (real Worker payload)", () => {
  it("builds a 10-cell strip beginning at Now", () => {
    const strip = hourlyStrip(data.hourly, TZ, NOW, 10);
    expect(strip).toHaveLength(10);
    expect(strip[0]).toMatchObject({ time: "Now", now: true });
    expect(strip[1].time).toMatch(/^\d{2}:00$/);
    expect(strip.every((c) => /^-?\d+°$|^—$/.test(c.temp))).toBe(true);
  });

  it("aggregates today's rain and gusts", () => {
    const a = todayAggregates(data.hourly, TZ, NOW);
    expect(a.rainMm).toEqual(expect.any(Number));
    expect(a.peakChance).toBeGreaterThanOrEqual(0);
    expect(a.peakGust).toBeGreaterThanOrEqual(0);
    expect(todayAggregates([], TZ, NOW)).toEqual({ rainMm: null, peakChance: null, peakGust: null });
  });

  it("gives a pressure trend", () => {
    expect(["rising", "falling", "steady"]).toContain(pressureTrend(data.hourly, NOW));
    expect(pressureTrend([], NOW)).toBeNull();
  });

  it("labels UV and finds the UV 3+ window", () => {
    expect(uvLabel(1)).toBe("1 Low");
    expect(uvLabel(4)).toBe("4 Med");
    expect(uvLabel(11)).toBe("11 Extreme");
    expect(uvLabel(null)).toBe("—");
    expect(uvLabel(7.15)).toBe("7 High");
    expect(uvLabel(7.5)).toBe("8 V.High");
    const { peakUV, uvWindow } = uvInfo(data.hourly, TZ, NOW);
    expect(peakUV).toBeGreaterThanOrEqual(3);
    expect(uvWindow).toMatch(/^\d{2}:00–\d{2}:00$/);
  });

  it("uses the calendar-day high and the overnight low", () => {
    const hl = todayHighLow(data.hourly, data.daily, TZ, NOW)!;
    expect(hl.high.temp).toBe(data.daily[0].calendarDayTemperatureMax);
    expect(hl.low.temp).toEqual(expect.any(Number));
    expect(hl.low.temp!).toBeLessThanOrEqual(hl.high.temp!);
  });

  it("reads cloud from the hour at or just before now", () => {
    expect(currentCloud(data.hourly, NOW)).toBe(data.hourly[13].cloudCover);
  });
});

describe("validatePayload", () => {
  const now = Date.parse(data.meta!.updated!) + 60_000;
  it("accepts the real payload", () => expect(validatePayload(data, now)).toEqual([]));
  it("rejects missing parts", () => {
    expect(validatePayload(null, now)).toEqual(["Invalid data structure"]);
    expect(validatePayload({ hourly: [] }, now)).toEqual(
      expect.arrayContaining(["Missing current conditions", "Insufficient hourly data"]));
  });
  it("rejects absurd temperatures and day-old data", () => {
    expect(validatePayload({ ...data, current: { temp: 101 } }, now).join()).toMatch(/out of range/);
    expect(validatePayload(data, now + 3 * 3_600_000).join()).toMatch(/3 hours old/);
  });
  it("flags stale but usable data after 30 minutes", () => {
    expect(isStale(data, now)).toBe(false);
    expect(isStale(data, now + 40 * 60_000)).toBe(true);
  });
});

describe("sample data", () => {
  const loc = getLocation("christchurch");
  const sample = generateSampleData(loc, NOW * 1000);
  it("is 120 hours and 5 days, obviously fake (101°), and fails validation", () => {
    expect(sample.hourly).toHaveLength(120);
    expect(sample.daily).toHaveLength(5);
    expect(sample.current.temp).toBe(101);
    expect(validatePayload(sample, NOW * 1000)).toEqual([expect.stringMatching(/out of range/)]);
  });
  it("drives the same display helpers as real data", () => {
    expect(hourlyStrip(sample.hourly, TZ, NOW, 10)).toHaveLength(10);
    expect(todayHighLow(sample.hourly, sample.daily, TZ, NOW)?.high.temp).toBe(101);
  });
});
