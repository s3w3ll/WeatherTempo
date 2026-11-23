import { planAlerts, MAX_ALERTS } from "../planner";
import { defaultAlertSettings, parseAlertSettings, sanitize } from "../settings";
import type { Hour } from "../../types";

const TZ = "Pacific/Auckland";
// 2026-06-10 00:00 NZST (UTC+12) = 2026-06-09 12:00 UTC
const T0 = Date.UTC(2026, 5, 9, 12) / 1000;
const NOW = T0 + 8 * 3600 + 600; // 08:10 local
const hr = (i: number, o: Partial<Hour> = {}): Hour => ({ validTimeUtc: T0 + i * 3600, temperature: 10, uvIndex: 0, precipChance: 0, qpf: 0, ...o });
const on = (o: object) => ({ ...defaultAlertSettings(), ...o });

describe("alert settings", () => {
  it("defaults, lenient parse, sanitize", () => {
    expect(parseAlertSettings(null).warningsEnabled).toBe(true);
    expect(parseAlertSettings("{bad").tempHigh).toBe(25);
    expect(parseAlertSettings('{"tempHigh":30,"rainChance":"x"}')).toMatchObject({ tempHigh: 30, rainChance: 50 });
    expect(sanitize(on({ tempHigh: 99, uvThreshold: 0, rainChance: 1 }))).toMatchObject({ tempHigh: 45, uvThreshold: 1, rainChance: 10 });
  });
});

describe("planAlerts", () => {
  it("fires once per upward temperature crossing", () => {
    const temps = [10, 10, 10, 10, 10, 10, 10, 10, 10, 12, 27, 27, 12, 12, 26, 12];
    const hours = temps.map((t, i) => hr(i, { temperature: t }));
    const out = planAlerts(hours, on({ tempHighEnabled: true }), "Christchurch", TZ, NOW);
    expect(out).toHaveLength(2);
    expect(out[0].title).toBe("Warming up in Christchurch");
    expect(out[0].body).toBe("Forecast above 25° from 10am today (27°).");
  });

  it("stays quiet when already beyond the limit at the first future hour", () => {
    const hours = Array.from({ length: 12 }, (_, i) => hr(i + 8, { temperature: 30 }));
    expect(planAlerts(hours, on({ tempHighEnabled: true }), "X", TZ, NOW)).toHaveLength(0);
  });

  it("alerts at the start of a UV run", () => {
    const hours = Array.from({ length: 24 }, (_, i) => hr(i, { uvIndex: i >= 10 && i < 15 ? (i === 10 ? 6 : 3) : 0 }));
    const out = planAlerts(hours, on({ uvEnabled: true }), "Christchurch", TZ, NOW);
    expect(out).toHaveLength(1);
    expect(out[0].body).toBe("UV 3+ from 10am to 3pm, peaking at 6 High around 10am.");
  });

  it("alerts ahead of rain with the lead time", () => {
    const hours = Array.from({ length: 24 }, (_, i) =>
      hr(i, i >= 15 && i < 18 ? { precipChance: 70, qpf: 1.2 } : {}));
    const out = planAlerts(hours, on({ rainEnabled: true }), "Christchurch", TZ, NOW);
    expect(out).toHaveLength(1);
    expect(out[0].fireSec).toBe(T0 + 14 * 3600);
    expect(out[0].body).toBe("Moderate rain from 3pm to 6pm today, up to 70% chance, about 3.6 mm.");
  });

  it("caps and sorts", () => {
    const hours = Array.from({ length: 200 }, (_, i) => hr(i, { temperature: i % 2 ? 30 : 10 }));
    const out = planAlerts(hours, on({ tempHighEnabled: true }), "X", TZ, NOW);
    expect(out).toHaveLength(MAX_ALERTS);
    expect(out.map((a) => a.fireSec)).toEqual([...out.map((a) => a.fireSec)].sort((a, b) => a - b));
  });
});
