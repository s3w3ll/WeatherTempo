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
            HStack(alignment: .center) {
                Text(insights.currentGlyph).font(.system(size: 40))
                Text(c.temp.map { "\(Int($0.rounded()))°" } ?? "—°")
                    .font(.system(size: 56, weight: .light))
                    .foregroundStyle(Theme.strong)
                    .minimumScaleFactor(0.7)
                Spacer(minLength: 8)
                if let hl = insights.displayHighLow {
                    VStack(alignment: .trailing, spacing: 6) {
                        extremeRow(up: true, hl.high)
                        extremeRow(up: false, hl.low)
                    }
                }
            }
            Text(c.condition ?? c.cloudPhrase ?? "—")
                .font(.headline).foregroundStyle(Theme.text)
            if let feels = c.feelsLike {
                Text("Feels like \(Int(feels.rounded()))°").font(.subheadline).foregroundStyle(Theme.muted)
            }
        }
    }

    private func extremeRow(up: Bool, _ e: WeatherInsights.Extreme) -> some View {
        HStack(spacing: 5) {
            Image(systemName: up ? "arrowtriangle.up.fill" : "arrowtriangle.down.fill")
                .font(.system(size: 9)).foregroundStyle(up ? Theme.warm : Theme.cyan)
            Text(NumberFormat.rounded(e.temp, suffix: "°"))
                .font(.system(size: 17, weight: .semibold)).foregroundStyle(up ? Theme.warm : Theme.cyan)
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
            Stat(symbol: "humidity", value: c.humidity.map { "\(NumberFormat.trimmed($0))%" } ?? "—", label: "Humidity"),
            Stat(symbol: "wind", value: c.windSpeed.map { "\(NumberFormat.trimmed($0)) km/h" } ?? "—",
                 label: insights.currentWindCardinal),
            Stat(symbol: "wind.snow", value: gust.map { "\(Int($0.rounded())) km/h" } ?? "—", label: "Gust"),
            Stat(symbol: "gauge", value: NumberFormat.rounded(c.pressure, suffix: " hPa"),
                 label: insights.pressureTrend?.label ?? "Pressure"),
            Stat(symbol: "drop", value: NumberFormat.rounded(c.dewPoint, suffix: "°"), label: "Dew point"),
            Stat(symbol: "cloud", value: insights.currentCloudCover.map { "\(NumberFormat.trimmed($0))%" } ?? "—", label: "Cloud"),
            Stat(symbol: "cloud.rain", value: agg.rainMm.map { "\(NumberFormat.trimmed($0)) mm" } ?? "—",
                 label: agg.peakChance.map { "Peak \(NumberFormat.trimmed($0))%" } ?? "Rain today"),
            Stat(symbol: "sun.max", value: c.uvIndex.map { WeatherInsights.uvLabel($0) } ?? "—", label: uvLabel),
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
        }
    }

    private func astro(symbol: String, tint: Color, title: String, value: String) -> some View {
        HStack(spacing: 6) {
            Image(systemName: symbol).font(.title3).foregroundStyle(tint)
            VStack(alignment: .leading, spacing: 1) {
                Text(title).font(.caption2).foregroundStyle(Theme.muted)
                Text(value).font(.caption.weight(.semibold)).foregroundStyle(Theme.text)
            }
        }
    }
}

struct Stat: Identifiable {
    let symbol: String
    let value: String
    let label: String
    var id: String { symbol + label }
}

struct StatsGrid: View {
    let stats: [Stat]
    private let columns = Array(repeating: GridItem(.flexible(), spacing: 8, alignment: .top), count: 4)

    var body: some View {
        LazyVGrid(columns: columns, spacing: 14) {
            ForEach(stats) { s in
                VStack(spacing: 3) {
                    Image(systemName: s.symbol).font(.system(size: 15)).foregroundStyle(Theme.muted)
                    Text(s.value)
                        .font(.system(size: 14, weight: .semibold)).foregroundStyle(Theme.strong)
                        .lineLimit(1).minimumScaleFactor(0.65)
                    Text(s.label)
                        .font(.system(size: 10)).foregroundStyle(Theme.muted)
                        .multilineTextAlignment(.center).lineLimit(2).minimumScaleFactor(0.8)
                }
                .frame(maxWidth: .infinity)
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
                        Text(cell.time).font(.system(size: 11)).foregroundStyle(cell.isNow ? Theme.warm : Theme.muted)
                            .fontWeight(cell.isNow ? .semibold : .regular)
                        Text(cell.glyph).font(.system(size: 22))
                        Text(cell.temp).font(.system(size: 15, weight: .semibold)).foregroundStyle(Theme.strong)
                        Text(cell.precip).font(.system(size: 11))
                            .foregroundStyle(cell.precip == "·" ? Theme.fade : Theme.blue)
                    }
                    .frame(width: 46)
                    .padding(.vertical, 8)
                    .background(cell.isNow ? Theme.warm.opacity(0.12) : .clear, in: RoundedRectangle(cornerRadius: 10))
                }
            }
    }
}
