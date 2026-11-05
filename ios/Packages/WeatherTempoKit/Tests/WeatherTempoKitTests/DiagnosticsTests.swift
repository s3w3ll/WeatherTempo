import Foundation
import Testing
@testable import WeatherTempoKit

@Suite struct DiagnosticsLogTests {
    private let t0 = SampleData.referenceNow

    @Test func repeatsCollapseIntoOneRow() {
        let store = InMemoryStore()
        for i in 0..<5 {
            DiagnosticsLog.record(.app, .forecast, ok: true, "Christchurch", at: t0.addingTimeInterval(Double(i) * 300), in: store)
        }
        DiagnosticsLog.record(.widget, .forecast, ok: true, "Christchurch", at: t0.addingTimeInterval(2000), in: store)
        let log = DiagnosticsLog.events(in: store)
        #expect(log.count == 2)
        #expect(log[0].source == .widget)
        #expect(log[1].count == 5 && log[1].firstDate == t0 && log[1].date == t0.addingTimeInterval(1200))
    }

    @Test func aChangeStartsANewRowAndRepeatsMoveToTheTop() {
        let store = InMemoryStore()
        DiagnosticsLog.record(.app, .forecast, ok: true, "Christchurch", at: t0, in: store)
        DiagnosticsLog.record(.app, .forecast, ok: false, "Offline", at: t0.addingTimeInterval(60), in: store)
        DiagnosticsLog.record(.widget, .warnings, ok: true, "None in force", at: t0.addingTimeInterval(120), in: store)
        DiagnosticsLog.record(.app, .forecast, ok: false, "Offline", at: t0.addingTimeInterval(180), in: store)
        let log = DiagnosticsLog.events(in: store)
        #expect(log.map(\.detail) == ["Offline", "None in force", "Christchurch"])
        #expect(log[0].count == 2)
        #expect(DiagnosticsLog.last(.app, .forecast, in: store)?.ok == false)
        #expect(DiagnosticsLog.last(.background, .forecast, in: store) == nil)
    }

    @Test func logIsCapped() {
        let store = InMemoryStore()
        for i in 0..<200 { DiagnosticsLog.record(.app, .notification, ok: true, "n\(i)", at: t0, in: store) }
        #expect(DiagnosticsLog.events(in: store).count == DiagnosticsLog.capacity)
        DiagnosticsLog.clear(in: store)
        #expect(DiagnosticsLog.events(in: store).isEmpty)
    }

    @Test func errorsReadPlainly() {
        #expect(DiagnosticsLog.describe(URLError(.notConnectedToInternet)) == "Offline")
        #expect(DiagnosticsLog.describe(URLError(.timedOut)) == "Timed out")
        #expect(DiagnosticsLog.describe(WeatherClientError.http(status: 503)) == "HTTP 503")
        #expect(DiagnosticsLog.describe(WarningFetch(warnings: [])) == "None in force")
        #expect(DiagnosticsLog.describe(WarningFetch(warnings: [], complete: false)) == "None in force (some alerts didn't load)")
    }

    @Test func reportListsEachCheck() {
        let store = InMemoryStore()
        DiagnosticsLog.record(.widget, .warnings, ok: false, "Offline", at: t0.addingTimeInterval(-600), in: store)
        let text = DiagnosticsReport.text(
            events: DiagnosticsLog.events(in: store),
            system: SystemStatus(sharedStorage: false, notifications: "On", timeSensitive: "Off",
                                 backgroundRefresh: "On", pendingNotifications: 3),
            memory: [], appVersion: "1.0 (7)", now: t0, timeZone: MeteogramModel.nzTimeZone)
        #expect(text.contains("Shared storage (App Group): NO"))
        #expect(text.contains("Notifications: On; time-sensitive: Off"))
        #expect(text.contains("Widget warnings: FAILED 10 min ago – Offline"))
        #expect(text.contains("Background forecast: never"))
    }
}

@Suite struct DiagnosticsWiringTests {
    private func payloadClient(fail: Bool) -> WeatherClient {
        let data = try! JSONEncoder().encode(SampleData.payload())
        return WeatherClient(maxAttempts: 1, retryDelay: .milliseconds(1)) { req in
            (fail ? Data() : data,
             HTTPURLResponse(url: req.url!, statusCode: fail ? 503 : 200, httpVersion: nil, headerFields: nil)!)
        }
    }

    private func cache() -> PayloadCache {
        PayloadCache(directory: FileManager.default.temporaryDirectory
            .appendingPathComponent("wt-diag-\(UUID().uuidString)", isDirectory: true))
    }

    @Test func widgetRunsAreLogged() async {
        let store = InMemoryStore()
        _ = await WidgetLoader.load(client: payloadClient(fail: true), warningClient: fakeWarningClient(offline: true),
                                    cache: cache(), store: store, now: SampleData.referenceNow)
        #expect(DiagnosticsLog.last(.widget, .forecast, in: store)?.detail == "HTTP 503, nothing cached")
        #expect(DiagnosticsLog.last(.widget, .warnings, in: store)?.detail == "Offline, showing 0 saved")
    }

    @Test func backgroundRunsAreLogged() async {
        let store = InMemoryStore()
        await AlertBackground.refreshAndReplan(
            store: store, client: payloadClient(fail: false), warningClient: fakeWarningClient(),
            cache: cache(), scheduler: FakeScheduler(), now: SampleData.referenceNow)
        #expect(DiagnosticsLog.last(.background, .forecast, in: store)?.ok == true)
        #expect(DiagnosticsLog.last(.background, .warnings, in: store)?.detail == "None in force")
    }

    @MainActor @Test func appRefreshIsLoggedAndSavedWarningsShowAtLaunch() async throws {
        let store = InMemoryStore()
        let model = DashboardModel(client: payloadClient(fail: false),
                                   warningClient: fakeWarningClient(["w": capXML(id: "w")]),
                                   cache: cache(), store: store, clock: { ISO8601DateFormatter().date(from: "2026-11-05T07:00:00Z")! })
        await model.refresh()
        #expect(DiagnosticsLog.last(.app, .forecast, in: store)?.ok == true)
        #expect(DiagnosticsLog.last(.app, .warnings, in: store)?.detail.hasPrefix("1 in force") == true)

        let relaunched = DashboardModel(client: payloadClient(fail: true), warningClient: fakeWarningClient(offline: true),
                                        cache: cache(), store: store, clock: { ISO8601DateFormatter().date(from: "2026-11-05T07:00:00Z")! })
        #expect(relaunched.warnings.map(\.id) == ["w"])
    }
}
