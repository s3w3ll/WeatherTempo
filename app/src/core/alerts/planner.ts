import { uvLabel } from "../display";
import { hourLabel, rainLabel, weekday, dayKey } from "../insights";
import { localMidnightUtc } from "../tides";
import type { Hour } from "../types";
import type { AlertSettings } from "./settings";

export type AlertKind = "tempHigh" | "tempLow" | "uv" | "dailyUV" | "rain";

export interface PlannedAlert {
  /** Stable per (kind, fire time) so replanning never duplicates. */
  id: string;
  kind: AlertKind;
  /** UTC seconds. */
  fireSec: number;
  title: string;
  body: string;
}

export const ALERT_ID_PREFIX = "weathertempo.alert.";
export const MAX_ALERTS = 40;
const HOUR = 3600;

const idFor = (kind: AlertKind, fireSec: number) => `${ALERT_ID_PREFIX}${kind}.${Math.round(fireSec)}`;

/** "today", "tomorrow", or the weekday name, relative to `nowSec` in `tz`. */
function dayPhrase(sec: number, nowSec: number, tz: string): string {
  const k = dayKey(sec, tz);
  if (k === dayKey(nowSec, tz)) return "today";
  if (k === dayKey(nowSec + 24 * HOUR, tz)) return "tomorrow";
  return weekday(sec, tz, true);
}

const num = (v: number) => (Math.round(v * 10) / 10).toString();

function temperatureAlerts(
  hours: Hour[], kind: "tempHigh" | "tempLow", limit: number, place: string, tz: string, nowSec: number,
): PlannedAlert[] {
  const beyond = (t: number) => (kind === "tempHigh" ? t > limit : t < limit);
  const out: PlannedAlert[] = [];
  let prev: boolean | null = null;
  for (const h of hours) {
    if (h.validTimeUtc + HOUR <= nowSec) continue;      // the slot containing now still counts
    if (h.temperature == null) continue;
    const now = beyond(h.temperature);
    // First usable hour only sets the baseline: if it's already beyond, we don't alert.
    if (prev === false && now && h.validTimeUtc > nowSec) {
      const t = Math.round(h.temperature);
      out.push({
        id: idFor(kind, h.validTimeUtc), kind, fireSec: h.validTimeUtc,
        title: kind === "tempHigh" ? `Warming up in ${place}` : `Cold in ${place}`,
        body: `Forecast ${kind === "tempHigh" ? "above" : "below"} ${num(limit)}° from ${hourLabel(h.validTimeUtc, tz)} ${dayPhrase(h.validTimeUtc, nowSec, tz)} (${t}°).`,
      });
    }
    prev = now;
  }
  return out;
}

/** Runs of consecutive hours where `pred` holds: [startIndex, endIndex] inclusive. */
function runs(hours: Hour[], pred: (h: Hour) => boolean): [number, number][] {
  const out: [number, number][] = [];
  let start = -1;
  for (let i = 0; i <= hours.length; i++) {
    const on = i < hours.length && pred(hours[i]);
    if (on && start < 0) start = i;
    if (!on && start >= 0) { out.push([start, i - 1]); start = -1; }
  }
  return out;
}

function uvAlerts(hours: Hour[], threshold: number, place: string, tz: string, nowSec: number): PlannedAlert[] {
  const out: PlannedAlert[] = [];
  for (const [a, b] of runs(hours, (h) => (h.uvIndex ?? 0) >= threshold)) {
    const start = hours[a].validTimeUtc;
    if (start <= nowSec) continue;
    let peak = a;
    for (let i = a; i <= b; i++) if ((hours[i].uvIndex ?? 0) > (hours[peak].uvIndex ?? 0)) peak = i;
    out.push({
      id: idFor("uv", start), kind: "uv", fireSec: start, title: `UV rising in ${place}`,
      body: `UV ${threshold}+ from ${hourLabel(start, tz)} to ${hourLabel(hours[b].validTimeUtc + HOUR, tz)}, peaking at ${uvLabel(hours[peak].uvIndex)} around ${hourLabel(hours[peak].validTimeUtc, tz)}.`,
    });
  }
  return out;
}

function dailyUVAlerts(
  hours: Hour[], s: AlertSettings, place: string, tz: string, nowSec: number,
): PlannedAlert[] {
  const out: PlannedAlert[] = [];
  const midnight0 = localMidnightUtc(nowSec * 1000, tz) / 1000;
  const spans = runs(hours, (h) => (h.uvIndex ?? 0) >= s.uvThreshold);
  for (let d = 0; d < 7; d++) {
    // Walk by 24h + re-anchor so DST days still land on local midnight.
    const midnight = localMidnightUtc((midnight0 + d * 24 * HOUR + 12 * HOUR) * 1000, tz) / 1000;
    const fire = midnight + s.dailyUVMinutes * 60;
    if (fire <= nowSec) continue;
    const key = dayKey(midnight + 12 * HOUR, tz);
    // Longest run that starts on this local day.
    let best: [number, number] | null = null;
    for (const r of spans) {
      if (dayKey(hours[r[0]].validTimeUtc, tz) !== key) continue;
      if (!best || r[1] - r[0] > best[1] - best[0]) best = r;
    }
    if (!best) continue;
    let peak = best[0];
    for (let i = best[0]; i <= best[1]; i++) if ((hours[i].uvIndex ?? 0) > (hours[peak].uvIndex ?? 0)) peak = i;
    out.push({
      id: idFor("dailyUV", fire), kind: "dailyUV", fireSec: fire, title: `UV today in ${place}`,
      body: `UV ${s.uvThreshold}+ from ${hourLabel(hours[best[0]].validTimeUtc, tz)} to ${hourLabel(hours[best[1]].validTimeUtc + HOUR, tz)}, peaking at ${uvLabel(hours[peak].uvIndex)} around ${hourLabel(hours[peak].validTimeUtc, tz)}.`,
    });
  }
  return out;
}

function rainAlerts(hours: Hour[], s: AlertSettings, place: string, tz: string, nowSec: number): PlannedAlert[] {
  const rainy = (h: Hour) => (h.precipChance ?? 0) >= s.rainChance && (h.qpf ?? 0) >= 0.1;
  // Merge spells separated by a single dry hour.
  const merged: [number, number][] = [];
  for (const r of runs(hours, rainy)) {
    const last = merged[merged.length - 1];
    if (last && r[0] - last[1] <= 2) last[1] = r[1];
    else merged.push([r[0], r[1]]);
  }
  const out: PlannedAlert[] = [];
  for (const [a, b] of merged) {
    const first = hours[a].validTimeUtc;
    const fire = first - s.rainLeadMinutes * 60;
    if (first <= nowSec || fire <= nowSec) continue;
    let total = 0, peakChance = 0;
    for (let i = a; i <= b; i++) {
      total += hours[i].qpf ?? 0;
      peakChance = Math.max(peakChance, hours[i].precipChance ?? 0);
    }
    const peakQpf = Math.max(...hours.slice(a, b + 1).map((h) => h.qpf ?? 0));
    out.push({
      id: idFor("rain", fire), kind: "rain", fireSec: fire, title: `Rain coming in ${place}`,
      body: `${rainLabel(peakQpf)} from ${hourLabel(first, tz)} to ${hourLabel(hours[b].validTimeUtc + HOUR, tz)} ${dayPhrase(first, nowSec, tz)}, up to ${Math.round(peakChance)}% chance, about ${num(total)} mm.`,
    });
  }
  return out;
}

/** Everything worth scheduling for this forecast, soonest first, capped. */
export function planAlerts(
  hours: Hour[], s: AlertSettings, place: string, tz: string, nowSec: number,
): PlannedAlert[] {
  const sorted = [...hours].sort((x, y) => x.validTimeUtc - y.validTimeUtc);
  const all: PlannedAlert[] = [];
  if (s.tempHighEnabled) all.push(...temperatureAlerts(sorted, "tempHigh", s.tempHigh, place, tz, nowSec));
  if (s.tempLowEnabled) all.push(...temperatureAlerts(sorted, "tempLow", s.tempLow, place, tz, nowSec));
  if (s.uvEnabled) all.push(...uvAlerts(sorted, s.uvThreshold, place, tz, nowSec));
  if (s.dailyUVEnabled) all.push(...dailyUVAlerts(sorted, s, place, tz, nowSec));
  if (s.rainEnabled) all.push(...rainAlerts(sorted, s, place, tz, nowSec));
  return all.sort((a, b) => a.fireSec - b.fireSec).slice(0, MAX_ALERTS);
}
