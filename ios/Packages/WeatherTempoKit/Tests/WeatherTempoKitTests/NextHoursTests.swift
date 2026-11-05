import Foundation
import Testing
@testable import WeatherTempoKit

private typealias Hour = WeatherPayload.Hour
private let t0 = SampleData.referenceStart.timeIntervalSince1970   // Tue 3 Nov 2026 00:00 NZDT

/// 24 hours from midnight; `now` is 2pm (index 14) unless given.
private func summary(now: Int = 14, _ make: (Int) -> Hour) -> String? {
    let hours = (0..<24).map(make)
    return MeteogramModel(hours: hours, pxPerHour: 8, now: Date(timeIntervalSince1970: t0 + Double(now) * 3600))
        .nextHoursSummary(window: 6)
}

private func h(_ i: Int, temp: Double = 12, qpf: Double? = nil, chance: Double? = nil, gust: Double? = nil) -> Hour {
    Hour(validTimeUtc: t0 + Double(i) * 3600, temperature: temp, windGust: gust, qpf: qpf, precipChance: chance)
}

@Suite struct NextHoursSummaryTests {
    @Test func dryAndSteady() {
        #expect(summary { h($0) } == "Dry for the next 6 hours. Staying around 12°.")
    }

    @Test func rainStartingLaterWithItsLength() {
        // rain 4pm and 5pm (2 h), moderate at its peak
        let s = summary { i in h(i, qpf: i == 16 ? 0.5 : i == 17 ? 1.5 : 0, chance: 80) }
        #expect(s?.hasPrefix("Moderate rain from 4pm, about 2 hours.") == true)
    }

    @Test func rainRunningPastTheWindowHasNoLength() {
        let s = summary { i in h(i, qpf: i >= 18 ? 0.5 : 0, chance: 70) }
        #expect(s?.hasPrefix("Light rain from 6pm.") == true)
    }

    @Test func rainingNowSaysWhenItEases() {
        let s = summary { i in h(i, qpf: i < 16 ? 5 : 0, chance: 90) }
        #expect(s?.hasPrefix("Heavy rain easing by 4pm.") == true)
        let all = summary { i in h(i, qpf: 0.4, chance: 90) }
        #expect(all?.hasPrefix("Light rain for the next 6 hours.") == true)
    }

    @Test func unlikelyRainIsIgnored() {
        let s = summary { i in h(i, qpf: 0.5, chance: 20) }
        #expect(s?.hasPrefix("Dry for the next 6 hours.") == true)
    }

    @Test func temperatureTrendPicksTheBiggerChange() {
        let warm = summary { i in h(i, temp: 10 + Double(max(0, min(i, 17) - 14))) }   // up 3 by 5pm
        #expect(warm?.contains("Warming to 13° by 5pm") == true)
        let cool = summary { i in h(i, temp: 20 - Double(max(0, i - 14)) * 1.5) }   // down 7.5 by 7pm
        #expect(cool?.contains("Cooling to 13° by 7pm") == true)
    }

    @Test func onlyStrongGustsAreMentioned() {
        #expect(summary { h($0, gust: 45) }?.contains("Gusts") == false)
        let s = summary { i in h(i, gust: i == 18 ? 62 : 30) }
        #expect(s?.hasSuffix("Gusts to 62 km/h around 6pm.") == true)
    }

    @Test func windowIsCutShortAtTheEndOfTheSeries() {
        #expect(summary(now: 21) { h($0) }?.hasPrefix("Dry for the next 3 hours.") == true)
    }

    @Test func noFutureHoursGivesNothing() {
        #expect(MeteogramModel(hours: [], pxPerHour: 8).nextHoursSummary() == nil)
    }
}
