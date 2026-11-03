import Foundation

/// Everything the dashboard cards compute from the raw payload. Port of the helper
/// functions in src/app.js (`todayAggregates`, `pressureTrend`, `uvInfo`, `todayHighLow`,
/// `buildDayForecast`, `renderHourlyStrip`). Pure: `now` and the time zone are inputs,
/// so every rule is unit-tested against fixed clocks.
public struct WeatherInsights {
    public typealias Hour = WeatherPayload.Hour

    public let payload: WeatherPayload
    public let now: Date
    public let timeZone: TimeZone
    private let cal: Calendar

    public init(payload: WeatherPayload, now: Date = Date(), timeZone: TimeZone = MeteogramModel.nzTimeZone) {
        self.payload = payload
        self.now = now
        self.timeZone = timeZone
        self.cal = TimeFormat.calendar(timeZone)
    }

    private var nowSec: Double { now.timeIntervalSince1970 }
    private var hourly: [Hour] { payload.hourly }

    private func dayKey(_ utcSec: Double) -> Int { TimeFormat.dayKey(utcSec, in: cal) }

    /// Hours falling on the same local calendar day as `now`.
    var todayHours: [Hour] {
        let key = dayKey(nowSec)
        return hourly.filter { $0.validTimeUtc != 0 && dayKey($0.validTimeUtc) == key }
    }

    // MARK: Small helpers

    private static func round1(_ x: Double) -> Double { (x * 10).rounded() / 10 }

    /// First hour with the largest non-nil value. `preferLater` makes ties go to the later
    /// hour: `todayHighLow` uses reduce((a,b) => a>b ? a : b) (later wins) while
    /// `buildDayForecast` uses `fn(h) > fn(best)` (earlier wins).
    private static func argmax(_ hs: [Hour], preferLater: Bool = false, _ key: (Hour) -> Double?) -> Hour? {
        var best: Hour?
        var bestV = -Double.infinity
        for h in hs {
            guard let v = key(h) else { continue }
            if v > bestV || (preferLater && v == bestV) { best = h; bestV = v }
        }
        return best
    }

    private static func argmin(_ hs: [Hour], preferLater: Bool = false, _ key: (Hour) -> Double?) -> Hour? {
        var best: Hour?
        var bestV = Double.infinity
        for h in hs {
            guard let v = key(h) else { continue }
            if v < bestV || (preferLater && v == bestV) { best = h; bestV = v }
        }
        return best
    }

    // MARK: Current conditions

    /// "Is it daytime?" from the current sunrise/sunset; unknown counts as day.
    public var isDaytime: Bool {
        guard let rise = payload.current.sunriseUtc, rise != 0,
              let set = payload.current.sunsetUtc, set != 0 else { return true }
        return nowSec >= rise && nowSec < set
    }

    public var currentGlyph: String {
        WeatherGlyph.emoji(iconCode: payload.current.iconCode, dayOrNight: isDaytime ? "D" : "N")
    }

    /// Cloud cover of the nearest hour at or after now (30 min grace), else the first hour.
    public var currentCloudCover: Double? {
        (hourly.first { $0.validTimeUtc >= nowSec - 1800 } ?? hourly.first)?.cloudCover
    }

    /// Wind cardinal: the payload's own, else derived from the bearing.
    public var currentWindCardinal: String {
        payload.current.windCardinal ?? payload.current.windDirection.map(WeatherGlyph.cardinal(degrees:)) ?? ""
    }

    // MARK: Hourly strip

    public struct StripCell: Equatable, Identifiable {
        public let id: Int
        public let time: String     // "Now", "3pm"
        public let glyph: String
        public let temp: String     // "14°"
        public let precip: String   // "40%" or "·" when under 10 %
        public let isNow: Bool
    }

    /// The row of upcoming hours on the conditions card. Starts one hour *before* the
    /// next slot so the first cell ("Now") is the current hour.
    public func hourlyStrip(count: Int = 10) -> [StripCell] {
        guard !hourly.isEmpty else { return [] }
        var start = hourly.firstIndex { $0.validTimeUtc >= nowSec } ?? 0
        if start > 0 { start -= 1 }
        let slice = hourly[start..<min(hourly.count, start + count)]
        return slice.enumerated().map { i, h in
            let chance = h.precipChance ?? 0
            return StripCell(
                id: start + i,
                time: i == 0 ? "Now" : TimeFormat.hour(h.validTimeUtc, in: timeZone),
                glyph: WeatherGlyph.emoji(iconCode: h.iconCode, dayOrNight: h.dayOrNight),
                temp: h.temperature.map { "\(Int($0.rounded()))°" } ?? TimeFormat.dash,
                precip: chance >= 10 ? "\(NumberFormat.trimmed(chance))%" : "·",
                isNow: i == 0)
        }
    }

    // MARK: Today aggregates

    public struct TodayAggregates: Equatable {
        public let rainMm: Double?
        public let peakChance: Double?
        public let peakGust: Double?
    }

    public var todayAggregates: TodayAggregates {
        let slots = todayHours
        guard !slots.isEmpty else { return TodayAggregates(rainMm: nil, peakChance: nil, peakGust: nil) }
        return TodayAggregates(
            rainMm: Self.round1(slots.reduce(0) { $0 + ($1.qpf ?? 0) }),
            peakChance: slots.map { $0.precipChance ?? 0 }.max(),
            peakGust: slots.map { $0.windGust ?? 0 }.max())
    }

    // MARK: Pressure trend

    public enum PressureTrend: String, Equatable {
        case rising, steady, falling

        public var label: String {
            switch self {
            case .rising: return "↑ Rising"
            case .steady: return "→ Steady"
            case .falling: return "↓ Falling"
            }
        }
    }

    /// 3-hour pressure change from the hourly series: |Δ| < 0.5 hPa is "steady".
    public var pressureTrend: PressureTrend? {
        guard !hourly.isEmpty else { return nil }
        func closest(to target: Double) -> Hour? {
            var best: Hour?
            for h in hourly where h.validTimeUtc != 0 && h.pressureMeanSeaLevel != nil {
                if best == nil || abs(h.validTimeUtc - target) < abs(best!.validTimeUtc - target) { best = h }
            }
            return best
        }
        guard let nowSlot = closest(to: nowSec), let pastSlot = closest(to: nowSec - 3 * 3600),
              nowSlot != pastSlot,
              let pNow = nowSlot.pressureMeanSeaLevel, let pPast = pastSlot.pressureMeanSeaLevel
        else { return nil }
        let delta = pNow - pPast
        if abs(delta) < 0.5 { return .steady }
        return delta > 0 ? .rising : .falling
    }

    // MARK: UV

    public static func uvLabel(_ index: Double?) -> String {
        guard let i = index else { return TimeFormat.dash }
        let n = NumberFormat.trimmed(i)
        switch i {
        case ...2: return "\(n) Low"
        case ...5: return "\(n) Med"
        case ...7: return "\(n) High"
        case ...10: return "\(n) V.High"
        default: return "\(n) Extreme"
        }
    }

    public struct UVInfo: Equatable {
        public let peak: Double?
        /// e.g. "10am–3pm": all of today's hours with UV >= 3 (first start to last end).
        public let window: String?
    }

    private func uvWindow(_ slots: [Hour]) -> String? {
        let high = slots.filter { ($0.uvIndex ?? 0) >= 3 }
        guard let first = high.first, let last = high.last else { return nil }
        return "\(TimeFormat.hour(first.validTimeUtc, in: timeZone))–\(TimeFormat.hour(last.validTimeUtc + 3600, in: timeZone))"
    }

    public var uvInfo: UVInfo {
        let slots = todayHours
        return UVInfo(peak: slots.isEmpty ? nil : slots.map { $0.uvIndex ?? 0 }.max(), window: uvWindow(slots))
    }

    // MARK: Today high / low

    public struct Extreme: Equatable {
        public let temp: Double?
        public let utcSec: Double?
    }

    public struct HighLow: Equatable {
        public let high: Extreme
        public let low: Extreme
    }

    /// Today's high and low.
    ///
    /// The high value comes from `daily[0].calendarDayTemperatureMax`: it covers midnight to
    /// midnight and, unlike `temperatureMax`, never goes null once the day's peak has
    /// passed. Its *time* is only shown when the forecast's own maximum is within 1° of it
    /// (i.e. the peak is still upcoming). The low is the overnight minimum, sunset tonight
    /// to sunrise tomorrow, not the calendar-day minimum.
    public var todayHighLow: HighLow? {
        let d0 = payload.daily.first
        let d1 = payload.daily.count > 1 ? payload.daily[1] : nil
        let calMax = d0?.calendarDayTemperatureMax
        let today = todayHours

        var hiTime: Double?
        if let fHi = Self.argmax(today, preferLater: true, { $0.temperature }),
           let calMax, let t = fHi.temperature, abs(t - calMax) <= 1 {
            hiTime = fHi.validTimeUtc
        }
        let highTemp = calMax ?? today.compactMap(\.temperature).max()

        var nightHours: [Hour] = []
        if let start = d0?.sunsetTimeUtc, start != 0, let end = d1?.sunriseTimeUtc, end != 0 {
            nightHours = hourly.filter { $0.validTimeUtc != 0 && $0.validTimeUtc >= start && $0.validTimeUtc < end }
        }
        let loSlot = Self.argmin(nightHours, preferLater: true, { $0.temperature })
        let lowTemp = loSlot?.temperature ?? today.compactMap(\.temperature).min()
        let loTime = loSlot?.validTimeUtc

        if highTemp == nil && lowTemp == nil { return nil }
        return HighLow(high: Extreme(temp: highTemp, utcSec: hiTime), low: Extreme(temp: lowTemp, utcSec: loTime))
    }

    /// `todayHighLow`, falling back to the station's rolling 24 h extremes (no times), as the web does.
    public var displayHighLow: HighLow? {
        if let hl = todayHighLow { return hl }
        let c = payload.current
        guard c.tempMax24h != nil || c.tempMin24h != nil else { return nil }
        return HighLow(high: Extreme(temp: c.tempMax24h, utcSec: nil), low: Extreme(temp: c.tempMin24h, utcSec: nil))
    }

    // MARK: Day forecast cards

    public struct Reading: Equatable {
        public let value: Double?
        public let utcSec: Double?
    }

    public struct DayForecast: Equatable {
        public let label: String        // "Tomorrow", "Thursday"
        public let date: String         // "5 Nov"
        public let sunrise: Double?
        public let sunset: Double?
        public let tempMax: Reading
        public let tempMin: Reading
        public let humidityMax: Reading
        public let humidityMin: Reading
        public let windSpeed: Double?
        public let windCardinal: String?
        public let windUtcSec: Double?
        public let totalMm: Double?
        public let maxChance: Double?
        public let uvPeak: Double?
        public let uvWindow: String?
        public let pressureMax: Reading
        public let pressureMin: Reading
    }

    /// Extremes and times for one forecast day. `dayIndex` 1 = tomorrow, 2 = the day after
    /// (`daily[0]` is today). nil when the Worker didn't send that day.
    public func dayForecast(dayIndex: Int) -> DayForecast? {
        guard payload.daily.indices.contains(dayIndex) else { return nil }
        let d = payload.daily[dayIndex]

        // The day is identified by its sunrise; fall back to the clock + offset.
        let refTs = d.sunriseTimeUtc.flatMap { $0 != 0 ? $0 : nil } ?? (nowSec.rounded() + Double(dayIndex) * 86_400)
        let key = dayKey(refTs)
        let slots = hourly.filter { $0.validTimeUtc != 0 && dayKey($0.validTimeUtc) == key }

        let hiSlot = Self.argmax(slots) { $0.temperature }

        // Overnight low: sunset tonight to the next day's sunrise (spans midnight).
        let next = payload.daily.indices.contains(dayIndex + 1) ? payload.daily[dayIndex + 1] : nil
        var nightSlots: [Hour] = []
        if let start = d.sunsetTimeUtc, start != 0, let end = next?.sunriseTimeUtc, end != 0 {
            nightSlots = hourly.filter { $0.validTimeUtc != 0 && $0.validTimeUtc >= start && $0.validTimeUtc < end }
        }
        let loSlot = !nightSlots.isEmpty
            ? Self.argmin(nightSlots) { $0.temperature }
            : Self.argmin(slots) { $0.temperature }

        func reading(_ h: Hour?, _ value: (Hour) -> Double?) -> Reading {
            Reading(value: h.flatMap(value), utcSec: h?.validTimeUtc)
        }

        let windSlot = Self.argmax(slots) { $0.windSpeed }
        let cardinal = windSlot.flatMap { $0.windDirectionCardinal ?? $0.windDirection.map(WeatherGlyph.cardinal(degrees:)) }

        return DayForecast(
            label: dayIndex == 1 ? "Tomorrow" : TimeFormat.weekday(refTs, in: timeZone),
            date: TimeFormat.dayMonth(refTs, in: timeZone),
            sunrise: d.sunriseTimeUtc.flatMap { $0 != 0 ? $0 : nil },
            sunset: d.sunsetTimeUtc.flatMap { $0 != 0 ? $0 : nil },
            tempMax: Reading(value: d.calendarDayTemperatureMax, utcSec: hiSlot?.validTimeUtc),
            tempMin: Reading(value: loSlot?.temperature ?? d.calendarDayTemperatureMin, utcSec: loSlot?.validTimeUtc),
            humidityMax: reading(Self.argmax(slots) { $0.relativeHumidity }) { $0.relativeHumidity },
            humidityMin: reading(Self.argmin(slots) { $0.relativeHumidity }) { $0.relativeHumidity },
            windSpeed: windSlot?.windSpeed,
            windCardinal: cardinal,
            windUtcSec: windSlot?.validTimeUtc,
            totalMm: slots.isEmpty ? nil : Self.round1(slots.reduce(0) { $0 + ($1.qpf ?? 0) }),
            maxChance: slots.isEmpty ? nil : slots.map { $0.precipChance ?? 0 }.max(),
            uvPeak: slots.compactMap(\.uvIndex).max(),
            uvWindow: uvWindow(slots),
            pressureMax: reading(Self.argmax(slots) { $0.pressureMeanSeaLevel }) { $0.pressureMeanSeaLevel },
            pressureMin: reading(Self.argmin(slots) { $0.pressureMeanSeaLevel }) { $0.pressureMeanSeaLevel })
    }

    /// Tomorrow plus the next three days: the four cards on the web dashboard.
    public var dayForecasts: [DayForecast] { (1...4).compactMap { dayForecast(dayIndex: $0) } }
}
