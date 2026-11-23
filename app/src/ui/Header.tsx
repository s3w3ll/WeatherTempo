import Feather from "@expo/vector-icons/Feather";
import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { fmtShortTime } from "../core/display";
import { useSettings } from "../settings";
import { Txt } from "./kit";

export function Header({ updatedUtc, tz, onSettings }: {
  /** Seconds, when the Worker built the payload. */
  updatedUtc: number | null; tz: string; onSettings: () => void;
}) {
  const { tokens, location } = useSettings();
  return (
    <View style={styles.row}>
      <View style={styles.loc}>
        <Feather name="map-pin" size={18} color={tokens.warm} />
        <Txt tone="strong" style={styles.name} accessibilityRole="header">
          {location.name}, {location.region}
        </Txt>
        <Pressable onPress={onSettings} accessibilityRole="button" accessibilityLabel="Select location"
          hitSlop={10} style={styles.btn}>
          <Feather name="settings" size={18} color={tokens.textMuted} />
        </Pressable>
      </View>
      <Txt tone="muted" style={styles.updated}>
        {updatedUtc ? `Updated ${fmtShortTime(updatedUtc, tz)}` : "—"}
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 },
  loc: { flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 1 },
  name: { fontSize: 18, fontWeight: "600", flexShrink: 1 },
  btn: { padding: 4 },
  updated: { fontSize: 13 },
});
