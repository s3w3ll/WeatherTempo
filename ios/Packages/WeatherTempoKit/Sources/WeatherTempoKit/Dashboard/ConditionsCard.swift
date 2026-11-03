import SwiftUI

/// Current conditions: big temperature, today's high/low, the next hours, an 8-cell stats
/// grid and sunrise / sunset / moon. Mirrors the web `.conditions-card`.
struct ConditionsCard: View {
    let payload: WeatherPayload
    let insights: WeatherInsights

    private var c: WeatherPayload.Current { payload.current }
    private var tz: TimeZone { insights.timeZone }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            header
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(AccessibilityText.current(payload, insights))
            HourlyStrip(cells: insights.hourlyStrip())
            Divider().overlay(Theme.separator)
            StatsGrid(stats: stats)
            Divider().overlay(Theme.separator)
            astronomy
        }
        .dashboardCard()
    }

    // MARK: Header

    private var header: some View {
        VStack(alignment: .leading, spacing: 4) {
            // Temperature beside today's high/low; at large text sizes they stack instead.
            ViewThatFits(in: .horizontal) {
                tempRow(stacked: false)
                tempRow(stacked: true)
            }
            Text(c.condition ?? c.cloudPhrase ?? "—")
                .font(.headline).foregroundStyle(Theme.text)
            if let feels = c.feelsLike {
                Text("Feels like \(Int(feels.rounded()))°").font(.subheadline).foregroundStyle(Theme.muted)
            }
        }
    }

    private func tempRow(stacked: Bool) -> some View {
        let layout = stacked
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 8))
            : AnyLayout(HStackLayout(alignment: .center, spacing: 8))
        return layout {
            HStack(alignment: .center) {
                Text(insights.currentGlyph).scaledFont(40, relativeTo: .largeTitle)
                Text(c.temp.map { "\(Int($0.rounded()))°" } ?? "—°")
                    .scaledFont(56, weight: .light, relativeTo: .largeTitle)
                    .foregroundStyle(Theme.strong)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }
            if !stacked { Spacer(minLength: 8) }
            if let hl = insights.displayHighLow {
                VStack(alignment: stacked ? .leading : .trailing, spacing: 6) {
                    extremeRow(up: true, hl.high)
                    extremeRow(up: false, hl.low)
                }
            }
        }
    }

    private func extremeRow(up: Bool, _ e: WeatherInsights.Extreme) -> some View {
        HStack(spacing: 5) {
            Image(systemName: up ? "arrowtriangle.up.fill" : "arrowtriangle.down.fill")
                .scaledFont(9, relativeTo: .caption).foregroundStyle(up ? Theme.warm : Theme.cyan)
            Text(NumberFormat.rounded(e.temp, suffix: "°"))
                .scaledFont(17, weight: .semibold, relativeTo: .title3).foregroundStyle(up ? Theme.warmText : Theme.cyanText)
            Text(TimeFormat.hour(e.utcSec, in: tz))
                .font(.caption).foregroundStyle(Theme.muted)
                .frame(minWidth: 34, alignment: .leading)
        }
    }

    // MARK: Stats

    private var stats: [Stat] {
        let agg = insights.todayAggregates
        let uv = insights.uvInfo
        let gust = c.windGust ?? agg.peakGust

        let uvLabel: String = {
            guard let peak = uv.peak else { return "UV" }
            return "Peak \(WeatherInsights.uvLabel(peak))" + (uv.window.map { " · \($0)" } ?? "")
        }()

        return [
            Stat(title: "Humidity", symbol: "humidity", value: c.humidity.map { "\(NumberFormat.trimmed($0))%" } ?? "—", label: "Humidity"),
            Stat(title: "Wind", symbol: "wind", value: c.windSpeed.map { "\(NumberFormat.trimmed($0)) km/h" } ?? "—",
                 label: insights.currentWindCardinal),
            Stat(title: "Gust", symbol: "wind.snow", value: gust.map { "\(Int($0.rounded())) km/h" } ?? "—", label: "Gust"),
            Stat(title: "Pressure", symbol: "gauge", value: NumberFormat.rounded(c.pressure, suffix: " hPa"),
                 label: insights.pressureTrend?.label ?? "Pressure"),
            Stat(title: "Dew point", symbol: "drop", value: NumberFormat.rounded(c.dewPoint, suffix: "°"), label: "Dew point"),
            Stat(title: "Cloud cover", symbol: "cloud", value: insights.currentCloudCover.map { "\(NumberFormat.trimmed($0))%" } ?? "—", label: "Cloud"),
            Stat(title: "Rain today", symbol: "cloud.rain", value: agg.rainMm.map { "\(NumberFormat.trimmed($0)) mm" } ?? "—",
                 label: agg.peakChance.map { "Peak \(NumberFormat.trimmed($0))%" } ?? "Rain today"),
            Stat(title: "UV index", symbol: "sun.max", value: c.uvIndex.map { WeatherInsights.uvLabel($0) } ?? "—", label: uvLabel),
        ]
    }

    // MARK: Astronomy

    private var astronomy: some View {
        HStack(alignment: .top, spacing: 0) {
            astro(symbol: "sunrise", tint: Theme.warm, title: "Sunrise",
                  value: TimeFormat.hourMinute(c.sunriseUtc, in: tz, spaced: true))
            Spacer(minLength: 4)
            astro(symbol: "sunset", tint: Color(r: 255, g: 140, b: 80), title: "Sunset",
                  value: TimeFormat.hourMinute(c.sunsetUtc, in: tz, spaced: true))
            Spacer(minLength: 4)
            HStack(spacing: 6) {
                Text(WeatherGlyph.moon(code: payload.today?.moonPhaseCode)).font(.title2)
                VStack(alignment: .leading, spacing: 1) {
                    Text("Moon").font(.caption2).foregroundStyle(Theme.muted)
                    Text(payload.today?.moonPhase ?? "—").font(.caption.weight(.semibold)).foregroundStyle(Theme.text)
                        .lineLimit(1).minimumScaleFactor(0.8)
                }
            }
            .accessibilityElement(children: .combine)
        }
        .accessibilityElement(children: .contain)
    }

    private func astro(symbol: String, tint: Color, title: String, value: String) -> some View {
        HStack(spacing: 6) {
            Image(systemName: symbol).font(.title3).foregroundStyle(tint)
            VStack(alignment: .leading, spacing: 1) {
                Text(title).font(.caption2).foregroundStyle(Theme.muted)
                Text(value).font(.caption.weight(.semibold)).foregroundStyle(Theme.text)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

struct Stat: Identifiable {
    let title: String      // spoken name: "Wind", "Dew point"
    let symbol: String
    let value: String
    let label: String
    var id: String { symbol + label }
}

struct StatsGrid: View {
    let stats: [Stat]
    @Environment(\.dynamicTypeSize) private var typeSize

    /// 4 across normally; 2 then 1 as text grows so values never truncate.
    private var columns: [GridItem] {
        let n = typeSize >= .accessibility1 ? 1 : (typeSize >= .xLarge ? 2 : 4)
        return Array(repeating: GridItem(.flexible(), spacing: 8, alignment: .top), count: n)
    }

    var body: some View {
        LazyVGrid(columns: columns, spacing: 14) {
            ForEach(stats) { s in
                VStack(spacing: 3) {
                    Image(systemName: s.symbol).scaledFont(15, relativeTo: .body).foregroundStyle(Theme.muted)
                    Text(s.value)
                        .scaledFont(14, weight: .semibold, relativeTo: .body).foregroundStyle(Theme.strong)
                        .lineLimit(1).minimumScaleFactor(0.65)
                    Text(s.label)
                        .scaledFont(10, relativeTo: .caption).foregroundStyle(Theme.muted)
                        .multilineTextAlignment(.center).lineLimit(2).minimumScaleFactor(0.8)
                }
                .frame(maxWidth: .infinity)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(s.title)
                .accessibilityValue(AccessibilityText.spoken(s.value) + (s.label == s.title ? "" : ", " + AccessibilityText.spoken(s.label)))
            }
        }
    }
}

struct HourlyStrip: View {
    let cells: [WeatherInsights.StripCell]
    @Environment(\.staticRender) private var staticRender

    var body: some View {
        if staticRender {
            // Overlay so the row's ~500 pt ideal width can't widen the card.
            Color.clear.frame(height: 86).frame(maxWidth: .infinity)
                .overlay(alignment: .leading) { row.fixedSize() }
                .clipped()
        } else {
            ScrollView(.horizontal, showsIndicators: false) { row }
        }
    }

    private var row: some View {
            HStack(spacing: 4) {
                ForEach(cells) { cell in
                    VStack(spacing: 4) {
                        Text(cell.time).scaledFont(11, relativeTo: .caption).foregroundStyle(cell.isNow ? Theme.warmText : Theme.muted)
                            .fontWeight(cell.isNow ? .semibold : .regular)
                        Text(cell.glyph).scaledFont(22, relativeTo: .title3)
                        Text(cell.temp).scaledFont(15, weight: .semibold, relativeTo: .body).foregroundStyle(Theme.strong)
                        Text(cell.precip).scaledFont(11, relativeTo: .caption)
                            .foregroundStyle(cell.precip == "·" ? Theme.fade : Theme.blue)
                    }
                    .frame(minWidth: 46)
                    .padding(.vertical, 8)
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel(AccessibilityText.stripCell(cell))
                    .background(cell.isNow ? Theme.warm.opacity(0.12) : .clear, in: RoundedRectangle(cornerRadius: 10))
                }
            }
    }
}
