import Feather from "@expo/vector-icons/Feather";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, View, type LayoutChangeEvent } from "react-native";
import { SkiaGate } from "../chart/SkiaGate";
import type { TideMiniProps } from "../chart/TideMiniInner";
import { buildTideModel, cardEvents, layoutTideCards, tideScrollForNow, TIDE_HIGH_COLOR, TIDE_LOW_COLOR } from "../chart/tideModel";
import type { HourlyHour } from "../core/payload";
import { clock } from "../core/insights";
import { KEYS, load, save } from "../data/storage";
import { DARK_PALETTE, LIGHT_PALETTE } from "../chart/palette";
import { getNextTides, tideHeight } from "../core/tides";
import type { Location } from "../core/types";
import { useSettings } from "../settings";
import { Card, Txt } from "./kit";

const CHART_H = 200;
const TIP_W = 170;
const CARD_H = 62;   // height of a tide card
const ZOOMS = [1, 2, 3, 4, 5] as const;
const LEAD = 8;      // length of the line from the curve point down to its card

/** Tide curve for today and tomorrow, the level now, and the next four highs/lows. */
export function TidesCard({ location, nowMs, hourly }: { location: Location; nowMs: number; hourly: HourlyHour[] }) {
  const { tokens } = useSettings();
  const port = location.tidePort;
  const [width, setWidth] = useState(0);
  const [hoverX, setHoverX] = useState<number | null>(null);
  const [days, setDays] = useState<number>(3);
  const scroller = useRef<any>(null);
  useEffect(() => {
    load(KEYS.tideDays).then((v) => { const n = Number(v); if (ZOOMS.includes(n as 1)) setDays(n); });
  }, []);
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

  // Same first hour, hour count and zoom as the weather chart, so the x-axes line up.
  const t0 = hourly[0]?.validTimeUtc;
  const model = useMemo(
    () => (port && width > 0 && t0 ? buildTideModel(port, minute * 60_000, {
      t0Sec: t0, hours: hourly.length, days, viewportWidth: width, H: CHART_H, lat: location.lat, lon: location.lon,
      hourTimes: hourly.map((h) => h.validTimeUtc), tz: location.timezone,
    }) : null),
    [port, hourly, days, width, location.lat, location.lon, location.timezone, minute],
  );
  // Opening, zoom or location change: put "now" about 30% in.
  useEffect(() => {
    if (!model || !width) return;
    scroller.current?.scrollTo({ x: tideScrollForNow(model, minute * 60_000, width), animated: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days, width, port, !!model]);
  const P = tokens.scheme === "dark" ? DARK_PALETTE : LIGHT_PALETTE;
  const sky = { day: P.bgDay, twilight: P.bgTwilight, night: P.bgNight };

  if (!port || !view) return null;   // inland: no tides panel

  const fmt = (d: Date) => clock(d.getTime() / 1000, location.timezone);

  const hover = model && hoverX != null ? model.hover(hoverX) : null;
  let cursorY: number | null = null;
  if (hover && model) {
    const i = Math.round(((hover.timeMs - model.startMs) / (model.endMs - model.startMs)) * (model.pts.length - 1));
    cursorY = model.pts[Math.max(0, Math.min(model.pts.length - 1, i))].y;
  }
  const tipLeft = hoverX != null && model ? Math.min(Math.max(0, hoverX + 8), Math.max(0, model.W - TIP_W)) : 0;
  const pickZoom = (n: number) => { setDays(n); setHoverX(null); save(KEYS.tideDays, String(n)); };
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

      {/* One scrolling strip: the curve, then each upcoming high/low under its own point, so it reads
          left to right in time. Zoomed out, neighbouring cards are thinned so none overlap. */}
      <View onLayout={(e: LayoutChangeEvent) => setWidth(Math.round(e.nativeEvent.layout.width))}>
        {view.events.length === 0 && <Txt tone="muted">No tide data available</Txt>}
        {model && (() => {
          const gap = 6;
          const nowM = minute * 60_000;
          // Roomy: one row of full cards (highs and lows alternate). Tight (zoomed out): two rows of compact
          // cards, highs above lows, each as wide as the room between same-kind tides allows.
          const roomy = model.pph * 5 >= 100;
          const fmtC = fmt;
          type Card = { key: string; left: number; w: number; top: number; h: number; high: boolean; compact: boolean; time: string; height: string; a11y: string };
          const placed: Card[] = [];
          const leads: { key: string; x: number; h: number; high: boolean }[] = [];
          let rowsH: number;
          if (roomy) {
            const cardW = 92;
            const shown = cardEvents(model, nowM, cardW + gap);
            const lefts = layoutTideCards(shown.map((e) => e.x), model.W, cardW, gap);
            shown.forEach((ev, i) => {
              const high = ev.type === "high";
              placed.push({
                key: String(ev.time.getTime()), left: lefts[i], w: cardW, top: LEAD, h: CARD_H, high, compact: false,
                time: fmt(ev.time), height: `${ev.height.toFixed(1)} m`,
                a11y: `${high ? "High" : "Low"} tide at ${fmt(ev.time)}, ${ev.height.toFixed(1)} metres`,
              });
              leads.push({ key: String(ev.time.getTime()), x: ev.x, h: LEAD, high });
            });
            rowsH = CARD_H + LEAD;
          } else {
            const cardW = Math.max(30, Math.min(64, Math.floor(model.pph * 12.2) - 3));
            const rowH = 36;
            (["high", "low"] as const).forEach((type, row) => {
              const shown = cardEvents(model, nowM, cardW + 2, type);
              const lefts = layoutTideCards(shown.map((e) => e.x), model.W, cardW, 2);
              const top = LEAD + row * (rowH + 4);
              shown.forEach((ev, i) => {
                placed.push({
                  key: String(ev.time.getTime()), left: lefts[i], w: cardW, top, h: rowH, high: type === "high", compact: true,
                  time: fmtC(ev.time), height: ev.height.toFixed(1),
                  a11y: `${type === "high" ? "High" : "Low"} tide at ${fmt(ev.time)}, ${ev.height.toFixed(1)} metres`,
                });
                leads.push({ key: String(ev.time.getTime()), x: ev.x, h: top, high: type === "high" });
              });
            });
            rowsH = LEAD + 2 * rowH + 4;
          }
          return (
            <ScrollView ref={scroller} horizontal showsHorizontalScrollIndicator={days < 5}>
              <View style={{ width: model.W }}>
                <View style={[styles.chart, { backgroundColor: tokens.tideCanvas }]}>
                  <Pressable
                    onPress={(e) => {
                      const n: any = e.nativeEvent;
                      const x = n.offsetX ?? n.locationX ?? 0;
                      // Touch: tap the same spot again to dismiss. Web: hover already selected it.
                      setHoverX((cur) => (Platform.OS !== "web" && cur != null && Math.abs(cur - x) < 6 ? null : x));
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
                        bg: tokens.tideCanvas, skyColors: sky, dayDiv: P.dayDiv, cursorX: hover ? hoverX : null, cursorY,
                      }}
                    />
                  </Pressable>
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

                {/* Day axis: a band of day names under the curve, as on the weather chart. */}
                <View style={[styles.dayAxis, { width: model.W, backgroundColor: P.dayAxisBg, borderTopColor: P.dayDiv }]}>
                  {model.dayCols.map((c) => (
                    <React.Fragment key={`dc${c.x0}`}>
                      <Txt numberOfLines={1} style={[styles.dayLabel, { left: c.x0, width: c.x1 - c.x0, color: P.text }]}>{c.label}</Txt>
                      {c.divider && <View style={[styles.dayTick, { left: c.x0, backgroundColor: P.dayDiv }]} />}
                    </React.Fragment>
                  ))}
                </View>

                <View style={{ width: model.W, height: rowsH }}>
                  {leads.map((l) => (
                    <View key={`ld${l.key}`} pointerEvents="none"
                      style={[styles.lead, { left: Math.round(l.x), height: l.h, backgroundColor: l.high ? TIDE_HIGH_COLOR : TIDE_LOW_COLOR }]} />
                  ))}
                  {placed.map((c) => (
                    <View key={c.key}
                      style={[styles.event, c.compact && styles.eventCompact, {
                        left: c.left, width: c.w, top: c.top, height: c.h, backgroundColor: tokens.stat,
                        borderColor: tokens.cardBorder, borderTopColor: c.high ? TIDE_HIGH_COLOR : TIDE_LOW_COLOR, borderTopWidth: c.compact ? 2 : StyleSheet.hairlineWidth,
                      }]}
                      accessible accessibilityLabel={c.a11y}>
                      {c.compact ? (
                        <>
                          <Txt tone="strong" style={styles.timeC} numberOfLines={1}>{c.time}</Txt>
                          <Txt tone="muted" style={styles.heightC} numberOfLines={1}>{c.height}</Txt>
                        </>
                      ) : (
                        <>
                          <Txt style={styles.type} numberOfLines={1}>{c.high ? "🌊 High" : "🏖️ Low"}</Txt>
                          <Txt tone="strong" style={styles.time} numberOfLines={1}>{c.time}</Txt>
                          <Txt tone="muted" style={styles.height}>{c.height}</Txt>
                        </>
                      )}
                    </View>
                  ))}
                </View>
              </View>
            </ScrollView>
          );
        })()}
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
  zoom: { flexDirection: "row", alignItems: "center", gap: 6 },
  zoomLabel: { fontSize: 12 },
  zoomBtn: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 8, paddingVertical: 4, paddingHorizontal: 9 },
  zoomText: { fontSize: 12 },
  bold: { fontWeight: "700" },
  tip: {
    position: "absolute", top: 6, borderWidth: StyleSheet.hairlineWidth, borderRadius: 8, padding: 8, gap: 2,
    shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 3 },
  },
  tipTime: { fontSize: 12, fontWeight: "700" },
  tipRow: { flexDirection: "row", justifyContent: "space-between" },
  tipLabel: { fontSize: 12 },
  tipVal: { fontSize: 12, fontWeight: "600" },
  dayAxis: { height: 16, borderTopWidth: StyleSheet.hairlineWidth, position: "relative" },
  dayLabel: { position: "absolute", top: 2, textAlign: "center", fontSize: 10, fontWeight: "700" },
  dayTick: { position: "absolute", top: 0, bottom: 0, width: 1 },
  eventCompact: { paddingHorizontal: 1, borderRadius: 6, gap: 0 },
  timeC: { fontSize: 10, fontWeight: "600" },
  heightC: { fontSize: 10 },
  lead: { position: "absolute", top: 0, width: 2, height: LEAD, marginLeft: -1, borderRadius: 1 },
  event: {
    position: "absolute", height: CARD_H, alignItems: "center", justifyContent: "center", gap: 1,
    paddingHorizontal: 4, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth,
  },
  type: { fontSize: 12, fontWeight: "600" },
  time: { fontSize: 13 },
  height: { fontSize: 12 },
});
