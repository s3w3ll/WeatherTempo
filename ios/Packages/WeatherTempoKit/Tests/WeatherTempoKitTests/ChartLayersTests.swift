import Foundation
import SwiftUI
import Testing
@testable import WeatherTempoKit

private typealias Hour = WeatherPayload.Hour
private let t0 = SampleData.referenceStart.timeIntervalSince1970

private func hour(_ i: Int, temp: Double? = 10, rh: Double? = nil, uv: Double? = nil, gust: Double? = nil) -> Hour {
    Hour(validTimeUtc: t0 + Double(i) * 3600, temperature: temp, relativeHumidity: rh, windGust: gust, uvIndex: uv)
}

private func model(_ hours: [Hour], layout: ChartLayout = .web) -> MeteogramModel {
    MeteogramModel(hours: hours, pxPerHour: 8, now: SampleData.referenceStart, layout: layout)
}

@Suite struct DewPointTests {
    @Test func magnusFormulaMatchesReferenceValues() throws {
        // Saturated air: dew point equals the temperature.
        #expect(abs(try #require(MeteogramModel.dewPoint(temperature: 20, humidity: 100)) - 20) < 1e-9)
        // Standard table values: 20 °C at 50 % -> 9.3 °C, 30 °C at 70 % -> 23.9 °C.
        #expect(abs(try #require(MeteogramModel.dewPoint(temperature: 20, humidity: 50)) - 9.3) < 0.1)
        #expect(abs(try #require(MeteogramModel.dewPoint(temperature: 30, humidity: 70)) - 23.9) < 0.1)
        // Below freezing still works.
        #expect(abs(try #require(MeteogramModel.dewPoint(temperature: -1, humidity: 98)) - -1.3) < 0.1)
    }

    @Test func impossibleHumidityGivesNoDewPoint() {
        #expect(MeteogramModel.dewPoint(temperature: 10, humidity: 0) == nil)
        #expect(MeteogramModel.dewPoint(temperature: 10, humidity: 120) == nil)
        #expect(MeteogramModel.dewPoint(hour(0, rh: nil)) == nil)
        #expect(MeteogramModel.dewPoint(hour(0, temp: nil, rh: 50)) == nil)
    }

    @Test func comfortScaleBands() {
        #expect(MeteogramModel.Comfort(dewPoint: -1) == .dry)
        #expect(MeteogramModel.Comfort(dewPoint: 9.9) == .dry)
        #expect(MeteogramModel.Comfort(dewPoint: 10) == .comfortable)
        #expect(MeteogramModel.Comfort(dewPoint: 16) == .sticky)
        #expect(MeteogramModel.Comfort(dewPoint: 21) == .oppressive)
    }

    @Test func detailRowShowsDewPointWithComfort() {
        let m = model([hour(0, temp: 12.6, rh: 78)])
        let rows = Dictionary(uniqueKeysWithValues: m.detailRows(for: 0).map { ($0.label, $0.value) })
        #expect(rows["Dew point"] == "9° Dry")
        let bare = model([hour(0)])
        #expect(bare.detailRows(for: 0).first { $0.label == "Dew point" }?.value == "—")
    }

    @Test func dewPointWidensTheTemperatureScaleOnlyWhereItIsDrawn() {
        // 10 °C at 30 % RH -> dew point about -6.8 °C
        let hours = [hour(0, temp: 10, rh: 30), hour(1, temp: 12, rh: 30)]
        #expect(model(hours).tMin < -8)
        #expect(model(hours, layout: .compact).tMin == 8)     // widgets don't draw dew point
    }
}

@Suite struct FreezingLineTests {
    @Test func shownOnlyWhenZeroIsInRange() throws {
        #expect(model([hour(0, temp: 10), hour(1, temp: 15)]).freezingY == nil)   // range 8...17
        let cold = model([hour(0, temp: 1), hour(1, temp: 6)])                      // range -1...8
        let y = try #require(cold.freezingY)
        #expect(y == cold.tempY(0))
        #expect(y > ChartZone.tempTop && y < ChartZone.tempBot)
    }
}

@Suite struct UVLayerTests {
    @Test func uvScaleUsesTheLowerFortyPercentOfTheMainZone() {
        let m = model([hour(0)])
        let span = (ChartZone.tempBot - ChartZone.tempTop) * 0.4
        #expect(m.uvY(0) == ChartZone.tempBot)
        #expect(abs(m.uvY(12) - (ChartZone.tempBot - span)) < 1e-9)
        #expect(m.uvY(20) == m.uvY(12))          // clamped
        #expect(m.uvY(-1) == m.uvY(0))
    }

    @Test func runsCoverDaylightPlusTheZeroOnEachSide() {
        let uv: [Double] = [0, 0, 1, 4, 6, 3, 0, 0, 2, 0]
        let m = model(uv.enumerated().map { hour($0.offset, uv: $0.element) })
        #expect(m.uvRuns == [1..<7, 7..<10])
    }

    @Test func noUVMeansNoRuns() {
        #expect(model((0..<5).map { hour($0, uv: 0) }).uvRuns.isEmpty)
        #expect(model((0..<5).map { hour($0) }).uvRuns.isEmpty)
    }

    @Test func runsAtTheEdgesDontOverrun() {
        let m = model([hour(0, uv: 5), hour(1, uv: 5)])
        #expect(m.uvRuns == [0..<2])
    }
}

@Suite struct SunshineTests {
    private func sky(_ i: Int, _ dn: String?, cloud: Double?) -> Hour {
        Hour(validTimeUtc: t0 + Double(i) * 3600, temperature: 10, cloudCover: cloud, dayOrNight: dn)
    }

    @Test func clearDaytimeIsFullSunAndCloudTakesItAway() {
        let m = model([sky(0, "D", cloud: 0), sky(1, "D", cloud: 25), sky(2, "D", cloud: 100)])
        #expect(m.sunshine == [1, 0.75, 0])
    }

    @Test func nightAndUnknownCloudGiveNoSun() {
        let m = model([sky(0, "N", cloud: 0), sky(1, nil, cloud: 0), sky(2, "D", cloud: nil)])
        #expect(m.sunshine == [0, 0, 0])
    }

    @Test func outOfRangeCloudIsClamped() {
        #expect(model([sky(0, "D", cloud: -5), sky(1, "D", cloud: 140)]).sunshine == [1, 0])
    }

    @Test func withCoordinatesTheSunriseHourCountsAsPartlySunny() {
        let chc = Location.named(Location.defaultID)
        // 3 Nov, Christchurch: sun up ~6:05am, so 5am is dark, 6am mostly up, noon fully up.
        let hours = (0..<24).map { sky($0, "D", cloud: 0) }
        let m = MeteogramModel(hours: hours, pxPerHour: 8, now: SampleData.referenceStart,
                               latitude: chc.lat, longitude: chc.lon)
        #expect(m.daylightFraction(5) == 0)
        #expect(m.daylightFraction(6) >= 0.5)
        #expect(m.daylightFraction(12) == 1)
        #expect(m.daylightFraction(23) == 0)   // the flag says "D", the sun says night
        let total = m.sunshine.reduce(0, +)
        #expect(total > 13.5 && total < 15)    // ~14.2 h of daylight on a clear day
    }

    @Test func glowRampsUpAfterSunriseAndFollowsTheCloud() throws {
        let chc = Location.named(Location.defaultID)
        let hours = (0..<24).map { sky($0, "D", cloud: $0 < 12 ? 0 : 100) }
        let m = MeteogramModel(hours: hours, pxPerHour: 8, now: SampleData.referenceStart,
                               latitude: chc.lat, longitude: chc.lon)
        let g = m.glowStops
        #expect(g.count == 24 * 4 + 1)
        let at = { (h: Double) in g[Int(h * 4)].value }
        #expect(at(5) == 0)                       // before sunrise
        #expect(at(6.5) > 0 && at(6.5) < 1)       // low sun: partial glow
        #expect(at(9) == 1)                       // clear, sun well up
        #expect(abs(at(12) - 0.5) < 1e-9)         // halfway between clear 11am and overcast noon centres
        #expect(at(15) == 0)                      // overcast
    }

    @Test func gradientStopsSitAtHourCentresInOrder() {
        let m = model((0..<24).map { sky($0, "D", cloud: 0) })
        let s = m.hourStopLocations
        #expect(s.count == 24)
        #expect(zip(s, s.dropFirst()).allSatisfy { $0 < $1 })
        #expect(s.first! > 0 && s.last! < 1)
        #expect(abs(s[3] * m.width - m.hourX(3)) < 1e-9)
    }
}

@Suite struct TwilightTests {
    private let chc = Location.named(Location.defaultID)

    private func utc(_ y: Int, _ mo: Int, _ d: Int, _ h: Double, tz: TimeZone = TimeZone(identifier: "UTC")!) -> Date {
        var cal = Calendar(identifier: .gregorian); cal.timeZone = tz
        return cal.date(from: DateComponents(year: y, month: mo, day: d))!.addingTimeInterval(h * 3600)
    }

    @Test func sunIsOverheadAtTheEquatorAtAnEquinoxNoon() {
        // 20 Mar 2026, solar noon on the Greenwich meridian is ~12:07 UTC
        let e = SolarPosition.elevation(at: utc(2026, 3, 20, 12 + 7.0 / 60), latitude: 0, longitude: 0)
        #expect(e > 88)
    }

    @Test func christchurchEarlyNovember() {
        let nz = MeteogramModel.nzTimeZone
        // Midday sun about 90 - (43.5 - 15) ≈ 61.5° at solar noon (~1:20pm NZDT); well below at midnight.
        let noon = SolarPosition.elevation(at: utc(2026, 11, 3, 13 + 20.0 / 60, tz: nz), latitude: chc.lat, longitude: chc.lon)
        #expect(noon > 58 && noon < 65)
        let midnight = SolarPosition.elevation(at: utc(2026, 11, 3, 0, tz: nz), latitude: chc.lat, longitude: chc.lon)
        #expect(midnight < -25)
    }

    @Test func stopsRunNightTwilightDayAndBackAtTheRealTimes() throws {
        let hours = (0..<24).map { Hour(validTimeUtc: t0 + Double($0) * 3600, temperature: 10) }
        let m = MeteogramModel(hours: hours, pxPerHour: 10, now: SampleData.referenceStart,
                               latitude: chc.lat, longitude: chc.lon)
        let stops = try #require(m.skyStops)
        #expect(stops.map(\.phase) == [.night, .night, .twilight, .day, .day, .twilight, .night, .night])
        #expect(zip(stops, stops.dropFirst()).allSatisfy { $0.x <= $1.x })

        // Sunrise ~6:05am and sunset ~8:20pm NZDT in early November (local hours from midnight).
        let localHour = { (s: MeteogramModel.SkyStop) in (s.x - ChartPad.left) / m.pxPerHour }
        let sunrise = localHour(stops[3]), sunset = localHour(stops[4])
        #expect(sunrise > 5.8 && sunrise < 6.4)
        #expect(sunset > 20.0 && sunset < 20.7)
        // Civil twilight lasts roughly half an hour at this latitude.
        let civil = sunrise - localHour(stops[2])
        #expect(civil > 0.4 && civil < 0.75)
    }

    @Test func withoutCoordinatesThereAreNoSkyStops() {
        #expect(model([hour(0)]).skyStops == nil)
    }
}

@Suite @MainActor struct ChartLayerRenderTests {
    /// Smoke test: every layer, including the new ones, renders without trapping on
    /// sparse data (nil gusts, nil humidity, a single UV hour).
    @Test func rendersWithAllLayersAndSparseData() throws {
        var hours = SampleData.hours(count: 48)
        hours[5].windGust = nil
        hours[6].relativeHumidity = nil
        hours[7].uvIndex = nil
        for layout in [ChartLayout.web, .compact] {
            let m = MeteogramModel(hours: hours, pxPerHour: 8, now: SampleData.referenceNow, layout: layout)
            let renderer = ImageRenderer(content: MeteogramCanvas(model: m).frame(width: m.width, height: m.height))
            #expect(renderer.cgImage != nil)
        }
    }
}
