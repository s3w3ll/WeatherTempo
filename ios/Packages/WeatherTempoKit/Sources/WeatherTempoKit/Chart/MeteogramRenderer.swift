import SwiftUI

/// Layer-by-layer port of `WeatherChart.render()` (src/chart.js). Each `draw…` method
/// corresponds to one `_draw…` method there; the comments name the JS original.
///
/// Known, deliberate differences from the canvas version:
/// - `Text` is positioned by its bottom edge (nudged to approximate the alphabetic
///   baseline canvas uses), so labels can sit ~1 px differently.
/// - Canvas `shadowBlur` becomes a SwiftUI shadow filter on a layer; looks the same, not identical.
/// - The hover line colour comes from the palette (see `ChartPalette.hoverLine`).
public enum MeteogramRenderer {

    public static func draw(_ m: MeteogramModel, in ctx: inout GraphicsContext, palette p: ChartPalette = .light) {
        guard !m.hours.isEmpty else { return }
        drawBackground(m, &ctx, p)
        drawCloudCover(m, &ctx, p)
        drawFreezingLine(m, &ctx, p)
        if m.layout.detailedLayers { drawUV(m, &ctx, p) }
        drawTemperatureArea(m, &ctx, p)
        drawTemperatureLine(m, &ctx, p)
        drawFeelsLikeLine(m, &ctx, p)
        if m.layout.detailedLayers { drawDewPointLine(m, &ctx, p) }
        drawPressureLine(m, &ctx, p)
        drawWind(m, &ctx, p)
        drawPrecipitation(m, &ctx, p)
        drawDayDividers(m, &ctx, p)
        drawNowMarker(m, &ctx, p)
        drawTimeAxis(m, &ctx, p)
        if m.layout.showDayAxis { drawDayAxis(m, &ctx, p) }
        drawTempLabels(m, &ctx, p)
    }

    // MARK: Helpers

    private static func line(_ a: CGPoint, _ b: CGPoint) -> Path {
        var path = Path(); path.move(to: a); path.addLine(to: b); return path
    }

    private static func verticalGradient(_ stops: [(Double, Color)], from y0: Double, to y1: Double) -> GraphicsContext.Shading {
        .linearGradient(
            Gradient(stops: stops.map { Gradient.Stop(color: $0.1, location: $0.0) }),
            startPoint: CGPoint(x: 0, y: y0), endPoint: CGPoint(x: 0, y: y1))
    }

    private static func label(_ s: String, at pt: CGPoint, size: Double, bold: Bool = false, color: Color, _ ctx: inout GraphicsContext) {
        // canvas fillText() puts the *baseline* at y; .bottom is the text box edge, which
        // is about 0.2 em below the baseline.
        ctx.draw(
            Text(s).font(.system(size: size, weight: bold ? .bold : .regular)).foregroundStyle(color),
            at: CGPoint(x: pt.x, y: pt.y + size * 0.2), anchor: .bottom)
    }

    /// strokeText + fillText halo: the text is drawn in the halo colour around its
    /// outline first, so it stays legible over lines and bands.
    private static func haloLabel(_ s: String, at pt: CGPoint, size: Double, color: Color, halo: Color, _ ctx: inout GraphicsContext) {
        let r = 1.5
        for k in 0..<8 {
            let a = Double(k) * .pi / 4
            label(s, at: CGPoint(x: pt.x + cos(a) * r, y: pt.y + sin(a) * r), size: size, bold: true, color: halo, &ctx)
        }
        label(s, at: pt, size: size, bold: true, color: color, &ctx)
    }

    private static func tempPoints(_ m: MeteogramModel) -> [CGPoint] {
        m.hours.enumerated().map { CGPoint(x: m.hourX($0.offset), y: m.tempY($0.element.temperature ?? 0)) }
    }

    private static func feelsPoints(_ m: MeteogramModel) -> [CGPoint] {
        m.hours.enumerated().map { CGPoint(x: m.hourX($0.offset), y: m.tempY($0.element.temperatureFeelsLike ?? 0)) }
    }

    // MARK: 1. Background  (_drawBackground)

    static func drawBackground(_ m: MeteogramModel, _ ctx: inout GraphicsContext, _ p: ChartPalette) {
        let w = m.width, h = m.height
        ctx.fill(Path(CGRect(x: 0, y: 0, width: w, height: h)), with: .color(p.bg))

        // Day/night bands
        for (i, hour) in m.hours.enumerated() {
            let rect = CGRect(x: ChartPad.left + Double(i) * m.pxPerHour, y: 0, width: m.pxPerHour, height: h)
            ctx.fill(Path(rect), with: .color(hour.dayOrNight == "D" ? p.bgDay : p.bgNight))
        }

        // Subtle horizontal grid lines in the temperature zone
        let step = max(1, (m.tMax - m.tMin) / 5).rounded(.up)
        var t = m.tMin.rounded(.up)
        while t <= m.tMax {
            let y = m.tempY(t)
            ctx.stroke(line(CGPoint(x: 0, y: y), CGPoint(x: w, y: y)), with: .color(p.grid), lineWidth: 0.5)
            t += step
        }

        // Swimlane separators between main / wind / precip zones
        for y in [m.layout.windTop, m.layout.precipTop] {
            ctx.stroke(line(CGPoint(x: 0, y: y), CGPoint(x: w, y: y)), with: .color(p.zoneSeparator), lineWidth: 2)
        }
    }

    // MARK: 2. Cloud cover  (_drawCloudCover)

    static func drawCloudCover(_ m: MeteogramModel, _ ctx: inout GraphicsContext, _ p: ChartPalette) {
        let zoneH = m.layout.cloudBot - m.layout.cloudTop
        ctx.drawLayer { layer in
            layer.addFilter(.blur(radius: 4))
            for run in m.cloudRuns {
                // Bottom edge: y proportional to cloud cover, at hour centres.
                let pts = run.map { j in
                    CGPoint(x: m.hourX(j), y: m.layout.cloudTop + zoneH * ((m.hours[j].cloudCover ?? 0) / 100))
                }
                let xLeft = ChartPad.left + Double(run.lowerBound) * m.pxPerHour
                let xRight = ChartPad.left + Double(run.upperBound) * m.pxPerHour

                var path = Path()
                path.move(to: CGPoint(x: xLeft, y: m.layout.cloudTop))   // top-left
                path.addLine(to: pts[0])                                  // down to first bottom point
                path.addSmoothCurve(through: pts, startNew: false)        // smooth bottom edge
                path.addLine(to: CGPoint(x: xRight, y: m.layout.cloudTop)) // back up, top-right
                path.closeSubpath()
                layer.fill(path, with: .color(p.cloud))
            }
        }
    }

    // MARK: 3. Temperature area  (_drawTemperatureArea)

    static func drawTemperatureArea(_ m: MeteogramModel, _ ctx: inout GraphicsContext, _ p: ChartPalette) {
        var path = Path()
        path.addSmoothCurve(through: tempPoints(m))
        // startNew:false on purpose: continues from the last temperature point (see addSmoothCurve).
        path.addSmoothCurve(through: Array(feelsPoints(m).reversed()), startNew: false)
        path.closeSubpath()
        ctx.fill(path, with: verticalGradient(
            [(0, p.tempFillTop), (1, p.tempFillBottom)], from: m.layout.tempTop, to: m.layout.tempBot))
    }

    // MARK: 4/5. Temperature + feels-like lines

    static func drawTemperatureLine(_ m: MeteogramModel, _ ctx: inout GraphicsContext, _ p: ChartPalette) {
        var path = Path()
        path.addSmoothCurve(through: tempPoints(m))
        ctx.stroke(path, with: .color(p.tempLine), style: StrokeStyle(lineWidth: 2.5, lineJoin: .round))
    }

    static func drawFeelsLikeLine(_ m: MeteogramModel, _ ctx: inout GraphicsContext, _ p: ChartPalette) {
        var path = Path()
        path.addSmoothCurve(through: feelsPoints(m))
        ctx.stroke(path, with: .color(p.feelsLine), style: StrokeStyle(lineWidth: 1.5, dash: [5, 5]))
    }

    // MARK: Freezing line (native addition)

    /// Dashed 0° line with a small label, only when 0° is inside the plotted range.
    static func drawFreezingLine(_ m: MeteogramModel, _ ctx: inout GraphicsContext, _ p: ChartPalette) {
        guard let y = m.freezingY else { return }
        ctx.stroke(line(CGPoint(x: 0, y: y), CGPoint(x: m.width, y: y)),
                   with: .color(p.freezingLine), style: StrokeStyle(lineWidth: 1, dash: [4, 4]))
        label("0°", at: CGPoint(x: 14, y: y - 2), size: 9, bold: true, color: p.freezingLine, &ctx)
    }

    // MARK: UV curve (native addition)

    /// UV on its own scale in the lower main zone, with the 3+ "sun protection" part filled.
    static func drawUV(_ m: MeteogramModel, _ ctx: inout GraphicsContext, _ p: ChartPalette) {
        let floor = m.uvY(0)
        let protect = m.uvY(3)
        for run in m.uvRuns {
            let pts = run.map { CGPoint(x: m.hourX($0), y: m.uvY(m.hours[$0].uvIndex ?? 0)) }
            guard let first = pts.first, let last = pts.last, pts.count >= 2 else { continue }

            var curve = Path()
            curve.addSmoothCurve(through: pts)

            // Fill only where UV >= 3: the area under the curve, clipped to above the 3 line.
            var area = curve
            area.addLine(to: CGPoint(x: last.x, y: floor))
            area.addLine(to: CGPoint(x: first.x, y: floor))
            area.closeSubpath()
            ctx.drawLayer { layer in
                layer.clip(to: Path(CGRect(x: first.x, y: 0, width: last.x - first.x, height: protect)))
                layer.fill(area, with: .color(p.uvFill))
            }
            ctx.stroke(curve, with: .color(p.uvLine), style: StrokeStyle(lineWidth: 1.5, lineJoin: .round))

            // Peak label: "UV 6"
            if let peak = run.max(by: { (m.hours[$0].uvIndex ?? 0) < (m.hours[$1].uvIndex ?? 0) }),
               let uv = m.hours[peak].uvIndex, uv >= 1 {
                label("UV \(Int(uv.rounded()))", at: CGPoint(x: m.hourX(peak), y: m.uvY(uv) - 4),
                      size: 8, bold: true, color: p.uvLine, &ctx)
            }
        }
    }

    // MARK: Dew point (native addition)

    static func drawDewPointLine(_ m: MeteogramModel, _ ctx: inout GraphicsContext, _ p: ChartPalette) {
        let pts: [CGPoint] = m.hours.enumerated().compactMap { i, h in
            MeteogramModel.dewPoint(h).map { CGPoint(x: m.hourX(i), y: m.tempY($0)) }
        }
        guard pts.count >= 2 else { return }
        var path = Path()
        path.addSmoothCurve(through: pts)
        ctx.stroke(path, with: .color(p.dewLine), style: StrokeStyle(lineWidth: 1.2, lineCap: .round, dash: [0.5, 3.5]))
    }

    // MARK: 6. Pressure  (_drawPressureLine)

    static func drawPressureLine(_ m: MeteogramModel, _ ctx: inout GraphicsContext, _ p: ChartPalette) {
        let pts: [CGPoint] = m.hours.enumerated().compactMap { i, h in
            h.pressureMeanSeaLevel.map { CGPoint(x: m.hourX(i), y: m.pressureY($0)) }
        }
        guard pts.count >= 2 else { return }
        var path = Path()
        path.addSmoothCurve(through: pts)
        ctx.stroke(path, with: .color(p.pressLine), style: StrokeStyle(lineWidth: 1.2, dash: [3, 6]))
    }

    // MARK: 7. Wind  (drawWindIndicators)

    static func drawWind(_ m: MeteogramModel, _ ctx: inout GraphicsContext, _ p: ChartPalette) {
        let pts = m.hours.enumerated().map { CGPoint(x: m.hourX($0.offset), y: m.windY($0.element.windSpeed ?? 0)) }
        guard let first = pts.first, let last = pts.last else { return }

        // Pass 1: area under the speed curve
        var area = Path()
        area.addSmoothCurve(through: pts)
        area.addLine(to: CGPoint(x: last.x, y: m.layout.windBot))
        area.addLine(to: CGPoint(x: first.x, y: m.layout.windBot))
        area.closeSubpath()
        ctx.fill(area, with: verticalGradient(
            [(0, p.windFillTop), (1, p.windFillBottom)], from: m.layout.windTop, to: m.layout.windBot))

        // Pass 1b: gusts, a thin dashed line above the speed curve (clamped to the zone like speed)
        let gustPts: [CGPoint] = m.hours.enumerated().compactMap { i, h in
            h.windGust.map { CGPoint(x: m.hourX(i), y: m.windY($0)) }
        }
        if gustPts.count >= 2 {
            var gusts = Path()
            gusts.addSmoothCurve(through: gustPts)
            ctx.stroke(gusts, with: .color(p.gustLine), style: StrokeStyle(lineWidth: 1, dash: [3, 2]))
        }

        // Pass 2: speed line with a soft glow
        var curve = Path()
        curve.addSmoothCurve(through: pts)
        ctx.drawLayer { layer in
            layer.addFilter(.shadow(color: p.windShadow, radius: 3))
            layer.stroke(curve, with: .color(p.windLine), lineWidth: 1.5)
        }

        // Pass 3: direction arrows (every 3rd hour, thinned when zoomed out), centred on the speed line
        for i in stride(from: 0, to: m.hours.count, by: m.windArrowInterval) {
            let h = m.hours[i]
            guard let speed = h.windSpeed else { continue }
            let a = MeteogramModel.windArrow(x: m.hourX(i), y: m.windY(speed), directionFrom: h.windDirection ?? 0)

            ctx.stroke(line(a.shaftStart, a.shaftEnd), with: .color(p.windArrow), lineWidth: 1.5)

            var head = Path()
            head.move(to: a.headTip)
            head.addLine(to: a.headLeft)
            head.addLine(to: a.headRight)
            head.closeSubpath()
            ctx.fill(head, with: .color(p.windArrow))
        }
    }

    // MARK: 8. Precipitation  (_drawPrecipBars)

    /// Sky-blue (light rain) to deep blue (heavy), `intensity` 0...1.
    static func precipColor(_ intensity: Double) -> Color {
        func lerp(_ a: Double, _ b: Double, _ t: Double) -> Double { a + (b - a) * t }
        return Color(
            r: lerp(80, 40, intensity).rounded(),
            g: lerp(170, 100, intensity).rounded(),
            b: lerp(255, 220, intensity).rounded())
    }

    static func drawPrecipitation(_ m: MeteogramModel, _ ctx: inout GraphicsContext, _ p: ChartPalette) {
        let zoneH = m.layout.precipBot - m.layout.precipTop
        let barW = max(2, m.pxPerHour * 0.45)
        let pts = m.hours.enumerated().map { CGPoint(x: m.hourX($0.offset), y: m.probabilityY($0.element.precipChance ?? 0)) }
        guard let first = pts.first, let last = pts.last else { return }

        // Pass 1: probability area, behind everything else in this zone
        var area = Path()
        area.addSmoothCurve(through: pts)
        area.addLine(to: CGPoint(x: last.x, y: m.layout.precipBot))
        area.addLine(to: CGPoint(x: first.x, y: m.layout.precipBot))
        area.closeSubpath()
        ctx.fill(area, with: verticalGradient(
            [(0, p.precipAreaTop), (1, p.precipAreaBottom)], from: m.layout.precipTop, to: m.layout.precipBot))

        // Pass 2: qpf bars (actual rain only)
        for (i, h) in m.hours.enumerated() {
            let qpf = h.qpf ?? 0
            guard qpf > 0 else { continue }
            let intensity = min(max(qpf / m.qMax, 0), 1)
            let height = max(2, zoneH * intensity)
            let rect = CGRect(x: m.hourX(i) - barW / 2, y: m.layout.precipBot - height, width: barW, height: height)
            // roundRect(..., [2, 2, 0, 0]): rounded top corners only
            let bar = UnevenRoundedRectangle(
                topLeadingRadius: 2, bottomLeadingRadius: 0, bottomTrailingRadius: 0, topTrailingRadius: 2
            ).path(in: rect)
            ctx.fill(bar, with: .color(precipColor(intensity).opacity(0.9)))
        }

        // Pass 3: probability line, on top so it is always visible above the bars
        var curve = Path()
        curve.addSmoothCurve(through: pts)
        ctx.drawLayer { layer in
            layer.addFilter(.shadow(color: p.precipShadow, radius: 3))
            layer.stroke(curve, with: .color(p.precipLine), lineWidth: 1.5)
        }
    }

    // MARK: 9. Day dividers  (_drawDayDividers)

    static func drawDayDividers(_ m: MeteogramModel, _ ctx: inout GraphicsContext, _ p: ChartPalette) {
        for i in m.dayBoundaries {
            let x = m.hourX(i) - m.pxPerHour / 2
            ctx.stroke(
                line(CGPoint(x: x, y: m.layout.tempTop), CGPoint(x: x, y: m.layout.precipBot)),
                with: .color(p.dayDivider), lineWidth: 1)
        }
    }

    // MARK: 10. Now marker  (_drawNowMarker)

    static func drawNowMarker(_ m: MeteogramModel, _ ctx: inout GraphicsContext, _ p: ChartPalette) {
        let x = m.hourX(m.nowIndex)
        ctx.stroke(
            line(CGPoint(x: x, y: 0), CGPoint(x: x, y: m.height)),
            with: verticalGradient(
                [(0, Color(r: 255, g: 255, b: 255, a: 0)), (0.2, p.nowLine), (0.8, p.nowLine),
                 (1, Color(r: 255, g: 255, b: 255, a: 0))], from: 0, to: m.height),
            lineWidth: 1.5)

        label("NOW", at: CGPoint(x: x, y: 14), size: 9, bold: true, color: p.nowLabel, &ctx)

        let dot = Path(ellipseIn: CGRect(x: x - 3, y: m.layout.tempTop + 4 - 3, width: 6, height: 6))
        ctx.fill(dot, with: .color(.white))
    }

    // MARK: 11. Time axis  (_drawTimeAxis)

    static func drawTimeAxis(_ m: MeteogramModel, _ ctx: inout GraphicsContext, _ p: ChartPalette) {
        for l in m.hourLabels {
            label(l.text, at: CGPoint(x: l.x, y: m.layout.timeTop + 13), size: 10, color: p.textMuted, &ctx)
        }
    }

    // MARK: 11b. Day axis  (_drawDayAxis)

    static func drawDayAxis(_ m: MeteogramModel, _ ctx: inout GraphicsContext, _ p: ChartPalette) {
        let stripH = m.layout.height - m.layout.dayAxisTop
        ctx.fill(Path(CGRect(x: 0, y: m.layout.dayAxisTop, width: m.width, height: stripH)), with: .color(p.dayAxisBackground))
        ctx.stroke(
            line(CGPoint(x: 0, y: m.layout.dayAxisTop), CGPoint(x: m.width, y: m.layout.dayAxisTop)),
            with: .color(p.dayDivider), lineWidth: 1)

        for (b, day) in m.dayLabels.enumerated() {
            label(day.text, at: CGPoint(x: day.centerX, y: m.layout.dayAxisTop + 12), size: 9, bold: true, color: p.text, &ctx)
            if b > 0 {
                ctx.stroke(
                    line(CGPoint(x: day.x0, y: m.layout.dayAxisTop), CGPoint(x: day.x0, y: m.layout.height)),
                    with: .color(p.dayDivider), lineWidth: 1)
            }
        }
    }

    // MARK: 12. Temperature labels  (_drawTempLabels)

    static func drawTempLabels(_ m: MeteogramModel, _ ctx: inout GraphicsContext, _ p: ChartPalette) {
        for marker in m.tempMarkers {
            let t = m.hours[marker.index].temperature ?? 0
            let x = m.hourX(marker.index)
            let curveY = m.tempY(t)
            let color = marker.isHigh ? p.tempLine : p.feelsLine
            let stem = 10.0
            // The clamp only matters on the compact layout, where a high near the top could
            // push its label off the canvas; on the web layout it never triggers.
            let labelY = marker.isHigh ? max(11, curveY - stem - 14) : curveY + stem + 14
            let stemY1 = marker.isHigh ? curveY - 4 : curveY + 4
            let stemY2 = marker.isHigh ? labelY + 4 : labelY - 4

            // Dot on the curve: halo ring, then fill (stroke first, as in the JS)
            let dot = Path(ellipseIn: CGRect(x: x - 3.5, y: curveY - 3.5, width: 7, height: 7))
            ctx.stroke(dot, with: .color(p.halo), lineWidth: 2)
            ctx.fill(dot, with: .color(color))

            // Dashed stem from dot to label
            ctx.stroke(
                line(CGPoint(x: x, y: stemY1), CGPoint(x: x, y: stemY2)),
                with: .color(color.opacity(0.5)), style: StrokeStyle(lineWidth: 1, dash: [2, 2]))

            // Keep the label inside the chart: a high/low on the first or last hour would otherwise be
            // half cut off (the dot, stem and curve stay at the true position).
            let labelX = min(max(x, 14), m.width - 14)
            haloLabel("\(Int(t.rounded()))°", at: CGPoint(x: labelX, y: labelY), size: 11, color: color, halo: p.halo, &ctx)
        }
    }

    // MARK: Hover overlay  (initHover's overlay canvas)

    /// Cursor line + dot on the temperature curve for the selected hour.
    public static func drawHover(_ m: MeteogramModel, index: Int, in ctx: inout GraphicsContext, palette p: ChartPalette = .light) {
        guard m.hours.indices.contains(index) else { return }
        let x = m.hourX(index)
        let clear = p.hoverLine.opacity(0)
        ctx.stroke(
            line(CGPoint(x: x, y: 0), CGPoint(x: x, y: m.height)),
            with: verticalGradient([(0, clear), (0.08, p.hoverLine), (0.92, p.hoverLine), (1, clear)], from: 0, to: m.height),
            lineWidth: 1)
        let y = m.tempY(m.hours[index].temperature ?? 0)
        ctx.fill(Path(ellipseIn: CGRect(x: x - 4, y: y - 4, width: 8, height: 8)), with: .color(p.tempLine))
    }
}
