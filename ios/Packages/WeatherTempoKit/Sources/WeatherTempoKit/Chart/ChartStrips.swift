import SwiftUI

/// The whole forecast in one row: a column per day (width proportional to its hours) with
/// the weather glyph, high/low, a temperature-range bar on a shared scale and sunshine hours.
/// A frame shows which part the chart below is showing; tap a day to jump there, or drag
/// along the strip to browse.
///
/// Sized by its content (no fixed height): iPhone caption fonts are taller than the Mac
/// ones the CI snapshots use, and Dynamic Type makes them taller still.
struct WeekOverviewStrip: View {
    let model: MeteogramModel
    /// The visible part of the chart, as fractions of all hours.
    let visible: ClosedRange<Double>
    var onSelectDay: (MeteogramModel.WeekDay) -> Void = { _ in }
    /// Drag along the strip: the fraction (0...1) of the series under the finger.
    var onBrowse: ((Double) -> Void)? = nil

    @State private var stripWidth: Double = 0

    var body: some View {
        let range = model.weekTemperatureRange
        ProportionalHStack {
            ForEach(model.weekDays) { day in
                Button { onSelectDay(day) } label: { column(day, range: range) }
                    .buttonStyle(.plain)
                    .layoutValue(key: ColumnWeight.self, value: Double(day.hourCount))
                    .accessibilityLabel(accessibility(day))
                    .accessibilityHint("Shows this day on the chart")
            }
        }
        .overlay(alignment: .topLeading) { viewportFrame }
        .background(GeometryReader { g in
            Color.clear
                .onAppear { stripWidth = g.size.width }
                .onChange(of: g.size.width) { _, w in stripWidth = w }
        })
        .simultaneousGesture(browseGesture)
    }

    /// Outline of the part of the series the chart is showing.
    private var viewportFrame: some View {
        GeometryReader { g in
            let w = g.size.width
            let x0 = visible.lowerBound * w
            let fw = max(8, (visible.upperBound - visible.lowerBound) * w)
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .stroke(Theme.strong.opacity(0.55), lineWidth: 1.5)
                .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(Theme.strong.opacity(0.05)))
                .frame(width: fw, height: g.size.height)
                .offset(x: min(x0, w - fw))
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    /// Horizontal drags browse; mostly-vertical ones are left to the page scroll.
    private var browseGesture: some Gesture {
        DragGesture(minimumDistance: 8)
            .onChanged { v in
                guard let onBrowse, stripWidth > 0,
                      abs(v.translation.width) > abs(v.translation.height) else { return }
                onBrowse(min(max(v.location.x / stripWidth, 0), 1))
            }
    }

    private func column(_ day: MeteogramModel.WeekDay, range: ClosedRange<Double>?) -> some View {
        // The full column where it fits, else a one-letter day with the glyph and bar only.
        ViewThatFits(in: .horizontal) {
            columnBody(day, range: range, roomy: true)
            columnBody(day, range: range, roomy: false)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 6)
        .padding(.bottom, 5)
        .contentShape(Rectangle())
    }

    private func columnBody(_ day: MeteogramModel.WeekDay, range: ClosedRange<Double>?, roomy: Bool) -> some View {
        VStack(spacing: 2) {
            Text(roomy ? day.label : String(day.label.prefix(1)))
                .font(.caption2.weight(.semibold)).foregroundStyle(Theme.muted)
            Text(day.glyph).font(.system(size: 14))
            if roomy {
                Text(NumberFormat.rounded(day.high, suffix: "°"))
                    .font(.caption2.weight(.semibold)).foregroundStyle(Theme.warmText)
            }
            rangeBar(day, range: range)
                .frame(width: roomy ? 26 : 4, height: 22)
            if roomy {
                Text(NumberFormat.rounded(day.low, suffix: "°"))
                    .font(.caption2).foregroundStyle(Theme.cyanText)
                Text("☀︎\(Self.sunHours(day.sunshineHours))")
                    .font(.caption2.weight(.semibold)).foregroundStyle(Theme.muted)
            }
        }
        .lineLimit(1)
        .fixedSize()
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

    /// "6h"; a trace of sun shows as "<1h" rather than rounding away to nothing.
    static func sunHours(_ h: Double) -> String {
        h > 0 && h < 0.5 ? "<1h" : "\(Int(h.rounded()))h"
    }

    private func accessibility(_ d: MeteogramModel.WeekDay) -> String {
        var s = d.label
        let sun = Int(d.sunshineHours.rounded())
        s += sun == 0 ? (d.sunshineHours > 0 ? ", little sunshine" : ", no sunshine")
            : ", about \(sun) hour\(sun == 1 ? "" : "s") of sunshine"
        if let h = d.high { s += ", high \(Int(h.rounded())) degrees" }
        if let l = d.low { s += ", low \(Int(l.rounded())) degrees" }
        if let c = d.maxChance, c >= 20 { s += ", \(Int(c.rounded())) percent chance of rain" }
        return s
    }
}

private struct ColumnWeight: LayoutValueKey {
    static let defaultValue: Double = 1
}

/// HStack whose children get widths proportional to their `ColumnWeight` (the day's hours)
/// and whose height is the tallest child's: the strip lines up with the chart's time scale
/// yet still grows with the text inside it.
struct ProportionalHStack: Layout {
    private func widths(_ total: Double, _ subviews: Subviews) -> [Double] {
        let weights = subviews.map { max(0, $0[ColumnWeight.self]) }
        let sum = weights.reduce(0, +)
        return weights.map { sum > 0 ? total * $0 / sum : 0 }
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let w = proposal.width ?? 320
        let h = zip(subviews, widths(w, subviews))
            .map { $0.sizeThatFits(ProposedViewSize(width: $1, height: nil)).height }
            .max() ?? 0
        return CGSize(width: w, height: h)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX
        for (s, w) in zip(subviews, widths(bounds.width, subviews)) {
            s.place(at: CGPoint(x: x, y: bounds.minY), anchor: .topLeading,
                    proposal: ProposedViewSize(width: w, height: bounds.height))
            x += w
        }
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
            // Merge neighbouring hours with the same band into one rectangle: per-hour
            // translucent cells show seams where they meet.
            let tendencies = model.pressureTendencies
            var i = 0
            while i < tendencies.count {
                guard let t = tendencies[i] else { i += 1; continue }
                let start = i
                while i < tendencies.count, let u = tendencies[i], u.direction == t.direction, u.strength == t.strength { i += 1 }
                let rect = CGRect(x: ChartPad.left + Double(start) * pph, y: 2,
                                  width: Double(i - start) * pph, height: size.height - 4)
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
