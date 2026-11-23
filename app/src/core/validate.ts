// Sanity checks on a Worker payload before the UI trusts it.
export const STALENESS_WARNING_MS = 30 * 60 * 1000;
export const STALENESS_ERROR_MS = 2 * 60 * 60 * 1000;

/** Problems found in `data`; empty means it is usable. */
export function validatePayload(data: unknown, nowMs: number): string[] {
  const errors: string[] = [];
  if (!data || typeof data !== "object") return ["Invalid data structure"];
  const d = data as Record<string, any>;

  if (!d.current) errors.push("Missing current conditions");
  if (!Array.isArray(d.hourly)) errors.push("Missing hourly array");
  else if (d.hourly.length < 10) errors.push("Insufficient hourly data");

  // Catches the "101°" bug: a placeholder/garbage temperature.
  const temp = d.current?.temp;
  if (typeof temp === "number" && (temp < -50 || temp > 60)) errors.push(`Temperature out of range: ${temp}°C`);

  const updated = d.meta?.updated;
  if (updated) {
    const age = nowMs - new Date(updated).getTime();
    if (age > STALENESS_ERROR_MS) errors.push(`Data is ${Math.round(age / 3_600_000)} hours old`);
  }
  return errors;
}

/** True when the payload is usable but older than 30 minutes. */
export function isStale(data: { meta?: { updated?: string } }, nowMs: number): boolean {
  const updated = data.meta?.updated;
  return !!updated && nowMs - new Date(updated).getTime() > STALENESS_WARNING_MS;
}
