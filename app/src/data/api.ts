// Talks to the Cloudflare Worker (the only network dependency). The API key
// lives in the Worker, never in this app.
import type { WarningItem, WeatherPayload } from "../core/payload";
import { generateSampleData } from "../core/sample";
import type { Location } from "../core/types";
import { validatePayload } from "../core/validate";

export const WORKER_URL = (process.env.EXPO_PUBLIC_WORKER_URL ?? "https://weathertempo-pws-proxy.forgesync.workers.dev")
  .replace(/\/$/, "");

const FETCH_TIMEOUT_MS = 10_000;
const MAX_RETRIES = 2;            // 3 tries in all
const RETRY_DELAY_MS = 1000;      // doubles each retry: 1 s, 2 s

async function fetchWithTimeout(url: string, timeoutMs = FETCH_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal, cache: "no-store" });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw new Error(`Request timeout after ${timeoutMs}ms`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type WeatherResult =
  | { source: "worker"; data: WeatherPayload }
  | { source: "sample-data"; data: WeatherPayload; error: string };

/** Worker with retries and exponential backoff, else synthetic sample data. */
export async function fetchWeather(loc: Location, fetchImpl = fetchWithTimeout): Promise<WeatherResult> {
  const url = `${WORKER_URL}?location=${encodeURIComponent(loc.id)}`;
  let lastError = "unknown error";
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const resp = await fetchImpl(url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
      const data = await resp.json();
      if (data.error) throw new Error(String(data.error));
      const problems = validatePayload(data, Date.now());
      if (problems.length) throw new Error(`Validation failed: ${problems.join(", ")}`);
      return { source: "worker", data: data as WeatherPayload };
    } catch (err) {
      lastError = (err as Error).message;
      console.warn(`[WeatherTempo] Worker attempt ${attempt + 1} failed: ${lastError}`);
      if (attempt < MAX_RETRIES) await sleep(RETRY_DELAY_MS * 2 ** attempt);
    }
  }
  return { source: "sample-data", data: generateSampleData(loc, Date.now()), error: lastError };
}

/**
 * Current MetService warnings. null = couldn't be checked (keep what you had),
 * [] = none. A Worker deployed before this route existed answers with the
 * weather payload instead, which has no `warnings` list.
 */
export async function fetchWarnings(locationId: string, fetchImpl = fetchWithTimeout): Promise<WarningItem[] | null> {
  return (await fetchWarningsFull(locationId, fetchImpl))?.warnings ?? null;
}

export interface WarningsResult {
  warnings: WarningItem[];
  /** false when MetService's feed was only partly readable, so absence proves nothing. */
  complete: boolean;
}

export async function fetchWarningsFull(locationId: string, fetchImpl = fetchWithTimeout): Promise<WarningsResult | null> {
  try {
    const resp = await fetchImpl(`${WORKER_URL}/warnings?location=${encodeURIComponent(locationId)}`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    if (!Array.isArray(data.warnings)) throw new Error("no warnings list in response");
    const nowSec = Date.now() / 1000;
    return {
      warnings: (data.warnings as WarningItem[]).filter((w) => !w.expires || w.expires > nowSec),
      complete: data.complete !== false,
    };
  } catch (err) {
    console.warn("[WeatherTempo] Warnings unavailable:", (err as Error).message);
    return null;
  }
}
