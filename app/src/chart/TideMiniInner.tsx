/**
 * Today's tide curve (Skia). Loaded lazily on web via SkiaGate, so it is the
 * only module here that imports Skia components.
 */
import { Canvas, Circle, DashPathEffect, Line, LinearGradient, Path, Rect, Shadow, vec } from "@shopify/react-native-skia";
import React from "react";
import { areaD, smoothPathD } from "./curve";
import { TIDE_HIGH_COLOR, TIDE_LOW_COLOR, TIDE_PAD_V, type TideChartModel } from "./tideModel";

export interface TideMiniProps {
  model: TideChartModel;
  /** Colour of the curve line (and its glow). */
  curve: string;
  fillA: string; fillB: string; fillC: string; bg: string;
  /** Colour for each sky phase, drawn behind the curve like the weather chart's background. */
  skyColors: { day: string; twilight: string; night: string };
  /** Colour of the day dividers (local midnights), as on the weather chart. */
  dayDiv: string;
  /** x of the hover cursor in px, or null. */
  cursorX: number | null;
  cursorY: number | null;
}

export default function TideMiniInner({ model: m, curve, fillA, fillB, fillC, bg, skyColors, dayDiv, cursorX, cursorY }: TideMiniProps) {
  const { W, H } = m;
  return (
    // Skia's web Canvas hands `style` straight to the DOM: a plain object, not a style array.
    <Canvas style={{ width: W, height: H }} accessibilityLabel="Today's tide curve">
      <Rect x={0} y={0} width={W} height={H} color={bg} />
      {m.sky.length > 1 && (
        <Rect x={0} y={0} width={W} height={H}>
          <LinearGradient start={vec(0, 0)} end={vec(W, 0)}
            colors={m.sky.map((s) => skyColors[s.phase])} positions={m.sky.map((s) => s.pos)} />
        </Rect>
      )}
      {m.dividers.map((x) => (
        <Line key={`dd${x}`} p1={vec(x, 0)} p2={vec(x, H)} color={dayDiv} strokeWidth={1} />
      ))}
      <Path path={areaD(m.pts, H)} color="transparent">
        <LinearGradient start={vec(0, TIDE_PAD_V)} end={vec(0, H)} colors={[fillA, fillB, fillC]} positions={[0, 0.6, 1]} />
      </Path>
      <Path path={smoothPathD(m.pts)} style="stroke" strokeWidth={1.8} color={curve}>
        <Shadow dx={0} dy={0} blur={4} color={curve} />
      </Path>
      {m.events.map((e) => (
        <Circle key={e.time.getTime()} cx={e.x} cy={e.y} r={3} color={e.type === "high" ? TIDE_HIGH_COLOR : TIDE_LOW_COLOR} />
      ))}
      {m.now && (
        <>
          <Line p1={vec(m.now.x, 0)} p2={vec(m.now.x, H)} color="rgba(255,255,255,0.7)" strokeWidth={1}>
            <DashPathEffect intervals={[2, 3]} />
          </Line>
          <Circle cx={m.now.x} cy={m.now.y} r={3} color="#ffffff" />
        </>
      )}
      {cursorX != null && cursorY != null && (
        <>
          <Line p1={vec(cursorX, 0)} p2={vec(cursorX, H)} color="rgba(255,255,255,0.55)" strokeWidth={1} />
          <Circle cx={cursorX} cy={cursorY} r={4} color={curve} />
        </>
      )}
    </Canvas>
  );
}
