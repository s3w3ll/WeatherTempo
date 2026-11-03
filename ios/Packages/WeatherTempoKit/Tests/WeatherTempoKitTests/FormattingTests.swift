import Foundation
import Testing
@testable import WeatherTempoKit

@Suite struct FormattingTests {
    private let nz = MeteogramModel.nzTimeZone
    private let midnight = SampleData.referenceStart.timeIntervalSince1970   // Tue 3 Nov 2026 00:00 NZDT

    @Test func hourIsCompactTwelveHour() {
        #expect(TimeFormat.hour(midnight, in: nz) == "12am")
        #expect(TimeFormat.hour(midnight + 10 * 3600, in: nz) == "10am")
        #expect(TimeFormat.hour(midnight + 12 * 3600, in: nz) == "12pm")
        #expect(TimeFormat.hour(midnight + 14 * 3600 + 1799, in: nz) == "2pm")
        #expect(TimeFormat.hour(midnight + 23 * 3600, in: nz) == "11pm")
    }

    @Test func missingTimesShowADash() {
        #expect(TimeFormat.hour(nil, in: nz) == "—")
        #expect(TimeFormat.hour(0, in: nz) == "—")   // JS: !utcSec
        #expect(TimeFormat.hourMinute(nil, in: nz) == "—")
    }

    @Test func hourMinuteCompactAndSpaced() {
        let t = midnight + 6 * 3600 + 32 * 60
        #expect(TimeFormat.hourMinute(t, in: nz) == "6:32am")
        #expect(TimeFormat.hourMinute(t, in: nz, spaced: true) == "6:32 am")
        #expect(TimeFormat.hourMinute(midnight + 20 * 3600 + 5 * 60, in: nz) == "8:05pm")
    }

    @Test func timesFollowTheGivenZoneNotTheDevice() {
        let utc = TimeZone(identifier: "UTC")!
        // 00:00 NZDT is 11:00 UTC the previous day
        #expect(TimeFormat.hour(midnight, in: utc) == "11am")
    }

    @Test func relativeTimeMatchesWebThresholds() {
        let now = Date()
        #expect(TimeFormat.relative(since: nil, now: now) == "—")
        #expect(TimeFormat.relative(since: now.addingTimeInterval(-90), now: now) == "just now")
        #expect(TimeFormat.relative(since: now.addingTimeInterval(-5 * 60), now: now) == "5 min ago")
        #expect(TimeFormat.relative(since: now.addingTimeInterval(-59 * 60), now: now) == "59 min ago")
        #expect(TimeFormat.relative(since: now.addingTimeInterval(-90 * 60), now: now) == "2h ago")
        #expect(TimeFormat.relative(since: now.addingTimeInterval(-3 * 3600), now: now) == "3h ago")
    }

    @Test func weekdayAndDate() {
        #expect(TimeFormat.weekday(midnight, in: nz) == "Tuesday")
        #expect(TimeFormat.weekday(midnight, in: nz, long: false) == "Tue")
        #expect(TimeFormat.dayMonth(midnight + 86_400, in: nz) == "4 Nov")
    }

    @Test func trimmedNumbers() {
        #expect(NumberFormat.trimmed(6.5) == "6.5")
        #expect(NumberFormat.trimmed(7) == "7")
        #expect(NumberFormat.trimmed(7.04) == "7")
        #expect(NumberFormat.trimmed(0.2) == "0.2")
        #expect(NumberFormat.rounded(12.5, suffix: "°") == "13°")
        #expect(NumberFormat.rounded(nil) == "—")
    }

    @Test func weatherIconsMatchWebMapping() {
        #expect(WeatherGlyph.emoji(iconCode: 32, dayOrNight: "D") == "☀️")
        #expect(WeatherGlyph.emoji(iconCode: 31, dayOrNight: "N") == "🌙")
        #expect(WeatherGlyph.emoji(iconCode: 30, dayOrNight: "D") == "⛅")
        #expect(WeatherGlyph.emoji(iconCode: 30, dayOrNight: "N") == "☁️")
        #expect(WeatherGlyph.emoji(iconCode: 28, dayOrNight: "D") == "🌥️")
        #expect(WeatherGlyph.emoji(iconCode: 9, dayOrNight: "D") == "🌦️")
        #expect(WeatherGlyph.emoji(iconCode: 12, dayOrNight: "D") == "🌧️")
        #expect(WeatherGlyph.emoji(iconCode: 14, dayOrNight: "D") == "❄️")
        #expect(WeatherGlyph.emoji(iconCode: 17, dayOrNight: "D") == "⛈️")
        #expect(WeatherGlyph.emoji(iconCode: 20, dayOrNight: "D") == "🌫️")
        #expect(WeatherGlyph.emoji(iconCode: 23, dayOrNight: "D") == "💨")
        // unknown / missing code: day => partly cloudy, night => cloud; missing dayOrNight counts as day
        #expect(WeatherGlyph.emoji(iconCode: 999, dayOrNight: "D") == "⛅")
        #expect(WeatherGlyph.emoji(iconCode: nil, dayOrNight: "N") == "☁️")
        #expect(WeatherGlyph.emoji(iconCode: nil, dayOrNight: nil) == "⛅")
    }

    @Test func moonPhases() {
        #expect(WeatherGlyph.moon(code: "NM") == "🌑")
        #expect(WeatherGlyph.moon(code: "WXC") == "🌒")
        #expect(WeatherGlyph.moon(code: "FM") == "🌕")
        #expect(WeatherGlyph.moon(code: "LQ") == "🌗")
        #expect(WeatherGlyph.moon(code: "???") == "🌕")
        #expect(WeatherGlyph.moon(code: nil) == "🌕")
    }

    @Test func compassPoints() {
        #expect(WeatherGlyph.cardinal(degrees: 0) == "N")
        #expect(WeatherGlyph.cardinal(degrees: 11.25) == "NNE")  // Math.round(0.5) == 1
        #expect(WeatherGlyph.cardinal(degrees: 90) == "E")
        #expect(WeatherGlyph.cardinal(degrees: 225) == "SW")
        #expect(WeatherGlyph.cardinal(degrees: 349) == "N")      // 15.5 -> 16 -> wraps to N
        #expect(WeatherGlyph.cardinal(degrees: 360) == "N")
    }
}
