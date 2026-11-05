import Foundation
import ImageIO
import SwiftUI
import Testing
import UniformTypeIdentifiers
@testable import WeatherTempoKit

private typealias Hour = WeatherPayload.Hour
private let start = SampleData.referenceStart.timeIntervalSince1970   // Tue 3 Nov 2026 00:00 NZDT

private func payload(_ hours: [Hour], daily: [WeatherPayload.Day] = []) -> WeatherPayload {
    WeatherPayload(meta: .init(updated: "2026-11-03T01:00:00.000Z"), current: .init(), today: nil, hourly: hours, daily: daily)
}

private func insights(_ hours: [Hour], now hoursIn: Double, daily: [WeatherPayload.Day] = []) -> WeatherInsights {
    WeatherInsights(payload: payload(hours, daily: daily), now: Date(timeIntervalSince1970: start + hoursIn * 3600))
}

private func h(_ off: Double, qpf: Double? = nil) -> Hour { Hour(validTimeUtc: start + off * 3600, qpf: qpf) }

// MARK: - Compact layout

@Suite struct ChartLayoutTests {
    @Test func webLayoutIsTheOriginalZoneConstants() {
        let w = ChartLayout.web
        #expect(w.tempBot == ChartZone.tempBot && w.windTop == ChartZone.windTop && w.precipBot == ChartZone.precipBot)
        #expect(w.height == 364 && w.showDayAxis)
    }

    @Test func compactLayoutIsOrderedAndFitsItsHeight() {
        let c = ChartLayout.compact
        let edges = [c.cloudTop, c.tempTop, c.tempBot, c.windTop, c.windBot, c.precipTop, c.precipBot, c.timeTop, c.height]
        #expect(edges == edges.sorted(), "zones must run top to bottom")
        #expect(c.windTop > c.tempBot && c.precipTop > c.windBot && c.timeTop > c.precipBot)
        #expect(c.height == 192 && !c.showDayAxis)
        // hour labels are drawn at timeTop + 13 and must stay inside the canvas
        #expect(c.timeTop + 13 + 3 <= c.height)
    }

    @Test func modelUsesTheLayoutItIsGiven() {
        let hours = SampleData.hours(count: 24)
        let web = MeteogramModel(hours: hours, pxPerHour: 10, now: SampleData.referenceStart)
        let compact = MeteogramModel(hours: hours, pxPerHour: 10, now: SampleData.referenceStart, layout: .compact)
        #expect(web.height == 364 && compact.height == 192)
        #expect(compact.tempY(compact.tMin) == ChartLayout.compact.tempBot)
        #expect(compact.tempY(compact.tMax) == ChartLayout.compact.tempTop)
        #expect(compact.windY(90) == ChartLayout.compact.windTop)
        #expect(compact.probabilityY(0) == ChartLayout.compact.precipBot)
        #expect(web != compact)
    }

    @MainActor @Test func compactChartRendersWithSkyPalette() throws {
        let hours = SampleData.hours(count: 30)
        let m = MeteogramModel(hours: hours, pxPerHour: 10, now: SampleData.referenceNow, layout: .compact)
        let r = ImageRenderer(content: MeteogramCanvas(model: m, palette: .sky).background(WidgetBackground()))
        r.scale = 2
        #expect(r.cgImage != nil)
    }
}

// MARK: - Rain line + daily strip

@Suite struct WidgetInsightsTests {
    @Test func rainIntensityBands() {
        #expect(WeatherInsights.RainIntensity.classify(qpf: nil) == nil)
        #expect(WeatherInsights.RainIntensity.classify(qpf: 0) == nil)
        #expect(WeatherInsights.RainIntensity.classify(qpf: 0.3) == .light)
        #expect(WeatherInsights.RainIntensity.classify(qpf: 1) == .moderate)
        #expect(WeatherInsights.RainIntensity.classify(qpf: 3.9) == .moderate)
        #expect(WeatherInsights.RainIntensity.classify(qpf: 4) == .heavy)
        #expect(WeatherInsights.RainIntensity.heavy.label == "Heavy rain")
    }

    @Test func nextRainIsTheFirstWetHourFromNowToday() throws {
        // dry, then 0.05 (too light), then 1.5 at 17:00, then 5 at 18:00
        let hours = [h(14), h(15, qpf: 0.05), h(16), h(17, qpf: 1.5), h(18, qpf: 5)]
        let rain = try #require(insights(hours, now: 14).nextRainToday)
        #expect(rain.utcSec == start + 17 * 3600)
        #expect(rain.intensity == .moderate)
        #expect(rain.summary(in: MeteogramModel.nzTimeZone) == "Moderate rain at 5pm")
    }

    @Test func largeWidgetLineIsTheNextHoursSummary() throws {
        // 14:00 now; moderate rain at 17:00-18:00 (h() leaves the chance unset, which counts as likely)
        let hours = (14..<30).map { Double($0) }.map { $0 == 17 ? h($0, qpf: 1.5) : $0 == 18 ? h($0, qpf: 5) : h($0) }
        let line = try #require(insights(hours, now: 14).nextHoursSummary)
        #expect(line.hasPrefix("Heavy rain from 5pm, about 2 hours."))
        #expect(insights([], now: 14).nextHoursSummary == nil)
    }

    @Test func rainThatAlreadyFellOrIsTomorrowIsIgnored() {
        // heavy rain at 09:00 (past by 14:00) and more tomorrow: nothing upcoming today
        let hours = [h(9, qpf: 6), h(15), h(30, qpf: 3)]
        #expect(insights(hours, now: 14).nextRainToday == nil)
    }

    @Test func thirtyMinuteGraceKeepsTheJustTurnedHour() throws {
        // 14:20: the 14:00 hour is 20 minutes old and still counts
        let rain = try #require(insights([h(14, qpf: 2)], now: 14 + 20.0 / 60).nextRainToday)
        #expect(rain.utcSec == start + 14 * 3600)
        // 14:40: 40 minutes old, no longer counts (a dry 20:00 hour exists, so the search starts there;
        // with *no* later hour the search deliberately falls back to the start, like the JS)
        #expect(insights([h(14, qpf: 2), h(20)], now: 14 + 40.0 / 60).nextRainToday == nil)
    }

    @Test func dailyStripLabelsTodayThenWeekdays() {
        let i = WeatherInsights(payload: SampleData.payload(), now: SampleData.referenceNow)
        let cells = i.dailyStrip
        #expect(cells.map(\.label) == ["Today", "Wed", "Thu", "Fri", "Sat"])
        #expect(cells.map(\.id) == [0, 1, 2, 3, 4])
        #expect(cells[0].high == i.payload.daily[0].calendarDayTemperatureMax)
        #expect(cells[1].low == i.payload.daily[1].calendarDayTemperatureMin)
        #expect(cells.allSatisfy { $0.rainChance != nil })
    }

    @Test func dailyStripCapsAtFiveAndToleratesNoData() {
        #expect(insights([], now: 0).dailyStrip.isEmpty)
        let many = (0..<8).map { _ in WeatherPayload.Day(calendarDayTemperatureMax: 1, calendarDayTemperatureMin: 0) }
        #expect(insights([], now: 0, daily: many).dailyStrip.count == 5)
    }

    @Test func upcomingHoursStartAtNowWithGraceAndRespectLimit() {
        let hours = (0..<48).map { h(Double($0)) }
        let up = insights(hours, now: 10 + 0.25).upcomingHours(limit: 30)
        #expect(up.count == 30)
        #expect(up.first?.validTimeUtc == start + 10 * 3600)   // 10:00 is within the 30 min grace
        // at 47:00 only the 47:00 hour is within the 30 min grace (46:00 is an hour old)
        #expect(insights(hours, now: 47).upcomingHours(limit: 30).map(\.validTimeUtc) == [start + 47 * 3600])
    }
}

// MARK: - Loader

@Suite struct WidgetLoaderTests {
    private func cache() -> PayloadCache {
        PayloadCache(directory: FileManager.default.temporaryDirectory
            .appendingPathComponent("wt-widget-\(UUID().uuidString)", isDirectory: true))
    }

    private func client(fail: Bool, body: Data? = nil) -> WeatherClient {
        let data = body ?? (try! JSONEncoder().encode(SampleData.payload()))
        return WeatherClient(maxAttempts: 1, retryDelay: .milliseconds(1)) { req in
            (fail ? Data() : data,
             HTTPURLResponse(url: req.url!, statusCode: fail ? 503 : 200, httpVersion: nil, headerFields: nil)!)
        }
    }

    @Test func freshDataIsUsedAndCachedForTheApp() async {
        let c = cache()
        let store = InMemoryStore([DashboardModel.locationKey: "dunedin"])
        let snap = await WidgetLoader.load(client: client(fail: false), cache: c, store: store, now: SampleData.referenceNow)
        #expect(snap.location.id == "dunedin")
        #expect(snap.payload != nil)
        #expect(snap.date == SampleData.referenceNow)
        #expect(c.load(locationID: "dunedin") == snap.payload)
    }

    @Test func fallsBackToTheCacheWhenOffline() async {
        let c = cache()
        let saved = SampleData.payload()
        try? c.save(saved, locationID: "christchurch")
        let snap = await WidgetLoader.load(client: client(fail: true), cache: c, store: InMemoryStore())
        #expect(snap.payload == saved)
        #expect(snap.location.id == "christchurch")   // default when nothing stored
    }

    @Test func noNetworkAndNoCacheGivesAnEmptySnapshot() async {
        let snap = await WidgetLoader.load(client: client(fail: true), cache: cache(), store: InMemoryStore())
        #expect(snap.payload == nil)
    }

    @Test func entriesStepEveryFifteenMinutes() {
        let snap = WidgetSnapshot.placeholder
        let entries = WidgetLoader.entries(from: snap)
        #expect(entries.count == 4)
        #expect(entries.map { $0.date.timeIntervalSince(snap.date) } == [0, 900, 1800, 2700])
        #expect(entries.allSatisfy { $0.payload == snap.payload && $0.location == snap.location })
    }
}

// MARK: - Snapshots

@MainActor @Suite struct WidgetSnapshotTests {
    private func render(_ size: WidgetSize, _ snapshot: WidgetSnapshot, width: CGFloat, height: CGFloat) throws -> CGImage {
        let content = WeatherWidgetView(size: size, snapshot: snapshot)
            .padding(size.usesSkyBackground ? 16 : 6)
            .frame(width: width, height: height)
            .background {
                if size.usesSkyBackground { WidgetBackground() } else { Color(white: 0.12) }
            }
            .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
            .environment(\.colorScheme, size.usesSkyBackground ? .light : .dark)
        let renderer = ImageRenderer(content: content)
        renderer.scale = 2
        return try #require(renderer.cgImage)
    }

    private func save(_ image: CGImage, named name: String) throws {
        guard let dir = ProcessInfo.processInfo.environment["METEOGRAM_OUT"], !dir.isEmpty else { return }
        let dirURL = URL(fileURLWithPath: dir, isDirectory: true)
        try FileManager.default.createDirectory(at: dirURL, withIntermediateDirectories: true)
        let dest = try #require(CGImageDestinationCreateWithURL(
            dirURL.appendingPathComponent("\(name).png") as CFURL, UTType.png.identifier as CFString, 1, nil))
        CGImageDestinationAddImage(dest, image, nil)
        #expect(CGImageDestinationFinalize(dest))
    }

    /// Rain in the evening so the status line shows.
    private var rainySnapshot: WidgetSnapshot {
        var p = SampleData.payload(now: SampleData.referenceStart.addingTimeInterval(3 * 3600))
        p.hourly = p.hourly.map { var x = $0; if x.validTimeUtc == start + 17 * 3600 { x.qpf = 1.8 }; return x }
        return WidgetSnapshot(location: .named("christchurch"), payload: p,
                              date: SampleData.referenceStart.addingTimeInterval(3 * 3600))
    }

    @Test func rendersHomeScreenSizes() throws {
        // iPhone 15-ish widget sizes in points
        try save(try render(.small, .placeholder, width: 170, height: 170), named: "widget-small")
        try save(try render(.medium, rainySnapshot, width: 364, height: 170), named: "widget-medium")
        try save(try render(.large, rainySnapshot, width: 364, height: 382), named: "widget-large")
        // smallest large widget (iPhone SE-class): must still fit
        try save(try render(.large, rainySnapshot, width: 329, height: 345), named: "widget-large-small-phone")
    }

    @Test func rendersLockScreenFamilies() throws {
        try save(try render(.lockRectangular, rainySnapshot, width: 172, height: 76), named: "widget-lock-rectangular")
        try save(try render(.lockCircular, .placeholder, width: 76, height: 76), named: "widget-lock-circular")
        try save(try render(.lockInline, .placeholder, width: 240, height: 24), named: "widget-lock-inline")
    }

    @Test func rendersNoDataState() throws {
        let empty = WidgetSnapshot(location: .named("christchurch"), payload: nil, date: SampleData.referenceNow)
        try save(try render(.medium, empty, width: 364, height: 170), named: "widget-nodata")
    }
}
