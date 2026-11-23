import Feather from "@expo/vector-icons/Feather";
import React, { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import { getNextTides, tideHeight } from "../core/tides";
import type { Location } from "../core/types";
import { useSettings } from "../settings";
import { Card, Txt } from "./kit";

/** Next four highs/lows and the level now. (The mini curve arrives with the Skia work.) */
export function TidesCard({ location, nowMs }: { location: Location; nowMs: number }) {
  const { tokens } = useSettings();
  const port = location.tidePort;
  // Recomputed once a minute is plenty; the memo key rounds `now` to the minute.
  const minute = Math.floor(nowMs / 60_000);
  const view = useMemo(() => {
    if (!port) return null;
    const ms = minute * 60_000;
    const now = tideHeight(port, ms);
    const soon = tideHeight(port, ms + 10 * 60_000);
    return {
      events: getNextTides(port, 4, ms),
      now,
      rising: now != null && soon != null ? soon > now : null,
    };
  }, [port, minute]);

  if (!port || !view) return null;   // inland: no tides panel

  const fmt = (d: Date) =>
    d.toLocaleTimeString("en-NZ", { timeZone: location.timezone, hour: "numeric", minute: "2-digit", hour12: true });

  return (
    <Card style={styles.card} accessibilityLabel="Tides">
      <View style={styles.head}>
        <View style={styles.title}>
          <Feather name="anchor" size={18} color={tokens.cyan} />
          <Txt tone="strong" style={styles.titleText}>{location.tideLabel}</Txt>
        </View>
        {view.now != null && (
          <View style={styles.now}>
            <Txt tone="muted" style={styles.nowLabel}>Now</Txt>
            <Txt tone="strong" style={styles.nowValue}>{view.now.toFixed(1)} m</Txt>
            {view.rising != null && (
              <Txt style={{ color: view.rising ? tokens.blue : tokens.warm, fontSize: 13 }}>
                {view.rising ? "↑ Rising" : "↓ Falling"}
              </Txt>
            )}
          </View>
        )}
      </View>
      <View style={styles.list}>
        {view.events.length === 0 && <Txt tone="muted">No tide data available</Txt>}
        {view.events.map((ev) => {
          const high = ev.type === "high";
          return (
            <View key={ev.time.getTime()} style={[styles.event, { backgroundColor: tokens.stat, borderColor: tokens.cardBorder }]}
              accessible accessibilityLabel={`${high ? "High" : "Low"} tide at ${fmt(ev.time)}, ${ev.height.toFixed(1)} metres`}>
              <Txt style={styles.emoji}>{high ? "🌊" : "🏖️"}</Txt>
              <View style={styles.flex}>
                <Txt tone="strong" style={styles.type}>{high ? "High Tide" : "Low Tide"}</Txt>
                <Txt tone="muted" style={styles.time}>{fmt(ev.time)}</Txt>
              </View>
              <Txt tone="strong" style={styles.height}>{ev.height.toFixed(1)} m</Txt>
            </View>
          );
        })}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: 12 },
  flex: { flex: 1 },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 },
  title: { flexDirection: "row", alignItems: "center", gap: 8 },
  titleText: { fontSize: 15, fontWeight: "600" },
  now: { flexDirection: "row", alignItems: "baseline", gap: 8 },
  nowLabel: { fontSize: 12 },
  nowValue: { fontSize: 18, fontWeight: "600" },
  list: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  event: {
    flexGrow: 1, flexBasis: "45%", minWidth: 150, flexDirection: "row", alignItems: "center", gap: 10,
    padding: 10, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth,
  },
  emoji: { fontSize: 22 },
  type: { fontSize: 14, fontWeight: "600" },
  time: { fontSize: 13 },
  height: { fontSize: 15, fontWeight: "600" },
});
