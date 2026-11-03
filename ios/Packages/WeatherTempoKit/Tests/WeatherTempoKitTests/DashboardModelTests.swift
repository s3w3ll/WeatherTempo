import Foundation
import Testing
@testable import WeatherTempoKit

/// Thread-safe request log for the fake network.
private actor Requests {
    private(set) var locations: [String] = []
    func record(_ id: String) { locations.append(id) }
    var count: Int { locations.count }
}

@MainActor @Suite struct DashboardModelTests {
    private let now = SampleData.referenceNow

    private func tempCache() -> PayloadCache {
        PayloadCache(directory: FileManager.default.temporaryDirectory
            .appendingPathComponent("wt-model-\(UUID().uuidString)", isDirectory: true))
    }

    private func response(_ status: Int, url: URL) -> HTTPURLResponse {
        HTTPURLResponse(url: url, statusCode: status, httpVersion: nil, headerFields: nil)!
    }

    /// A client whose network returns the sample payload (stamped `updated`) for any location,
    /// optionally failing, delaying specific locations, and recording what was asked for.
    private func client(
        requests: Requests,
        updated: Date,
        fail: Bool = false,
        delay: [String: Duration] = [:]
    ) -> WeatherClient {
        let body = try! JSONEncoder().encode(SampleData.payload(now: updated))
        return WeatherClient(maxAttempts: 1, retryDelay: .milliseconds(1)) { req in
            let id = URLComponents(url: req.url!, resolvingAgainstBaseURL: false)?
                .queryItems?.first { $0.name == "location" }?.value ?? "?"
            await requests.record(id)
            if let d = delay[id] { try await Task.sleep(for: d) }
            if fail { return (Data(), HTTPURLResponse(url: req.url!, statusCode: 503, httpVersion: nil, headerFields: nil)!) }
            return (body, HTTPURLResponse(url: req.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
        }
    }

    private func makeModel(
        requests: Requests = Requests(),
        store: InMemoryStore = InMemoryStore(),
        cache: PayloadCache? = nil,
        fail: Bool = false,
        delay: [String: Duration] = [:],
        clockAt: Date? = nil
    ) -> (DashboardModel, PayloadCache, InMemoryStore) {
        let cache = cache ?? tempCache()
        let at = clockAt ?? now
        let model = DashboardModel(
            client: client(requests: requests, updated: at, fail: fail, delay: delay),
            cache: cache, store: store, clock: { at })
        return (model, cache, store)
    }

    // MARK: Settings

    @Test func startsWithDefaults() {
        let (m, _, _) = makeModel()
        #expect(m.location.id == "christchurch")
        #expect(m.chartDays == 3)
        #expect(m.payload == nil)
        #expect(m.banner == nil)
    }

    @Test func restoresPersistedSettings() {
        let store = InMemoryStore([DashboardModel.locationKey: "dunedin", DashboardModel.chartDaysKey: "5"])
        let (m, _, _) = makeModel(store: store)
        #expect(m.location.id == "dunedin")
        #expect(m.chartDays == 5)
    }

    @Test func ignoresInvalidPersistedSettings() {
        let store = InMemoryStore([DashboardModel.locationKey: "atlantis", DashboardModel.chartDaysKey: "9"])
        let (m, _, _) = makeModel(store: store)
        #expect(m.location.id == "christchurch")   // unknown -> default, like getLocation()
        #expect(m.chartDays == 3)
    }

    @Test func chartDaysAreClampedAndPersisted() {
        let (m, _, store) = makeModel()
        m.setChartDays(2)
        #expect(m.chartDays == 2 && store.values[DashboardModel.chartDaysKey] == "2")
        m.setChartDays(99)
        #expect(m.chartDays == 5)
        m.setChartDays(0)
        #expect(m.chartDays == 1)
    }

    // MARK: Loading

    @Test func activateFetchesCachesAndClearsFailure() async {
        let requests = Requests()
        let (m, cache, _) = makeModel(requests: requests)
        await m.activate()
        #expect(m.payload != nil)
        #expect(!m.lastRefreshFailed && !m.isRefreshing)
        #expect(await requests.locations == ["christchurch"])
        #expect(cache.load(locationID: "christchurch") == m.payload)
    }

    @Test func showsCachedDataEvenWhenTheNetworkFails() async {
        let cache = tempCache()
        try? cache.save(SampleData.payload(now: now), locationID: "christchurch")
        // Cached data is 6 minutes old, so a refresh is due (fresh data would skip the network).
        let (m, _, _) = makeModel(cache: cache, fail: true, clockAt: now.addingTimeInterval(6 * 60))
        await m.activate()
        #expect(m.payload != nil)                 // still on screen
        #expect(m.lastRefreshFailed)
        #expect(m.banner?.level == .warning)
        #expect(m.banner?.message.contains("Offline") == true)
        #expect(m.banner?.message.contains("6 min ago") == true)
    }

    @Test func failureWithNothingCachedIsAnError() async {
        let (m, _, _) = makeModel(fail: true)
        await m.activate()
        #expect(m.payload == nil)
        #expect(m.banner?.level == .error)
    }

    @Test func successAfterFailureClearsTheBanner() async {
        let requests = Requests()
        let store = InMemoryStore()
        let cache = tempCache()
        let (failing, _, _) = makeModel(requests: requests, store: store, cache: cache, fail: true)
        await failing.activate()
        #expect(failing.lastRefreshFailed)

        let (ok, _, _) = makeModel(requests: requests, store: store, cache: cache)
        await ok.activate()
        #expect(!ok.lastRefreshFailed && ok.banner == nil)
    }

    // MARK: Refresh policy

    @Test func refreshIfStaleSkipsFreshDataAndRefetchesOldData() async {
        let requests = Requests()
        let (m, _, _) = makeModel(requests: requests)
        await m.activate()                       // payload is stamped `now`, clock says `now`
        #expect(await requests.count == 1)
        await m.refreshIfStale()
        #expect(await requests.count == 1)       // age 0 < 5 min: skipped

        // Same payload but the clock has moved on 6 minutes
        let later = now.addingTimeInterval(6 * 60)
        let cache = tempCache()
        try? cache.save(SampleData.payload(now: now), locationID: "christchurch")
        let (m2, _, _) = makeModel(requests: requests, cache: cache, clockAt: later)
        await m2.activate()
        #expect(await requests.count == 2)       // cached payload is 6 min old: refetched
    }

    @Test func failedRefreshAlwaysRetries() async {
        let requests = Requests()
        let (m, _, _) = makeModel(requests: requests, fail: true)
        await m.activate()
        await m.refreshIfStale()
        #expect(await requests.count == 2)
    }

    // MARK: Switching location

    @Test func selectingALocationPersistsLoadsItsCacheAndFetchesIt() async {
        let requests = Requests()
        let cache = tempCache()
        let (m, _, store) = makeModel(requests: requests, cache: cache)
        await m.activate()

        await m.select(.named("dunedin"))
        #expect(m.location.id == "dunedin")
        #expect(store.values[DashboardModel.locationKey] == "dunedin")
        #expect(await requests.locations == ["christchurch", "dunedin"])
        #expect(cache.load(locationID: "dunedin") != nil)
    }

    @Test func selectingTheCurrentLocationDoesNothing() async {
        let requests = Requests()
        let (m, _, _) = makeModel(requests: requests)
        await m.select(.named("christchurch"))
        #expect(await requests.count == 0)
    }

    @Test func slowResponseForThePreviousLocationIsDiscarded() async {
        // Christchurch is slow; the user switches to Dunedin before it answers.
        let requests = Requests()
        let (m, cache, _) = makeModel(requests: requests, delay: ["christchurch": .milliseconds(150)])
        let slow = Task { await m.refresh() }
        try? await Task.sleep(for: .milliseconds(20))
        await m.select(.named("dunedin"))
        await slow.value

        #expect(m.location.id == "dunedin")
        #expect(cache.load(locationID: "christchurch") == nil)   // its late response was dropped, not cached
        #expect(m.payload != nil && !m.lastRefreshFailed)
    }

    @Test func switchingClearsAStaleFailureFlag() async {
        let (m, _, _) = makeModel(fail: true)
        await m.activate()
        #expect(m.lastRefreshFailed)
        await m.select(.named("auckland"))
        // the new location's fetch also fails here, but it was reset first and set again by its own failure
        #expect(m.lastRefreshFailed)
        #expect(m.location.id == "auckland")
    }

    // MARK: State

    @Test func stateReflectsTheModel() async {
        let (m, _, _) = makeModel()
        await m.activate()
        let s = m.state(now: now)
        #expect(s.location.id == "christchurch" && s.payload != nil && s.chartDays == 3)
        #expect(s.banner == nil)
    }
}
