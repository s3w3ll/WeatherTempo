import Foundation
import Testing
@testable import WeatherTempoKit

enum Fixture {
    static func data(_ name: String) throws -> Data {
        let url = try #require(Bundle.module.url(forResource: name, withExtension: "json", subdirectory: "Fixtures"))
        return try Data(contentsOf: url)
    }
}

@Suite struct WeatherPayloadTests {
    @Test func decodesRealWorkerPayload() throws {
        let p = try JSONDecoder().decode(WeatherPayload.self, from: Fixture.data("worker-full"))
        #expect(p.hourly.count == 120)
        #expect(p.daily.count == 5)
        #expect(p.hourly[0].validTimeUtc > 1_700_000_000)
        try p.validate()
    }

    @Test func decodesSparsePayloadWithNullsAndMissingBlocks() throws {
        // No `today`, no `sourceStatus`, null condition/cloudCover/temperatureMax.
        let p = try JSONDecoder().decode(WeatherPayload.self, from: Fixture.data("worker-sparse"))
        #expect(p.today == nil)
        #expect(p.meta.sourceStatus == nil)
        #expect(p.current.condition == nil)
        #expect(p.hourly[0].cloudCover == nil)
        #expect(p.daily[0].temperatureMax == nil)
        #expect(p.daily[0].temperatureMin == 4.2)
        try p.validate()
    }

    @Test func parsesTimestampWithAndWithoutFraction() throws {
        var p = try JSONDecoder().decode(WeatherPayload.self, from: Fixture.data("worker-sparse"))
        let plain = try #require(p.updatedDate)
        p.meta.updated = "2026-05-21T19:25:43.123Z"
        let fractional = try #require(p.updatedDate)
        #expect(abs(fractional.timeIntervalSince(plain) - 0.123) < 0.001)
    }

    @Test func parsesPythonMicrosecondOffsetTimestamp() throws {
        // Format written by the retired fetch_weather.py pipeline.
        var p = try JSONDecoder().decode(WeatherPayload.self, from: Fixture.data("worker-sparse"))
        p.meta.updated = "2026-05-21T19:25:43.624884+00:00"
        let d = try #require(p.updatedDate)
        #expect(Int(d.timeIntervalSince1970) == 1_779_391_543)
    }

    @Test func staleAfterFortyFiveMinutes() throws {
        let p = try JSONDecoder().decode(WeatherPayload.self, from: Fixture.data("worker-sparse"))
        let updated = try #require(p.updatedDate)
        #expect(!p.isStale(now: updated.addingTimeInterval(44 * 60)))
        #expect(p.isStale(now: updated.addingTimeInterval(46 * 60)))
    }

    @Test func staleWhenWorkerReportsStalePWS() throws {
        var p = try JSONDecoder().decode(WeatherPayload.self, from: Fixture.data("worker-sparse"))
        let updated = try #require(p.updatedDate)
        p.meta.sourceStatus = .init(openMeteo: "ok", pws: "stale", currentSource: "open-meteo")
        #expect(p.isStale(now: updated))
    }

    @Test func emptyHourlyFailsValidation() throws {
        var p = try JSONDecoder().decode(WeatherPayload.self, from: Fixture.data("worker-sparse"))
        p.hourly = []
        #expect(throws: PayloadError.emptyHourly) { try p.validate() }
    }
}
