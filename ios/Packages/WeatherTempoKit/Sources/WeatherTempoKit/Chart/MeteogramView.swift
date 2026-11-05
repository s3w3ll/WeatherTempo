import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

/// The base chart only: no scrolling, no interaction. This is what widgets embed, and
/// what the CI snapshot test renders. `Equatable` so SwiftUI can skip redrawing the
/// (comparatively expensive, blurred) chart when only the hover selection changes.
public struct MeteogramCanvas: View, Equatable {
    public let model: MeteogramModel
    public var palette: ChartPalette = .light

    public init(model: MeteogramModel, palette: ChartPalette = .light) {
        self.model = model
        self.palette = palette
    }

    public static func == (a: MeteogramCanvas, b: MeteogramCanvas) -> Bool { a.model == b.model }

    public var body: some View {
        Canvas { context, _ in
            MeteogramRenderer.draw(model, in: &context, palette: palette)
        }
        .frame(width: model.width, height: model.height)
    }
}

/// Cursor line + dot for the selected hour, on its own canvas so scrubbing is cheap.
struct MeteogramHoverLayer: View {
    let model: MeteogramModel
    let index: Int?

    var body: some View {
        Canvas { context, _ in
            if let index { MeteogramRenderer.drawHover(model, index: index, in: &context) }
        }
        .frame(width: model.width, height: model.height)
        .allowsHitTesting(false)
    }
}

/// Scrollable, interactive meteogram.
///
/// - `days` is the zoom: that many days exactly fill the viewport. The chart always holds the
///   whole forecast, so 5 days needs no scrolling and 2 days scrolls to reach the rest.
/// - Scrolls horizontally, starting with "now" about 30 % in from the left (`scrollToNow`).
/// - Tap an hour, or press and drag, to inspect it. The details show in a strip above the
///   chart rather than a floating tooltip, because a finger would cover a tooltip.
public struct MeteogramView: View {
    private let hours: [WeatherPayload.Hour]
    private let days: Int
    private let timeZone: TimeZone
    private let now: Date
    private let latitude: Double?
    private let longitude: Double?

    @State private var selected: Int?
    /// Current horizontal scroll position of the chart (nil until first reported).
    @State private var scrollX: Double?
    @Environment(\.staticRender) private var staticRender

    public init(
        hours: [WeatherPayload.Hour],
        days: Int = 2,
        timeZone: TimeZone = MeteogramModel.nzTimeZone,
        now: Date = Date(),
        latitude: Double? = nil,
        longitude: Double? = nil
    ) {
        self.hours = hours
        self.days = days
        self.timeZone = timeZone
        self.now = now
        self.latitude = latitude
        self.longitude = longitude
    }

    /// Everything inside the GeometryReader: week strip, detail strip, chart, pressure strip.
    static var contentHeight: Double {
        WeekOverviewStrip.height + 8 + HourDetailStrip.height + 8 + ChartZone.height + 2 + PressureTrendStrip.height
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            GeometryReader { geo in
                let model = MeteogramModel(
                    hours: hours,
                    pxPerHour: MeteogramModel.pxPerHour(viewportWidth: geo.size.width, days: days),
                    now: now, timeZone: timeZone, latitude: latitude, longitude: longitude)
                chart(model, viewport: geo.size.width)
            }
            .frame(height: Self.contentHeight)

            MeteogramLegend()
        }
    }

    @ViewBuilder
    private func chart(_ model: MeteogramModel, viewport: Double) -> some View {
        if staticRender {
            // Image rendering: show the window a user would see on first appearance
            // ("now" 30 % in from the left) instead of a ScrollView.
            let scrollX = model.initialScrollX(viewport: viewport)
            VStack(alignment: .leading, spacing: 8) {
                WeekOverviewStrip(model: model, visible: model.visibleFraction(scrollX: scrollX, viewport: viewport))
                HourDetailStrip(model: model, index: selected)
                VStack(alignment: .leading, spacing: 2) {
                    MeteogramCanvas(model: model)
                    PressureTrendStrip(model: model)
                }
                .accessibilityHidden(true)
                .offset(x: -scrollX)
                .frame(width: viewport, height: model.height + 2 + PressureTrendStrip.height, alignment: .leading)
                .clipped()
            }
        } else {
            ScrollViewReader { proxy in
                VStack(alignment: .leading, spacing: 8) {
                    WeekOverviewStrip(
                        model: model,
                        visible: model.visibleFraction(scrollX: scrollX ?? model.initialScrollX(viewport: viewport), viewport: viewport),
                        onSelectDay: { day in
                            withAnimation(.easeInOut(duration: 0.3)) { proxy.scrollTo("day-\(day.startIndex)", anchor: .leading) }
                        })
                    HourDetailStrip(model: model, index: selected)
                    scroller(model)
                }
                .onAppear { proxy.scrollTo("now", anchor: UnitPoint(x: 0.3, y: 0.5)) }
            }
            .id(days)   // changing the zoom rebuilds the scroll view, which re-anchors on "now"
        }
    }

    private func scroller(_ model: MeteogramModel) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            VStack(alignment: .leading, spacing: 2) {
                ZStack(alignment: .topLeading) {
                    MeteogramCanvas(model: model).equatable()
                    MeteogramHoverLayer(model: model, index: selected)
                    // Invisible anchors: "now" for the first appearance, one per day for the week strip.
                    // (padding, not offset: scrollTo uses the layout frame, which offset doesn't move)
                    Color.clear.frame(width: 1, height: 1)
                        .id("now")
                        .padding(.leading, model.hourX(model.nowIndex))
                    ForEach(model.weekDays) { day in
                        Color.clear.frame(width: 1, height: 1)
                            .id("day-\(day.startIndex)")
                            .padding(.leading, max(0, model.hourX(day.startIndex) - model.pxPerHour / 2))
                    }
                }
                .frame(width: model.width, height: model.height)
                .contentShape(Rectangle())
                .simultaneousGesture(tapGesture(model))
                .gesture(scrubGesture(model))
                // A canvas has no accessible structure: describe it, and let VoiceOver
                // step through the hours with swipe up / down.
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(model.accessibilitySummary)
                .accessibilityValue(selected.map { model.spokenDetail(for: $0) } ?? "")
                .accessibilityAdjustableAction { direction in
                    let last = model.hours.count - 1
                    guard last >= 0 else { return }
                    let from = selected ?? model.nowIndex
                    switch direction {
                    case .increment: select(min(last, selected == nil ? from : from + 1))
                    case .decrement: select(max(0, selected == nil ? from : from - 1))
                    @unknown default: break
                    }
                }

                PressureTrendStrip(model: model)
            }
            // Report how far the content has scrolled, for the week strip's frame (iOS 17 has
            // no scroll-offset API, so read it from the content's frame).
            .background(GeometryReader { g in
                Color.clear.preference(key: ChartScrollOffsetKey.self, value: -g.frame(in: .named("chartScroll")).minX)
            })
        }
        .coordinateSpace(name: "chartScroll")
        .onPreferenceChange(ChartScrollOffsetKey.self) { scrollX = $0 }
    }

    // MARK: Gestures

    private func tapGesture(_ model: MeteogramModel) -> some Gesture {
        SpatialTapGesture().onEnded { value in
            let i = model.hourIndex(atX: value.location.x)
            select(selected == i ? nil : i)
        }
    }

    /// Long-press then drag, so plain horizontal swipes still scroll the chart.
    private func scrubGesture(_ model: MeteogramModel) -> some Gesture {
        LongPressGesture(minimumDuration: 0.2)
            .sequenced(before: DragGesture(minimumDistance: 0))
            .onChanged { value in
                if case .second(true, let drag?) = value {
                    select(model.hourIndex(atX: drag.location.x))
                }
            }
    }

    private func select(_ i: Int?) {
        guard i != selected else { return }
        selected = i
        #if canImport(UIKit)
        if i != nil { UISelectionFeedbackGenerator().selectionChanged() }
        #endif
    }
}

private struct ChartScrollOffsetKey: PreferenceKey {
    static let defaultValue: Double = 0
    static func reduce(value: inout Double, nextValue: () -> Double) { value = nextValue() }
}

/// The hover tooltip's content, pinned above the chart.
struct HourDetailStrip: View {
    /// Fixed so the layout doesn't jump when an hour is selected.
    static let height: Double = 92

    let model: MeteogramModel
    let index: Int?

    private let columns = Array(repeating: GridItem(.flexible(), alignment: .topLeading), count: 3)

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            if let index, model.hours.indices.contains(index) {
                Text(model.detailTitle(for: index)).font(.caption.bold())
                LazyVGrid(columns: columns, alignment: .leading, spacing: 2) {
                    ForEach(model.detailRows(for: index), id: \.label) { row in
                        VStack(alignment: .leading, spacing: 0) {
                            Text(row.label).scaledFont(9, relativeTo: .caption).foregroundStyle(.secondary)
                            Text(row.value).font(.caption2.weight(.semibold)).lineLimit(1).minimumScaleFactor(0.7)
                        }
                    }
                }
            } else {
                // Nothing selected: use the space for what's coming up.
                if let summary = model.nextHoursSummary() {
                    Text("Next \(MeteogramModel.nextHoursWindow) hours").font(.caption.bold())
                    Text(summary)
                        .font(.footnote).foregroundStyle(Theme.text)
                        .lineLimit(3).minimumScaleFactor(0.8)
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 0)
                }
                Text("Tap or press and drag on the chart to inspect an hour")
                    .font(.caption2).foregroundStyle(.secondary).lineLimit(1).minimumScaleFactor(0.8)
            }
        }
        .frame(maxWidth: .infinity, minHeight: Self.height, maxHeight: Self.height, alignment: .topLeading)
    }
}

/// The chart key in two rows (main zone, then wind/precip/pressure), colours from the palette.
public struct MeteogramLegend: View {
    public init() {}

    public var body: some View {
        let p = ChartPalette.light
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 12) {
                item("Temperature", p.tempLine, dashed: false)
                item("Feels like", p.feelsLine, dashed: true)
                item("Dew point", p.dewLine, dashed: true)
                item("UV", p.uvLine, dashed: false)
            }
            HStack(spacing: 12) {
                item("Wind", p.windArrow, dashed: false)
                item("Gusts", p.gustLine, dashed: true)
                item("Precip", p.precipLine, dashed: false)
                item("Pressure", p.pressLine, dashed: true)
            }
        }
        .scaledFont(10, relativeTo: .caption)
        .foregroundStyle(.secondary)
        .lineLimit(1)
        .minimumScaleFactor(0.8)
    }

    private func item(_ title: String, _ color: Color, dashed: Bool) -> some View {
        HStack(spacing: 4) {
            Path { $0.move(to: CGPoint(x: 0, y: 0)); $0.addLine(to: CGPoint(x: 12, y: 0)) }
                .stroke(color, style: StrokeStyle(lineWidth: 2, dash: dashed ? [3, 2] : []))
                .frame(width: 12, height: 2)
            Text(title)
        }
    }
}

#if DEBUG
#Preview("Meteogram – 2 days") {
    MeteogramView(
        hours: SampleData.hours(),
        days: 2,
        now: SampleData.referenceStart.addingTimeInterval(14 * 3600)
    )
    .padding()
}
#endif
