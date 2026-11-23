import React from "react";
import { StyleSheet, View } from "react-native";
import { useSettings } from "../settings";
import { Txt } from "./kit";

export type BannerLevel = "loading" | "warning" | "error";

/** Wording for the data-source state; null when everything is fine. */
export function bannerFor(
  loading: boolean, source: "worker" | "sample-data" | null, pws: string | undefined,
): { level: BannerLevel; text: string } | null {
  if (loading) return { level: "loading", text: "Fetching weather data…" };
  if (source === "sample-data") return { level: "error", text: "⚠️ All data sources failed — showing synthetic sample data" };
  // pws is a reason string (ok / no-observation / stale / http-4xx / bad-json / unreachable / n/a).
  // Only "a station exists but didn't supply the reading" is worth a banner.
  if (source === "worker" && pws && pws !== "ok" && pws !== "n/a") {
    return { level: "warning", text: "Live station unavailable — current conditions from forecast model" };
  }
  return null;
}

export function StatusBanner({ level, text }: { level: BannerLevel; text: string }) {
  const { tokens } = useSettings();
  const color = level === "error" ? tokens.red : level === "warning" ? tokens.warnOrange : tokens.blue;
  return (
    <View style={[styles.box, { borderColor: color, backgroundColor: tokens.stat }]} accessibilityLiveRegion="polite">
      <Txt style={[styles.text, { color }]}>{text}</Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderWidth: 1, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12 },
  text: { fontSize: 13, fontWeight: "500" },
});
