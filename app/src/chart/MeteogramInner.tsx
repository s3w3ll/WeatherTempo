/**
 * Interactive meteogram: horizontal scroll, hover (web) / tap (iOS) cursor and
 * tooltip. This is the only module that imports Skia components, so on web it
 * is loaded lazily after CanvasKit (see Meteogram.tsx).
 */
import { Canvas, Circle, Line, LinearGradient, vec } from "@shopify/react-native-skia";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Platform, Pressable, ScrollView, StyleSheet, View, type LayoutChangeEvent, type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { Txt } from "../ui/kit";
import { MeteogramCanvas } from "./MeteogramCanvas";
import { type ChartModel, scrollForHour, scrollForNow, scrollForTime, timeAtScroll, tooltip } from "./model";
import { PressureStrip } from "./PressureStrip";
import { rgba, WARN_RGB, type Palette } from "./palette";

export interface MeteogramProps {
  model: ChartModel;
  P: Palette;
  /** Bump to scroll back to "now" (new location). */
  resetKey: string;
  onScrollTime?: (utcSec: number) => void;
  /** Scroll offset and viewport width, for the week strip's frame. */
  onScrollMetrics?: (scrollLeft: number, viewport: number) => void;
  /** Filled with imperative scrolling for the week strip. */
  controlRef?: React.MutableRefObject<MeteogramControl | null>;
  /** UTC time to keep at the left edge when the model changes (zoom). */
  keepTime: number | null;
  textColor: string;
  mutedColor: string;
  cardColor: string;
  borderColor: string;
}

export interface MeteogramControl {
  scrollToHour(i: number, animated: boolean): void;
}

const TIP_W = 220;
const clear = (c: string) => c.replace(/[\d.]+\)$/, "0)");

/** The cursor: a vertical line fading at both ends plus a dot on the temperature curve. */
function Cursor({ model, P, i }: { model: ChartModel; P: Palette; i: number }) {
  const x = model.hourX(i);
  const y = model.tempY(model.hours[i].temperature ?? 0);
  // Skia's web Canvas hands `style` straight to the DOM: a plain object, not a style array.
  return (
    <Canvas style={{ position: "absolute", top: 0, left: 0, width: model.W, height: model.H, pointerEvents: "none" }}>
      <Line p1={vec(x, 0)} p2={vec(x, model.H)} strokeWidth={1}>
        <LinearGradient start={vec(0, 0)} end={vec(0, model.H)}
          colors={[clear(P.hoverLine), P.hoverLine, P.hoverLine, clear(P.hoverLine)]} positions={[0, 0.08, 0.92, 1]} />
      </Line>
      <Circle cx={x} cy={y} r={4} color={P.tempLine} />
    </Canvas>
  );
}

export default function MeteogramInner(props: MeteogramProps) {
  const { model, P, resetKey, keepTime, onScrollTime, onScrollMetrics, controlRef } = props;
  const scroller = useRef<any>(null);   // RN 0.88's ScrollViewInstance type is awkward; we only call scrollTo
  const scrollX = useRef(0);
  const [viewport, setViewport] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  // Where the finger/pointer is vertically (canvas px) and how tall the tooltip is, so it can follow.
  const [pointerY, setPointerY] = useState(0);
  const [tipH, setTipH] = useState(0);

  // Opening, or a new location: put "now" about 30% in.
  useEffect(() => {
    if (!viewport) return;
    const x = scrollForNow(model, viewport);
    scroller.current?.scrollTo({ x, animated: false });
    scrollX.current = x;
    setSelected(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey, viewport > 0]);

  // Zoom changed: keep the same moment at the left edge.
  useEffect(() => {
    if (keepTime == null || !viewport) return;
    const x = Math.max(0, scrollForTime(model, keepTime));
    scroller.current?.scrollTo({ x, animated: false });
    scrollX.current = x;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model.pph]);

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollX.current = e.nativeEvent.contentOffset.x;
    onScrollTime?.(timeAtScroll(model, scrollX.current));
    onScrollMetrics?.(scrollX.current, e.nativeEvent.layoutMeasurement.width);
  }, [model, onScrollTime, onScrollMetrics]);

  // Let the week strip drive the scroll, and tell it where we are (also after zoom/resize).
  useEffect(() => {
    if (controlRef) {
      controlRef.current = {
        scrollToHour: (i, animated) => {
          const x = scrollForHour(model, i);
          scroller.current?.scrollTo({ x, animated });
          scrollX.current = x;
          onScrollMetrics?.(x, viewport);
        },
      };
    }
    if (viewport) onScrollMetrics?.(scrollX.current, viewport);
  }, [model, viewport, controlRef, onScrollMetrics]);

  const pick = useCallback((x: number) => model.hourAt(x), [model]);
  const webHover = Platform.OS === "web"
    ? {
        onPointerMove: (e: any) => {
          setSelected(pick(e.nativeEvent.offsetX ?? e.nativeEvent.locationX ?? 0));
          setPointerY(e.nativeEvent.offsetY ?? e.nativeEvent.locationY ?? 0);
        },
        onPointerLeave: () => setSelected(null),
      }
    : {};

  const tip = selected != null ? tooltip(model, selected) : null;
  // Tooltip beside the cursor (left of it; flipped right near the left edge), in viewport coordinates.
  const cx = selected != null ? model.hourX(selected) - scrollX.current : 0;
  const flip = cx - TIP_W - 12 < 0;
  const left = Math.min(Math.max(0, flip ? cx + 16 : cx - TIP_W - 12), Math.max(0, viewport - TIP_W));
  // The tooltip grows out of the touched point: centred on it, kept inside the chart.
  const top = Math.min(Math.max(0, pointerY - tipH / 2), Math.max(0, model.H - tipH));
  // Touch: moving a finger up and down on an hour slides the tooltip with it.
  const touch = (e: any) => {
    const n = e.nativeEvent;
    if (n?.locationY != null) setPointerY(n.locationY);
    if (n?.locationX != null) setSelected(pick(n.locationX));
  };

  return (
    <View onLayout={(e: LayoutChangeEvent) => setViewport(e.nativeEvent.layout.width)}>
      <ScrollView ref={scroller} horizontal showsHorizontalScrollIndicator onScroll={onScroll} scrollEventThrottle={32}>
        <View onTouchStart={Platform.OS === "web" ? undefined : touch} onTouchMove={Platform.OS === "web" ? undefined : touch}>
          <Pressable
            onPress={(e) => {
              setPointerY(e.nativeEvent.locationY);
              const i = pick(e.nativeEvent.locationX);
              setSelected((s) => (s === i ? null : i));   // tap again to dismiss
            }}
            accessibilityLabel="Forecast chart. Tap an hour for details."
            {...(webHover as object)}
          >
            <MeteogramCanvas model={model} P={P} />
            {selected != null && <Cursor model={model} P={P} i={selected} />}
          </Pressable>
          <PressureStrip model={model} P={P} />
        </View>
      </ScrollView>

      {tip && selected != null && (
        <View pointerEvents="none" onLayout={(e: LayoutChangeEvent) => setTipH(e.nativeEvent.layout.height)}
          style={[styles.tip, { left, top, width: TIP_W, backgroundColor: props.cardColor, borderColor: props.borderColor }]}>
          <Txt style={[styles.tipTime, { color: props.textColor }]}>{tip.time}</Txt>
          {tip.rows.map((r) => (
            <View key={r.label} style={styles.tipRow}>
              <Txt style={[styles.tipLabel, { color: props.mutedColor }]}>{r.label}</Txt>
              <Txt style={[styles.tipVal, { color: props.textColor }]} numberOfLines={2}>
                {r.warnLevel ? <Txt style={{ color: rgba(WARN_RGB[r.warnLevel], 1) }}>● </Txt> : null}
                {r.value}
              </Txt>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  tip: {
    position: "absolute", borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, padding: 10, gap: 3,
    shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 10, shadowOffset: { width: 0, height: 4 },
  },
  tipTime: { fontSize: 12, fontWeight: "700", marginBottom: 2 },
  tipRow: { flexDirection: "row", justifyContent: "space-between", gap: 10 },
  tipLabel: { fontSize: 12 },
  tipVal: { fontSize: 12, fontWeight: "600", flexShrink: 1, textAlign: "right" },
});
