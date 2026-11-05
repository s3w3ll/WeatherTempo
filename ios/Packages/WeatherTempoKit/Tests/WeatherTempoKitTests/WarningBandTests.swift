import Foundation
import Testing
@testable import WeatherTempoKit

private let start = SampleData.referenceStart.timeIntervalSince1970   // Tue 3 Nov 2026 00:00 NZDT

private func warning(_ id: String, _ level: WeatherWarning.Level, from: Double?, to: Double?) -> WeatherWarning {
    WeatherWarning(id: id, headline: "\(id) - \(level.name)", event: id, level: level,
                   onset: from.map { Date(timeIntervalSince1970: start + $0 * 3600) },
                   expires: to.map { Date(timeIntervalSince1970: start + $0 * 3600) },
                   areaDescription: "", details: "", polygons: [])
}

@Suite struct WarningBandTests {
    private let hours = SampleData.hours(count: 48)

    @Test func spansMapTimeToTheHourCentres() throws {
        let m = MeteogramModel(hours: hours, pxPerHour: 10, warnings: [warning("rain", .orange, from: 6, to: 18)])
        let s = try #require(m.warningSpans.first)
        #expect(s.x0 == m.hourX(6) && s.x1 == m.hourX(18))
    }

    @Test func openEndsAreClampedAndOutsideWarningsDropped() {
        let m = MeteogramModel(hours: hours, pxPerHour: 10, warnings: [
            warning("ongoing", .yellow, from: nil, to: 3),
            warning("past", .red, from: -20, to: -10),
            warning("open", .red, from: 40, to: nil),
        ])
        #expect(m.warningSpans.map(\.id) == ["ongoing", "open"])          // least severe first
        #expect(m.warningSpans[0].x0 == m.hourX(0) - 5)                  // half an hour before the first centre
        #expect(m.warningSpans[1].x1 == m.hourX(47) + 5)
    }

    @Test func hourDetailsFindTheWorstWarning() {
        let m = MeteogramModel(hours: hours, pxPerHour: 10, warnings: [
            warning("watch", .yellow, from: 0, to: 24), warning("rain", .orange, from: 10, to: 12),
        ])
        #expect(m.warning(atHour: 11)?.id == "rain")
        #expect(m.warning(atHour: 12)?.id == "watch")      // the end is exclusive
        #expect(m.warning(atHour: 30) == nil)
    }
}

@Suite struct SunProtectionTests {
    private func model(uv: [Int: Double], now hour: Double, count: Int = 30) -> MeteogramModel {
        let hrs = (0..<count).map { i in
            WeatherPayload.Hour(validTimeUtc: start + Double(i) * 3600, uvIndex: uv[i] ?? 0)
        }
        return MeteogramModel(hours: hrs, pxPerHour: 1, now: Date(timeIntervalSince1970: start + hour * 3600))
    }

    private let day: [Int: Double] = [9: 2, 10: 3, 11: 5, 12: 8, 13: 9, 14: 7, 15: 4, 16: 3, 17: 2]

    @Test func laterTodayGivesTheWindowAndPeak() throws {
        let sun = try #require(model(uv: day, now: 7).sunProtection())
        #expect(sun.sentence == "Sun protection 10am to 5pm (UV up to 9, very high)")
        #expect(sun.compactTimes == "10am–5pm")
    }

    @Test func underWaySaysUntil() throws {
        let sun = try #require(model(uv: day, now: 13.5).sunProtection())
        #expect(sun.ongoing && sun.sentence == "Sun protection until 5pm (UV up to 9, very high)")
        #expect(sun.compactTimes == "until 5pm")
    }

    @Test func nothingWhenUVStaysLowOrIsOver() {
        #expect(model(uv: [12: 2], now: 7).sunProtection() == nil)
        #expect(model(uv: day, now: 18).sunProtection() == nil)
    }

    @Test func summaryEndsWithItUnlessLeftOut() throws {
        let m = model(uv: day, now: 7)
        #expect(try #require(m.nextHoursSummary()).hasSuffix("Sun protection 10am to 5pm (UV up to 9, very high)."))
        #expect(m.nextHoursSummary(includeSunProtection: false)?.contains("Sun protection") == false)
    }

    @Test func widgetStatSeesAStretchAlreadyUnderWay() throws {
        let hrs = (0..<30).map { i in WeatherPayload.Hour(validTimeUtc: start + Double(i) * 3600, uvIndex: day[i] ?? 0) }
        let p = WeatherPayload(meta: .init(updated: "2026-11-03T01:00:00.000Z"), current: .init(), today: nil,
                               hourly: hrs, daily: [])
        // 1:50pm: the 1pm hour started 50 minutes ago
        let i = WeatherInsights(payload: p, now: Date(timeIntervalSince1970: start + 13.83 * 3600))
        #expect(i.sunProtection?.compactTimes == "until 5pm")
        #expect(i.nextHoursSummary?.contains("Sun protection") == false)
    }
}
