import Foundation
import Observation
import UserNotifications

public enum AlertAuthorization: Equatable, Sendable {
    case notDetermined, denied, allowed
}

/// The seam between planning and iOS, so the coordinator can be tested with a fake.
public protocol NotificationScheduling: Sendable {
    func authorization() async -> AlertAuthorization
    func requestAuthorization() async -> Bool
    /// Removes every pending WeatherTempo alert, then schedules exactly `alerts`.
    func replaceAll(with alerts: [PlannedAlert]) async
    /// Delivers a notification straight away (MetService warnings).
    func notifyNow(id: String, title: String, body: String) async
}

/// Local notifications via `UNUserNotificationCenter`. No entitlement or paid account is needed.
public struct UserNotificationScheduler: NotificationScheduling {
    public init() {}

    private var center: UNUserNotificationCenter { .current() }

    public func authorization() async -> AlertAuthorization {
        switch await center.notificationSettings().authorizationStatus {
        case .notDetermined: return .notDetermined
        case .denied: return .denied
        default: return .allowed
        }
    }

    public func requestAuthorization() async -> Bool {
        (try? await center.requestAuthorization(options: [.alert, .sound])) ?? false
    }

    public func replaceAll(with alerts: [PlannedAlert]) async {
        let pending = await center.pendingNotificationRequests()
        let ours = pending.map(\.identifier).filter { $0.hasPrefix(AlertPlanner.idPrefix) }
        center.removePendingNotificationRequests(withIdentifiers: ours)

        let now = Date()
        for alert in alerts {
            let seconds = alert.fireDate.timeIntervalSince(now)
            guard seconds > 1 else { continue }
            let content = UNMutableNotificationContent()
            content.title = alert.title
            content.body = alert.body
            content.sound = .default
            content.threadIdentifier = "weathertempo.\(alert.kind.rawValue)"
            let trigger = UNTimeIntervalNotificationTrigger(timeInterval: seconds, repeats: false)
            try? await center.add(UNNotificationRequest(identifier: alert.id, content: content, trigger: trigger))
        }
    }

    public func notifyNow(id: String, title: String, body: String) async {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default
        content.threadIdentifier = "weathertempo.warning"
        content.interruptionLevel = .timeSensitive
        try? await center.add(UNNotificationRequest(identifier: id, content: content, trigger: nil))
    }
}

/// Owns the user's alert settings and keeps the scheduled notifications in step with the
/// latest forecast.
@MainActor @Observable
public final class AlertCoordinator {
    public var settings: AlertSettings {
        didSet {
            guard settings != oldValue else { return }
            settings.save(to: store)
            replan()
        }
    }
    public private(set) var authorization: AlertAuthorization = .notDetermined
    /// What is currently scheduled, for the settings screen to show.
    public private(set) var planned: [PlannedAlert] = []

    @ObservationIgnored private let store: KeyValueStoring
    @ObservationIgnored private let scheduler: NotificationScheduling
    @ObservationIgnored private let clock: () -> Date
    @ObservationIgnored private var latest: (payload: WeatherPayload, location: Location)?

    public init(
        store: KeyValueStoring = AppGroup.defaults,
        scheduler: NotificationScheduling = UserNotificationScheduler(),
        clock: @escaping () -> Date = { Date() }
    ) {
        self.store = store
        self.scheduler = scheduler
        self.clock = clock
        self.settings = AlertSettings.load(from: store)
    }

    public func refreshAuthorization() async {
        authorization = await scheduler.authorization()
    }

    /// Asks iOS for permission the first time an alert is switched on.
    public func ensureAuthorized() async {
        await refreshAuthorization()
        if authorization == .notDetermined {
            _ = await scheduler.requestAuthorization()
            await refreshAuthorization()
        }
    }

    /// Call after each warnings fetch: notifies about warnings not seen before (asking for
    /// permission the first time one arrives).
    public func warningsUpdated(_ warnings: [WeatherWarning], location: Location) {
        guard settings.warningsEnabled else { return }
        let fresh = WarningNotifications.toNotify(warnings, notified: WarningNotifications.notified(in: store))
        guard !fresh.isEmpty else { return }
        WarningNotifications.markNotified(fresh, in: store)
        let scheduler = scheduler
        let now = clock()
        Task {
            await ensureAuthorized()
            for w in fresh {
                let c = WarningNotifications.content(w, locationName: location.name, now: now, timeZone: location.timeZone)
                await scheduler.notifyNow(id: c.id, title: c.title, body: c.body)
            }
        }
    }

    /// Call after each fresh forecast.
    public func forecastUpdated(_ payload: WeatherPayload, location: Location) {
        latest = (payload, location)
        replan()
    }

    private var planTask: Task<Void, Never>?

    private func replan() {
        guard let latest else { return }
        let plan = settings.anyEnabled
            ? AlertPlanner.plan(hours: latest.payload.hourly, settings: settings,
                                locationName: latest.location.name, timeZone: latest.location.timeZone, now: clock())
            : []
        planned = plan
        let scheduler = scheduler
        // Serialise: a newer plan must land after an older one.
        let previous = planTask
        planTask = Task {
            await previous?.value
            await scheduler.replaceAll(with: plan)
        }
    }
}

/// Used by the background-refresh task: fetch a fresh forecast for the saved location and
/// reschedule, without the UI running.
public enum AlertBackground {
    public static let taskIdentifier = "nz.sewell.weathertempo.refresh"

    public static func refreshAndReplan(
        store: KeyValueStoring = AppGroup.defaults,
        client: WeatherClient = WeatherClient(),
        warningClient: WarningClient = WarningClient(),
        cache: PayloadCache = .shared(),
        scheduler: NotificationScheduling = UserNotificationScheduler(),
        now: Date = Date()
    ) async {
        let settings = AlertSettings.load(from: store)
        let location = Location.named(store.loadString(DashboardModel.locationKey))

        // Warnings first: they matter most and don't depend on the forecast.
        if settings.warningsEnabled,
           let warnings = try? await warningClient.warnings(latitude: location.lat, longitude: location.lon, now: now) {
            let fresh = WarningNotifications.toNotify(warnings, notified: WarningNotifications.notified(in: store))
            WarningNotifications.markNotified(fresh, in: store)
            for w in fresh {
                let c = WarningNotifications.content(w, locationName: location.name, now: now, timeZone: location.timeZone)
                await scheduler.notifyNow(id: c.id, title: c.title, body: c.body)
            }
        }

        let payload: WeatherPayload?
        if let fresh = try? await client.fetch(locationID: location.id) {
            try? cache.save(fresh, locationID: location.id)
            payload = fresh
        } else {
            payload = cache.load(locationID: location.id)
        }
        guard let payload else { return }

        let plan = settings.anyEnabled
            ? AlertPlanner.plan(hours: payload.hourly, settings: settings, locationName: location.name,
                                timeZone: location.timeZone, now: now)
            : []
        await scheduler.replaceAll(with: plan)
    }
}

/// Which warnings to notify about, and what the notification says. Each MetService alert id
/// is notified once (an update gets a new id, so an upgraded warning notifies again).
public enum WarningNotifications {
    static let storeKey = "weatherTempo.notifiedWarnings"
    static let idPrefix = "weathertempo.warning."
    /// Ids remembered; old ones drop off (MetService ids are never reused).
    static let memory = 100

    public static func toNotify(_ warnings: [WeatherWarning], notified: [String]) -> [WeatherWarning] {
        let seen = Set(notified)
        return warnings.filter { !seen.contains($0.id) }
    }

    static func notified(in store: KeyValueStoring) -> [String] {
        guard let json = store.loadString(storeKey), let data = json.data(using: .utf8),
              let ids = try? JSONDecoder().decode([String].self, from: data) else { return [] }
        return ids
    }

    static func markNotified(_ warnings: [WeatherWarning], in store: KeyValueStoring) {
        guard !warnings.isEmpty else { return }
        let ids = Array((notified(in: store) + warnings.map(\.id)).suffix(memory))
        if let data = try? JSONEncoder().encode(ids), let json = String(data: data, encoding: .utf8) {
            store.saveString(json, for: storeKey)
        }
    }

    public static func content(_ w: WeatherWarning, locationName: String, now: Date, timeZone: TimeZone)
        -> (id: String, title: String, body: String) {
        (idPrefix + w.id,
         "\(w.headline) – \(locationName)",
         "\(w.timing(now: now, timeZone: timeZone)). \(w.summary)")
    }
}
