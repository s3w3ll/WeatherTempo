import Foundation
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
