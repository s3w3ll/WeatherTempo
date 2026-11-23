import { LOCATIONS, getLocation } from "../locations";
import { TIDE_PORTS } from "../tidePorts";

describe("locations", () => {
  it("ids are unique", () => {
    expect(new Set(LOCATIONS.map((l) => l.id)).size).toBe(LOCATIONS.length);
  });
  it("every tidePort exists, and tideLabel is set exactly when tidePort is", () => {
    for (const l of LOCATIONS) {
      if (l.tidePort) expect(TIDE_PORTS[l.tidePort]).toBeDefined();
      expect(l.tidePort === null).toBe(l.tideLabel === null);
    }
  });
  it("Christchurch uses the New Brighton fit and the PWS station", () => {
    const c = getLocation("christchurch");
    expect(c.tidePort).toBe("new-brighton");
    expect(c.pwsStation).toBe("ICHRIS810");
  });
  it("falls back to Christchurch for unknown ids", () => {
    expect(getLocation("nowhere").id).toBe("christchurch");
    expect(getLocation(null).id).toBe("christchurch");
  });
});
