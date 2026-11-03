import Foundation
import Testing
@testable import WeatherTempoKit

private let nz = MeteogramModel.nzTimeZone
/// Tue 3 Nov 2026 00:00 NZDT.
private let day0 = SampleData.referenceStart.timeIntervalSince1970

/// Hourly data from day0 (local midnight) with the given temperature / UV per hour index.
private func hours(count: Int = 72, temp: (Int) -> Double, uv: (Int) -> Double = { _ in 0 }) -> [WeatherPayload.Hour] {
    (0..<count).map {
        WeatherPayload.Hour(validTimeUtc: day0 + Double($0) * 3600, temperature: temp($0), uvIndex: uv($0))
    }
}

/// A day shaped like NZ spring: UV above 3 from 10am to 3pm (hours 10...14 of each day).
private func uvDay(_ i: Int) -> Double { (10...14).contains(i % 24) ? 6 : 0 }

private func plan(_ hs: [WeatherPayload.Hour], _ s: AlertSettings, now hour: Double = 1) -> [PlannedAlert] {
    AlertPlanner.plan(hours: hs, settings: s, locationName: "Christchurch", timeZone: nz,
                      now: Date(timeIntervalSince1970: day0 + hour * 3600))
}

@Suite struct AlertSettingsTests {
    @Test func defaultsAreOffWithUVThresholdThreeAndSevenAm() {
        let s = AlertSettings()
        #expect(!s.anyEnabled)
        #expect(s.uvThreshold == 3)
        #expect(s.dailyUVMinutes == 420)
    }

    @Test func roundTripsThroughTheStore() {
        let store = InMemoryStore()
        var s = AlertSettings()
        s.tempLowEnabled = true; s.tempLow = 1; s.dailyUVEnabled = true; s.dailyUVMinutes = 6 * 60 + 30
        s.save(to: store)
        #expect(AlertSettings.load(from: store) == s)
    }

    @Test func corruptOrMissingStoreFallsBackToDefaults() {
        #expect(AlertSettings.load(from: InMemoryStore()) == AlertSettings())
        #expect(AlertSettings.load(from: InMemoryStore([AlertSettings.storeKey: "{nope"])) == AlertSettings())
    }

    @Test func sanitizingClampsWildValues() {
        var s = AlertSettings()
        s.tempHigh = 900; s.tempLow = -900; s.uvThreshold = 0; s.dailyUVMinutes = 99_999
        let c = s.sanitized()
        #expect(c.tempHigh == 45 && c.tempLow == -10 && c.uvThreshold == 1 && c.dailyUVMinutes == 1439)
    }
}

@Suite struct TemperatureAlertTests {
    // 10° overnight rising to 22° at 3pm (hour 15) and back, repeating daily.
    private func wave(_ i: Int) -> Double { 16 - 6 * cos(Double((i % 24) - 3) / 24 * 2 * .pi) }

    @Test func warnsOnceWhenForecastRisesAboveTheLimit() throws {
        var s = AlertSettings(); s.tempHighEnabled = true; s.tempHigh = 20
        let alerts = plan(hours(temp: wave), s)
        #expect(alerts.allSatisfy { $0.kind == .tempHigh })
        #expect(alerts.count == 3)                                   // one per day, not one per warm hour
        let first = try #require(alerts.first)
        #expect(first.body.contains("above 20°") && first.body.contains("today"))
        #expect(first.title == "Warming up in Christchurch")
    }

    @Test func warnsWhenForecastFallsBelowTheLimit() throws {
        var s = AlertSettings(); s.tempLowEnabled = true; s.tempLow = 12
        let alerts = plan(hours(temp: wave), s, now: 8)
        #expect(!alerts.isEmpty && alerts.allSatisfy { $0.kind == .tempLow })
        #expect(alerts[0].body.contains("below 12°"))
        #expect(alerts[0].title == "Cold in Christchurch")
    }

    @Test func staysQuietWhenAlreadyBeyondTheLimit() {
        // always 30°: above 25 from the start, never crosses
        var s = AlertSettings(); s.tempHighEnabled = true; s.tempHigh = 25
        #expect(plan(hours(temp: { _ in 30 }), s).isEmpty)
    }

    @Test func staysQuietWhenNeverReachingTheLimit() {
        var s = AlertSettings(); s.tempHighEnabled = true; s.tempHigh = 40
        #expect(plan(hours(temp: wave), s).isEmpty)
    }

    @Test func disabledMeansNothingEvenIfCrossed() {
        var s = AlertSettings(); s.tempHigh = 20
        #expect(plan(hours(temp: wave), s).isEmpty)
    }

    @Test func pastCrossingsAreIgnored() {
        var s = AlertSettings(); s.tempHighEnabled = true; s.tempHigh = 20
        let all = plan(hours(temp: wave), s, now: 1)
        let later = plan(hours(temp: wave), s, now: 30)               // day 1, 6am: day 0 is over
        #expect(later.count == all.count - 1)
        #expect(later.allSatisfy { $0.fireDate.timeIntervalSince1970 > day0 + 30 * 3600 })
    }

    @Test func strictlyAboveMeansEqualDoesNotCount() {
        var s = AlertSettings(); s.tempHighEnabled = true; s.tempHigh = 20
        #expect(plan(hours(temp: { $0 % 24 == 12 ? 20 : 10 }), s).isEmpty)
        #expect(plan(hours(temp: { $0 % 24 == 12 ? 20.5 : 10 }), s).count == 3)
    }

    @Test func missingTemperaturesAreSkippedNotTreatedAsCrossings() {
        var s = AlertSettings(); s.tempHighEnabled = true; s.tempHigh = 20
        var hs = hours(temp: { _ in 10 })
        for i in 5..<9 { hs[i].temperature = nil }
        #expect(plan(hs, s).isEmpty)
    }
}

@Suite struct UVAlertTests {
    @Test func alertsAtTheStartOfEachHighUVStretch() throws {
        var s = AlertSettings(); s.uvEnabled = true
        let alerts = plan(hours(temp: { _ in 15 }, uv: uvDay), s)
        #expect(alerts.count == 3 && alerts.allSatisfy { $0.kind == .uv })
        let first = try #require(alerts.first)
        #expect(first.fireDate.timeIntervalSince1970 == day0 + 10 * 3600)
        #expect(first.body == "UV 3+ from 10am to 3pm, peaking at 6 High around 10am.")
    }

    @Test func thresholdIsInclusiveAndConfigurable() {
        var s = AlertSettings(); s.uvEnabled = true; s.uvThreshold = 6
        #expect(plan(hours(temp: { _ in 15 }, uv: uvDay), s).count == 3)    // 6 >= 6
        s.uvThreshold = 7
        #expect(plan(hours(temp: { _ in 15 }, uv: uvDay), s).isEmpty)
    }

    @Test func aStretchThatAlreadyStartedDoesNotFire() {
        var s = AlertSettings(); s.uvEnabled = true
        let alerts = plan(hours(temp: { _ in 15 }, uv: uvDay), s, now: 12)  // 12pm day 0, UV already high
        #expect(alerts.count == 2)
    }
}

@Suite struct DailyUVTests {
    private func settings(minutes: Int = 7 * 60) -> AlertSettings {
        var s = AlertSettings(); s.dailyUVEnabled = true; s.dailyUVMinutes = minutes; return s
    }

    @Test func sendsAtTheChosenTimeWithTheTimeUVPassesThreshold() throws {
        let alerts = plan(hours(temp: { _ in 15 }, uv: uvDay), settings(), now: -1)   // 11pm the night before
        let first = try #require(alerts.first)
        #expect(first.kind == .dailyUV)
        #expect(first.fireDate.timeIntervalSince1970 == day0 + 7 * 3600)
        #expect(first.title == "UV today in Christchurch")
        #expect(first.body.contains("from 10am to 3pm"))
        #expect(alerts.count == 3)
    }

    @Test func todaysSummaryIsSkippedOncePastTheSendTime() {
        let alerts = plan(hours(temp: { _ in 15 }, uv: uvDay), settings(), now: 8)    // 8am: 7am has passed
        #expect(alerts.count == 2)
        #expect(alerts[0].fireDate.timeIntervalSince1970 == day0 + 31 * 3600)
    }

    @Test func silentOnDaysWithLowUV() {
        // only day 1 is sunny
        let uv: (Int) -> Double = { (24..<48).contains($0) ? uvDay($0) : 0 }
        let alerts = plan(hours(temp: { _ in 15 }, uv: uv), settings(), now: -1)
        #expect(alerts.count == 1)
        #expect(alerts[0].fireDate.timeIntervalSince1970 == day0 + 31 * 3600)
    }

    @Test func customTimeAndThresholdAreHonoured() throws {
        var s = settings(minutes: 6 * 60 + 30); s.uvThreshold = 6
        let first = try #require(plan(hours(temp: { _ in 15 }, uv: uvDay), s, now: -1).first)
        #expect(first.fireDate.timeIntervalSince1970 == day0 + 6.5 * 3600)
        #expect(first.body.hasPrefix("UV 6+ from 10am"))
    }

    @Test func dailyAndCrossingAlertsAreIndependent() {
        var s = settings(); s.uvEnabled = true
        let kinds = Set(plan(hours(temp: { _ in 15 }, uv: uvDay), s, now: -1).map(\.kind))
        #expect(kinds == [.uv, .dailyUV])
    }
}

@Suite struct PlannerInvariantTests {
    @Test func resultIsSortedUniquelyIdentifiedAndCapped() {
        var s = AlertSettings()
        s.tempHighEnabled = true; s.tempHigh = 14; s.tempLowEnabled = true; s.tempLow = 14
        s.uvEnabled = true; s.dailyUVEnabled = true
        let hs = hours(count: 120, temp: { 14 + (($0 / 2) % 2 == 0 ? 3 : -3) }, uv: { $0 % 2 == 0 ? 6 : 0 })
        let alerts = plan(hs, s, now: -1)
        #expect(alerts.count == AlertPlanner.maxAlerts)
        #expect(alerts.map(\.fireDate) == alerts.map(\.fireDate).sorted())
        #expect(Set(alerts.map(\.id)).count == alerts.count)
        #expect(alerts.allSatisfy { $0.id.hasPrefix(AlertPlanner.idPrefix) })
    }

    @Test func emptyForecastPlansNothing() {
        var s = AlertSettings(); s.tempHighEnabled = true; s.uvEnabled = true; s.dailyUVEnabled = true
        #expect(plan([], s).isEmpty)
    }
}

private final class FakeScheduler: NotificationScheduling, @unchecked Sendable {
    var replaced: [[PlannedAlert]] = []
    func authorization() async -> AlertAuthorization { .allowed }
    func requestAuthorization() async -> Bool { true }
    func replaceAll(with alerts: [PlannedAlert]) async { replaced.append(alerts) }
}

@Suite @MainActor struct AlertCoordinatorTests {
    @Test func replansWhenForecastOrSettingsChange() async throws {
        let scheduler = FakeScheduler()
        let store = InMemoryStore()
        let coordinator = AlertCoordinator(store: store, scheduler: scheduler,
                                           clock: { Date(timeIntervalSince1970: day0 - 3600) })
        let payload = SampleData.payload()

        coordinator.forecastUpdated(payload, location: .named("christchurch"))   // nothing enabled yet
        coordinator.settings.dailyUVEnabled = true
        #expect(!coordinator.planned.isEmpty)
        #expect(AlertSettings.load(from: store).dailyUVEnabled)                  // persisted

        // let the serialised scheduling tasks run
        for _ in 0..<20 where scheduler.replaced.count < 2 { try await Task.sleep(for: .milliseconds(20)) }
        #expect(scheduler.replaced.first?.isEmpty == true)
        #expect(scheduler.replaced.last?.isEmpty == false)

        coordinator.settings.dailyUVEnabled = false
        #expect(coordinator.planned.isEmpty)
    }

    @Test func settingsChangeBeforeAnyForecastPlansNothing() {
        let scheduler = FakeScheduler()
        let coordinator = AlertCoordinator(store: InMemoryStore(), scheduler: scheduler)
        coordinator.settings.uvEnabled = true
        #expect(coordinator.planned.isEmpty)
    }
}
