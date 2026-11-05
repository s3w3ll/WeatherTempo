import Foundation

// Pure geometry for the week overview strip and the pressure trend strip. No drawing here;
// the views in WeekOverviewStrip.swift / PressureTrendStrip.swift follow these numbers.

extension MeteogramModel {

    // MARK: Week overview

    /// One column of the week strip: a local calendar day of the hourly series.
    public struct WeekDay: Equatable, Identifiable {
        public var id: Int { startIndex }
        /// Hour indices `startIndex..<endIndex` in `hours`.
        public let startIndex: Int
        public let endIndex: Int
        public let label: String        // "Tue"
        public let glyph: String        // weather emoji around midday (or the middle hour)
        public let low: Double?
        public let high: Double?
        public let maxChance: Double?
        public let totalMm: Double
        /// Sum of each hour's `sunshine` (0...1): a clear daylight hour adds 1, a half-cloudy one 0.5.
        public let sunshineHours: Double

        public var hourCount: Int { endIndex - startIndex }
    }

    public var weekDays: [WeekDay] {
        guard !hours.isEmpty else { return [] }
        let bounds = [0] + dayBoundaries + [hours.count]
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_NZ"); f.timeZone = timeZone; f.dateFormat = "EEE"
        var cal = Calendar(identifier: .gregorian); cal.timeZone = timeZone
        let sun = sunshine

        return (0..<(bounds.count - 1)).map { b in
            let range = bounds[b]..<bounds[b + 1]
            let slice = hours[range]
            let temps = slice.compactMap(\.temperature)
            // The 1pm hour if the day has one, else the middle of whatever part of the day we have.
            let iconHour = slice.first { cal.component(.hour, from: $0.date) == 13 } ?? hours[(range.lowerBound + range.upperBound - 1) / 2]
            return WeekDay(
                startIndex: range.lowerBound, endIndex: range.upperBound,
                label: f.string(from: hours[range.lowerBound].date),
                glyph: WeatherGlyph.emoji(iconCode: iconHour.iconCode, dayOrNight: iconHour.dayOrNight),
                low: temps.min(), high: temps.max(),
                maxChance: slice.compactMap(\.precipChance).max(),
                totalMm: slice.reduce(0) { $0 + ($1.qpf ?? 0) },
                sunshineHours: sun[range].reduce(0, +))
        }
    }

    /// Lowest and highest temperature across the whole series: the scale for the strip's range bars.
    public var weekTemperatureRange: ClosedRange<Double>? {
        let temps = hours.compactMap(\.temperature)
        guard let lo = temps.min(), let hi = temps.max() else { return nil }
        return lo...max(hi, lo + 1)
    }

    /// The part of the series showing in a `viewport`-wide window scrolled to `scrollX`,
    /// as fractions 0...1 of all hours. The strip's columns are proportional to hours, so
    /// these fractions map straight onto strip x positions.
    public func visibleFraction(scrollX: Double, viewport: Double) -> ClosedRange<Double> {
        let total = Double(hours.count) * pxPerHour
        guard total > 0 else { return 0...1 }
        let a = min(max((scrollX - ChartPad.left) / total, 0), 1)
        let b = min(max((scrollX + viewport - ChartPad.left) / total, a), 1)
        return a...b
    }

    /// The initial scroll position the live chart uses: "now" 30 % in from the left.
    public func initialScrollX(viewport: Double) -> Double {
        min(max(0, hourX(nowIndex) - viewport * 0.3), max(0, width - viewport))
    }

    // MARK: Pressure trend

    /// Pressure tendency over the previous three hours, in the bands marine and aviation
    /// forecasts use (hPa per 3 h): steady < 0.5, slowly < 1.6, quickly < 3.6, rapidly beyond.
    public struct PressureTendency: Equatable, Sendable {
        public enum Direction: Equatable, Sendable { case rising, falling, steady }
        public let direction: Direction
        /// 0 steady, 1 slowly, 2 quickly, 3 rapidly.
        public let strength: Int
        /// Change in hPa over three hours (signed).
        public let change: Double

        public init(changePer3h d: Double) {
            change = d
            let m = abs(d)
            strength = m < 0.5 ? 0 : m < 1.6 ? 1 : m < 3.6 ? 2 : 3
            direction = strength == 0 ? .steady : (d > 0 ? .rising : .falling)
        }

        public var label: String {
            switch direction {
            case .steady: return "Steady"
            case .rising, .falling:
                let verb = direction == .rising ? "Rising" : "Falling"
                return "\(verb) \(["", "slowly", "quickly", "rapidly"][strength])"
            }
        }
    }

    /// Tendency per hour, from the change since three hours earlier (scaled to 3 h when the
    /// series has fewer earlier hours). nil where pressure is missing.
    public var pressureTendencies: [PressureTendency?] {
        hours.indices.map { i in
            guard let p = hours[i].pressureMeanSeaLevel else { return nil }
            // Look back up to 3 hours for a reading; at the very start, look forward instead.
            for back in stride(from: 3, through: 1, by: -1) where i - back >= 0 {
                if let q = hours[i - back].pressureMeanSeaLevel { return PressureTendency(changePer3h: (p - q) * 3 / Double(back)) }
            }
            for ahead in 1...3 where i + ahead < hours.count {
                if let q = hours[i + ahead].pressureMeanSeaLevel { return PressureTendency(changePer3h: (q - p) * 3 / Double(ahead)) }
            }
            return nil
        }
    }

    /// Runs of hours with the same direction (steady included), for labelling the strip.
    public struct TendencyRun: Equatable {
        public let range: Range<Int>
        public let direction: PressureTendency.Direction
        public let maxStrength: Int
        public var label: String {
            direction == .steady ? "Steady"
                : PressureTendency(changePer3h: (direction == .rising ? 1 : -1) * [0, 1, 2, 4][maxStrength]).label
        }
    }

    public var pressureTendencyRuns: [TendencyRun] {
        let t = pressureTendencies
        var runs: [TendencyRun] = []
        var i = 0
        while i < t.count {
            guard let first = t[i] else { i += 1; continue }
            let start = i
            var strength = first.strength
            while i < t.count, let x = t[i], x.direction == first.direction {
                strength = max(strength, x.strength); i += 1
            }
            runs.append(TendencyRun(range: start..<i, direction: first.direction, maxStrength: strength))
        }
        return runs
    }
}
