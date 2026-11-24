import Feather from "@expo/vector-icons/Feather";
import React, { useState } from "react";
import { StyleSheet, View } from "react-native";
import { fmtHourCompact, uvLabel } from "../core/display";
import { clock } from "../core/insights";
import { buildDayForecast, type DayForecast } from "../core/dayForecast";
import type { WeatherPayload } from "../core/payload";
import { useSettings } from "../settings";
import { Card, Txt } from "./kit";

const hm = (utc: number | null, tz: string) =>
  utc ? clock(utc, tz) : "—";
const h = (utc: number | null, tz: string) => (utc ? fmtHourCompact(utc, tz) : "—");

function Sep() {
  const { tokens } = useSettings();
  return <View style={[styles.sep, { backgroundColor: tokens.cardBorder }]} />;
}

function DayCard({ fc, tz }: { fc: DayForecast | null; tz: string }) {
  const { tokens } = useSettings();
  if (!fc) return <Card style={styles.card}><Txt tone="muted">—</Txt></Card>;

  const deg = (v: number | null) => (v != null ? `${Math.round(v)}°` : "—");
  const wind = fc.wind.speed != null ? `${fc.wind.speed} km/h ${fc.wind.cardinal ?? ""}`.trim() : "—";
  const precip = fc.precip.totalMm != null && fc.precip.maxChance != null
    ? `${fc.precip.totalMm} mm · ${fc.precip.maxChance}%` : "—";
  const hPa = (v: number | null) => (v != null ? `${Math.round(v)} hPa` : "—");

  return (
    <Card style={styles.card} accessibilityLabel={`${fc.label} ${fc.date} forecast`}>
      <View>
        <Txt tone="strong" style={styles.day} accessibilityRole="header">{fc.label}</Txt>
        <Txt tone="muted" style={styles.date}>{fc.date}</Txt>
      </View>

      <View style={styles.tempRow}>
        <View style={styles.half}>
          <Feather name="arrow-up" size={13} color={tokens.warm} />
          <Txt style={[styles.tempVal, { color: tokens.warm }]}>{deg(fc.temp.max.val)}</Txt>
          <Txt tone="muted" style={styles.small}>{h(fc.temp.max.utcSec, tz)}</Txt>
        </View>
        <View style={styles.half}>
          <Feather name="arrow-down" size={13} color={tokens.cyan} />
          <Txt style={[styles.tempVal, { color: tokens.cyan }]}>{deg(fc.temp.min.val)}</Txt>
          <Txt tone="muted" style={styles.small}>{h(fc.temp.min.utcSec, tz)}</Txt>
        </View>
      </View>

      <View style={styles.row}>
        <Txt style={styles.icon}>💧</Txt>
        {/* One line on any width: shrinks the text a little on a narrow phone card rather than wrapping. */}
        <Txt style={[styles.small, styles.grow]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}
          accessibilityLabel={`Humidity high ${fc.humidity.max.val ?? "unknown"} percent, low ${fc.humidity.min.val ?? "unknown"} percent`}>
          <Txt tone="muted">↑</Txt><Txt style={{ color: tokens.blue }}>{fc.humidity.max.val != null ? `${fc.humidity.max.val}%` : "—"}</Txt><Txt tone="muted"> {h(fc.humidity.max.utcSec, tz)}  ↓</Txt><Txt style={{ color: tokens.blue }}>{fc.humidity.min.val != null ? `${fc.humidity.min.val}%` : "—"}</Txt><Txt tone="muted"> {h(fc.humidity.min.utcSec, tz)}</Txt>
        </Txt>
      </View>

      <Sep />
      <View style={styles.sun}>
        <View style={styles.sunItem}><Feather name="sunrise" size={14} color={tokens.warm} /><Txt tone="strong" style={styles.small}>{hm(fc.sunrise, tz)}</Txt></View>
        <View style={styles.sunItem}><Feather name="sunset" size={14} color={tokens.sunset} /><Txt tone="strong" style={styles.small}>{hm(fc.sunset, tz)}</Txt></View>
      </View>
      <Sep />

      <View style={styles.row}>
        <Txt style={styles.icon}>💨</Txt>
        <View>
          <Txt style={[styles.value, { color: tokens.red }]}>{wind}</Txt>
          {fc.wind.speed != null && <Txt tone="muted" style={styles.small}>at {h(fc.wind.utcSec, tz)}</Txt>}
        </View>
      </View>
      <View style={styles.row}>
        <Txt style={styles.icon}>🌧</Txt>
        <Txt style={[styles.value, { color: tokens.blue }]}>{precip}</Txt>
      </View>
      <View style={styles.row}>
        <Txt style={styles.icon}>☀️</Txt>
        <View>
          <Txt style={[styles.value, { color: "#a050d0" }]}>UV {fc.uv.peak != null ? uvLabel(fc.uv.peak) : "—"}</Txt>
          <Txt tone="muted" style={styles.small}>{fc.uv.window ?? "Below 3"}</Txt>
        </View>
      </View>

      <Sep />
      <View style={styles.pressure}>
        <Feather name="arrow-up" size={12} color={tokens.textMuted} />
        <Txt tone="strong" style={styles.small}>{hPa(fc.pressure.max.val)}</Txt>
        <Txt tone="muted" style={styles.small}>{h(fc.pressure.max.utcSec, tz)}</Txt>
      </View>
      <View style={styles.pressure}>
        <Feather name="arrow-down" size={12} color={tokens.textMuted} />
        <Txt tone="strong" style={styles.small}>{hPa(fc.pressure.min.val)}</Txt>
        <Txt tone="muted" style={styles.small}>{h(fc.pressure.min.utcSec, tz)}</Txt>
      </View>
    </Card>
  );
}

/** Tomorrow and the three days after: four across when there's room, otherwise two by two. */
export function DayCards({ data, tz, nowSec }: { data: WeatherPayload; tz: string; nowSec: number }) {
  // Explicit cell widths: a percentage flexBasis in a wrapping row made iOS (Yoga) measure the cards at
  // the narrow basis width, so their text wrapped into very tall cards and pushed the second row off.
  const [w, setW] = useState(0);
  const cols = w >= 4 * MIN_CELL + 3 * GAP ? 4 : 2;
  const cellW = w > 0 ? Math.floor((w - GAP * (cols - 1)) / cols) : undefined;
  return (
    <View style={styles.grid} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      {[1, 2, 3, 4].map((i) => (
        <View key={i} style={[styles.cell, cellW != null && { width: cellW }]}>
          <DayCard fc={buildDayForecast(i, data.hourly ?? [], data.daily ?? [], tz, nowSec)} tz={tz} />
        </View>
      ))}
    </View>
  );
}

const MIN_CELL = 150;
const GAP = 12;

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: GAP },
  cell: { width: "47%" },
  card: { gap: 8, flexGrow: 1, padding: 14 },
  day: { fontSize: 16, fontWeight: "700" },
  date: { fontSize: 12 },
  tempRow: { flexDirection: "row", gap: 14, flexWrap: "wrap" },
  half: { flexDirection: "row", alignItems: "baseline", gap: 4 },
  tempVal: { fontSize: 22, fontWeight: "600" },
  small: { fontSize: 12 },
  value: { fontSize: 14, fontWeight: "600" },
  row: { flexDirection: "row", gap: 8, alignItems: "flex-start" },
  icon: { fontSize: 14, width: 20 },
  grow: { flex: 1 },
  sep: { height: StyleSheet.hairlineWidth },
  sun: { flexDirection: "row", gap: 16 },
  sunItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  pressure: { flexDirection: "row", alignItems: "center", gap: 6 },
});
