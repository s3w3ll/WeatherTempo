import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import type { WarningItem, WeatherPayload } from "../core/payload";
import type { Location } from "../core/types";
import { fetchWarnings, fetchWeather } from "./api";

const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

export interface WeatherState {
  data: WeatherPayload | null;
  source: "worker" | "sample-data" | null;
  error: string | null;
  loading: boolean;
  warnings: WarningItem[];
  /** Epoch ms of the last successful Worker fetch. */
  fetchedAt: number | null;
  refresh: () => void;
}

/**
 * Weather + warnings for a location: loads on mount and location change,
 * refreshes every 5 minutes and when the app returns to the foreground.
 * A response for a location the user has since left is ignored.
 */
export function useWeather(location: Location): WeatherState {
  const [data, setData] = useState<WeatherPayload | null>(null);
  const [source, setSource] = useState<WeatherState["source"]>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [warnings, setWarnings] = useState<WarningItem[]>([]);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const current = useRef(location.id);
  current.current = location.id;

  const loadWarnings = useCallback(async (id: string) => {
    const w = await fetchWarnings(id);
    if (w != null && id === current.current) setWarnings(w);   // null: keep what we had
  }, []);

  const load = useCallback(async (loc: Location, initial: boolean) => {
    if (initial) setLoading(true);
    loadWarnings(loc.id);
    const result = await fetchWeather(loc);
    if (loc.id !== current.current) return;
    setData(result.data);
    setSource(result.source);
    setError(result.source === "sample-data" ? result.error : null);
    if (result.source === "worker") setFetchedAt(Date.now());
    setLoading(false);
  }, [loadWarnings]);

  // New location: clear, then load.
  useEffect(() => {
    setData(null);
    setWarnings([]);
    setSource(null);
    load(location, true);
  }, [location, load]);

  // Live refresh.
  useEffect(() => {
    const tick = () => load(location, false);
    const timer = setInterval(tick, REFRESH_INTERVAL_MS);
    const sub = AppState.addEventListener("change", (s) => { if (s === "active") tick(); });
    return () => { clearInterval(timer); sub.remove(); };
  }, [location, load]);

  const refresh = useCallback(() => { load(location, false); }, [location, load]);
  return { data, source, error, loading, warnings, fetchedAt, refresh };
}
