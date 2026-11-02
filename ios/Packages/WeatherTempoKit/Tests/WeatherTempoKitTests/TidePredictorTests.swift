import Foundation
import Testing
@testable import WeatherTempoKit

/// Shape of Fixtures/tide-golden.json, produced by running src/tides.js under node
/// (see ios/tools/gen-swift-data.mjs). These tests prove the Swift port agrees with the JS.
private struct TideGolden: Decodable {
    struct Height: Decodable { let port: String; let iso: String; let ms: Double; let height: Double }
    struct Event: Decodable { let type: String; let ms: Double; let height: Double }
    struct Events: Decodable { let startMs: Double; let endMs: Double; let byPort: [String: [Event]] }
    struct Sample: Decodable { let ms: Double; let height: Double }
    let heights: [Height]
    let events: Events
    let samples: [Sample]
}

private func date(ms: Double) -> Date { Date(timeIntervalSince1970: ms / 1000) }

private func loadGolden() throws -> TideGolden {
    try JSONDecoder().decode(TideGolden.self, from: Fixture.data("tide-golden"))
}

@Suite struct TidePredictorTests {
    @Test func j2000EpochIsNoonUTCOnNewYearsDay2000() {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "UTC")!
        let expected = cal.date(from: DateComponents(year: 2000, month: 1, day: 1, hour: 12))!
        #expect(TidePredictor.j2000 == expected.timeIntervalSince1970)
    }

    @Test func heightMatchesJavaScriptForEveryPort() throws {
        let golden = try loadGolden()
        #expect(golden.heights.count == 39)  // 13 ports x 3 instants
        for g in golden.heights {
            let h = try #require(TidePredictor.height(portID: g.port, at: date(ms: g.ms)))
            #expect(abs(h - g.height) < 1e-9, "\(g.port) @ \(g.iso): swift \(h) vs js \(g.height)")
        }
    }

    @Test func eventsMatchJavaScript() throws {
        let golden = try loadGolden()
        for (port, expected) in golden.events.byPort {
            let got = TidePredictor.events(
                portID: port, from: date(ms: golden.events.startMs), to: date(ms: golden.events.endMs))
            #expect(got.count == expected.count, "\(port): event count")
            for (g, e) in zip(got, expected) {
                #expect(g.kind.rawValue == e.type, "\(port): kind")
                #expect(Int((g.time.timeIntervalSince1970 * 1000).rounded()) == Int(e.ms), "\(port): time")
                #expect(abs(g.height - e.height) < 0.0051, "\(port): height")
            }
        }
    }

    @Test func sampleMatchesJavaScriptAndIncludesBothEnds() throws {
        let golden = try loadGolden()
        let start = date(ms: golden.samples.first!.ms)
        let end = date(ms: golden.samples.last!.ms)
        let got = TidePredictor.sample(portID: "lyttelton", from: start, to: end, stepMinutes: 10)
        #expect(got.count == golden.samples.count)
        for (g, e) in zip(got, golden.samples) {
            #expect(abs(g.height - e.height) < 0.0011)  // both rounded to mm; allow a tie flip
        }
    }

    @Test func eventsAlternateHighAndLow() throws {
        let start = date(ms: 1_793_664_000_000)  // 2026-11-03T00:00Z
        let evs = TidePredictor.events(portID: "lyttelton", from: start, to: start.addingTimeInterval(72 * 3600))
        #expect(evs.count >= 10)
        for (a, b) in zip(evs, evs.dropFirst()) {
            #expect(a.kind != b.kind)
            // Semi-diurnal: roughly 6h12m between a high and the next low.
            let gap = b.time.timeIntervalSince(a.time) / 3600
            #expect(gap > 4.5 && gap < 8, "gap \(gap)h")
        }
    }

    @Test func unknownPortGivesNilOrEmpty() {
        let now = Date()
        #expect(TidePredictor.height(portID: "atlantis", at: now) == nil)
        #expect(TidePredictor.sample(portID: "atlantis", from: now, to: now.addingTimeInterval(3600)).isEmpty)
        #expect(TidePredictor.events(portID: "atlantis", from: now, to: now.addingTimeInterval(86_400)).isEmpty)
        #expect(TidePredictor.nextEvents(portID: "atlantis").isEmpty)
    }

    @Test func nextEventsAreFutureOrderedAndLimited() {
        let now = date(ms: 1_793_664_000_000)
        let evs = TidePredictor.nextEvents(portID: "lyttelton", count: 4, now: now)
        #expect(evs.count == 4)
        #expect(evs.allSatisfy { $0.time >= now })
        #expect(evs == evs.sorted { $0.time < $1.time })
    }

    @Test func todayCurveStartsAtLocalMidnightInNZDT() throws {
        // 2026-11-03 05:00 UTC = 18:00 NZDT (UTC+13) on 3 Nov, so local midnight
        // is 2026-11-02 11:00 UTC.
        let now = date(ms: 1_793_664_000_000 + 5 * 3_600_000)
        let curve = TidePredictor.todayCurve(portID: "lyttelton", now: now)
        let first = try #require(curve.first)
        #expect(first.time.timeIntervalSince1970 == 1_793_664_000 - 13 * 3600)
        #expect(curve.count == 48 * 6 + 1)  // 48 h at 10 min, both ends
    }

    @Test func spanOfLyttelton2026IsPlausible() {
        // Sanity check against reality: Lyttelton's spring range is roughly 2 m.
        let start = date(ms: 1_793_664_000_000)
        let samples = TidePredictor.sample(portID: "lyttelton", from: start, to: start.addingTimeInterval(14 * 86_400))
        let hs = samples.map(\.height)
        #expect(hs.min()! > -0.3 && hs.max()! < 2.2)
        #expect(hs.max()! - hs.min()! > 1.2)
    }
}
