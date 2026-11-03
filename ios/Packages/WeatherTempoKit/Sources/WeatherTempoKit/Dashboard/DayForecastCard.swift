import SwiftUI

/// One forecast day (the web `.day-card`): hi/lo with times, humidity range, sun times,
/// wind, rain, UV and pressure range.
struct DayForecastCard: View {
    let forecast: WeatherInsights.DayForecast
    let timeZone: TimeZone

    private func hour(_ s: Double?) -> String { TimeFormat.hour(s, in: timeZone) }
    private func pct(_ r: WeatherInsights.Reading) -> String { r.value.map { "\(NumberFormat.trimmed($0))%" } ?? "—" }
    private func hPa(_ r: WeatherInsights.Reading) -> String { NumberFormat.rounded(r.value, suffix: " hPa") }

    var body: some View {
        let f = forecast
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Text(f.label).font(.headline).foregroundStyle(Theme.strong)
                Text(f.date).font(.caption).foregroundStyle(Theme.muted)
                Spacer()
                temp(up: true, f.tempMax)
                temp(up: false, f.tempMin)
            }

            row("💧") {
                Text("Hi ").foregroundStyle(Theme.muted) + Text(pct(f.humidityMax)).foregroundStyle(Theme.blue).bold()
                    + Text(" \(hour(f.humidityMax.utcSec))  ·  Lo ").foregroundStyle(Theme.muted)
                    + Text(pct(f.humidityMin)).foregroundStyle(Theme.cyan).bold()
                    + Text(" \(hour(f.humidityMin.utcSec))").foregroundStyle(Theme.muted)
            }

            Divider().overlay(Theme.separator)

            HStack(spacing: 18) {
                sun("sunrise", Theme.warm, TimeFormat.hourMinute(f.sunrise, in: timeZone))
                sun("sunset", Color(r: 255, g: 140, b: 80), TimeFormat.hourMinute(f.sunset, in: timeZone))
            }

            Divider().overlay(Theme.separator)

            row("💨") {
                Text(windText).foregroundStyle(Theme.red).bold()
            }
            row("🌧") {
                Text(precipText).foregroundStyle(Theme.blue).bold()
            }
            row("☀️") {
                Text("UV \(f.uvPeak.map { WeatherInsights.uvLabel($0) } ?? "—")").foregroundStyle(Theme.warm).bold()
                    + Text("  ·  \(f.uvWindow ?? "Below 3")").foregroundStyle(Theme.muted)
            }

            Divider().overlay(Theme.separator)

            HStack(spacing: 18) {
                pressure(up: true, f.pressureMax)
                pressure(up: false, f.pressureMin)
            }
        }
        .font(.system(size: 13))
        .dashboardCard()
    }

    private var windText: String {
        guard let speed = forecast.windSpeed else { return "—" }
        return "\(NumberFormat.trimmed(speed)) km/h \(forecast.windCardinal ?? "") at \(hour(forecast.windUtcSec))"
            .replacingOccurrences(of: "  ", with: " ")
    }

    private var precipText: String {
        guard let mm = forecast.totalMm, let chance = forecast.maxChance else { return "—" }
        return "\(NumberFormat.trimmed(mm)) mm · \(NumberFormat.trimmed(chance))%"
    }

    private func temp(up: Bool, _ r: WeatherInsights.Reading) -> some View {
        HStack(spacing: 3) {
            Image(systemName: up ? "arrowtriangle.up.fill" : "arrowtriangle.down.fill")
                .font(.system(size: 8)).foregroundStyle(up ? Theme.warm : Theme.cyan)
            Text(NumberFormat.rounded(r.value, suffix: "°"))
                .font(.system(size: 16, weight: .semibold)).foregroundStyle(up ? Theme.warm : Theme.cyan)
            Text(hour(r.utcSec)).font(.caption2).foregroundStyle(Theme.muted)
        }
    }

    private func sun(_ symbol: String, _ tint: Color, _ time: String) -> some View {
        HStack(spacing: 5) {
            Image(systemName: symbol).foregroundStyle(tint)
            Text(time).foregroundStyle(Theme.text).fontWeight(.medium)
        }
    }

    private func pressure(up: Bool, _ r: WeatherInsights.Reading) -> some View {
        HStack(spacing: 4) {
            Image(systemName: up ? "arrowtriangle.up.fill" : "arrowtriangle.down.fill")
                .font(.system(size: 8)).foregroundStyle(up ? Theme.warm : Theme.cyan)
            Text(hPa(r)).foregroundStyle(Theme.text).fontWeight(.semibold)
            Text(hour(r.utcSec)).font(.caption2).foregroundStyle(Theme.muted)
        }
    }

    private func row<Content: View>(_ icon: String, @ViewBuilder _ content: () -> Content) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(icon).frame(width: 20)
            content()
            Spacer(minLength: 0)
        }
    }
}
