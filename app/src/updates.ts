// Over-the-air JavaScript updates (expo-updates, self-hosted on GitHub Pages; see scripts/update-manifest.mjs).
//
// At launch the native side checks for an update and downloads it in the background without making you
// wait (fallbackToCacheTimeout 0). Here we also check whenever the app comes back to the foreground and,
// once an update has downloaded, switch to it the next time the app is opened, when a quick reload
// is barely noticeable, rather than mid-use.
import * as Updates from "expo-updates";
import { useEffect, useRef } from "react";
import { AppState, Platform } from "react-native";

const CHECK_EVERY_MS = 30 * 60_000;

export const otaEnabled = Platform.OS !== "web" && Updates.isEnabled;

/** One line for Settings: which code the app is running. */
export function runningLabel(): string {
  if (!otaEnabled) return "Built-in code (updates off)";
  const when = Updates.createdAt
    ? Updates.createdAt.toLocaleString("en-NZ", { dateStyle: "medium", timeStyle: "short", hour12: false, timeZone: "Pacific/Auckland" })
    : "unknown";
  return `${Updates.isEmbeddedLaunch ? "Built-in" : "Update"} · runtime ${Updates.runtimeVersion ?? "?"} · ${when}`;
}

/** Check now, download if there is something new; resolves true when an update is ready to apply. */
export async function checkAndFetch(): Promise<boolean> {
  if (!otaEnabled) return false;
  const res = await Updates.checkForUpdateAsync();
  if (!res.isAvailable) return false;
  const fetched = await Updates.fetchUpdateAsync();
  return fetched.isNew;
}

export const applyNow = () => Updates.reloadAsync();

/** Mount once at the root. */
export function useOtaUpdates() {
  const pending = useRef(false);
  const lastCheck = useRef(0);
  useEffect(() => {
    if (!otaEnabled) return;
    const check = () => {
      lastCheck.current = Date.now();
      checkAndFetch().then((ready) => { if (ready) pending.current = true; }).catch(() => {});
    };
    check();   // also covers an update the native launch check found
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      if (pending.current) { applyNow().catch(() => {}); return; }
      if (Date.now() - lastCheck.current >= CHECK_EVERY_MS) check();
    });
    return () => sub.remove();
  }, []);
}
