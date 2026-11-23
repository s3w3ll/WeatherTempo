/**
 * The meteogram, drawn with React Native Skia (iOS, and web via CanvasKit).
 * Layer order matches the website's chart.js render():
 *   background → warning shade → clouds → freezing line → UV → temperature
 *   area/line/feels-like/dew point → pressure → wind → precipitation →
 *   day dividers → NOW → time axis → day axis → temperature labels → warning strip.
 * All geometry comes from model.ts; this file only turns it into draw calls.
 */
import {
  Blur, Canvas, Circle, DashPathEffect, Group, Line, LinearGradient, Mask, Paint, Path, Rect, Shadow, Text, vec,
  type SkFont,
} from "@shopify/react-native-skia";
import React from "react";
import { areaD, smoothPathD } from "./curve";
import { useChartFonts, type ChartFonts } from "./fonts";
import {
  cloudRuns, dayColumns, dividerXs, glowGradient, gridYs, precipBars, skyGradient, tempMarkers, temperaturePts,
  feelsLikePts, dewPts, pressurePts, windPts, gustPts, precipChancePts, timeLabels, uvRuns, windArrows, ZONE,
  type ChartModel,
} from "./model";
import { precipColor, rgba, WARN_RGB, type Palette } from "./palette";

/** Text centred on x (Skia's Text has no alignment). */
function CText({ text, x, y, font, color }: { text: string; x: number; y: number; font: SkFont; color: string }) {
  return <Text x={x - font.measureText(text).width / 2} y={y} text={text} font={font} color={color} />;
}

const topRoundedBar = (x: number, y: number, w: number, h: number, r = 2) =>
  `M${x} ${y + h}V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}V${y + h}Z`;

interface Props { model: ChartModel; P: Palette; fonts: ChartFonts }

function Layers({ model: m, P, fonts }: Props) {
  const { W, H } = m;
  const sky = skyGradient(m);
  const phase = { day: P.bgDay, twilight: P.bgTwilight, night: P.bgNight };
  const glow = glowGradient(m);
  const [gr, gg, gb, ga] = P.sunGlow;

  const temp = temperaturePts(m);
  const feels = feelsLikePts(m);
  const dew = dewPts(m);
  const press = pressurePts(m);
  const wind = windPts(m);
  const gust = gustPts(m);
  const chance = precipChancePts(m);

  const freezing = m.tMin <= 0 && m.tMax >= 0 ? m.tempY(0) : null;
  const nowX = m.hourX(m.nowIdx);
  const stripH = Math.min(4, Math.max(3, ZONE.cloudTop - 1));   // clear of the NOW label

  return (
    <>
      {/* 1. Background */}
      <Rect x={0} y={0} width={W} height={H} color={P.bg} />
      <Rect x={0} y={0} width={W} height={H}>
        <LinearGradient start={vec(0, 0)} end={vec(W, 0)}
          colors={sky.map((s) => phase[s.phase])} positions={sky.map((s) => s.pos)} />
      </Rect>

      {/* Sun glow: horizontal colour, masked by a vertical fade (bright at the top) */}
      {glow.length > 0 && (
        <Mask mode="alpha" mask={
          <Rect x={0} y={0} width={W} height={ZONE.tempBot}>
            <LinearGradient start={vec(0, 0)} end={vec(0, ZONE.tempBot)}
              colors={["rgba(0,0,0,1)", "rgba(0,0,0,0.6)", "rgba(0,0,0,0.15)"]} positions={[0, 0.55, 1]} />
          </Rect>
        }>
          <Rect x={0} y={0} width={W} height={ZONE.tempBot}>
            <LinearGradient start={vec(0, 0)} end={vec(W, 0)}
              colors={glow.map((s) => `rgba(${gr},${gg},${gb},${(ga * s.value).toFixed(3)})`)}
              positions={glow.map((s) => s.pos)} />
          </Rect>
        </Mask>
      )}

      {gridYs(m).map((y) => <Line key={`g${y}`} p1={vec(0, y)} p2={vec(W, y)} color={P.grid} strokeWidth={0.5} />)}
      {[ZONE.windTop, ZONE.precipTop].map((y) => (
        <Line key={`z${y}`} p1={vec(0, y)} p2={vec(W, y)} color={P.zoneSep} strokeWidth={2} />
      ))}

      {/* 2. Warning shade */}
      {m.spans.map((s, i) => (
        <React.Fragment key={`ws${i}`}>
          <Rect x={s.x0} y={0} width={s.x1 - s.x0} height={ZONE.precipBot} color={rgba(WARN_RGB[s.level], 0.13)} />
          {[s.x0, s.x1].map((x) => (
            <Line key={x} p1={vec(x, 0)} p2={vec(x, ZONE.precipBot)} color={rgba(WARN_RGB[s.level], 0.55)} strokeWidth={1}>
              <DashPathEffect intervals={[3, 3]} />
            </Line>
          ))}
        </React.Fragment>
      ))}

      {/* 3. Cloud cover: soft translucent bands hanging from the top */}
      <Group layer={<Paint><Blur blur={4} /></Paint>}>
        {cloudRuns(m).map((r, i) => (
          <Path key={`c${i}`} color={P.cloud}
            path={`M${r.xLeft} ${ZONE.cloudTop}L${r.pts[0].x} ${r.pts[0].y}${smoothPathD(r.pts, true)}L${r.xRight} ${ZONE.cloudTop}Z`} />
        ))}
      </Group>

      {/* 4. Freezing line */}
      {freezing != null && (
        <>
          <Line p1={vec(0, freezing)} p2={vec(W, freezing)} color={P.freezingLine} strokeWidth={1}>
            <DashPathEffect intervals={[4, 4]} />
          </Line>
          <CText text="0°" x={14} y={freezing - 2} font={fonts.b9} color={P.freezingLine} />
        </>
      )}

      {/* 5. UV */}
      {uvRuns(m).map((r, i) => (
        <React.Fragment key={`uv${i}`}>
          {/* fill only where UV >= 3: clip above the UV 3 line */}
          <Group clip={{ x: r.pts[0].x, y: 0, width: r.pts[r.pts.length - 1].x - r.pts[0].x, height: r.protectY }}>
            <Path path={areaD(r.pts, r.floorY)} color={P.uvFill} />
          </Group>
          <Path path={smoothPathD(r.pts)} style="stroke" strokeWidth={1.5} strokeJoin="round" color={P.uvLine} />
          {r.peak && <CText text={`UV ${r.peak.uv}`} x={r.peak.x} y={r.peak.y - 4} font={fonts.b8} color={P.uvLine} />}
        </React.Fragment>
      ))}

      {/* 6. Temperature: band between temp and feels-like, then the lines */}
      <Path color="transparent"
        path={`${smoothPathD(temp)}${smoothPathD([...feels].reverse(), true)}Z`}>
        <LinearGradient start={vec(0, ZONE.tempTop)} end={vec(0, ZONE.tempBot)}
          colors={[P.tempFillTop, P.tempFillBot]} />
      </Path>
      <Path path={smoothPathD(temp)} style="stroke" strokeWidth={2.5} strokeJoin="round" color={P.tempLine} />
      <Path path={smoothPathD(feels)} style="stroke" strokeWidth={1.5} color={P.feelsLine}>
        <DashPathEffect intervals={[5, 5]} />
      </Path>
      {dew.length >= 2 && (
        <Path path={smoothPathD(dew)} style="stroke" strokeWidth={1.2} strokeCap="round" color={P.dewLine}>
          <DashPathEffect intervals={[0.5, 3.5]} />
        </Path>
      )}

      {/* 7. Pressure (secondary axis, dashed) */}
      {press.length >= 2 && (
        <Path path={smoothPathD(press)} style="stroke" strokeWidth={1.2} color={P.pressLine}>
          <DashPathEffect intervals={[3, 6]} />
        </Path>
      )}

      {/* 8. Wind: area, gusts, speed line, direction arrows */}
      <Path path={areaD(wind, ZONE.windBot)} color="transparent">
        <LinearGradient start={vec(0, ZONE.windTop)} end={vec(0, ZONE.windBot)} colors={[P.windFillTop, P.windFillBot]} />
      </Path>
      {gust.length >= 2 && (
        <Path path={smoothPathD(gust)} style="stroke" strokeWidth={1} color={P.gustLine}>
          <DashPathEffect intervals={[3, 2]} />
        </Path>
      )}
      <Path path={smoothPathD(wind)} style="stroke" strokeWidth={1.5} color={P.windLine}>
        <Shadow dx={0} dy={0} blur={3} color={P.windShadow} />
      </Path>
      {windArrows(m).map((a, i) => (
        <React.Fragment key={`wa${i}`}>
          <Line p1={vec(a.shaft[0], a.shaft[1])} p2={vec(a.shaft[2], a.shaft[3])} color={P.windArrow} strokeWidth={1.5} />
          <Path color={P.windArrow}
            path={`M${a.head[0]} ${a.head[1]}L${a.head[2]} ${a.head[3]}L${a.head[4]} ${a.head[5]}Z`} />
        </React.Fragment>
      ))}

      {/* 9. Precipitation: chance area, qpf bars, chance line (probability behind, facts in front) */}
      <Path path={areaD(chance, ZONE.precipBot)} color="transparent">
        <LinearGradient start={vec(0, ZONE.precipTop)} end={vec(0, ZONE.precipBot)} colors={[P.precipTop, P.precipBot]} />
      </Path>
      {precipBars(m).map((b, i) => (
        <Path key={`pb${i}`} path={topRoundedBar(b.x, b.y, b.w, b.h)} color={precipColor(b.intensity)} opacity={0.9} />
      ))}
      <Path path={smoothPathD(chance)} style="stroke" strokeWidth={1.5} color={P.precipLine}>
        <Shadow dx={0} dy={0} blur={3} color={P.precipShadow} />
      </Path>

      {/* 10. Day dividers */}
      {dividerXs(m).map((x) => (
        <Line key={`dd${x}`} p1={vec(x, ZONE.tempTop)} p2={vec(x, ZONE.precipBot)} color={P.dayDiv} strokeWidth={1} />
      ))}

      {/* 11. NOW marker */}
      <Line p1={vec(nowX, 0)} p2={vec(nowX, H)} strokeWidth={1.5}>
        <LinearGradient start={vec(0, 0)} end={vec(0, H)}
          colors={["rgba(255,255,255,0)", P.nowLine, P.nowLine, "rgba(255,255,255,0)"]} positions={[0, 0.2, 0.8, 1]} />
      </Line>
      <CText text="NOW" x={nowX} y={14} font={fonts.b9} color={P.nowLabel} />
      <Circle cx={nowX} cy={ZONE.tempTop + 4} r={3} color="#ffffff" />

      {/* 12. Time axis */}
      {timeLabels(m).map((l) => (
        <CText key={`t${l.x}`} text={l.text} x={l.x} y={ZONE.timeTop + 13} font={fonts.r10} color={P.textMuted} />
      ))}

      {/* 12b. Day axis */}
      <Rect x={0} y={ZONE.dayAxisTop} width={W} height={ZONE.height - ZONE.dayAxisTop} color={P.dayAxisBg} />
      <Line p1={vec(0, ZONE.dayAxisTop)} p2={vec(W, ZONE.dayAxisTop)} color={P.dayDiv} strokeWidth={1} />
      {dayColumns(m).map((c) => (
        <React.Fragment key={`dc${c.x0}`}>
          <CText text={c.label} x={(c.x0 + c.x1) / 2} y={ZONE.dayAxisTop + 12} font={fonts.b9} color={P.text} />
          {c.divider && <Line p1={vec(c.x0, ZONE.dayAxisTop)} p2={vec(c.x0, ZONE.height)} color={P.dayDiv} strokeWidth={1} />}
        </React.Fragment>
      ))}

      {/* 13. Day highs and night lows */}
      {tempMarkers(m).map((k) => {
        const color = k.kind === "high" ? P.tempLine : P.feelsLine;
        const w = fonts.b11.measureText(k.text).width;
        return (
          <React.Fragment key={`tm${k.idx}`}>
            <Line p1={vec(k.x, k.stemY1)} p2={vec(k.x, k.stemY2)} color={color} opacity={0.5} strokeWidth={1}>
              <DashPathEffect intervals={[2, 2]} />
            </Line>
            <Circle cx={k.x} cy={k.curveY} r={3.5} color={P.halo} style="stroke" strokeWidth={2} />
            <Circle cx={k.x} cy={k.curveY} r={3.5} color={color} />
            <Text x={k.labelX - w / 2} y={k.labelY} text={k.text} font={fonts.b11} color={P.halo} style="stroke" strokeWidth={3} />
            <Text x={k.labelX - w / 2} y={k.labelY} text={k.text} font={fonts.b11} color={color} />
          </React.Fragment>
        );
      })}

      {/* 14. Warning strip along the very top, drawn last so nothing covers it */}
      {m.spans.map((s, i) => (
        <Rect key={`wt${i}`} x={s.x0} y={0} width={s.x1 - s.x0} height={stripH} color={rgba(WARN_RGB[s.level], 1)} />
      ))}
    </>
  );
}

/** The chart canvas, W × 364 px. Memoised: hovering or scrolling must not redraw it. */
export const MeteogramCanvas = React.memo(function MeteogramCanvas({ model, P }: { model: ChartModel; P: Palette }) {
  const fonts = useChartFonts();
  return (
    <Canvas style={{ width: model.W, height: model.H }} accessibilityLabel="Forecast chart">
      {fonts && model.hours.length > 0 && <Layers model={model} P={P} fonts={fonts} />}
    </Canvas>
  );
});
