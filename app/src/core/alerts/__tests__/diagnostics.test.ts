import { describeWarnings, record, DIAGNOSTICS_CAPACITY } from "../diagnostics";

const ev = (date: number, detail = "ok", kind: "forecast" | "warnings" = "forecast") =>
  ({ date, source: "app" as const, kind, ok: true, detail });

describe("diagnostics log", () => {
  it("bumps identical repeats instead of adding rows", () => {
    let log = record([], ev(100));
    log = record(log, ev(200));
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ count: 2, firstDate: 100, date: 200 });
  });
  it("adds a row when the detail differs and caps the size", () => {
    let log = record([], ev(1));
    log = record(log, ev(2, "other"));
    expect(log).toHaveLength(2);
    for (let i = 0; i < 200; i++) log = record(log, ev(i, `d${i}`));
    expect(log).toHaveLength(DIAGNOSTICS_CAPACITY);
  });
  it("describes warnings", () => {
    expect(describeWarnings([], true)).toBe("None in force");
    expect(describeWarnings(["a", "b"], false)).toBe("2 in force: a; b (some alerts didn't load)");
  });
});
