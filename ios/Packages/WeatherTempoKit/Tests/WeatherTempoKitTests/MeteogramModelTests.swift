import Foundation
import Testing
@testable import WeatherTempoKit

private typealias Hour = WeatherPayload.Hour

private func hour(_ i: Int, temp: Double? = 10, feels: Double? = nil, cloud: Double? = nil,
                  dn: String = "D", qpf: Double? = nil, pressure: Double? = nil) -> Hour {
    Hour(validTimeUtc: SampleData.referenceStart.timeIntervalSince1970 + Double(i) * 3600,
         temperature: temp, temperatureFeelsLike: feels, cloudCover: cloud, qpf: qpf,
         pressureMeanSeaLevel: pressure, dayOrNight: dn)
}

private func model(_ hours: [Hour], pph: Double = 8, now: Date = SampleData.referenceStart) -> MeteogramModel {
    MeteogramModel(hours: hours, pxPerHour: pph, now: now)
}

@Suite struct MeteogramLayoutTests {
    @Test func zonesKeepTheSeventyFifteenFifteenSplit() {
        let main = ChartZone.tempBot - ChartZone.top       // 224
        let wind = ChartZone.windBot - ChartZone.windTop   // 48
        let precip = ChartZone.precipBot - ChartZone.precipTop // 48
        #expect(main == 224 && wind == 48 && precip == 48)
        // 320 px data area, 70/15/15
        #expect(main / 320 == 0.7)
        #expect(wind / 320 == 0.15)
        #expect(precip / 320 == 0.15)
        // 4 px gaps between zones, axis below the data area
        #expect(ChartZone.windTop - ChartZone.tempBot == 4)
        #expect(ChartZone.precipTop - ChartZone.windBot == 4)
        #expect(ChartZone.timeTop - ChartZone.precipBot == 4)
        #expect(ChartZone.height == 364)
    }

    @Test func selectedDaysExactlyFillTheViewport() {
        // (390 - 12 padding) px spread over days * 24 hours
        #expect(MeteogramModel.pxPerHour(viewportWidth: 390, days: 1) == 15.75)
        #expect(MeteogramModel.pxPerHour(viewportWidth: 390, days: 2) == 7.875)
        #expect(MeteogramModel.pxPerHour(viewportWidth: 390, days: 3) == 5.25)
        #expect(MeteogramModel.pxPerHour(viewportWidth: 390, days: 5) == 3.15)   // no 8 px floor any more
        #expect(MeteogramModel.pxPerHour(viewportWidth: 1000, days: 2) > 20)
    }

    @Test func fiveDayZoomFitsAFiveDayForecastInsideTheViewportWithoutScrolling() {
        let hours = SampleData.hours(count: 120)
        let pph = MeteogramModel.pxPerHour(viewportWidth: 390, days: 5)
        let m = model(hours, pph: pph)
        #expect(abs(m.width - 390) < 1e-9)
    }

    @Test func twoDayZoomOfAFiveDayForecastScrollsToReachTheRest() {
        let hours = SampleData.hours(count: 120)
        let pph = MeteogramModel.pxPerHour(viewportWidth: 390, days: 2)
        let m = model(hours, pph: pph)
        #expect(m.hours.count == 120)                 // all five days are kept
        #expect(m.width > 390 * 2.4)                  // ~2.5 viewports wide
        // the two selected days occupy exactly one viewport
        #expect(abs((m.hourX(47) + pph / 2 + ChartPad.right) - 390) < 1e-9)
    }

    @Test func zoomingOutThinsHourLabelsAndWindArrows() {
        func stride(_ pph: Double) -> (Int, Int) { let m = model([hour(0)], pph: pph); return (m.hourLabelStride, m.windArrowInterval) }
        #expect(stride(15.75) == (3, 3))     // 1 day
        #expect(stride(10) == (3, 3))
        #expect(stride(7.875) == (6, 3))     // 2 days
        #expect(stride(5.25) == (6, 6))      // 3 days
        #expect(stride(3.15) == (12, 6))     // 5 days
        #expect(stride(1.2) == (24, 15))
    }

    @Test func widthIncludesPadding() {
        let m = model((0..<48).map { hour($0) })
        #expect(m.width == 6 + 48 * 8 + 6)
        #expect(m.height == 364)
        #expect(m.hourX(0) == 6 + 4)
        #expect(m.hourX(1) - m.hourX(0) == 8)
    }

    @Test func temperatureRangeIsPaddedByTwoAndIncludesFeelsLike() {
        let m = model([hour(0, temp: 10, feels: 4), hour(1, temp: 15, feels: 12)])
        #expect(m.tMin == 2)    // min(feels 4) - 2
        #expect(m.tMax == 17)   // max(temp 15) + 2
        #expect(m.tempY(m.tMin) == ChartZone.tempBot)
        #expect(m.tempY(m.tMax) == ChartZone.tempTop)
    }

    @Test func rangesFallBackWhenDataMissing() {
        let m = model([hour(0, temp: nil)])
        #expect(m.tMin == 6 && m.tMax == 20)
        #expect(m.pMin == 1000 && m.pMax == 1030)
        #expect(m.qMax == 1)
    }

    @Test func pressureAndRainScales() {
        let m = model([hour(0, qpf: 0.4, pressure: 1010), hour(1, qpf: 3.2, pressure: 1020)])
        #expect(m.pMin == 1008 && m.pMax == 1022)
        #expect(m.pressureY(1008) == ChartZone.tempBot)
        #expect(m.qMax == 3.2)
    }

    @Test func windAndProbabilityMapping() {
        let m = model([hour(0)])
        #expect(m.windY(0) == ChartZone.windBot)
        #expect(m.windY(90) == ChartZone.windTop)
        #expect(m.windY(500) == ChartZone.windTop)   // clamped
        #expect(m.windY(-5) == ChartZone.windBot)
        // 30 km/h sits exactly one third up the zone
        #expect(m.windY(30) == ChartZone.windBot - 16)
        #expect(m.probabilityY(0) == ChartZone.precipBot)
        #expect(m.probabilityY(100) == ChartZone.precipTop)
    }

    @Test func nowIndexIsFirstHourAtOrAfterNow() {
        let hours = (0..<10).map { hour($0) }
        let start = SampleData.referenceStart
        #expect(model(hours, now: start).nowIndex == 0)
        #expect(model(hours, now: start.addingTimeInterval(3600 * 3)).nowIndex == 3)
        #expect(model(hours, now: start.addingTimeInterval(3600 * 3 + 1)).nowIndex == 4)
        #expect(model(hours, now: start.addingTimeInterval(3600 * 100)).nowIndex == 0)  // all in the past
    }

    @Test func hourIndexFromX() {
        let m = model((0..<10).map { hour($0) })
        #expect(m.hourIndex(atX: m.hourX(0)) == 0)
        #expect(m.hourIndex(atX: m.hourX(4) + 3) == 4)
        #expect(m.hourIndex(atX: -50) == 0)
        #expect(m.hourIndex(atX: 10_000) == 9)
    }
}

@Suite struct MeteogramFeatureTests {
    @Test func cloudRunsGroupConsecutiveHoursAtOrAboveTenPercent() {
        let clouds: [Double?] = [0, 20, 30, 5, 50, nil, 10, 10]
        let m = model(clouds.enumerated().map { hour($0.offset, cloud: $0.element) })
        #expect(m.cloudRuns == [1..<3, 4..<5, 6..<8])
    }

    @Test func tempMarkersPickDayHighAndNightLow() {
        // N N D D D N  with temps 5 4 10 12 11 6
        let spec: [(String, Double)] = [("N", 5), ("N", 4), ("D", 10), ("D", 12), ("D", 11), ("N", 6)]
        let m = model(spec.enumerated().map { hour($0.offset, temp: $0.element.1, dn: $0.element.0) })
        #expect(m.tempMarkers == [
            .init(index: 1, isHigh: false),
            .init(index: 3, isHigh: true),
            .init(index: 5, isHigh: false),
        ])
    }

    @Test func singleHourStillGetsAMarker() {
        #expect(model([hour(0, dn: "D")]).tempMarkers == [.init(index: 0, isHigh: true)])
        #expect(model([]).tempMarkers.isEmpty)
    }

    @Test func hourLabelsEveryThreeLocalHoursWhenThereIsRoom() {
        // reference start is local midnight (NZDT); 12 px/h = 36 px between labels
        let m = model((0..<24).map { hour($0) }, pph: 12)
        #expect(m.hourLabelStride == 3)
        #expect(m.hourLabels.map(\.text) == ["12am", "3am", "6am", "9am", "12pm", "3pm", "6pm", "9pm"])
        #expect(m.hourLabels.map(\.index) == [0, 3, 6, 9, 12, 15, 18, 21])
    }

    @Test func hourLabelsOnlyNoonAndMidnightWhenFiveDaysFitOnAPhone() {
        let m = model((0..<48).map { hour($0) }, pph: 3.15)
        #expect(m.hourLabels.map(\.text) == ["12am", "12pm", "12am", "12pm"])
    }

    @Test func hourLabelsEverySixHoursOnNarrowCharts() {
        // 8 px/h would put labels 24 px apart and they collide
        let m = model((0..<24).map { hour($0) }, pph: 8)
        #expect(m.hourLabelStride == 6)
        #expect(m.hourLabels.map(\.text) == ["12am", "6am", "12pm", "6pm"])
    }

    @Test func dayBoundariesFollowLocalMidnightNotUTC() {
        // Start 9am NZDT: the next local midnight is 15 hours later.
        let start = SampleData.referenceStart.addingTimeInterval(9 * 3600)
        let hours = SampleData.hours(start: start, count: 48)
        let m = model(hours)
        #expect(m.dayBoundaries == [15, 39])
    }

    @Test func dayLabelsUseLongNamesWhenWideAndShortWhenNarrow() {
        let hours = SampleData.hours(count: 48)   // Tue 3 Nov, Wed 4 Nov 2026
        let wide = model(hours, pph: 8)           // 24 h * 8 = 192 px > 100
        #expect(wide.dayLabels.map(\.text) == ["Tuesday", "Wednesday"])
        let narrow = model(hours, pph: 3)         // 72 px
        #expect(narrow.dayLabels.map(\.text) == ["Tue", "Wed"])
        #expect(wide.dayLabels[1].x0 == wide.hourX(24) - 4)
    }

    @Test func windArrowPointsWhereTheWindIsGoing() {
        // Wind FROM the north blows toward the south: down the screen (y grows downward).
        let north = MeteogramModel.windArrow(x: 100, y: 100, directionFrom: 0)
        #expect(north.headTip.y > north.shaftEnd.y && north.shaftEnd.y > north.shaftStart.y)
        #expect(abs(north.headTip.x - 100) < 1e-9)

        // FROM the west -> toward the east: right.
        let west = MeteogramModel.windArrow(x: 100, y: 100, directionFrom: 270)
        #expect(west.headTip.x > west.shaftEnd.x && west.shaftEnd.x > west.shaftStart.x)
        #expect(abs(west.headTip.y - 100) < 1e-9)

        // Shaft is centred on the point and 0.6 * L * 2 = 6 px long.
        let dist = hypot(west.shaftEnd.x - west.shaftStart.x, west.shaftEnd.y - west.shaftStart.y)
        #expect(abs(dist - 6) < 1e-9)
        #expect(abs((west.shaftStart.x + west.shaftEnd.x) / 2 - 100) < 1e-9)
    }

    @Test func detailRowsMirrorTheWebTooltip() {
        let h = Hour(validTimeUtc: SampleData.referenceStart.timeIntervalSince1970,
                     temperature: 12.6, temperatureFeelsLike: 10.4, relativeHumidity: 78,
                     windSpeed: 6.5, windDirectionCardinal: "NNW", windGust: 7.9,
                     cloudCover: 100, qpf: 0.2, precipChance: 51, pressureMeanSeaLevel: 1027.3,
                     uvIndex: 0, wxPhraseMedium: "Light Drizzle")
        let m = model([h])
        let rows = Dictionary(uniqueKeysWithValues: m.detailRows(for: 0).map { ($0.label, $0.value) })
        #expect(rows["Temp"] == "13°")
        #expect(rows["Feels like"] == "10°")
        #expect(rows["Condition"] == "Light Drizzle")
        #expect(rows["Humidity"] == "78%")
        #expect(rows["Wind"] == "6.5 km/h NNW")
        #expect(rows["Gusts"] == "7.9 km/h")
        #expect(rows["Rain chance"] == "51%")
        #expect(rows["Precipitation"] == "0.2 mm")
        #expect(rows["Pressure"] == "1027 hPa")
        #expect(rows["UV index"] == "0")
        #expect(rows["Cloud cover"] == "100%")
        #expect(m.detailTitle(for: 0).hasPrefix("Tue"))
    }

    @Test func detailRowsShowDashesForMissingData() {
        let m = model([hour(0, temp: nil)])
        let rows = Dictionary(uniqueKeysWithValues: m.detailRows(for: 0).map { ($0.label, $0.value) })
        #expect(rows["Temp"] == "—")
        #expect(rows["Wind"] == "—")
        #expect(rows["Precipitation"] == "—")
        #expect(m.detailRows(for: 99).isEmpty)
    }

    @Test func sampleDataIsDeterministicAndPlausible() {
        let a = SampleData.hours(), b = SampleData.hours()
        #expect(a == b)
        #expect(a.count == 120)
        #expect(a.allSatisfy { ($0.temperature ?? 0) > -5 && ($0.temperature ?? 0) < 30 })
        #expect(a.contains { ($0.qpf ?? 0) > 0 })
        #expect(a[12].dayOrNight == "D" && a[2].dayOrNight == "N")
    }
}
