/**
 * One column per day, its width that day's share of the forecast hours, so the
 * strip maps proportionally onto the whole chart. A frame tracks the part the
 * chart is scrolled to; tap a day to jump there, or drag along the strip to browse.
 */
import React, { useMemo, useRef, useState } from "react";
import { PanResponder, Pressable, StyleSheet, View, type LayoutChangeEvent } from "react-native";
import type { WeekStripDay } from "../core/weekStrip";
import { useSettings } from "../settings";
import { Txt } from "./kit";

export function WeekStrip({ days, frame, onSelectHour, onBrowse }: {
  days: WeekStripDay[];
  /** The visible part of the series, fractions 0–1. */
  frame: [number, number];
  onSelectHour: (hourIndex: number) => void;
  /** Dragging: the fraction 0–1 along the strip under the finger. */
  onBrowse: (fraction: number) => void;
}) {
  const { tokens } = useSettings();
  const [width, setWidth] = useState(0);
  const widthRef = useRef(0);
  widthRef.current = width;
  const browse = useRef(onBrowse);
  browse.current = onBrowse;

  // A press without a drag stays a tap on a day; a horizontal drag of 8 px or more browses.
  const pan = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy),
    onPanResponderGrant: (e) => { if (widthRef.current) browse.current(e.nativeEvent.locationX / widthRef.current); },
    onPanResponderMove: (e) => { if (widthRef.current) browse.current(e.nativeEvent.locationX / widthRef.current); },
  }), []);

  if (!days.length) return null;
  const [a, b] = frame;
  const fw = Math.max(8, (b - a) * width);
  const fl = Math.min(a * width, Math.max(0, width - fw));

  return (
    <View style={[styles.strip, { backgroundColor: tokens.stat, borderColor: tokens.cardBorder }]}
      onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)} {...pan.panHandlers}
      accessibilityLabel="Forecast days: choose one to show it on the chart">
      {days.map((d) => {
        const narrow = width > 0 && (d.hours / 120) * width < 40;   // a sliver of a day keeps just its initial
        return (
          <Pressable key={d.start} style={[styles.day, { flexGrow: d.hours }]} onPress={() => onSelectHour(d.start)}
            accessibilityRole="button" accessibilityLabel={d.a11y}>
            <Txt tone="muted" style={styles.label} numberOfLines={1}>{narrow ? d.label.charAt(0) : d.label}</Txt>
            <Txt style={styles.glyph}>{d.glyph}</Txt>
            <Txt tone="strong" style={styles.hi}>{d.hi}</Txt>
            <View style={styles.barTrack}>
              <View style={[styles.bar, { top: `${d.barTop}%`, height: `${d.barHeight}%`, backgroundColor: tokens.warm }]} />
            </View>
            <Txt tone="muted" style={styles.lo}>{d.lo}</Txt>
            {!narrow && <Txt tone="fade" style={styles.sun}>☀︎{d.sun}</Txt>}
          </Pressable>
        );
      })}
      {width > 0 && (
        <View pointerEvents="none" style={[styles.frame, { left: fl, width: fw, borderColor: tokens.frame }]} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  strip: { flexDirection: "row", borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden", position: "relative" },
  day: { flexBasis: 0, alignItems: "center", gap: 2, paddingVertical: 6, minWidth: 0 },
  label: { fontSize: 11 },
  glyph: { fontSize: 18 },
  hi: { fontSize: 13, fontWeight: "700" },
  lo: { fontSize: 12 },
  sun: { fontSize: 10 },
  barTrack: { width: 4, height: 28, borderRadius: 2, backgroundColor: "rgba(128,128,128,0.15)", overflow: "hidden" },
  bar: { position: "absolute", left: 0, right: 0, borderRadius: 2, minHeight: 2 },
  frame: { position: "absolute", top: 0, bottom: 0, borderWidth: 2, borderRadius: 10 },
});
