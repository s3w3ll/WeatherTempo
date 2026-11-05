import Foundation
import Testing
@testable import WeatherTempoKit

private let nz = MeteogramModel.nzTimeZone
private let now = SampleData.referenceNow

@Suite struct AccessibilityContrastTests {
    private let t = ThemeRGB.self

    @Test func luminanceAndContrastMatchTheWCAGDefinition() {
        #expect(abs(RGB(255, 255, 255).contrast(against: RGB(0, 0, 0)) - 21) < 1e-9)
        #expect(abs(RGB(119, 119, 119).contrast(against: RGB(255, 255, 255)) - 4.48) < 0.01)   // the classic #777 on white
        #expect(RGB(10, 20, 30).contrast(against: RGB(10, 20, 30)) == 1)
    }

    @Test func dashboardTextMeetsAA() {
        let bg = t.card
        let pairs: [(String, RGB)] = [
            ("text", t.text), ("strong", t.strong), ("muted", t.muted), ("fade", t.fade),
            ("warmText", t.warmText), ("cyanText", t.cyanText), ("redText", t.redText), ("blue", t.blue),
        ]
        for (name, c) in pairs {
            #expect(c.contrast(against: bg) >= 4.5, "\(name) on card is \(c.contrast(against: bg))")
        }
    }

    @Test func dashboardTextAlsoReadsOnThePageBackground() {
        // the banner and header sit on the page colour, not a card
        for (name, c) in [("muted", t.muted), ("fade", t.fade), ("text", t.text)] {
            #expect(c.contrast(against: t.page) >= 4.5, "\(name) on page is \(c.contrast(against: t.page))")
        }
    }

    @Test func darkModeTextMeetsAAOnCardsAndPage() {
        let d = ThemeRGB.Dark.self
        let pairs: [(String, RGB)] = [
            ("text", d.text), ("strong", d.strong), ("muted", d.muted), ("fade", d.fade),
            ("warmText", d.warmText), ("cyanText", d.cyanText), ("redText", d.redText),
            ("blue", d.blue), ("amberText", d.amberText),
        ]
        for (name, c) in pairs {
            #expect(c.contrast(against: d.card) >= 4.5, "dark \(name) on card is \(c.contrast(against: d.card))")
            #expect(c.contrast(against: d.page) >= 4.5, "dark \(name) on page is \(c.contrast(against: d.page))")
        }
        #expect(t.amberText.contrast(against: t.card) >= 4.5)
    }

    @Test func widgetTextMeetsAAOnEveryStopOfTheSkyGradient() {
        for (stopName, stop) in [("top", t.skyTop), ("mid", t.skyMid), ("bottom", t.skyBottom)] {
            for (textName, c) in [("white", t.skyWhite), ("muted", t.skyMuted), ("cyan", t.skyCyan)] {
                #expect(c.contrast(against: stop) >= 4.5, "\(textName) on sky \(stopName) is \(c.contrast(against: stop))")
            }
        }
    }
}

@Suite struct SpokenUnitsTests {
    @Test func unitsBecomeWords() {
        #expect(AccessibilityText.spoken("21.2 km/h") == "21.2 kilometres per hour")
        #expect(AccessibilityText.spoken("14°") == "14 degrees")
        #expect(AccessibilityText.spoken("-2°") == "-2 degrees")
        #expect(AccessibilityText.spoken("56%") == "56 percent")
        #expect(AccessibilityText.spoken("1018 hPa") == "1018 hectopascals")
        #expect(AccessibilityText.spoken("10.9 mm") == "10.9 millimetres")
        #expect(AccessibilityText.spoken("1.4 m") == "1.4 metres")
    }

    @Test func symbolsAreDroppedOrSpelledOut() {
        #expect(AccessibilityText.spoken("↑ Rising") == "Rising")
        #expect(AccessibilityText.spoken("↓ Falling") == "Falling")
        #expect(AccessibilityText.spoken("9am–6pm") == "9am to 6pm")
    }

    @Test func wordsContainingUnitLettersAreLeftAlone() {
        #expect(AccessibilityText.spoken("Moderate rain") == "Moderate rain")
        #expect(AccessibilityText.spoken("Humidity") == "Humidity")
        #expect(AccessibilityText.spoken("Mist and drizzle") == "Mist and drizzle")
    }
}

@Suite struct AccessibilitySentencesTests {
    private var payload: WeatherPayload { SampleData.payload() }
    private var insights: WeatherInsights { WeatherInsights(payload: payload, now: now) }

    @Test func currentConditionsReadAsSentences() {
        let text = AccessibilityText.current(payload, insights)
        #expect(text.hasPrefix("Currently 16 degrees, Partly Cloudy."))
        #expect(text.contains("Feels like 13 degrees."))
        #expect(text.contains("High 17 degrees at 3pm"))
        #expect(text.contains("low 7 degrees at 3am"))
        #expect(!text.contains("°") && !text.contains("km/h"))
        #expect(text.hasSuffix("."))
    }

    @Test func currentConditionsSurviveMissingData() {
        let empty = WeatherPayload(meta: .init(updated: "2026-11-03T01:00:00.000Z"), current: .init(), today: nil, hourly: [], daily: [])
        let text = AccessibilityText.current(empty, WeatherInsights(payload: empty, now: now))
        #expect(text == "Current temperature unavailable.")
    }

    @Test func stripCellsMentionRainOnlyWhenLikely() {
        let cells = insights.hourlyStrip()
        #expect(AccessibilityText.stripCell(cells[0]).hasPrefix("Now, 16 degrees"))
        let dry = WeatherInsights.StripCell(id: 0, time: "3pm", glyph: "☀️", temp: "17°", precip: "·", isNow: false)
        let wet = WeatherInsights.StripCell(id: 1, time: "4pm", glyph: "🌧️", temp: "15°", precip: "40%", isNow: false)
        #expect(AccessibilityText.stripCell(dry) == "3pm, 17 degrees")
        #expect(AccessibilityText.stripCell(wet) == "4pm, 15 degrees, 40 percent chance of rain")
    }

    @Test func dayCardIsOneReadablePhrase() throws {
        let f = try #require(insights.dayForecast(dayIndex: 1))
        let text = AccessibilityText.day(f, timeZone: nz)
        #expect(text.hasPrefix("Tomorrow, 4 Nov."))
        #expect(text.contains("High 18 degrees at 3pm"))
        #expect(text.contains("Sunrise 6:06am, sunset 8:05pm"))
        #expect(text.contains("kilometres per hour"))
        #expect(text.contains("Pressure"))
        // nothing a screen reader would mangle
        for bad in ["°", "%", "km/h", "hPa", "↑", "↓", "·", "–"] { #expect(!text.contains(bad), "contains \(bad): \(text)") }
    }

    @Test func tideSentences() throws {
        let s = try #require(TideSummary(location: .named("christchurch"), now: now))
        let header = AccessibilityText.tideHeader(s)
        #expect(header.hasPrefix("New Brighton Beach — Tides. Now "))
        #expect(header.contains("metres") && (header.hasSuffix("rising") || header.hasSuffix("falling")))
        let event = AccessibilityText.tideEvent(s.events[0], timeZone: nz)
        #expect(event.contains(" tide at ") && event.hasSuffix("metres"))
    }

    @Test func widgetDailyCell() {
        let wet = WeatherInsights.DailyCell(id: 1, label: "Wed", high: 18, low: 7, rainChance: 60)
        let dry = WeatherInsights.DailyCell(id: 2, label: "Thu", high: 19, low: 8, rainChance: 5)
        #expect(AccessibilityText.daily(wet) == "Wed, high 18 degrees, low 7 degrees, 60 percent chance of rain")
        #expect(AccessibilityText.daily(dry) == "Thu, high 19 degrees, low 8 degrees")
    }
}

@Suite struct ChartAccessibilityTests {
    private func model(_ hours: [WeatherPayload.Hour]) -> MeteogramModel {
        MeteogramModel(hours: hours, pxPerHour: 8, now: SampleData.referenceStart)
    }

    @Test func summaryDescribesTheWholeChart() {
        let m = model(SampleData.hours(count: 120))
        let s = m.accessibilitySummary
        #expect(s.hasPrefix("Forecast chart, 120 hours from Tue, 3 Nov"))
        #expect(s.contains("Temperature from 6 to 20 degrees"))
        #expect(s.contains("Wind up to"))
        #expect(s.contains("Rain ") && s.contains("millimetres in total, heaviest around"))
        #expect(s.hasSuffix("Swipe up or down to step through the hours."))
    }

    @Test func summaryHandlesNoRainAndNoData() {
        let dry = (0..<24).map { WeatherPayload.Hour(validTimeUtc: SampleData.referenceStart.timeIntervalSince1970 + Double($0) * 3600, temperature: 10, qpf: 0) }
        #expect(model(dry).accessibilitySummary.contains("No rain expected"))
        #expect(model([]).accessibilitySummary == "Forecast chart, no data.")
    }

    @Test func spokenDetailExpandsUnitsAndSkipsMissingValues() {
        let hours = SampleData.hours(count: 24)
        let m = model(hours)
        let d = m.spokenDetail(for: 14)
        #expect(d.hasPrefix("Tue, 3 Nov, 2:00"))
        #expect(d.contains("Temp ") && d.contains(" degrees"))
        #expect(d.contains("kilometres per hour"))
        #expect(!d.contains("°") && !d.contains("km/h") && !d.contains("—"))
        #expect(m.spokenDetail(for: 999) == "")
    }
}
