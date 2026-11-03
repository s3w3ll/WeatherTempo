import Foundation
import Testing
@testable import WeatherTempoKit

private typealias Hour = WeatherPayload.Hour
private let start = SampleData.referenceStart.timeIntervalSince1970   // Tue 3 Nov 2026 00:00 NZDT
private let nz = MeteogramModel.nzTimeZone

private func insights(now: Date = SampleData.referenceNow) -> WeatherInsights {
    WeatherInsights(payload: SampleData.payload(now: now), now: now)
}

/// A payload with just the hours given.
private func payload(_ hours: [Hour], daily: [WeatherPayload.Day] = [], current: WeatherPayload.Current = .init()) -> WeatherPayload {
    WeatherPayload(meta: .init(updated: "2026-11-03T01:00:00.000Z"), current: current, today: nil, hourly: hours, daily: daily)
}

private func h(_ hourOffset: Double, _ configure: (inout Hour) -> Void = { _ in }) -> Hour {
    var hour = Hour(validTimeUtc: start + hourOffset * 3600)
    configure(&hour)
    return hour
}

@Suite struct HourlyStripTests {
    @Test func startsOneHourBeforeTheNextSlotAndLabelsNow() {
        // now = exactly 14:00 -> first slot >= now is index 14 -> strip starts at 13
        let strip = insights().hourlyStrip(count: 10)
        #expect(strip.count == 10)
        #expect(strip[0].isNow && strip[0].time == "Now")
        #expect(strip[0].id == 13)
        #expect(strip[1].time == "2pm")
        #expect(strip[2].time == "3pm")
        #expect(!strip[1].isNow)
    }

    @Test func precipitationShownOnlyFromTenPercent() {
        let p = payload([h(0) { $0.precipChance = 9 }, h(1) { $0.precipChance = 10 }, h(2) { $0.precipChance = nil }])
        let strip = WeatherInsights(payload: p, now: Date(timeIntervalSince1970: start - 1)).hourlyStrip()
        #expect(strip.map(\.precip) == ["·", "10%", "·"])
    }

    @Test func missingTempShowsDashAndEmptyPayloadGivesEmptyStrip() {
        let p = payload([h(0)])
        #expect(WeatherInsights(payload: p, now: Date(timeIntervalSince1970: start)).hourlyStrip().first?.temp == "—")
        #expect(WeatherInsights(payload: payload([]), now: Date()).hourlyStrip().isEmpty)
    }

    @Test func allHoursInThePastStartsAtTheBeginning() {
        let strip = insights(now: SampleData.referenceStart.addingTimeInterval(86_400 * 30)).hourlyStrip(count: 3)
        #expect(strip.map(\.id) == [0, 1, 2])
    }
}

@Suite struct TodayInsightsTests {
    @Test func aggregatesCoverOnlyTodaysLocalDay() {
        let i = insights()
        let today = i.payload.hourly.prefix(24)
        let expectedRain = (today.reduce(0) { $0 + ($1.qpf ?? 0) } * 10).rounded() / 10
        let a = i.todayAggregates
        #expect(a.rainMm == expectedRain)
        #expect(a.peakChance == today.compactMap(\.precipChance).max())
        #expect(a.peakGust == today.compactMap(\.windGust).max())
    }

    @Test func aggregatesAreNilWhenNoHoursToday() {
        let p = payload([h(48)])    // two days later
        let a = WeatherInsights(payload: p, now: Date(timeIntervalSince1970: start + 3600)).todayAggregates
        #expect(a == .init(rainMm: nil, peakChance: nil, peakGust: nil))
    }

    @Test func dayBoundaryIsLocalMidnightNotUTC() {
        // 23:30 NZDT on Nov 3 is still "today"; 00:30 on Nov 4 is not.
        let p = payload([h(23.5) { $0.qpf = 1 }, h(24.5) { $0.qpf = 5 }])
        let a = WeatherInsights(payload: p, now: Date(timeIntervalSince1970: start + 12 * 3600)).todayAggregates
        #expect(a.rainMm == 1)
    }

    @Test func pressureTrendRisingSteadyFalling() {
        func trend(_ past: Double, _ now: Double) -> WeatherInsights.PressureTrend? {
            let p = payload([h(0) { $0.pressureMeanSeaLevel = past }, h(3) { $0.pressureMeanSeaLevel = now }])
            return WeatherInsights(payload: p, now: Date(timeIntervalSince1970: start + 3 * 3600)).pressureTrend
        }
        #expect(trend(1010, 1012) == .rising)
        #expect(trend(1012, 1010) == .falling)
        #expect(trend(1010, 1010.4) == .steady)
        #expect(trend(1010, 1010.5) == .rising)    // |delta| < 0.5 is steady; 0.5 is not
    }

    @Test func pressureTrendNeedsTwoDistinctSlots() {
        let single = payload([h(3) { $0.pressureMeanSeaLevel = 1010 }])
        #expect(WeatherInsights(payload: single, now: Date(timeIntervalSince1970: start + 3 * 3600)).pressureTrend == nil)
        #expect(WeatherInsights(payload: payload([]), now: Date()).pressureTrend == nil)
        // hours without pressure are ignored
        let none = payload([h(0), h(3)])
        #expect(WeatherInsights(payload: none, now: Date(timeIntervalSince1970: start + 3 * 3600)).pressureTrend == nil)
    }

    @Test func uvLabelBands() {
        #expect(WeatherInsights.uvLabel(nil) == "—")
        #expect(WeatherInsights.uvLabel(0) == "0 Low")
        #expect(WeatherInsights.uvLabel(2) == "2 Low")
        #expect(WeatherInsights.uvLabel(3) == "3 Med")
        #expect(WeatherInsights.uvLabel(5) == "5 Med")
        #expect(WeatherInsights.uvLabel(5.5) == "5.5 High")
        #expect(WeatherInsights.uvLabel(7) == "7 High")
        #expect(WeatherInsights.uvLabel(8) == "8 V.High")
        #expect(WeatherInsights.uvLabel(10) == "10 V.High")
        #expect(WeatherInsights.uvLabel(11) == "11 Extreme")
    }

    @Test func uvWindowSpansFirstToLastHourAtOrAboveThree() {
        let uv: [Double] = [0, 0, 1, 2, 3, 4, 5, 4, 3, 2, 1, 0]   // hours 0...11 of today
        let p = payload(uv.enumerated().map { i, v in h(Double(i)) { $0.uvIndex = v } })
        let info = WeatherInsights(payload: p, now: Date(timeIntervalSince1970: start + 3600)).uvInfo
        #expect(info.peak == 5)
        #expect(info.window == "4am–9am")   // first >=3 at 04:00, last at 08:00 + 1 h
    }

    @Test func uvWindowIsNilWhenAlwaysLow() {
        let p = payload([h(1) { $0.uvIndex = 1 }, h(2) { $0.uvIndex = 2.9 }])
        let info = WeatherInsights(payload: p, now: Date(timeIntervalSince1970: start)).uvInfo
        #expect(info.peak == 2.9)
        #expect(info.window == nil)
    }

    @Test func highLowUsesCalendarDayMaxAndOvernightMin() throws {
        let i = insights()
        let hl = try #require(i.todayHighLow)
        let d0 = i.payload.daily[0], d1 = i.payload.daily[1]

        #expect(hl.high.temp == d0.calendarDayTemperatureMax)

        // High time = the hour of today's warmest reading (it's within 1 degree of the calendar max).
        let today = Array(i.payload.hourly.prefix(24))
        let warmest = try #require(today.max { ($0.temperature ?? 0) < ($1.temperature ?? 0) })
        #expect(hl.high.utcSec == warmest.validTimeUtc)

        // Low = coolest hour between tonight's sunset and tomorrow's sunrise.
        let night = i.payload.hourly.filter {
            $0.validTimeUtc >= d0.sunsetTimeUtc! && $0.validTimeUtc < d1.sunriseTimeUtc!
        }
        let coolest = try #require(night.min { ($0.temperature ?? 0) < ($1.temperature ?? 0) })
        #expect(hl.low.temp == coolest.temperature)
        #expect(hl.low.utcSec == coolest.validTimeUtc)
    }

    @Test func highTimeOmittedWhenForecastPeakIsMoreThanADegreeFromCalendarMax() {
        // Peak already passed: forecast hours left today are all well below the calendar max.
        let daily = [WeatherPayload.Day(calendarDayTemperatureMax: 20, calendarDayTemperatureMin: 8)]
        let p = payload([h(20) { $0.temperature = 14 }, h(21) { $0.temperature = 13 }], daily: daily)
        let hl = WeatherInsights(payload: p, now: Date(timeIntervalSince1970: start + 19 * 3600)).todayHighLow
        #expect(hl?.high.temp == 20)
        #expect(hl?.high.utcSec == nil)
        // No overnight window (no sunset/sunrise) -> low falls back to today's remaining minimum
        #expect(hl?.low.temp == 13)
    }

    @Test func highLowFallsBackToStationRollingExtremes() {
        let cur = WeatherPayload.Current(tempMax24h: 17, tempMin24h: 6)
        let p = payload([], current: cur)
        let hl = WeatherInsights(payload: p, now: Date()).displayHighLow
        #expect(hl == .init(high: .init(temp: 17, utcSec: nil), low: .init(temp: 6, utcSec: nil)))
        #expect(WeatherInsights(payload: payload([]), now: Date()).displayHighLow == nil)
    }

    @Test func tiesGoToTheLaterHourForTodaysHighButEarlierForDayCards() {
        // todayHighLow: reduce((a,b) => a>b ? a : b) -> later wins on ties.
        let daily = [WeatherPayload.Day(calendarDayTemperatureMax: 15, calendarDayTemperatureMin: 5)]
        let p = payload([h(10) { $0.temperature = 15 }, h(11) { $0.temperature = 15 }], daily: daily)
        let hl = WeatherInsights(payload: p, now: Date(timeIntervalSince1970: start + 9 * 3600)).todayHighLow
        #expect(hl?.high.utcSec == start + 11 * 3600)
    }

    @Test func currentDaytimeFromSunriseSunset() {
        var cur = WeatherPayload.Current(iconCode: 32)
        cur.sunriseUtc = start + 6 * 3600
        cur.sunsetUtc = start + 20 * 3600
        let day = WeatherInsights(payload: payload([], current: cur), now: Date(timeIntervalSince1970: start + 12 * 3600))
        let night = WeatherInsights(payload: payload([], current: cur), now: Date(timeIntervalSince1970: start + 22 * 3600))
        #expect(day.isDaytime && day.currentGlyph == "☀️")
        #expect(!night.isDaytime)
        #expect(WeatherInsights(payload: payload([]), now: Date()).isDaytime)   // unknown counts as day
    }

    @Test func currentCloudCoverUsesNearestHourWithGrace() {
        let p = payload([h(0) { $0.cloudCover = 10 }, h(1) { $0.cloudCover = 20 }, h(2) { $0.cloudCover = 30 }])
        // 1:20 -> hour 1 (00:00 is older than now-30min; 01:00 qualifies)
        let i = WeatherInsights(payload: p, now: Date(timeIntervalSince1970: start + 3600 + 1200))
        #expect(i.currentCloudCover == 20)
        // within 30 min after an hour the previous slot still counts
        let j = WeatherInsights(payload: p, now: Date(timeIntervalSince1970: start + 1500))
        #expect(j.currentCloudCover == 10)
    }

    @Test func windCardinalFallsBackToBearing() {
        var cur = WeatherPayload.Current()
        cur.windDirection = 225
        #expect(WeatherInsights(payload: payload([], current: cur), now: Date()).currentWindCardinal == "SW")
        cur.windCardinal = "NNE"
        #expect(WeatherInsights(payload: payload([], current: cur), now: Date()).currentWindCardinal == "NNE")
        #expect(WeatherInsights(payload: payload([]), now: Date()).currentWindCardinal == "")
    }
}

@Suite struct DayForecastTests {
    @Test func tomorrowCard() throws {
        let i = insights()
        let f = try #require(i.dayForecast(dayIndex: 1))
        #expect(f.label == "Tomorrow")
        #expect(f.date == "4 Nov")
        #expect(f.sunrise == i.payload.daily[1].sunriseTimeUtc)
        #expect(f.tempMax.value == i.payload.daily[1].calendarDayTemperatureMax)

        let day = i.payload.hourly.filter { $0.validTimeUtc >= start + 86_400 && $0.validTimeUtc < start + 2 * 86_400 }
        #expect(day.count == 24)
        // time of the high = first hour with the day's maximum temperature (earlier wins on ties here)
        let maxT = day.compactMap(\.temperature).max()
        #expect(f.tempMax.utcSec == day.first { $0.temperature == maxT }?.validTimeUtc)
        // rain total + max chance
        #expect(f.totalMm == (day.reduce(0) { $0 + ($1.qpf ?? 0) } * 10).rounded() / 10)
        #expect(f.maxChance == day.compactMap(\.precipChance).max())
    }

    @Test func laterDaysAreLabelledByWeekday() throws {
        let i = insights()
        #expect(try #require(i.dayForecast(dayIndex: 2)).label == "Thursday")   // 5 Nov 2026
        #expect(try #require(i.dayForecast(dayIndex: 3)).label == "Friday")
        #expect(i.dayForecasts.map(\.label) == ["Tomorrow", "Thursday", "Friday", "Saturday"])
    }

    @Test func missingDayGivesNil() {
        #expect(insights().dayForecast(dayIndex: 9) == nil)
        #expect(insights().dayForecast(dayIndex: 0) != nil)   // today is addressable too
    }

    @Test func overnightLowSpansSunsetToNextSunrise() throws {
        let i = insights()
        let f = try #require(i.dayForecast(dayIndex: 1))
        let d = i.payload.daily[1], next = i.payload.daily[2]
        let night = i.payload.hourly.filter { $0.validTimeUtc >= d.sunsetTimeUtc! && $0.validTimeUtc < next.sunriseTimeUtc! }
        let coolest = try #require(night.min { ($0.temperature ?? 0) < ($1.temperature ?? 0) })
        #expect(f.tempMin.value == coolest.temperature)
        #expect(f.tempMin.utcSec == coolest.validTimeUtc)
    }

    @Test func lastDayWithoutNextSunriseUsesTheCalendarDayMinimum() throws {
        let f = try #require(insights().dayForecast(dayIndex: 4))
        let day = insights().payload.hourly.filter { $0.validTimeUtc >= start + 4 * 86_400 && $0.validTimeUtc < start + 5 * 86_400 }
        let coolest = try #require(day.min { ($0.temperature ?? 0) < ($1.temperature ?? 0) })
        #expect(f.tempMin.value == coolest.temperature)
    }

    @Test func windPicksStrongestHourAndCardinal() throws {
        let daily = [
            WeatherPayload.Day(),
            WeatherPayload.Day(sunriseTimeUtc: start + 86_400 + 6 * 3600),
        ]
        let p = payload([
            h(24 + 9) { $0.windSpeed = 20; $0.windDirectionCardinal = "SW" },
            h(24 + 15) { $0.windSpeed = 35; $0.windDirection = 90 },   // no cardinal -> derived from bearing
            h(24 + 18) { $0.windSpeed = 30; $0.windDirectionCardinal = "NW" },
        ], daily: daily)
        let f = try #require(WeatherInsights(payload: p, now: Date(timeIntervalSince1970: start)).dayForecast(dayIndex: 1))
        #expect(f.windSpeed == 35)
        #expect(f.windCardinal == "E")
        #expect(f.windUtcSec == start + (24 + 15) * 3600)
    }

    @Test func dayWithNoHoursKeepsDailyValuesAndNilsTheRest() throws {
        let daily = [
            WeatherPayload.Day(),
            WeatherPayload.Day(calendarDayTemperatureMax: 19, calendarDayTemperatureMin: 9,
                               sunriseTimeUtc: start + 86_400 + 6 * 3600),
        ]
        let f = try #require(WeatherInsights(payload: payload([h(0)], daily: daily), now: Date(timeIntervalSince1970: start))
            .dayForecast(dayIndex: 1))
        #expect(f.tempMax == .init(value: 19, utcSec: nil))
        #expect(f.tempMin == .init(value: 9, utcSec: nil))
        #expect(f.totalMm == nil && f.maxChance == nil && f.uvPeak == nil && f.windSpeed == nil)
    }
}

@Suite struct SamplePayloadTests {
    @Test func samplePayloadIsConsistent() {
        let p = SampleData.payload()
        #expect(p.hourly.count == 120 && p.daily.count == 5)
        #expect(p.current.temp != nil && p.current.sunriseUtc != nil)
        #expect(p.updatedDate == SampleData.referenceNow)
        #expect(!p.isStale(now: SampleData.referenceNow))
        #expect(p.isStale(now: SampleData.referenceNow.addingTimeInterval(46 * 60)))
        #expect(p.daily[0].sunsetTimeUtc! > p.daily[0].sunriseTimeUtc!)
    }
}
