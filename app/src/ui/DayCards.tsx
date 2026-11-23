import Feather from "@expo/vector-icons/Feather";
import React from "react";
import { StyleSheet, View } from "react-native";
import { fmtHourCompact, uvLabel } from "../core/display";
import { buildDayForecast, type DayForecast } from "../core/dayForecast";
import type { WeatherPayload } from "../core/payload";
import { useSettings } from "../settings";
import { Card, Txt } from "./kit";

const hm = (utc: number | null, tz: string) =>
  utc ? new Date(utc * 1000).toLocaleTimeString("en-NZ", { timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true }).replace(/ (am|pm)$/i, "$1") : "—";
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
        <View>
          <Txt style={styles.small}><Txt tone="muted">Hi </Txt><Txt style={{ color: tokens.blue }}>{fc.humidity.max.val != null ? `${fc.humidity.max.val}%` : "—"}</Txt><Txt tone="muted"> {h(fc.humidity.max.utcSec, tz)}</Txt></Txt>
          <Txt style={styles.small}><Txt tone="muted">Lo </Txt><Txt style={{ color: tokens.blue }}>{fc.humidity.min.val != null ? `${fc.humidity.min.val}%` : "—"}</Txt><Txt tone="muted"> {h(fc.humidity.min.utcSec, tz)}</Txt></Txt>
        </View>
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

/** Tomorrow and the three days after, side by side (two by two on a phone). */
export function DayCards({ data, tz, nowSec }: { data: WeatherPayload; tz: string; nowSec: number }) {
  return (
    <View style={styles.grid}>
      {[1, 2, 3, 4].map((i) => (
        <View key={i} style={styles.cell}>
          <DayCard fc={buildDayForecast(i, data.hourly ?? [], data.daily ?? [], tz, nowSec)} tz={tz} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  cell: { flexGrow: 1, flexBasis: "22%", minWidth: 150 },
  card: { gap: 8, flex: 1, padding: 14 },
  day: { fontSize: 16, fontWeight: "700" },
  date: { fontSize: 12 },
  tempRow: { flexDirection: "row", gap: 14, flexWrap: "wrap" },
  half: { flexDirection: "row", alignItems: "baseline", gap: 4 },
  tempVal: { fontSize: 22, fontWeight: "600" },
  small: { fontSize: 12 },
  value: { fontSize: 14, fontWeight: "600" },
  row: { flexDirection: "row", gap: 8, alignItems: "flex-start" },
  icon: { fontSize: 14, width: 20 },
  sep: { height: StyleSheet.hairlineWidth },
  sun: { flexDirection: "row", gap: 16 },
  sunItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  pressure: { flexDirection: "row", alignItems: "center", gap: 6 },
});
