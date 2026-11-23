/**
 * Thin strip under the chart, aligned hour-for-hour with it: blue when
 * pressure is rising, orange when falling, stronger for faster change, runs
 * labelled where there's room. Its own canvas, so the chart's 364 px layout is untouched.
 */
import { Canvas, Rect, Text } from "@shopify/react-native-skia";
import React from "react";
import { useChartFonts } from "./fonts";
import { pressureCells, PRESSURE_ALPHA, PRESSURE_STRIP_H, type ChartModel } from "./model";
import { PRESS_RGB, rgba, type Palette } from "./palette";

export const PressureStrip = React.memo(function PressureStrip({ model, P }: { model: ChartModel; P: Palette }) {
  const fonts = useChartFonts();
  const { cells, labels } = pressureCells(model);
  const H = PRESSURE_STRIP_H;
  return (
    <Canvas style={{ width: model.W, height: H }} accessibilityLabel="Pressure trend">
      {cells.map((c, i) => (
        <Rect key={i} x={c.x} y={2} width={c.w} height={H - 4}
          color={c.direction === "steady" ? P.pressSteady : rgba(PRESS_RGB[c.direction], PRESSURE_ALPHA[c.strength])} />
      ))}
      {fonts && labels.map((l, i) => (
        <Text key={i} x={l.x - fonts.s8.measureText(l.text).width / 2} y={H / 2 + 3} text={l.text} font={fonts.s8}
          color={l.strong ? "#ffffff" : P.pressText} />
      ))}
    </Canvas>
  );
});
