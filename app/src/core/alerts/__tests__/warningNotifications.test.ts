import { decide, type RememberedWarning } from "../warningNotifications";
import type { WarningItem } from "../../payload";

const TZ = "Pacific/Auckland";
const NOW = Date.UTC(2026, 5, 10, 0) / 1000;
const w = (id: string, level: WarningItem["level"], o: Partial<WarningItem> = {}): WarningItem => ({
  id, level, headline: "Heavy Rain Warning - Orange", event: "Heavy Rain",
  expires: NOW + 6 * 3600, details: "Rain is expected. More later.", ...o,
});
const base = { locationID: "chc", place: "Christchurch", nowSec: NOW, tz: TZ, liftedEnabled: true, complete: true };

describe("warning notifications", () => {
  it("notifies a new warning once", () => {
    const a = decide({ ...base, warnings: [w("1", "orange")], memory: [] });
    expect(a.notices).toHaveLength(1);
    expect(a.notices[0].title).toBe("Heavy Rain Warning - Orange – Christchurch");
    expect(a.notices[0].body).toContain("Rain is expected.");
    const b = decide({ ...base, warnings: [w("1", "orange")], memory: a.memory });
    expect(b.notices).toHaveLength(0);
  });

  it("is quiet for a re-issue at the same level and loud for an upgrade", () => {
    const a = decide({ ...base, warnings: [w("1", "orange")], memory: [] });
    expect(decide({ ...base, warnings: [w("2", "orange")], memory: a.memory }).notices).toHaveLength(0);
    const up = decide({ ...base, warnings: [w("3", "red")], memory: a.memory });
    expect(up.notices).toHaveLength(1);
    expect(up.notices[0].body.startsWith("Upgraded from orange.")).toBe(true);
  });

  it("only the worse of two new same-hazard warnings notifies", () => {
    const r = decide({ ...base, warnings: [w("1", "yellow"), w("2", "red")], memory: [] });
    expect(r.notices).toHaveLength(1);
  });

  it("announces an early lift, not a natural end or a partial feed", () => {
    const a = decide({ ...base, warnings: [w("1", "orange")], memory: [] });
    const lifted = decide({ ...base, warnings: [], memory: a.memory });
    expect(lifted.notices).toHaveLength(1);
    expect(lifted.notices[0].title).toBe("Heavy Rain Warning lifted – Christchurch");
    expect(decide({ ...base, warnings: [], memory: a.memory, complete: false }).notices).toHaveLength(0);
    const ending: RememberedWarning[] = a.memory.map((m) => ({ ...m, expires: NOW + 600 }));
    expect(decide({ ...base, warnings: [], memory: ending }).notices).toHaveLength(0);
    expect(decide({ ...base, warnings: [], memory: a.memory, liftedEnabled: false }).notices).toHaveLength(0);
  });
});
