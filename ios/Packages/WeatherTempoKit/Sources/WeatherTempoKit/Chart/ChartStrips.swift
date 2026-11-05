import SwiftUI

/// The whole forecast in one row: a column per day (width proportional to its hours) with
/// the weather glyph, high/low and a temperature-range bar on a shared scale. A frame shows
/// which part the chart below is showing; tapping a day scrolls the chart there.
struct WeekOverviewStrip: View {
    static let height: Double = 64

    let model: MeteogramModel
    /// The visible part of the chart, as fractions of all hours.
    let visible: ClosedRange<Double>
    var onSelectDay: (MeteogramModel.WeekDay) -> Void = { _ in }

    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width
            let total = Double(max(model.hours.count, 1))
            let days = model.weekDays
            let range = model.weekTemperatureRange

            ZStack(alignment: .topLeading) {
                HStack(spacing: 0) {
                    ForEach(days) { day in
                        Button { onSelectDay(day) } label: {
                            column(day, range: range, width: w * Double(day.hourCount) / total)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(accessibility(day))
                        .accessibilityHint("Shows this day on the chart")
                    }
                }

                // Viewport frame
                let x0 = visible.lowerBound * w
                let fw = max(8, (visible.upperBound - visible.lowerBound) * w)
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .stroke(Theme.strong.opacity(0.55), lineWidth: 1.5)
                    .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(Theme.strong.opacity(0.05)))
                    .frame(width: fw, height: Self.height)
                    .offset(x: min(x0, w - fw))
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)
            }
        }
        .frame(height: Self.height)
    }

    private func column(_ day: MeteogramModel.WeekDay, range: ClosedRange<Double>?, width: Double) -> some View {
        let roomy = width >= 44
        return VStack(spacing: 2) {
            Text(roomy ? day.label : String(day.label.prefix(1)))
                .font(.caption2.weight(.semibold)).foregroundStyle(Theme.muted)
            Text(day.glyph).font(.system(size: 14))
            if roomy {
                Text(NumberFormat.rounded(day.high, suffix: "°"))
                    .font(.caption2.weight(.semibold)).foregroundStyle(Theme.warmText)
            }
            rangeBar(day, range: range)
                .frame(width: max(4, min(width - 10, 26)), height: 14)
            if roomy {
                Text(NumberFormat.rounded(day.low, suffix: "°"))
                    .font(.caption2).foregroundStyle(Theme.cyanText)
            }
        }
        .lineLimit(1)
        .frame(width: width, height: Self.height)
        .contentShape(Rectangle())
    }

    /// Vertical bar from the day's low to its high on the week's shared scale, warm to cool.
    private func rangeBar(_ day: MeteogramModel.WeekDay, range: ClosedRange<Double>?) -> some View {
        GeometryReader { g in
            if let range, let lo = day.low, let hi = day.high {
                let span = range.upperBound - range.lowerBound
                let top = (range.upperBound - hi) / span * g.size.height
                let bottom = (range.upperBound - lo) / span * g.size.height
                Capsule()
                    .fill(LinearGradient(colors: [Theme.warm, Theme.cyan], startPoint: .top, endPoint: .bottom))
                    .frame(width: 4, height: max(3, bottom - top))
                    .offset(x: (g.size.width - 4) / 2, y: top)
            }
        }
    }

    private func accessibility(_ d: MeteogramModel.WeekDay) -> String {
        var s = d.label
        if let h = d.high { s += ", high \(Int(h.rounded())) degrees" }
        if let l = d.low { s += ", low \(Int(l.rounded())) degrees" }
        if let c = d.maxChance, c >= 20 { s += ", \(Int(c.rounded())) percent chance of rain" }
        return s
    }
}

/// Thin strip under the chart, aligned hour-for-hour with it: blue when pressure is rising,
/// orange when falling, stronger for faster change, with the run labelled where there's room.
struct PressureTrendStrip: View {
    static let height: Double = 16

    let model: MeteogramModel

    static let rising = RGB(37, 99, 216)
    static let falling = RGB(214, 100, 30)

    var body: some View {
        Canvas { ctx, size in
            let pph = model.pxPerHour
            for (i, t) in model.pressureTendencies.enumerated() {
                guard let t else { continue }
                let rect = CGRect(x: ChartPad.left + Double(i) * pph, y: 2, width: pph + 0.5, height: size.height - 4)
                let color: Color = switch t.direction {
                case .rising: Self.rising.color.opacity([0.10, 0.22, 0.45, 0.75][t.strength])
                case .falling: Self.falling.color.opacity([0.10, 0.22, 0.45, 0.75][t.strength])
                case .steady: Theme.strong.opacity(0.06)
                }
                ctx.fill(Path(rect), with: .color(color))
            }

            for run in model.pressureTendencyRuns where run.direction != .steady {
                let x0 = ChartPad.left + Double(run.range.lowerBound) * pph
                let w = Double(run.range.count) * pph
                let arrow = run.direction == .rising ? "▲" : "▼"
                let text = w >= 90 ? "\(arrow) \(run.label)" : (w >= 14 ? arrow : "")
                guard !text.isEmpty else { continue }
                let tint = run.maxStrength == 3 ? Color.white : Theme.strong
                ctx.draw(Text(text).font(.system(size: 8, weight: .semibold)).foregroundStyle(tint),
                         at: CGPoint(x: x0 + w / 2, y: size.height / 2), anchor: .center)
            }
        }
        .frame(width: model.width, height: Self.height)
        .accessibilityHidden(true)
    }
}
