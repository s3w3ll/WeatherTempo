import Foundation
import Testing
@testable import WeatherTempoKit

private typealias Hour = WeatherPayload.Hour
private let t0 = SampleData.referenceStart.timeIntervalSince1970   // Tue 3 Nov 2026 00:00 NZDT

private func hours(_ count: Int, start: Int = 0, pressure: (Int) -> Double? = { _ in nil }) -> [Hour] {
    (0..<count).map { i in
        Hour(validTimeUtc: t0 + Double(start + i) * 3600, temperature: 10 + Double((start + i) % 24) / 2,
             precipChance: Double((start + i) % 24) * 2, pressureMeanSeaLevel: pressure(i))
    }
}

private func model(_ hs: [Hour], pph: Double = 8) -> MeteogramModel {
    MeteogramModel(hours: hs, pxPerHour: pph, now: Date(timeIntervalSince1970: t0))
}

@Suite struct WeekOverviewTests {
    @Test func oneColumnPerLocalDay() {
        let days = model(SampleData.hours(count: 120)).weekDays
        #expect(days.map(\.label) == ["Tue", "Wed", "Thu", "Fri", "Sat"])
        #expect(days.map(\.hourCount) == [24, 24, 24, 24, 24])
        #expect(days[1].startIndex == 24 && days[1].endIndex == 48)
    }

    @Test func partialFirstAndLastDaysKeepTheirTrueWidth() {
        // starts at 6pm Tuesday, 40 hours -> Tue 6 h, Wed 24 h, Thu 10 h
        let days = model(hours(40, start: 18)).weekDays
        #expect(days.map(\.hourCount) == [6, 24, 10])
        #expect(days.map(\.label) == ["Tue", "Wed", "Thu"])
    }

    @Test func dayStatsComeFromThatDaysHours() throws {
        let d = try #require(model(hours(48)).weekDays.first)
        #expect(d.low == 10 && d.high == 21.5)        // 10 + 23/2
        #expect(d.maxChance == 46)
    }

    @Test func sunshineHoursSumEachDaysClearDaylight() throws {
        // Day 1: 10 clear daylight hours + 4 half-cloudy ones; day 2: overcast all day.
        let hs = (0..<48).map { i -> Hour in
            let hod = i % 24
            let day = (6..<20).contains(hod)
            let cloud: Double = i >= 24 ? 100 : (hod < 16 ? 0 : 50)
            return Hour(validTimeUtc: t0 + Double(i) * 3600, temperature: 10, cloudCover: cloud, dayOrNight: day ? "D" : "N")
        }
        let days = model(hs).weekDays
        #expect(days.map(\.sunshineHours) == [12, 0])
    }

    @Test func sunHoursLabelKeepsATraceOfSun() {
        #expect(WeekOverviewStrip.sunHours(0) == "0h")
        #expect(WeekOverviewStrip.sunHours(0.3) == "<1h")
        #expect(WeekOverviewStrip.sunHours(6.6) == "7h")
    }

    @Test func emptySeriesHasNoDays() {
        #expect(model([]).weekDays.isEmpty)
        #expect(model([]).weekTemperatureRange == nil)
    }

    @Test func visibleFractionMapsTheViewportOntoTheSeries() {
        let m = model(hours(48))                       // 48 h * 8 px = 384 px of data
        #expect(m.visibleFraction(scrollX: 6, viewport: 192) == 0...0.5)
        #expect(m.visibleFraction(scrollX: 198, viewport: 192) == 0.5...1)
        #expect(m.visibleFraction(scrollX: -50, viewport: 9999) == 0...1)   // clamped
    }

    @Test func defaultVisibleWindowOpensWithNowThirtyPercentIn() {
        // 120 h, now = hour 0 -> window clamps to the start: 2 days = 48 h = 0...0.4
        let m = model(SampleData.hours(count: 120))
        #expect(m.defaultVisibleFraction(days: 2) == 0...0.4)
        #expect(m.defaultVisibleFraction(days: 9) == 0...1)          // longer than the series
        let mid = MeteogramModel(hours: SampleData.hours(count: 120), pxPerHour: 8,
                                 now: Date(timeIntervalSince1970: t0 + 60 * 3600))
        let f = mid.defaultVisibleFraction(days: 2)
        #expect(abs((f.upperBound - f.lowerBound) - 0.4) < 1e-9)
        #expect(abs(f.lowerBound * 120 - (60.5 - 48 * 0.3)) < 1e-9)
        #expect(model([]).defaultVisibleFraction(days: 2) == 0...1)
    }

    @Test func browsingCentresTheWindowOnTheFinger() {
        let m = model(SampleData.hours(count: 120))
        #expect(m.browseStartHour(fraction: 0.5, days: 2) == 36)      // centre 60 - 24
        #expect(m.browseStartHour(fraction: 0, days: 2) == 0)         // clamped at the start
        #expect(m.browseStartHour(fraction: 1, days: 2) == 72)        // and at the end
        #expect(m.browseStartHour(fraction: 0.7, days: 5) == 0)       // whole series visible
    }

    @Test func initialScrollStaysInsideTheContent() {
        let m = model(hours(48))
        #expect(m.initialScrollX(viewport: 9999) == 0)
        let late = MeteogramModel(hours: hours(48), pxPerHour: 8, now: Date(timeIntervalSince1970: t0 + 47 * 3600))
        #expect(late.initialScrollX(viewport: 100) == late.width - 100)
    }
}

@Suite struct PressureTrendTests {
    @Test func bandsFollowTheMarineScale() {
        typealias T = MeteogramModel.PressureTendency
        #expect(T(changePer3h: 0.4).direction == .steady)
        #expect(T(changePer3h: 0.5).strength == 1 && T(changePer3h: 0.5).direction == .rising)
        #expect(T(changePer3h: -1.6).strength == 2 && T(changePer3h: -1.6).direction == .falling)
        #expect(T(changePer3h: 3.6).strength == 3)
        #expect(T(changePer3h: -1).label == "Falling slowly")
        #expect(T(changePer3h: 5).label == "Rising rapidly")
        #expect(T(changePer3h: 0).label == "Steady")
    }

    @Test func tendencyIsTheChangeOverThePreviousThreeHours() throws {
        let m = model(hours(10, pressure: { 1010 + Double($0) }))      // +1 hPa/h = +3 per 3 h
        let t = m.pressureTendencies
        #expect(t.allSatisfy { $0?.direction == .rising && $0?.strength == 2 })
        #expect(abs(try #require(t[5]).change - 3) < 1e-9)
        #expect(abs(try #require(t[0]).change - 3) < 1e-9)              // first hour looks ahead
    }

    @Test func missingPressureGivesNoTendency() {
        let m = model(hours(6, pressure: { $0 == 2 ? nil : 1015 }))
        #expect(m.pressureTendencies[2] == nil)
        #expect(m.pressureTendencies[3]?.direction == .steady)
        #expect(model(hours(4)).pressureTendencies.allSatisfy { $0 == nil })
    }

    @Test func runsGroupDirectionAndKeepTheStrongestChange() {
        // steady for 6 h, then falling 2 hPa/h (rapidly) for 6 h
        let m = model(hours(12, pressure: { $0 < 6 ? 1015 : 1015 - 2 * Double($0 - 5) }))
        let runs = m.pressureTendencyRuns
        #expect(runs.first?.direction == .steady)
        let falling = runs.first { $0.direction == .falling }
        #expect(falling?.maxStrength == 3)
        #expect(falling?.label == "Falling rapidly")
        #expect(falling?.range.upperBound == 12)
    }
}
