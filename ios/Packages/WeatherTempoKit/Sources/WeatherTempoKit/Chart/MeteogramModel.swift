import Foundation
import CoreGraphics

/// Everything chart.js works out *before* drawing: data ranges, coordinate mapping,
/// cloud runs, day boundaries, axis labels and high/low markers. No drawing happens
/// here, so it is unit-tested directly. The renderer only has to follow it.
public struct MeteogramModel: Equatable {
    public typealias Hour = WeatherPayload.Hour

    public static let nzTimeZone = TimeZone(identifier: "Pacific/Auckland")!
    /// chart.js never goes below 8 px per hour, so long ranges scroll instead of cramming.
    public static let minPxPerHour: Double = 8

    public let hours: [Hour]
    public let pxPerHour: Double
    public let timeZone: TimeZone

    public let tMin: Double
    public let tMax: Double
    public let pMin: Double
    public let pMax: Double
    public let qMax: Double
    /// First hour at or after "now" (0 if the whole series is in the past), as in chart.js.
    public let nowIndex: Int

    private let calendar: Calendar

    /// px/hour so that `days` days exactly fill `viewportWidth` (`_setup()` in chart.js).
    public static func pxPerHour(viewportWidth: Double, days: Int) -> Double {
        max(minPxPerHour, (viewportWidth - ChartPad.left - ChartPad.right) / Double(max(1, days) * 24))
    }

    public init(hours: [Hour], pxPerHour: Double, now: Date = Date(), timeZone: TimeZone = MeteogramModel.nzTimeZone) {
        self.hours = hours
        self.pxPerHour = pxPerHour
        self.timeZone = timeZone

        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = timeZone
        self.calendar = cal

        // Temperature range spans temp *and* feels-like, padded by 2 degrees.
        let temps = hours.compactMap(\.temperature) + hours.compactMap(\.temperatureFeelsLike)
        tMin = (temps.min() ?? 8) - 2
        tMax = (temps.max() ?? 18) + 2

        let pressures = hours.compactMap(\.pressureMeanSeaLevel)
        pMin = pressures.min().map { $0 - 2 } ?? 1000
        pMax = pressures.max().map { $0 + 2 } ?? 1030

        qMax = max(1, hours.map { $0.qpf ?? 0 }.max() ?? 0)

        let nowSec = now.timeIntervalSince1970
        nowIndex = hours.firstIndex { $0.validTimeUtc >= nowSec } ?? 0
    }

    // MARK: Size

    public var width: Double { ChartPad.left + Double(hours.count) * pxPerHour + ChartPad.right }
    public var height: Double { ChartZone.height }

    // MARK: Coordinate mapping

    public func hourX(_ i: Int) -> Double { ChartPad.left + Double(i) * pxPerHour + pxPerHour / 2 }

    public func tempY(_ t: Double) -> Double {
        ChartZone.tempBot - (t - tMin) / (tMax - tMin) * (ChartZone.tempBot - ChartZone.tempTop)
    }

    public func pressureY(_ p: Double) -> Double {
        ChartZone.tempBot - (p - pMin) / (pMax - pMin) * (ChartZone.tempBot - ChartZone.tempTop)
    }

    /// Wind speed ceiling in km/h; 30 km/h lands at exactly one third of the zone height.
    public static let maxWindSpeed: Double = 90

    public func windY(_ speed: Double) -> Double {
        let zoneH = ChartZone.windBot - ChartZone.windTop
        let clamped = min(max(speed, 0), Self.maxWindSpeed)
        return ChartZone.windBot - clamped / Self.maxWindSpeed * zoneH
    }

    /// Rain probability: 0 % at the bottom of the precip zone, 100 % at the top.
    public func probabilityY(_ percent: Double) -> Double {
        ChartZone.precipBot - percent / 100 * (ChartZone.precipBot - ChartZone.precipTop)
    }

    /// Hour index nearest to an x position (hover/touch), clamped to the data.
    public func hourIndex(atX x: Double) -> Int {
        guard !hours.isEmpty else { return 0 }
        let raw = ((x - ChartPad.left - pxPerHour / 2) / pxPerHour).rounded()
        return min(max(Int(raw), 0), hours.count - 1)
    }

    // MARK: Cloud cover

    /// Consecutive hours with at least 10 % cloud; each becomes one blurred cloud shape.
    public var cloudRuns: [Range<Int>] {
        var runs: [Range<Int>] = []
        var i = 0
        while i < hours.count {
            if (hours[i].cloudCover ?? 0) < 10 { i += 1; continue }
            let start = i
            while i < hours.count && (hours[i].cloudCover ?? 0) >= 10 { i += 1 }
            runs.append(start..<i)
        }
        return runs
    }

    // MARK: Days and axis labels

    /// Indices (>= 1) where the local calendar day changes.
    public var dayBoundaries: [Int] {
        guard hours.count > 1 else { return [] }
        return (1..<hours.count).filter { !calendar.isDate(hours[$0 - 1].date, inSameDayAs: hours[$0].date) }
    }

    public struct DayLabel: Equatable {
        public let startIndex: Int
        public let x0: Double
        public let x1: Double
        public let text: String
        public var centerX: Double { (x0 + x1) / 2 }
    }

    /// One label per calendar day. Long weekday name when the day is wider than 100 px.
    public var dayLabels: [DayLabel] {
        guard !hours.isEmpty else { return [] }
        let bounds = [0] + dayBoundaries + [hours.count]

        let long = DateFormatter(); long.locale = Locale(identifier: "en_NZ"); long.timeZone = timeZone; long.dateFormat = "EEEE"
        let short = DateFormatter(); short.locale = Locale(identifier: "en_NZ"); short.timeZone = timeZone; short.dateFormat = "EEE"

        return (0..<(bounds.count - 1)).map { b in
            let startI = bounds[b]
            let endI = bounds[b + 1] - 1
            let x0 = hourX(startI) - pxPerHour / 2
            let x1 = hourX(endI) + pxPerHour / 2
            let formatter = (x1 - x0) > 100 ? long : short
            return DayLabel(startIndex: startI, x0: x0, x1: x1, text: formatter.string(from: hours[startI].date))
        }
    }

    public struct HourLabel: Equatable {
        public let index: Int
        public let x: Double
        public let text: String
    }

    /// "12am 3am 6am ..." every third local hour.
    public var hourLabels: [HourLabel] {
        hours.enumerated().compactMap { i, h in
            guard h.validTimeUtc != 0 else { return nil }
            let hour = calendar.component(.hour, from: h.date)
            guard hour % 3 == 0 else { return nil }
            let text: String
            switch hour {
            case 0: text = "12am"
            case 12: text = "12pm"
            case 13...: text = "\(hour - 12)pm"
            default: text = "\(hour)am"
            }
            return HourLabel(index: i, x: hourX(i), text: text)
        }
    }

    // MARK: Temperature markers

    public struct TempMarker: Equatable {
        public let index: Int
        public let isHigh: Bool
    }

    /// Splits the series into contiguous day/night runs, then marks the warmest hour of
    /// each day run and the coolest of each night run (partial runs at the ends included).
    public var tempMarkers: [TempMarker] {
        guard !hours.isEmpty else { return [] }
        var markers: [TempMarker] = []
        var runStart = 0
        for i in 1...hours.count {
            let ended = i == hours.count || hours[i].dayOrNight != hours[runStart].dayOrNight
            guard ended else { continue }
            let isDay = hours[runStart].dayOrNight == "D"
            var pick = runStart
            for j in (runStart + 1)..<max(i, runStart + 1) {
                let t = hours[j].temperature ?? 0
                let p = hours[pick].temperature ?? 0
                if isDay ? t > p : t < p { pick = j }
            }
            markers.append(TempMarker(index: pick, isHigh: isDay))
            runStart = i
        }
        return markers
    }

    // MARK: Wind arrows

    public struct WindArrow: Equatable {
        public let shaftStart: CGPoint
        public let shaftEnd: CGPoint
        public let headTip: CGPoint
        public let headLeft: CGPoint
        public let headRight: CGPoint
    }

    /// Arrow centred on (x, y) pointing where the wind is blowing *to*.
    /// `directionFrom` is the meteorological bearing the wind comes from (0 = N, 90 = E).
    /// Pure trig on screen coordinates (y down), so no canvas rotation conversion is
    /// needed, same as drawWindIndicators() in chart.js.
    public static func windArrow(x: Double, y: Double, directionFrom: Double) -> WindArrow {
        let L = 5.0
        let rad = (directionFrom + 180) * .pi / 180
        let dx = sin(rad) * L
        let dy = -cos(rad) * L

        let tipX = x + dx * 0.6
        let tipY = y + dy * 0.6
        let hw = min(max(L * 0.45, 2.5), 4)
        let px = -dy / L * hw
        let py = dx / L * hw

        return WindArrow(
            shaftStart: CGPoint(x: x - dx * 0.6, y: y - dy * 0.6),
            shaftEnd: CGPoint(x: tipX, y: tipY),
            headTip: CGPoint(x: tipX + dx * 0.5, y: tipY + dy * 0.5),
            headLeft: CGPoint(x: tipX - dx * 0.3 + px, y: tipY - dy * 0.3 + py),
            headRight: CGPoint(x: tipX - dx * 0.3 - px, y: tipY - dy * 0.3 - py))
    }

    // MARK: Hover detail

    public struct DetailRow: Equatable {
        public let label: String
        public let value: String
    }

    public func detailTitle(for index: Int) -> String {
        guard hours.indices.contains(index), hours[index].validTimeUtc != 0 else { return "" }
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_NZ")
        f.timeZone = timeZone
        f.dateFormat = "EEE, d MMM, h:mm a"
        return f.string(from: hours[index].date)
    }

    /// The rows chart.js shows in its hover tooltip (`_tooltipHTML`).
    public func detailRows(for index: Int) -> [DetailRow] {
        guard hours.indices.contains(index) else { return [] }
        let h = hours[index]

        func trimmed(_ v: Double) -> String {
            let r = (v * 10).rounded() / 10
            return r == r.rounded() ? String(Int(r)) : String(format: "%.1f", r)
        }
        func plain(_ v: Double?, _ unit: String) -> String { v.map { "\(trimmed($0))\(unit)" } ?? "—" }
        func rounded(_ v: Double?, _ unit: String) -> String { v.map { "\(Int($0.rounded()))\(unit)" } ?? "—" }

        let wind: String = {
            guard let s = h.windSpeed else { return "—" }
            return "\(trimmed(s)) km/h \(h.windDirectionCardinal ?? "")".trimmingCharacters(in: .whitespaces)
        }()

        return [
            DetailRow(label: "Temp", value: rounded(h.temperature, "°")),
            DetailRow(label: "Feels like", value: rounded(h.temperatureFeelsLike, "°")),
            DetailRow(label: "Condition", value: h.wxPhraseMedium ?? "—"),
            DetailRow(label: "Humidity", value: plain(h.relativeHumidity, "%")),
            DetailRow(label: "Wind", value: wind),
            DetailRow(label: "Gusts", value: h.windGust.map { "\(trimmed($0)) km/h" } ?? "—"),
            DetailRow(label: "Rain chance", value: plain(h.precipChance, "%")),
            DetailRow(label: "Precipitation", value: (h.qpf ?? 0) > 0 ? "\(trimmed(h.qpf!)) mm" : "—"),
            DetailRow(label: "Pressure", value: rounded(h.pressureMeanSeaLevel, " hPa")),
            DetailRow(label: "UV index", value: h.uvIndex.map { trimmed($0) } ?? "—"),
            DetailRow(label: "Cloud cover", value: plain(h.cloudCover, "%")),
        ]
    }
}
