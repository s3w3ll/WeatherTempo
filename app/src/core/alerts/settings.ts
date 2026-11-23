/**
 * What the user wants to be told about. Stored as one JSON string under one
 * key. Ported from AlertSettings.swift (same key and field names, so a future
 * widget extension can read the same thing).
 */
export interface AlertSettings {
  /** Notify when the forecast temperature rises above `tempHigh`. */
  tempHighEnabled: boolean;
  tempHigh: number;
  /** Notify when the forecast temperature falls below `tempLow`. */
  tempLowEnabled: boolean;
  tempLow: number;
  /** Notify when the forecast UV index reaches `uvThreshold`. */
  uvEnabled: boolean;
  /** Shared by the UV alert and the daily summary. 3 is where sun protection starts to matter. */
  uvThreshold: number;
  /** A morning summary, sent only on days the forecast UV reaches `uvThreshold`. */
  dailyUVEnabled: boolean;
  /** Minutes after local midnight (420 = 7:00am), in the location's time zone. */
  dailyUVMinutes: number;
  /** Notify ahead of forecast rain. */
  rainEnabled: boolean;
  /** An hour counts as rainy when its chance is at least this (and some rain is forecast). */
  rainChance: number;
  /** How long before the rain starts to send the alert. */
  rainLeadMinutes: number;
  /** Notify as soon as MetService issues a watch or warning covering the location. On by default: it's a safety feature. */
  warningsEnabled: boolean;
  /** Also notify when MetService lifts a warning well before its planned end. */
  warningLiftedEnabled: boolean;
}

export const ALERT_SETTINGS_KEY = "weatherTempo.alerts";
export const TEMP_RANGE = [-10, 45] as const;
export const UV_RANGE = [1, 11] as const;
export const RAIN_CHANCE_RANGE = [10, 90] as const;
export const RAIN_LEAD_OPTIONS = [30, 60, 120, 180] as const;

export function defaultAlertSettings(): AlertSettings {
  return {
    tempHighEnabled: false, tempHigh: 25,
    tempLowEnabled: false, tempLow: 3,
    uvEnabled: false, uvThreshold: 3,
    dailyUVEnabled: false, dailyUVMinutes: 7 * 60,
    rainEnabled: false, rainChance: 50, rainLeadMinutes: 60,
    warningsEnabled: true, warningLiftedEnabled: true,
  };
}

export const anyEnabled = (s: AlertSettings) =>
  s.tempHighEnabled || s.tempLowEnabled || s.uvEnabled || s.dailyUVEnabled || s.rainEnabled;

const clamp = (v: number, [lo, hi]: readonly [number, number]) => Math.min(Math.max(v, lo), hi);

/** Clamps hand-edited or corrupt values back into sensible bounds. */
export function sanitize(s: AlertSettings): AlertSettings {
  return {
    ...s,
    tempHigh: clamp(s.tempHigh, TEMP_RANGE),
    tempLow: clamp(s.tempLow, TEMP_RANGE),
    uvThreshold: clamp(s.uvThreshold, UV_RANGE),
    dailyUVMinutes: clamp(s.dailyUVMinutes, [0, 24 * 60 - 1]),
    rainChance: clamp(s.rainChance, RAIN_CHANCE_RANGE),
    rainLeadMinutes: clamp(s.rainLeadMinutes, [0, 6 * 60]),
  };
}

/**
 * Parses stored JSON field by field, so settings saved by an older build
 * (missing newer keys) keep their values instead of resetting to defaults.
 * Corrupt or missing input gives the defaults.
 */
export function parseAlertSettings(json: string | null | undefined): AlertSettings {
  const d = defaultAlertSettings();
  if (!json) return d;
  let raw: unknown;
  try { raw = JSON.parse(json); } catch { return d; }
  if (!raw || typeof raw !== "object") return d;
  const r = raw as Record<string, unknown>;
  const out: Record<string, unknown> = { ...d };
  for (const k of Object.keys(d) as (keyof AlertSettings)[]) {
    if (typeof r[k] === typeof d[k] && (typeof r[k] !== "number" || Number.isFinite(r[k]))) out[k] = r[k];
  }
  return sanitize(out as unknown as AlertSettings);
}

export const serializeAlertSettings = (s: AlertSettings) => JSON.stringify(s);
