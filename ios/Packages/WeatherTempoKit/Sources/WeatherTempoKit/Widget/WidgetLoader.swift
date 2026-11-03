import Foundation

/// Where the app and the widget share settings and cache. If this App Group isn't
/// available (for example a sideloaded build that re-signed it), everything below falls
/// back gracefully: `defaults` becomes the process's own defaults and the cache directory
/// becomes the process's own caches folder. The widget then simply fetches for itself and
/// uses the default location, instead of failing.
public enum AppGroup {
    public static let id = "group.nz.sewell.weathertempo"
    public static var defaults: UserDefaults { UserDefaults(suiteName: id) ?? .standard }
}

/// What a widget renders at one point in time.
public struct WidgetSnapshot: Equatable {
    public var location: Location
    public var payload: WeatherPayload?
    public var date: Date

    public init(location: Location, payload: WeatherPayload?, date: Date) {
        self.location = location
        self.payload = payload
        self.date = date
    }

    public static let placeholder = WidgetSnapshot(
        location: .named("christchurch"), payload: SampleData.payload(), date: SampleData.referenceNow)
}

public enum WidgetLoader {
    /// Network first (widgets get few wake-ups, so fresh data matters more than saving a
    /// request), saving what it gets for the app to show instantly; cache second; otherwise
    /// a snapshot with no payload, which renders as "open the app".
    public static func load(
        client: WeatherClient = WeatherClient(maxAttempts: 2),
        cache: PayloadCache = .shared(),
        store: KeyValueStoring = AppGroup.defaults,
        now: Date = Date()
    ) async -> WidgetSnapshot {
        let location = Location.named(store.loadString(DashboardModel.locationKey))
        if let fresh = try? await client.fetch(locationID: location.id) {
            try? cache.save(fresh, locationID: location.id)
            return WidgetSnapshot(location: location, payload: fresh, date: now)
        }
        return WidgetSnapshot(location: location, payload: cache.load(locationID: location.id), date: now)
    }

    /// Entries for the next hour at 15-minute steps from one payload, so the "now" row, strip
    /// and "x min ago" text stay roughly right until the next real refresh (iOS decides that).
    public static func entries(from snapshot: WidgetSnapshot, steps: Int = 4, stepMinutes: Int = 15) -> [WidgetSnapshot] {
        (0..<steps).map {
            WidgetSnapshot(location: snapshot.location, payload: snapshot.payload,
                           date: snapshot.date.addingTimeInterval(Double($0 * stepMinutes) * 60))
        }
    }
}
