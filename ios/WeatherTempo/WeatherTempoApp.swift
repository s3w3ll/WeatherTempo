import BackgroundTasks
import SwiftUI
import UserNotifications
import WeatherTempoKit

/// Shows alerts as banners even while the app is open (iOS hides them by default).
private final class ForegroundNotificationDelegate: NSObject, UNUserNotificationCenterDelegate {
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async
        -> UNNotificationPresentationOptions { [.banner, .sound] }
}

@main
struct WeatherTempoApp: App {
    @State private var model: DashboardModel
    @State private var alerts: AlertCoordinator
    @Environment(\.scenePhase) private var scenePhase
    private static let notificationDelegate = ForegroundNotificationDelegate()

    init() {
        let model = DashboardModel()
        let alerts = AlertCoordinator()
        // Every fresh forecast reschedules the temperature / UV notifications.
        model.onFreshPayload = { payload, location in alerts.forecastUpdated(payload, location: location) }
        _model = State(initialValue: model)
        _alerts = State(initialValue: alerts)
        UNUserNotificationCenter.current().delegate = Self.notificationDelegate
    }

    var body: some Scene {
        WindowGroup {
            DashboardView(model: model, alerts: alerts)
                // The theme's colours are fixed light-mode values; dark mode comes later.
                .preferredColorScheme(.light)
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .background { Self.scheduleBackgroundRefresh() }
        }
        // Best effort: iOS decides when (and whether) to run this, but when it does the
        // alerts are replanned from a fresh forecast without the app being opened.
        .backgroundTask(.appRefresh(AlertBackground.taskIdentifier)) {
            await AlertBackground.refreshAndReplan()
            Self.scheduleBackgroundRefresh()
        }
    }

    private static func scheduleBackgroundRefresh() {
        let request = BGAppRefreshTaskRequest(identifier: AlertBackground.taskIdentifier)
        request.earliestBeginDate = Date(timeIntervalSinceNow: 3 * 3600)
        try? BGTaskScheduler.shared.submit(request)
    }
}
