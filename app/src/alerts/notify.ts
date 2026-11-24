// Thin wrapper over expo-notifications. Native only: on web every call is a no-op.
import { Platform } from "react-native";
import { ALERT_ID_PREFIX, type PlannedAlert } from "../core/alerts/planner";
import type { WarningNotice } from "../core/alerts/warningNotifications";

const supported = Platform.OS === "ios" || Platform.OS === "android";
const mod = () => import("expo-notifications");

/** Show banners while the app is open too. Call once at startup. */
export async function configureNotifications(): Promise<void> {
  if (!supported) return;
  const N = await mod();
  N.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
  });
}

export type Permission = "granted" | "denied" | "undetermined" | "unsupported";

export async function permissionStatus(): Promise<Permission> {
  if (!supported) return "unsupported";
  const p = await (await mod()).getPermissionsAsync();
  return p.granted ? "granted" : p.canAskAgain ? "undetermined" : "denied";
}

/** Asks on first need; true if notifications may be sent. */
export async function ensurePermission(): Promise<boolean> {
  if (!supported) return false;
  const N = await mod();
  const cur = await N.getPermissionsAsync();
  if (cur.granted) return true;
  if (!cur.canAskAgain) return false;
  return (await N.requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true } })).granted;
}

/** Replaces every pending weather alert with `alerts` (other notifications are left alone). Returns how many were scheduled. */
export async function replaceAll(alerts: PlannedAlert[], nowSec: number): Promise<number> {
  if (!supported) return 0;
  const N = await mod();
  const pending = await N.getAllScheduledNotificationsAsync();
  await Promise.all(pending.filter((p) => p.identifier.startsWith(ALERT_ID_PREFIX))
    .map((p) => N.cancelScheduledNotificationAsync(p.identifier)));
  if (!alerts.length || !(await ensurePermission())) return 0;
  let n = 0;
  for (const a of alerts) {
    const seconds = Math.ceil(a.fireSec - nowSec);
    if (seconds <= 1) continue;
    await N.scheduleNotificationAsync({
      identifier: a.id,
      content: { title: a.title, body: a.body, sound: true },
      trigger: { type: N.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds, repeats: false },
    });
    n++;
  }
  return n;
}

export async function notifyNow(notice: WarningNotice): Promise<void> {
  if (!supported || !(await ensurePermission())) return;
  const N = await mod();
  await N.scheduleNotificationAsync({
    identifier: notice.id,
    content: { title: notice.title, body: notice.body, sound: true },
    trigger: null,
  });
}
