import React, { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, View, type LayoutChangeEvent } from "react-native";
import type { WarningItem, WeatherPayload } from "../core/payload";
import { Meteogram } from "../chart/Meteogram";
import { buildChartModel } from "../chart/model";
import { DARK_PALETTE, LIGHT_PALETTE } from "../chart/palette";
import { KEYS, load, save } from "../data/storage";
import { useSettings } from "../settings";
import type { Location } from "../core/types";
import { Card, Txt } from "./kit";

const ZOOMS = [1, 2, 3, 4, 5] as const;

const LEGEND: { label: string; key: "tempLine" | "feelsLine" | "dewLine" | "uvLine" | "freezingLine" | "windLine" | "gustLine" | "precipLine" | "pressLine" }[] = [
  { label: "Temperature", key: "tempLine" }, { label: "Feels like", key: "feelsLine" },
  { label: "Dew point", key: "dewLine" }, { label: "UV", key: "uvLine" }, { label: "0°", key: "freezingLine" },
  { label: "Wind", key: "windLine" }, { label: "Gusts", key: "gustLine" },
  { label: "Precipitation", key: "precipLine" }, { label: "Pressure", key: "pressLine" },
];

export function ChartSection({ data, location, warnings, nowMs }: {
  data: WeatherPayload; location: Location; warnings: WarningItem[]; nowMs: number;
}) {
  const { tokens } = useSettings();
  const [days, setDays] = useState<number>(3);
  const [width, setWidth] = useState(0);
  const leftTime = useRef<number | null>(null);   // moment at the left edge, kept across zoom changes
  const keepTime = useRef<number | null>(null);

  useEffect(() => {
    load(KEYS.chartDays).then((v) => { const n = Number(v); if (ZOOMS.includes(n as 1)) setDays(n); });
  }, []);

  const P = tokens.scheme === "dark" ? DARK_PALETTE : LIGHT_PALETTE;
  const hours = data.hourly;
  // `nowSec` is deliberately coarse (minute) so the model doesn't rebuild on every tick.
  const nowSec = Math.floor(nowMs / 60_000) * 60;
  const model = useMemo(() => buildChartModel({
    hours, days, viewportWidth: width || 900, lat: location.lat, lon: location.lon,
    warnings, tz: location.timezone, nowSec,
  }), [hours, days, width, location, warnings, nowSec]);

  const pickZoom = (n: number) => {
    keepTime.current = leftTime.current;
    setDays(n);
    save(KEYS.chartDays, String(n));
  };

  return (
    <Card style={styles.card} accessibilityLabel="Forecast chart section"
      onLayout={(e: LayoutChangeEvent) => setWidth(Math.round(e.nativeEvent.layout.width - 32))}>
      <View style={styles.head}>
        <Txt tone="strong" style={styles.title}>Forecast</Txt>
        <View style={styles.zoom} accessibilityRole="radiogroup">
          <Txt tone="muted" style={styles.zoomLabel}>Zoom:</Txt>
          {ZOOMS.map((n) => {
            const on = n === days;
            return (
              <Pressable key={n} onPress={() => pickZoom(n)} accessibilityRole="radio" accessibilityState={{ selected: on }}
                accessibilityLabel={`${n} day${n > 1 ? "s" : ""}`}
                style={[styles.zoomBtn, { borderColor: tokens.cardBorder, backgroundColor: on ? tokens.selectBgHi : tokens.selectBg }]}>
                <Txt tone={on ? "strong" : "muted"} style={[styles.zoomText, on && styles.bold]}>{n}d</Txt>
              </Pressable>
            );
          })}
        </View>
      </View>

      {width > 0 && (
        <Meteogram
          model={model} P={P} resetKey={location.id}
          keepTime={keepTime.current}
          onScrollTime={(t) => { leftTime.current = t; }}
          textColor={tokens.text} mutedColor={tokens.textMuted} cardColor={tokens.selectBg} borderColor={tokens.cardBorder}
        />
      )}

      <View style={styles.legend}>
        {LEGEND.map((l) => (
          <View key={l.label} style={styles.legendItem}>
            <View style={[styles.swatch, { backgroundColor: P[l.key] }]} />
            <Txt tone="muted" style={styles.legendText}>{l.label}</Txt>
          </View>
        ))}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: 10 },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 },
  title: { fontSize: 15, fontWeight: "600" },
  zoom: { flexDirection: "row", alignItems: "center", gap: 6 },
  zoomLabel: { fontSize: 12 },
  zoomBtn: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 8, paddingVertical: 4, paddingHorizontal: 9 },
  zoomText: { fontSize: 12 },
  bold: { fontWeight: "700" },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  swatch: { width: 16, height: 3, borderRadius: 2 },
  legendText: { fontSize: 11 },
});
