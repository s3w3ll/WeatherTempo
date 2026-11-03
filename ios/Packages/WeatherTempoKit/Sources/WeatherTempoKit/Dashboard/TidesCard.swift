import SwiftUI

/// Tides: "now" level and direction, today's curve with a now marker, and the next four
/// high/low events. Hidden for inland locations (no `TideSummary`).
struct TidesCard: View {
    let tides: TideSummary
    let timeZone: TimeZone

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline) {
                Label(tides.label, systemImage: "water.waves")
                    .font(.headline).foregroundStyle(Theme.strong)
                    .labelStyle(.titleAndIcon)
                Spacer()
                Text("Now").font(.caption).foregroundStyle(Theme.muted)
                Text(String(format: "%.1f m", tides.currentHeight))
                    .font(.system(size: 15, weight: .semibold)).foregroundStyle(Theme.strong)
                Text(tides.trend.label).font(.caption).foregroundStyle(Theme.cyan)
            }

            TideMiniChart(tides: tides, timeZone: timeZone)
                .frame(height: 76)

            VStack(spacing: 10) {
                if tides.events.isEmpty {
                    Text("No tide data available").font(.caption).foregroundStyle(Theme.muted)
                }
                ForEach(Array(tides.events.enumerated()), id: \.offset) { _, ev in
                    HStack(spacing: 10) {
                        Text(ev.kind == .high ? "🌊" : "🏖️").font(.title3)
                        VStack(alignment: .leading, spacing: 1) {
                            Text(ev.kind == .high ? "High Tide" : "Low Tide")
                                .font(.subheadline.weight(.semibold)).foregroundStyle(Theme.strong)
                            Text(TimeFormat.hourMinute(ev.time.timeIntervalSince1970, in: timeZone, spaced: true))
                                .font(.caption).foregroundStyle(Theme.muted)
                        }
                        Spacer()
                        Text(String(format: "%.1f m", ev.height))
                            .font(.system(size: 15, weight: .semibold)).foregroundStyle(Theme.cyan)
                    }
                }
            }
        }
        .dashboardCard()
    }
}

/// Today's tide curve (local midnight to midnight) with a gradient fill, high/low dots and
/// a marker for the current level. New for the native app: the web version left this as a stub.
struct TideMiniChart: View {
    let tides: TideSummary
    let timeZone: TimeZone

    var body: some View {
        Canvas { ctx, size in
            let curve = tides.curve
            guard curve.count >= 2, let first = curve.first, let last = curve.last else { return }

            let padY = 10.0
            let span = max(0.1, tides.maxHeight - tides.minHeight)
            let t0 = first.time.timeIntervalSince1970
            let t1 = last.time.timeIntervalSince1970

            func x(_ d: Date) -> Double { (d.timeIntervalSince1970 - t0) / (t1 - t0) * size.width }
            func y(_ h: Double) -> Double { size.height - padY - (h - tides.minHeight) / span * (size.height - 2 * padY) }

            let pts = curve.map { CGPoint(x: x($0.time), y: y($0.height)) }

            // Fill under the curve
            var area = Path()
            area.addSmoothCurve(through: pts)
            area.addLine(to: CGPoint(x: size.width, y: size.height))
            area.addLine(to: CGPoint(x: 0, y: size.height))
            area.closeSubpath()
            ctx.fill(area, with: .linearGradient(
                Gradient(colors: [Theme.cyan.opacity(0.35), Theme.cyan.opacity(0.03)]),
                startPoint: .zero, endPoint: CGPoint(x: 0, y: size.height)))

            var line = Path()
            line.addSmoothCurve(through: pts)
            ctx.stroke(line, with: .color(Theme.cyan), style: StrokeStyle(lineWidth: 2, lineJoin: .round))

            // Now marker
            let nx = x(tides.now)
            if nx >= 0 && nx <= size.width {
                var v = Path(); v.move(to: CGPoint(x: nx, y: 0)); v.addLine(to: CGPoint(x: nx, y: size.height))
                ctx.stroke(v, with: .color(Theme.strong.opacity(0.35)), style: StrokeStyle(lineWidth: 1, dash: [3, 3]))
                let dot = Path(ellipseIn: CGRect(x: nx - 4, y: y(tides.currentHeight) - 4, width: 8, height: 8))
                ctx.fill(dot, with: .color(.white))
                ctx.stroke(dot, with: .color(Theme.strong), lineWidth: 2)
            }

            // Local high/low turning points within today, labelled with their time
            let events = TidePredictor.events(
                portID: tides.portID, from: first.time, to: last.time)
            for ev in events {
                let ex = x(ev.time), ey = y(ev.height)
                ctx.fill(Path(ellipseIn: CGRect(x: ex - 2.5, y: ey - 2.5, width: 5, height: 5)), with: .color(Theme.cyan))
                let label = TimeFormat.hour(ev.time.timeIntervalSince1970, in: timeZone)
                ctx.draw(
                    Text(label).font(.system(size: 9)).foregroundStyle(Theme.muted),
                    at: CGPoint(x: min(max(ex, 12), size.width - 12), y: ev.kind == .high ? ey - 8 : ey + 9),
                    anchor: .center)
            }
        }
    }
}
