// The one routine that checks warnings, notifies, and re-plans scheduled
// alerts. Used by the foreground app and the background task.
import { Platform } from "react-native";
import {
  describeError, describeWarnings, parseLog, record, type DiagKind, type DiagSource,
} from "../core/alerts/diagnostics";
import { planAlerts } from "../core/alerts/planner";
import { anyEnabled, parseAlertSettings } from "../core/alerts/settings";
import { decide, parseMemory } from "../core/alerts/warningNotifications";
import { getLocation } from "../core/locations";
import { fetchWarningsFull, fetchWeather } from "../data/api";
import { KEYS, load, save } from "../data/storage";
import { notifyNow, replaceAll } from "./notify";

export async function log(source: DiagSource, kind: DiagKind, ok: boolean, detail: string): Promise<void> {
  const cur = parseLog(await load(KEYS.diagnostics));
  const next = record(cur, { date: Math.floor(Date.now() / 1000), source, kind, ok, detail });
  await save(KEYS.diagnostics, JSON.stringify(next));
}

/** Warnings first (they're urgent), then the forecast and a re-plan. Never throws. */
export async function refreshAndReplan(source: DiagSource, locationId?: string): Promise<void> {
  try {
    const settings = parseAlertSettings(await load(KEYS.alerts));
    const loc = getLocation(locationId ?? (await load(KEYS.location)) ?? undefined);
    const nowSec = Math.floor(Date.now() / 1000);

    const w = await fetchWarningsFull(loc.id);
    if (!w) {
      await log(source, "warnings", false, "Could not check");
    } else {
      await log(source, "warnings", true, describeWarnings(w.warnings.map((x) => x.headline), w.complete));
      if (settings.warningsEnabled && Platform.OS !== "web") {
        const r = decide({
          warnings: w.warnings, complete: w.complete, memory: parseMemory(await load(KEYS.warningMemory)),
          locationID: loc.id, place: loc.name, nowSec, tz: loc.timezone, liftedEnabled: settings.warningLiftedEnabled,
        });
        await save(KEYS.warningMemory, JSON.stringify(r.memory));
        for (const n of r.notices) {
          await notifyNow(n);
          await log(source, "notification", true, n.title);
        }
      }
    }

    if (Platform.OS === "web") return;
    const f = await fetchWeather(loc);
    if (f.source !== "worker") { await log(source, "forecast", false, f.error); return; }
    await log(source, "forecast", true, `${f.data.hourly.length} hours for ${loc.name}`);
    const plan = anyEnabled(settings) ? planAlerts(f.data.hourly, settings, loc.name, loc.timezone, nowSec) : [];
    const n = await replaceAll(plan, nowSec);
    await log(source, "schedule", true, `${n} alert${n === 1 ? "" : "s"} scheduled`);
  } catch (e) {
    await log(source, "schedule", false, describeError(e));
  }
}
