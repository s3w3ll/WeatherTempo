import Foundation

/// The sentences VoiceOver reads. Visual labels are terse ("21.2 km/h", "↑ Rising", "1018 hPa");
/// these expand units and symbols into words and fold each card into one coherent phrase, so
/// a screen-reader user hears "Wind, 21.2 kilometres per hour, south-west" instead of a stream
/// of fragments. Pure functions, unit-tested.
public enum AccessibilityText {

    // MARK: Units and symbols -> words

    /// "21.2 km/h" -> "21.2 kilometres per hour", "14°" -> "14 degrees", "56%" -> "56 percent".
    public static func spoken(_ text: String) -> String {
        var s = text
        let swaps: [(String, String)] = [
            ("°", " degrees"), ("%", " percent"),
            ("km/h", "kilometres per hour"), ("hPa", "hectopascals"),
            ("↑ ", ""), ("↓ ", ""), ("→ ", ""), ("·", ","), ("–", " to "),
        ]
        for (a, b) in swaps { s = s.replacingOccurrences(of: a, with: b) }
        // "mm" and "m" only as whole unit words after a number
        s = s.replacingOccurrences(of: #"(\d) mm\b"#, with: "$1 millimetres", options: .regularExpression)
        s = s.replacingOccurrences(of: #"(\d) m\b"#, with: "$1 metres", options: .regularExpression)
        return s.replacingOccurrences(of: "  ", with: " ").trimmingCharacters(in: .whitespaces)
    }

    private static func degrees(_ v: Double?) -> String? {
        v.map { "\(Int($0.rounded())) degrees" }
    }

    /// "at 3pm", or nil when the time is unknown.
    private static func at(_ utcSec: Double?, _ tz: TimeZone) -> String? {
        guard let s = utcSec, s != 0 else { return nil }
        return "at \(TimeFormat.hour(s, in: tz))"
    }

    // MARK: Conditions card

    /// "Currently 16 degrees, Partly Cloudy. Feels like 13 degrees. High 17 degrees at 3pm, low 7 degrees at 3am."
    public static func current(_ payload: WeatherPayload, _ insights: WeatherInsights) -> String {
        let c = payload.current
        var sentences: [String] = []

        var now = degrees(c.temp).map { "Currently \($0)" } ?? "Current temperature unavailable"
        if let cond = c.condition ?? c.cloudPhrase { now += ", \(cond)" }
        sentences.append(now)

        if let feels = degrees(c.feelsLike) { sentences.append("Feels like \(feels)") }

        if let hl = insights.displayHighLow {
            var parts: [String] = []
            if let h = degrees(hl.high.temp) { parts.append(["High", h, at(hl.high.utcSec, insights.timeZone)].compactMap { $0 }.joined(separator: " ")) }
            if let l = degrees(hl.low.temp) { parts.append(["low", l, at(hl.low.utcSec, insights.timeZone)].compactMap { $0 }.joined(separator: " ")) }
            if !parts.isEmpty { sentences.append(parts.joined(separator: ", ")) }
        }
        return sentences.joined(separator: ". ") + "."
    }

    /// "Now, 16 degrees, 63 percent chance of rain" (the strip's cells).
    public static func stripCell(_ cell: WeatherInsights.StripCell) -> String {
        var s = "\(cell.time), \(spoken(cell.temp))"
        if cell.precip != "·" { s += ", \(spoken(cell.precip)) chance of rain" }
        return s
    }

    // MARK: Day forecast card

    public static func day(_ f: WeatherInsights.DayForecast, timeZone tz: TimeZone) -> String {
        var s: [String] = ["\(f.label), \(f.date)"]

        var temps: [String] = []
        if let h = degrees(f.tempMax.value) { temps.append(["High", h, at(f.tempMax.utcSec, tz)].compactMap { $0 }.joined(separator: " ")) }
        if let l = degrees(f.tempMin.value) { temps.append(["low", l, at(f.tempMin.utcSec, tz)].compactMap { $0 }.joined(separator: " ")) }
        if !temps.isEmpty { s.append(temps.joined(separator: ", ")) }

        if let hi = f.humidityMax.value, let lo = f.humidityMin.value {
            s.append("Humidity \(Int(lo.rounded())) to \(Int(hi.rounded())) percent")
        }
        if f.sunrise != nil || f.sunset != nil {
            s.append("Sunrise \(TimeFormat.hourMinute(f.sunrise, in: tz)), sunset \(TimeFormat.hourMinute(f.sunset, in: tz))")
        }
        if let w = f.windSpeed {
            s.append("Wind \(NumberFormat.trimmed(w)) kilometres per hour \(f.windCardinal ?? "")".trimmingCharacters(in: .whitespaces)
                     + (at(f.windUtcSec, tz).map { " \($0)" } ?? ""))
        }
        if let mm = f.totalMm, let chance = f.maxChance {
            s.append(mm == 0 ? "No rain, \(NumberFormat.trimmed(chance)) percent chance"
                             : "Rain \(NumberFormat.trimmed(mm)) millimetres, up to \(NumberFormat.trimmed(chance)) percent chance")
        }
        if let uv = f.uvPeak {
            s.append("UV \(spoken(WeatherInsights.uvLabel(uv)))" + (f.uvWindow.map { ", \(spoken($0))" } ?? ", below 3 all day"))
        }
        if let hi = f.pressureMax.value, let lo = f.pressureMin.value {
            s.append("Pressure \(Int(lo.rounded())) to \(Int(hi.rounded())) hectopascals")
        }
        return s.joined(separator: ". ") + "."
    }

    // MARK: Tides

    public static func tideHeader(_ t: TideSummary) -> String {
        "\(t.label). Now \(String(format: "%.1f", t.currentHeight)) metres, \(t.trend == .rising ? "rising" : "falling")"
    }

    public static func tideEvent(_ e: TideEvent, timeZone tz: TimeZone) -> String {
        "\(e.kind == .high ? "High" : "Low") tide at \(TimeFormat.hourMinute(e.time.timeIntervalSince1970, in: tz, spaced: true)), \(String(format: "%.1f", e.height)) metres"
    }

    // MARK: Widgets

    public static func daily(_ c: WeatherInsights.DailyCell) -> String {
        var s = c.label
        if let h = degrees(c.high) { s += ", high \(h)" }
        if let l = degrees(c.low) { s += ", low \(l)" }
        if let p = c.rainChance, p >= 20 { s += ", \(Int(p.rounded())) percent chance of rain" }
        return s
    }
}

extension MeteogramModel {

    /// One-paragraph description of the whole chart for VoiceOver, because a canvas has no
    /// accessible structure of its own.
    public var accessibilitySummary: String {
        guard let first = hours.first else { return "Forecast chart, no data." }
        let temps = hours.compactMap(\.temperature)
        var s: [String] = ["Forecast chart, \(hours.count) hours from \(detailTitle(for: 0))"]
        _ = first

        if let lo = temps.min(), let hi = temps.max() {
            s.append("Temperature from \(Int(lo.rounded())) to \(Int(hi.rounded())) degrees")
        }
        if let wind = hours.compactMap(\.windSpeed).max() {
            s.append("Wind up to \(Int(wind.rounded())) kilometres per hour")
        }
        let total = hours.reduce(0) { $0 + ($1.qpf ?? 0) }
        if total < 0.1 {
            s.append("No rain expected")
        } else if let wettest = hours.indices.max(by: { (hours[$0].qpf ?? 0) < (hours[$1].qpf ?? 0) }) {
            s.append("Rain \(NumberFormat.trimmed((total * 10).rounded() / 10)) millimetres in total, heaviest around \(detailTitle(for: wettest))")
        }
        return s.joined(separator: ". ") + ". Swipe up or down to step through the hours."
    }

    /// The selected hour as a sentence (the web tooltip's rows, minus the dashes).
    public func spokenDetail(for index: Int) -> String {
        guard hours.indices.contains(index) else { return "" }
        let rows = detailRows(for: index)
            .filter { $0.value != "—" }
            .map { "\($0.label) \(AccessibilityText.spoken($0.value))" }
        return ([detailTitle(for: index)] + rows).joined(separator: ". ")
    }
}
