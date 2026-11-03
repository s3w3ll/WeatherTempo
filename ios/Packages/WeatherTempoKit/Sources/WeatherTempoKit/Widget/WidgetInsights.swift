import Foundation

extension WeatherInsights {

    public enum RainIntensity: Equatable {
        case light, moderate, heavy

        /// Same bands as `precipIntensityLabel` in the Scriptable widget (mm per hour).
        public static func classify(qpf: Double?) -> RainIntensity? {
            guard let q = qpf, q > 0 else { return nil }
            if q >= 4 { return .heavy }
            if q >= 1 { return .moderate }
            return .light
        }

        public var label: String {
            switch self {
            case .light: return "Light rain"
            case .moderate: return "Moderate rain"
            case .heavy: return "Heavy rain"
            }
        }
    }

    public struct RainEvent: Equatable {
        public let utcSec: Double
        public let qpf: Double
        public let intensity: RainIntensity

        public func summary(in tz: TimeZone) -> String {
            "\(intensity.label) at \(TimeFormat.hour(utcSec, in: tz))"
        }
    }

    /// The next hour *today* with more than 0.1 mm of rain: the large widget's status line
    /// ("Moderate rain at 5pm"). Restricted to today's local calendar day because the hourly
    /// series spans five days and rain three days out doesn't belong on a right-now line.
    /// The search starts 30 minutes back so the just-turned hour still counts.
    public var nextRainToday: RainEvent? {
        let todayKey = TimeFormat.dayKey(now.timeIntervalSince1970, in: TimeFormat.calendar(timeZone))
        let from = payload.hourly.firstIndex { $0.validTimeUtc >= now.timeIntervalSince1970 - 1800 } ?? 0
        let cal = TimeFormat.calendar(timeZone)
        for h in payload.hourly[from...] {
            guard let q = h.qpf, q > 0.1,
                  TimeFormat.dayKey(h.validTimeUtc, in: cal) == todayKey,
                  let intensity = RainIntensity.classify(qpf: q) else { continue }
            return RainEvent(utcSec: h.validTimeUtc, qpf: q, intensity: intensity)
        }
        return nil
    }

    public struct DailyCell: Equatable, Identifiable {
        public let id: Int
        public let label: String       // "Today", "Thu"
        public let high: Double?
        public let low: Double?
        public let rainChance: Double? // peak % that day
    }

    /// One compact cell per forecast day (the widget's bottom row).
    public var dailyStrip: [DailyCell] {
        payload.daily.prefix(5).enumerated().map { i, d in
            let refTs = d.sunriseTimeUtc.flatMap { $0 != 0 ? $0 : nil }
                ?? (now.timeIntervalSince1970.rounded() + Double(i) * 86_400)
            return DailyCell(
                id: i,
                label: i == 0 ? "Today" : TimeFormat.weekday(refTs, in: timeZone, long: false),
                high: d.calendarDayTemperatureMax,
                low: d.calendarDayTemperatureMin,
                rainChance: dayForecast(dayIndex: i)?.maxChance)
        }
    }

    /// Hours from "now" onward for the widget chart (30 min grace, like the strip).
    public func upcomingHours(limit: Int) -> [Hour] {
        let from = payload.hourly.firstIndex { $0.validTimeUtc >= now.timeIntervalSince1970 - 1800 } ?? 0
        return Array(payload.hourly[from...].prefix(limit))
    }
}
