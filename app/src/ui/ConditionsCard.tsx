import Feather from "@expo/vector-icons/Feather";
import React, { useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import {
  currentCloud, degToCard, fmtHourOnly, fmtShortTime, hourlyStrip, iconFor, isDaytime, MOON_EMOJI,
  observedLabel, pressureTrend, todayAggregates, todayHighLow, uvInfo, uvLabel,
} from "../core/display";
import type { WeatherPayload } from "../core/payload";
import { useSettings } from "../settings";
import { Card, Txt } from "./kit";

type FeatherName = React.ComponentProps<typeof Feather>["name"];

/** Grid width at which all eight stats fit in one row (about 100px each plus gaps). */
const ONE_ROW_MIN = 820;

function Stat({ icon, value, label, oneRow }: { icon: FeatherName; value: string; label: string; oneRow?: boolean }) {
  const { tokens } = useSettings();
  return (
    <View style={[styles.stat, oneRow && styles.statOneRow, { backgroundColor: tokens.stat, borderColor: tokens.cardBorder }]}
      accessible accessibilityLabel={`${label}: ${value}`}>
      <Feather name={icon} size={16} color={tokens.textMuted} />
      <Txt tone="strong" style={styles.statValue}>{value}</Txt>
      <Txt tone="muted" style={styles.statLabel} numberOfLines={2}>{label}</Txt>
    </View>
  );
}

export function ConditionsCard({ data, tz, nowMs }: { data: WeatherPayload; tz: string; nowMs: number }) {
  const { tokens } = useSettings();
  const c = data.current ?? {};
  const hourly = data.hourly ?? [];
  const nowSec = nowMs / 1000;

  const hl = todayHighLow(hourly, data.daily ?? [], tz, nowSec);
  const agg = todayAggregates(hourly, tz, nowSec);
  const trend = pressureTrend(hourly, nowSec);
  const uv = uvInfo(hourly, tz, nowSec);
  const cloud = currentCloud(hourly, nowSec);
  const gust = c.windGust ?? agg.peakGust;
  const observed = observedLabel(c.observedUtc, data.meta?.sourceStatus?.currentSource, tz, nowMs);
  const deg = (v: number | null | undefined) => (v != null ? `${Math.round(v)}°` : "—°");
  // Wide enough for all eight stats side by side? Otherwise they wrap as before.
  const [gridW, setGridW] = useState(0);
  const oneRow = gridW >= ONE_ROW_MIN;

  return (
    <Card style={styles.card} accessibilityLabel="Current conditions">
      {/* Row 1: temperature + today's high/low */}
      <View style={styles.top}>
        <View style={styles.main}>
          <Txt style={styles.icon} accessibilityElementsHidden importantForAccessibility="no">
            {iconFor(c.iconCode, isDaytime(c, nowSec) ? "D" : "N")}
          </Txt>
          <Txt tone="strong" style={styles.temp}>{deg(c.temp)}</Txt>
          <View style={styles.flex}>
            <Txt tone="strong" style={styles.condition}>{c.condition || c.cloudPhrase || "—"}</Txt>
            {c.feelsLike != null && <Txt tone="muted" style={styles.sub}>Feels like {Math.round(c.feelsLike)}°</Txt>}
            {observed && <Txt tone="fade" style={styles.observed}>{observed}</Txt>}
          </View>
        </View>
        {(hl || c.tempMax24h != null) && (
          <View style={styles.hl}>
            <View style={styles.hlItem}>
              <Feather name="arrow-up" size={14} color={tokens.warm} />
              <Txt tone="strong" style={styles.hlTemp}>{deg(hl?.high.temp ?? c.tempMax24h)}</Txt>
              {hl?.high.utcSec ? <Txt tone="muted" style={styles.hlTime}>{fmtHourOnly(hl.high.utcSec, tz)}</Txt> : null}
            </View>
            <View style={styles.hlItem}>
              <Feather name="arrow-down" size={14} color={tokens.cyan} />
              <Txt tone="strong" style={styles.hlTemp}>{deg(hl?.low.temp ?? c.tempMin24h)}</Txt>
              {hl?.low.utcSec ? <Txt tone="muted" style={styles.hlTime}>{fmtHourOnly(hl.low.utcSec, tz)}</Txt> : null}
            </View>
          </View>
        )}
      </View>

      {/* Hourly strip */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
        {hourlyStrip(hourly, tz, nowSec, 10).map((h, i) => (
          <View key={i} style={[styles.hour, h.now && { backgroundColor: tokens.stat, borderColor: tokens.cardBorder }]}
            accessible accessibilityLabel={`${h.time}, ${h.temp}${h.precip ? `, ${h.precip} chance of rain` : ""}`}>
            <Txt tone={h.now ? "strong" : "muted"} style={styles.hourTime}>{h.time}</Txt>
            <Txt style={styles.hourIcon}>{h.icon}</Txt>
            <Txt tone="strong" style={styles.hourTemp}>{h.temp}</Txt>
            <Txt style={[styles.hourPrecip, { color: h.precip ? tokens.blue : tokens.textFade }]}>{h.precip ?? "·"}</Txt>
          </View>
        ))}
      </ScrollView>

      {/* Row 2: stats */}
      <View style={styles.grid} onLayout={(e) => setGridW(e.nativeEvent.layout.width)}>
        <Stat oneRow={oneRow} icon="droplet" value={c.humidity != null ? `${c.humidity}%` : "—"} label="Humidity" />
        <Stat oneRow={oneRow} icon="wind" value={c.windSpeed != null ? `${c.windSpeed} km/h` : "—"}
          label={c.windCardinal || (c.windDirection != null ? degToCard(c.windDirection) : "Wind")} />
        <Stat oneRow={oneRow} icon="navigation" value={gust != null ? `${Math.round(gust)} km/h` : "—"} label="Gust" />
        <Stat oneRow={oneRow} icon="activity" value={c.pressure != null ? `${Math.round(c.pressure)} hPa` : "—"}
          label={trend === "rising" ? "↑ Rising" : trend === "falling" ? "↓ Falling" : trend === "steady" ? "→ Steady" : "Pressure"} />
        <Stat oneRow={oneRow} icon="thermometer" value={c.dewPoint != null ? `${Math.round(c.dewPoint)}°` : "—"} label="Dew Point" />
        <Stat oneRow={oneRow} icon="cloud" value={cloud != null ? `${cloud}%` : "—"} label="Cloud" />
        <Stat oneRow={oneRow} icon="cloud-rain" value={agg.rainMm != null ? `${agg.rainMm} mm` : "—"}
          label={agg.peakChance != null ? `Peak ${agg.peakChance}%` : "Rain today"} />
        <Stat oneRow={oneRow} icon="sun" value={c.uvIndex != null ? `Now ${uvLabel(c.uvIndex)}` : "—"}
          label={uv.peakUV != null ? `Peak ${uvLabel(uv.peakUV)}${uv.uvWindow ? ` · ${uv.uvWindow}` : ""}` : "UV"} />
      </View>

      {/* Row 3: astronomy */}
      <View style={[styles.astro, { borderTopColor: tokens.cardBorder }]}>
        <View style={styles.astroItem}>
          <Feather name="sunrise" size={20} color={tokens.warm} />
          <View>
            <Txt tone="muted" style={styles.astroLabel}>Sunrise</Txt>
            <Txt tone="strong" style={styles.astroValue}>{fmtShortTime(c.sunriseUtc, tz)}</Txt>
          </View>
        </View>
        <View style={styles.astroItem}>
          <Feather name="sunset" size={20} color={tokens.sunset} />
          <View>
            <Txt tone="muted" style={styles.astroLabel}>Sunset</Txt>
            <Txt tone="strong" style={styles.astroValue}>{fmtShortTime(c.sunsetUtc, tz)}</Txt>
          </View>
        </View>
        <View style={styles.astroItem}>
          <Txt style={styles.moon}>{MOON_EMOJI[data.today?.moonPhaseCode ?? ""] ?? "🌕"}</Txt>
          <View>
            <Txt tone="muted" style={styles.astroLabel}>Moon</Txt>
            <Txt tone="strong" style={styles.astroValue}>{data.today?.moonPhase ?? "—"}</Txt>
          </View>
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: 14 },
  flex: { flex: 1 },
  top: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 },
  main: { flexDirection: "row", alignItems: "center", gap: 10, flexShrink: 1 },
  icon: { fontSize: 44 },
  temp: { fontSize: 56, fontWeight: "300", letterSpacing: -2 },
  condition: { fontSize: 17, fontWeight: "600" },
  sub: { fontSize: 14 },
  observed: { fontSize: 12, marginTop: 2 },
  hl: { gap: 4 },
  hlItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  hlTemp: { fontSize: 18, fontWeight: "600" },
  hlTime: { fontSize: 12 },
  strip: { gap: 6 },
  hour: {
    alignItems: "center", gap: 2, minWidth: 54, paddingVertical: 8, paddingHorizontal: 6,
    borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: "transparent",
  },
  hourTime: { fontSize: 12 },
  hourIcon: { fontSize: 22 },
  hourTemp: { fontSize: 15, fontWeight: "600" },
  hourPrecip: { fontSize: 11 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  stat: {
    flexGrow: 1, flexBasis: "22%", minWidth: 120, gap: 3, padding: 10, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth,
  },
  statOneRow: { flexBasis: 0, minWidth: 0 },
  statValue: { fontSize: 16, fontWeight: "600" },
  statLabel: { fontSize: 12 },
  astro: { flexDirection: "row", justifyContent: "space-around", flexWrap: "wrap", gap: 12, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth },
  astroItem: { flexDirection: "row", alignItems: "center", gap: 8 },
  astroLabel: { fontSize: 12 },
  astroValue: { fontSize: 15, fontWeight: "600" },
  moon: { fontSize: 24 },
});
