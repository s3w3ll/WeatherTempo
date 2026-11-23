import raw from "../__fixtures__/worker-christchurch.json";
import { buildDayForecast, hourlyTableRows, HOURLY_COLUMNS } from "../dayForecast";
import type { WeatherPayload } from "../payload";
import { weekStripDays } from "../weekStrip";
import { browseStartHour, buildChartModel, visibleFraction } from "../../chart/model";

const data = raw as unknown as WeatherPayload;
const TZ = "Pacific/Auckland";
const NOW = data.hourly[13].validTimeUtc;   // 1pm NZDT, Tue 24 Nov 2026

describe("buildDayForecast", () => {
  const tomorrow = buildDayForecast(1, data.hourly, data.daily, TZ, NOW)!;
  const dayAfter = buildDayForecast(2, data.hourly, data.daily, TZ, NOW)!;

  it("labels tomorrow, then weekday names, with a short date", () => {
    expect(tomorrow.label).toBe("Tomorrow");
    expect(tomorrow.date).toBe("25 Nov");
    expect(dayAfter.label).toBe("Thursday");
    expect(dayAfter.date).toBe("26 Nov");
  });
  it("returns null past the end of the daily list", () => {
    expect(buildDayForecast(5, data.hourly, data.daily, TZ, NOW)).toBeNull();
    expect(buildDayForecast(1, data.hourly, [], TZ, NOW)).toBeNull();
  });
  it("takes the high from the calendar day and the time from that day's warmest hour", () => {
    expect(tomorrow.temp.max.val).toBe(data.daily[1].calendarDayTemperatureMax);
    const day = data.hourly.filter((h) => new Date(h.validTimeUtc * 1000)
      .toLocaleDateString("en-NZ", { timeZone: TZ }) === "25/11/2026");
    const warmest = day.reduce((a, b) => (b.temperature! > a.temperature! ? b : a));
    expect(tomorrow.temp.max.utcSec).toBe(warmest.validTimeUtc);
  });
  it("finds the overnight low between this sunset and the next sunrise", () => {
    const { sunsetTimeUtc } = data.daily[1];
    const nextSunrise = data.daily[2].sunriseTimeUtc!;
    expect(tomorrow.temp.min.utcSec!).toBeGreaterThanOrEqual(sunsetTimeUtc!);
    expect(tomorrow.temp.min.utcSec!).toBeLessThan(nextSunrise);
  });
  it("summarises humidity, wind, rain, UV and pressure from the day's hours", () => {
    expect(tomorrow.humidity.max.val!).toBeGreaterThanOrEqual(tomorrow.humidity.min.val!);
    expect(tomorrow.wind.speed).toEqual(expect.any(Number));
    expect(tomorrow.wind.cardinal).toMatch(/^[NESW]{1,3}$/);
    expect(tomorrow.precip.totalMm).toEqual(expect.any(Number));
    expect(tomorrow.precip.maxChance).toBeGreaterThanOrEqual(0);
    expect(tomorrow.uv.peak!).toBeGreaterThan(0);
    expect(tomorrow.uv.window).toMatch(/^\d{1,2}(am|pm)–\d{1,2}(am|pm)$/);
    expect(tomorrow.pressure.max.val!).toBeGreaterThanOrEqual(tomorrow.pressure.min.val!);
    expect(tomorrow.sunrise).toBe(data.daily[1].sunriseTimeUtc);
  });
  it("copes with a day that has no hourly slots", () => {
    const sparse = buildDayForecast(1, [], data.daily, TZ, NOW)!;
    expect(sparse.precip).toEqual({ totalMm: null, maxChance: null });
    expect(sparse.wind.speed).toBeNull();
    expect(sparse.uv).toEqual({ peak: null, window: null });
    expect(sparse.temp.min.val).toBe(data.daily[1].calendarDayTemperatureMin);   // falls back to the daily value
  });
});

describe("hourlyTableRows", () => {
  const rows = hourlyTableRows(data.hourly, TZ, NOW);
  it("starts with a day heading and has one per local date", () => {
    expect(rows[0]).toMatchObject({ kind: "day", label: "Tue, 24 Nov" });
    expect(rows.filter((r) => r.kind === "day")).toHaveLength(5);
    expect(rows.filter((r) => r.kind === "hour")).toHaveLength(120);
  });
  it("has one cell per column and marks the current hour", () => {
    const hours = rows.filter((r): r is Extract<typeof r, { kind: "hour" }> => r.kind === "hour");
    expect(hours.every((r) => r.cells.length === HOURLY_COLUMNS.length)).toBe(true);
    const now = hours.filter((r) => r.isNow);
    expect(now).toHaveLength(1);
    expect(now[0].cells[0]).toBe("Now");
    expect(hours[1].cells[0]).toMatch(/^\d{1,2}:00 (am|pm)$/);
  });
  it("formats units and dashes", () => {
    const first = rows.find((r) => r.kind === "hour") as Extract<(typeof rows)[number], { kind: "hour" }>;
    expect(first.cells[2]).toMatch(/^-?\d+\.\d°$/);        // one decimal
    expect(first.cells[10]).toMatch(/ hPa$/);
    const blank = hourlyTableRows([{ validTimeUtc: NOW }], TZ, NOW)[1] as Extract<(typeof rows)[number], { kind: "hour" }>;
    expect(blank.cells.slice(2)).toEqual(["—", "—", "—", "—", "—", "—", "—", "—", "—", "—"]);
  });
  it("honours the hour limit", () => {
    expect(hourlyTableRows(data.hourly, TZ, NOW, 10).filter((r) => r.kind === "hour")).toHaveLength(10);
  });
});

describe("weekStripDays", () => {
  const days = weekStripDays(data.hourly, TZ, data.meta!.lat, data.meta!.lon);
  it("has a column per day, weighted by hours, starting at the right hour", () => {
    expect(days).toHaveLength(5);
    expect(days.reduce((s, d) => s + d.hours, 0)).toBe(120);
    expect(days[0]).toMatchObject({ start: 0, hours: 24, label: "Tue" });
    expect(days[1].start).toBe(24);
  });
  it("draws range bars on one shared scale", () => {
    for (const d of days) {
      expect(d.barTop).toBeGreaterThanOrEqual(0);
      expect(d.barHeight).toBeGreaterThanOrEqual(0);
      expect(d.barTop + d.barHeight).toBeLessThanOrEqual(100 + 1e-9);
    }
    const hottest = days.reduce((a, b) => (parseInt(b.hi) > parseInt(a.hi) ? b : a));
    expect(hottest.barTop).toBeLessThan(2);   // the overall high touches the top of the scale
  });
  it("describes each day for VoiceOver", () => {
    expect(days[0].a11y).toMatch(/^Tue, .*high \d+ degrees, low \d+ degrees/);
  });
  it("is empty without hours", () => {
    expect(weekStripDays([], TZ, 0, 0)).toEqual([]);
  });
});

describe("week strip ↔ chart scrolling", () => {
  const m = buildChartModel({ hours: data.hourly, days: 3, viewportWidth: 900, tz: TZ, nowSec: NOW });
  it("reports what fraction of the series is in view", () => {
    const [a, b] = visibleFraction(m, 0, 900);
    expect(a).toBe(0);
    expect(b).toBeCloseTo(3 / 5, 1);                       // 3 of 5 days visible
    const [c, d] = visibleFraction(m, m.W, 900);
    expect(d).toBe(1);
    expect(c).toBeLessThanOrEqual(d);
  });
  it("centres the window on a fraction, never past either end", () => {
    expect(browseStartHour(m, 0, 900)).toBe(0);
    expect(browseStartHour(m, 1, 900)).toBe(120 - 72);
    const mid = browseStartHour(m, 0.5, 900);
    expect(mid).toBeGreaterThan(0);
    expect(mid + 72).toBeLessThanOrEqual(120);
  });
});
