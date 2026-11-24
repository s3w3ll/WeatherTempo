import Feather from "@expo/vector-icons/Feather";
import React, { useMemo, useState } from "react";
import { Platform, Pressable, StyleSheet, View, type LayoutChangeEvent } from "react-native";
import { SkiaGate } from "../chart/SkiaGate";
import type { TideMiniProps } from "../chart/TideMiniInner";
import { buildTideModel, TIDE_HIGH_COLOR, TIDE_LOW_COLOR } from "../chart/tideModel";
import { DARK_PALETTE, LIGHT_PALETTE } from "../chart/palette";
import { getNextTides, tideHeight } from "../core/tides";
import type { Location } from "../core/types";
import { useSettings } from "../settings";
import { Card, Txt } from "./kit";

const CHART_H = 200;
const TIP_W = 170;

/** Tide curve for today and tomorrow, the level now, and the next four highs/lows. */
export function TidesCard({ location, nowMs }: { location: Location; nowMs: number }) {
  const { tokens } = useSettings();
  const port = location.tidePort;
  const [width, setWidth] = useState(0);
  const [hoverX, setHoverX] = useState<number | null>(null);
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

  const model = useMemo(
    () => (port && width > 0 ? buildTideModel(port, location.timezone, minute * 60_000, width, CHART_H, location.lat, location.lon) : null),
    [port, location.timezone, location.lat, location.lon, minute, width],
  );
  const P = tokens.scheme === "dark" ? DARK_PALETTE : LIGHT_PALETTE;
  const sky = { day: P.bgDay, twilight: P.bgTwilight, night: P.bgNight };

  if (!port || !view) return null;   // inland: no tides panel

  const fmt = (d: Date) =>
    d.toLocaleTimeString("en-NZ", { timeZone: location.timezone, hour: "numeric", minute: "2-digit", hour12: true });

  const hover = model && hoverX != null ? model.hover(hoverX) : null;
  let cursorY: number | null = null;
  if (hover && model) {
    const i = Math.round(((hover.timeMs - model.startMs) / model.spanMs) * (model.pts.length - 1));
    cursorY = model.pts[Math.max(0, Math.min(model.pts.length - 1, i))].y;
  }
  const tipLeft = hoverX != null && width ? Math.min(Math.max(0, hoverX + 8), Math.max(0, width - TIP_W)) : 0;
  const webHover = Platform.OS === "web"
    ? {
        onPointerMove: (e: any) => setHoverX(e.nativeEvent.offsetX ?? e.nativeEvent.locationX ?? 0),
        onPointerLeave: () => setHoverX(null),
      }
    : {};

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

      <View onLayout={(e: LayoutChangeEvent) => setWidth(Math.round(e.nativeEvent.layout.width))}
        style={[styles.chart, { backgroundColor: tokens.tideCanvas }]}>
        {model && (
          <Pressable
            onPress={(e) => {
              const x = e.nativeEvent.locationX;
              setHoverX((cur) => (cur != null && Math.abs(cur - x) < 6 ? null : x));   // tap the same spot to dismiss
            }}
            accessibilityLabel="Tide curve. Tap a time for the water level."
            {...(webHover as object)}
          >
            <SkiaGate<TideMiniProps>
              web={() => import("../chart/TideMiniInner")}
              // eslint-disable-next-line @typescript-eslint/no-require-imports
              native={() => require("../chart/TideMiniInner").default}
              height={CHART_H}
              props={{
                model, curve: tokens.tideCurve, fillA: tokens.tideFillA, fillB: tokens.tideFillB, fillC: tokens.tideFillC,
                bg: tokens.tideCanvas,
                skyColors: sky, cursorX: hover ? hoverX : null, cursorY,
              }}
            />
          </Pressable>
        )}
        {hover && (
          <View pointerEvents="none"
            style={[styles.tip, { left: tipLeft, width: TIP_W, backgroundColor: tokens.selectBg, borderColor: tokens.cardBorder }]}>
            <Txt tone="strong" style={styles.tipTime}>
              {new Date(hover.timeMs).toLocaleDateString("en-NZ", { timeZone: location.timezone, weekday: "short", day: "numeric", month: "short" })}
              {" "}{fmt(new Date(hover.timeMs))}
              {hover.near
                ? <Txt style={{ color: hover.near === "high" ? TIDE_HIGH_COLOR : TIDE_LOW_COLOR }}>{` · ${hover.near === "high" ? "High" : "Low"}`}</Txt>
                : null}
            </Txt>
            <View style={styles.tipRow}>
              <Txt tone="muted" style={styles.tipLabel}>Height</Txt>
              <Txt tone="strong" style={styles.tipVal}>{hover.height} m</Txt>
            </View>
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
  chart: { height: CHART_H, borderRadius: 12, overflow: "hidden", position: "relative" },
  tip: {
    position: "absolute", top: 6, borderWidth: StyleSheet.hairlineWidth, borderRadius: 8, padding: 8, gap: 2,
    shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 3 },
  },
  tipTime: { fontSize: 12, fontWeight: "700" },
  tipRow: { flexDirection: "row", justifyContent: "space-between" },
  tipLabel: { fontSize: 12 },
  tipVal: { fontSize: 12, fontWeight: "600" },
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
