import Foundation
import Testing
@testable import WeatherTempoKit

@Suite struct StatusPolicyTests {
    private let now = SampleData.referenceNow
    private func fresh() -> WeatherPayload { SampleData.payload(now: now) }

    @Test func healthyFreshDataShowsNoBanner() {
        #expect(StatusPolicy.banner(payload: fresh(), lastRefreshFailed: false, now: now) == nil)
        #expect(StatusPolicy.banner(payload: fresh(), lastRefreshFailed: false, now: now.addingTimeInterval(44 * 60)) == nil)
    }

    @Test func nothingYetAndNoFailureShowsNoBanner() {
        // first launch, still loading
        #expect(StatusPolicy.banner(payload: nil, lastRefreshFailed: false, now: now) == nil)
    }

    @Test func noDataAndFailureIsAnError() {
        let b = StatusPolicy.banner(payload: nil, lastRefreshFailed: true, now: now)
        #expect(b?.level == .error)
    }

    @Test func failedRefreshWithCachedDataIsAnOfflineWarning() {
        let later = now.addingTimeInterval(20 * 60)
        let b = StatusPolicy.banner(payload: fresh(), lastRefreshFailed: true, now: later)
        #expect(b?.level == .warning)
        #expect(b?.message.contains("Offline") == true)
        #expect(b?.message.contains("2:00pm") == true)       // when the cached data is from
        #expect(b?.message.contains("20 min ago") == true)
    }

    @Test func liveStationProblemsWarnExceptOkAndNotApplicable() {
        for (status, expectBanner) in [("ok", false), ("n/a", false), ("stale", true), ("no-observation", true),
                                       ("unreachable", true), ("http-4xx", true), ("bad-json", true)] {
            var p = fresh()
            p.meta.sourceStatus = .init(openMeteo: "ok", pws: status, currentSource: "open-meteo")
            let b = StatusPolicy.banner(payload: p, lastRefreshFailed: false, now: now)
            #expect((b != nil) == expectBanner, "pws = \(status)")
            if expectBanner { #expect(b?.message.contains("Live station unavailable") == true) }
        }
    }

    @Test func missingSourceStatusIsNotAProblem() {
        var p = fresh()
        p.meta.sourceStatus = nil
        #expect(StatusPolicy.banner(payload: p, lastRefreshFailed: false, now: now) == nil)
    }

    @Test func oldDataWarnsAfterFortyFiveMinutes() {
        let b = StatusPolicy.banner(payload: fresh(), lastRefreshFailed: false, now: now.addingTimeInterval(50 * 60))
        #expect(b?.level == .warning)
        #expect(b?.message == "Data is 50 min old")
        let hours = StatusPolicy.banner(payload: fresh(), lastRefreshFailed: false, now: now.addingTimeInterval(3 * 3600))
        #expect(hours?.message == "Data is 3h old")
    }

    @Test func offlineTakesPrecedenceOverStationWarning() {
        var p = fresh()
        p.meta.sourceStatus = .init(openMeteo: "ok", pws: "stale", currentSource: "open-meteo")
        let b = StatusPolicy.banner(payload: p, lastRefreshFailed: true, now: now)
        #expect(b?.message.contains("Offline") == true)
    }
}

@Suite struct TideSummaryTests {
    private let now = SampleData.referenceNow

    @Test func inlandLocationsHaveNoTideSummary() {
        #expect(TideSummary(location: .named("hamilton"), now: now) == nil)
    }

    @Test func christchurchUsesLytteltonWithItsOwnLabel() throws {
        let s = try #require(TideSummary(location: .named("christchurch"), now: now))
        #expect(s.label == "New Brighton Beach — Tides")
        let expected = try #require(TidePredictor.height(portID: "lyttelton", at: now))
        #expect(s.currentHeight == expected)
    }

    @Test func nextFourEventsAreInTheFutureAndAlternate() throws {
        let s = try #require(TideSummary(location: .named("christchurch"), now: now))
        #expect(s.events.count == 4)
        #expect(s.events.allSatisfy { $0.time >= now })
        for (a, b) in zip(s.events, s.events.dropFirst()) { #expect(a.kind != b.kind) }
    }

    @Test func trendMatchesWhichWayTheWaterIsMoving() throws {
        // Find a rising and a falling moment over a day and check the label follows the physics.
        let port = try #require(TidePort.all["lyttelton"])
        for hourOffset in stride(from: 0.0, to: 24, by: 1.5) {
            let t = now.addingTimeInterval(hourOffset * 3600)
            let s = try #require(TideSummary(location: .named("christchurch"), now: t))
            let later = TidePredictor.height(port: port, at: t.addingTimeInterval(600))
            #expect(s.trend == (later >= s.currentHeight ? .rising : .falling))
        }
        // both directions occur across a day
        let trends = Set(try stride(from: 0.0, to: 24, by: 1.5).map { off -> TideSummary.Trend in
            try #require(TideSummary(location: .named("christchurch"), now: now.addingTimeInterval(off * 3600))).trend
        })
        #expect(trends == [.rising, .falling])
    }

    @Test func curveRunsFromLocalMidnightFor24HoursAtTenMinutes() throws {
        let s = try #require(TideSummary(location: .named("christchurch"), now: now))
        #expect(s.curve.count == 24 * 6 + 1)
        #expect(s.curve.first?.time == SampleData.referenceStart)   // NZ midnight
        #expect(s.curve.last?.time == SampleData.referenceStart.addingTimeInterval(24 * 3600))
        #expect(s.minHeight < s.currentHeight + 1e-9 && s.currentHeight < s.maxHeight + 1e-9)
    }
}
