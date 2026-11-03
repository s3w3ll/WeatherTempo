import Foundation

/// Deterministic fake forecast for SwiftUI previews, widget placeholders and the CI
/// chart snapshot. Shaped like a plausible Christchurch spring: a warm afternoon peak,
/// building cloud, an evening rain band and a changing breeze. Not real data.
public enum SampleData {
    /// 2026-11-03 00:00 NZDT (= 2026-11-02 11:00 UTC), so index 0 is local midnight.
    public static let referenceStart = Date(timeIntervalSince1970: 1_793_617_200)

    /// 2:00 pm on the reference day: a convenient "now" for previews and tests.
    public static let referenceNow = referenceStart.addingTimeInterval(14 * 3600)

    /// A complete, internally consistent payload (current block, 5 daily rows, moon, meta)
    /// built from `hours()`. The first hour is local midnight, so earlier hours are "in the
    /// past" relative to `now`; the real Worker may send only future hours.
    public static func payload(now: Date = referenceNow, hourCount: Int = 120) -> WeatherPayload {
        let hs = hours(count: hourCount)
        let nowSec = now.timeIntervalSince1970
        let cur = hs.last { $0.validTimeUtc <= nowSec } ?? hs[0]

        // Five days; sunrise 06:06, sunset 20:05 local (close to early-November Christchurch).
        let daily: [WeatherPayload.Day] = (0..<5).map { d in
            let dayStart = referenceStart.timeIntervalSince1970 + Double(d) * 86_400
            let temps = hs.filter { $0.validTimeUtc >= dayStart && $0.validTimeUtc < dayStart + 86_400 }
                .compactMap(\.temperature)
            return WeatherPayload.Day(
                calendarDayTemperatureMax: temps.max(), calendarDayTemperatureMin: temps.min(),
                temperatureMax: temps.max(), temperatureMin: temps.min(),
                sunriseTimeUtc: dayStart + 6 * 3600 + 6 * 60, sunsetTimeUtc: dayStart + 20 * 3600 + 5 * 60)
        }

        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]

        return WeatherPayload(
            meta: .init(updated: iso.string(from: now), location: "Christchurch, New Zealand",
                        lat: -43.5321, lon: 172.6362,
                        sourceStatus: .init(openMeteo: "ok", pws: "ok", currentSource: "pws")),
            current: .init(
                temp: cur.temperature, feelsLike: cur.temperatureFeelsLike, humidity: cur.relativeHumidity,
                pressure: cur.pressureMeanSeaLevel, windSpeed: cur.windSpeed, windGust: cur.windGust,
                windDirection: cur.windDirection, windCardinal: cur.windDirectionCardinal,
                uvIndex: cur.uvIndex, dewPoint: ((cur.temperature ?? 10) - 3).rounded(), solarRad: 420,
                condition: cur.wxPhraseMedium, cloudPhrase: cur.wxPhraseMedium, iconCode: (cur.qpf ?? 0) > 0 ? 11 : 30,
                sunriseUtc: daily[0].sunriseTimeUtc, sunsetUtc: daily[0].sunsetTimeUtc,
                tempMax24h: daily[0].calendarDayTemperatureMax, tempMin24h: daily[0].calendarDayTemperatureMin),
            today: .init(moonPhase: "Waxing Crescent", moonPhaseCode: "WXC", moonPhaseDay: 5),
            hourly: hs,
            daily: daily)
    }

    public static func hours(start: Date = referenceStart, count: Int = 120) -> [WeatherPayload.Hour] {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = MeteogramModel.nzTimeZone

        func clamp(_ v: Double, _ lo: Double, _ hi: Double) -> Double { min(max(v, lo), hi) }
        func tenth(_ v: Double) -> Double { (v * 10).rounded() / 10 }

        return (0..<count).map { i in
            let time = start.addingTimeInterval(Double(i) * 3600)
            let hod = Double(cal.component(.hour, from: time))
            let n = Double(i)

            let wind = tenth(14 + 12 * sin(n / 7 + 0.5))
            let temp = tenth(11 + 5 * sin((hod - 9) / 24 * 2 * .pi) + 0.04 * n)
            let chance = clamp(25 + 55 * sin(n / 11 + 1.2), 0, 100).rounded()
            let qpf = chance > 60 ? tenth((chance - 60) / 20) : 0
            let isDay = (6..<20).contains(Int(hod))

            return WeatherPayload.Hour(
                validTimeUtc: time.timeIntervalSince1970,
                temperature: temp,
                temperatureFeelsLike: tenth(temp - 1.5 - wind / 12),
                relativeHumidity: clamp(70 - 15 * sin((hod - 9) / 24 * 2 * .pi), 30, 100).rounded(),
                windSpeed: wind,
                windDirection: Double((200 + i * 9) % 360),
                windDirectionCardinal: "SW",
                windGust: tenth(wind * 1.4),
                cloudCover: clamp(50 + 48 * sin(n / 9), 0, 100).rounded(),
                qpf: qpf,
                precipChance: chance,
                precipType: qpf > 0 ? "rain" : nil,
                pressureMeanSeaLevel: tenth(1015 + 6 * sin(n / 30)),
                uvIndex: isDay ? tenth(clamp(6 * sin((hod - 6) / 14 * .pi), 0, 11)) : 0,
                iconCode: nil,
                dayOrNight: isDay ? "D" : "N",
                wxPhraseMedium: qpf > 0 ? "Light Rain" : "Partly Cloudy")
        }
    }
}
