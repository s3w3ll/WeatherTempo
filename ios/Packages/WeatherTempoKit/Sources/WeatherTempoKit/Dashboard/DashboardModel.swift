import Foundation
import Observation
#if os(iOS)
import WidgetKit
#endif

/// Tiny persistence seam so the model can be tested without touching real UserDefaults.
public protocol KeyValueStoring {
    func loadString(_ key: String) -> String?
    func saveString(_ value: String, for key: String)
}

extension UserDefaults: KeyValueStoring {
    public func loadString(_ key: String) -> String? { string(forKey: key) }
    public func saveString(_ value: String, for key: String) { set(value, forKey: key) }
}

public final class InMemoryStore: KeyValueStoring {
    public var values: [String: String]
    public init(_ values: [String: String] = [:]) { self.values = values }
    public func loadString(_ key: String) -> String? { values[key] }
    public func saveString(_ value: String, for key: String) { values[key] = value }
}

/// Everything a dashboard render needs, as plain values (no networking, no model).
/// Views take this so previews and CI snapshots can build one from `SampleData`.
public struct DashboardState {
    public var location: Location
    public var payload: WeatherPayload?
    public var banner: StatusBanner?
    public var now: Date
    public var chartDays: Int
    public var isRefreshing: Bool

    public init(location: Location, payload: WeatherPayload?, banner: StatusBanner? = nil,
                now: Date = Date(), chartDays: Int = 3, isRefreshing: Bool = false) {
        self.location = location
        self.payload = payload
        self.banner = banner
        self.now = now
        self.chartDays = chartDays
        self.isRefreshing = isRefreshing
    }

    public static let sample = DashboardState(
        location: .named("christchurch"), payload: SampleData.payload(), now: SampleData.referenceNow)
}

/// Owns what the dashboard is showing: the selected location, the latest payload, and
/// the refresh lifecycle.
///
/// - Shows the cached payload immediately, then refreshes (stale-while-revalidate).
/// - Keeps showing old data when a refresh fails, and says so via `StatusPolicy`.
/// - Persists location and chart zoom under the same keys the web app uses.
@MainActor @Observable
public final class DashboardModel {
    public static let locationKey = "weatherTempo.location"
    public static let chartDaysKey = "weatherTempo.chartDays"
    public static let validChartDays = 1...5
    public static let defaultChartDays = 3
    /// Same cadence as the web app's live refresh.
    public static let refreshInterval: TimeInterval = 5 * 60

    public private(set) var location: Location
    public private(set) var chartDays: Int
    public private(set) var payload: WeatherPayload?
    public private(set) var lastRefreshFailed = false
    private var inFlight = 0

    @ObservationIgnored private let client: WeatherClient
    @ObservationIgnored private let cache: PayloadCache
    @ObservationIgnored private let store: KeyValueStoring
    @ObservationIgnored private let clock: () -> Date
    /// Bumped on every location change; a refresh that finishes under an older generation is dropped.
    @ObservationIgnored private var generation = 0
    /// Called after every successful refresh (the alert planner hangs off this).
    @ObservationIgnored public var onFreshPayload: ((WeatherPayload, Location) -> Void)?

    public init(
        client: WeatherClient = WeatherClient(),
        cache: PayloadCache = .shared(),
        store: KeyValueStoring = AppGroup.defaults,
        clock: @escaping () -> Date = { Date() }
    ) {
        self.client = client
        self.cache = cache
        self.store = store
        self.clock = clock
        self.location = Location.named(store.loadString(Self.locationKey))
        self.chartDays = store.loadString(Self.chartDaysKey)
            .flatMap(Int.init).flatMap { Self.validChartDays.contains($0) ? $0 : nil } ?? Self.defaultChartDays
    }

    public var isRefreshing: Bool { inFlight > 0 }

    public var banner: StatusBanner? {
        StatusPolicy.banner(payload: payload, lastRefreshFailed: lastRefreshFailed,
                            now: clock(), timeZone: location.timeZone)
    }

    public func state(now: Date) -> DashboardState {
        DashboardState(location: location, payload: payload,
                       banner: StatusPolicy.banner(payload: payload, lastRefreshFailed: lastRefreshFailed,
                                                   now: now, timeZone: location.timeZone),
                       now: now, chartDays: chartDays, isRefreshing: isRefreshing)
    }

    // MARK: Lifecycle

    /// Call when the app becomes active: shows cached data right away, then refreshes if due.
    public func activate() async {
        if payload == nil { payload = cache.load(locationID: location.id) }
        await refreshIfStale()
    }

    public func refreshIfStale() async {
        if let p = payload, !lastRefreshFailed,
           let age = p.age(now: clock()), age >= 0, age < Self.refreshInterval {
            return
        }
        await refresh()
    }

    public func refresh() async {
        let gen = generation
        let target = location
        inFlight += 1
        defer { inFlight -= 1 }

        do {
            let fresh = try await client.fetch(locationID: target.id)
            guard gen == generation else { return }          // user switched location meanwhile
            payload = fresh
            lastRefreshFailed = false
            try? cache.save(fresh, locationID: target.id)
            reloadWidgets()
            onFreshPayload?(fresh, target)
        } catch {
            // Backgrounding the app cancels the task: not a failure, don't show "Offline".
            if Task.isCancelled || error is CancellationError { return }
            guard gen == generation else { return }
            lastRefreshFailed = true
        }
    }

    // MARK: Settings

    public func select(_ newLocation: Location) async {
        guard newLocation.id != location.id else { return }
        generation += 1
        location = newLocation
        store.saveString(newLocation.id, for: Self.locationKey)
        payload = cache.load(locationID: newLocation.id)    // may be nil: the view shows a loading state
        lastRefreshFailed = false
        reloadWidgets()
        await refresh()
    }

    /// Widgets follow the app's location and read the cache this model writes, so nudge
    /// them whenever either changes.
    private func reloadWidgets() {
        #if os(iOS)
        WidgetCenter.shared.reloadAllTimelines()
        #endif
    }

    public func setChartDays(_ days: Int) {
        let clamped = min(max(days, Self.validChartDays.lowerBound), Self.validChartDays.upperBound)
        chartDays = clamped
        store.saveString(String(clamped), for: Self.chartDaysKey)
    }
}
