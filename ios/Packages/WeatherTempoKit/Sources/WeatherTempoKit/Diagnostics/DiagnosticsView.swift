import SwiftUI
import UserNotifications
#if canImport(UIKit)
import UIKit
#endif

/// Phone settings that decide whether alerts and background refresh can work at all.
public struct SystemStatus: Equatable, Sendable {
    /// The App Group container exists, so the app and widget share storage.
    public var sharedStorage: Bool
    public var notifications: String
    public var timeSensitive: String
    public var backgroundRefresh: String
    public var pendingNotifications: Int

    public init(sharedStorage: Bool, notifications: String, timeSensitive: String,
                backgroundRefresh: String, pendingNotifications: Int) {
        self.sharedStorage = sharedStorage
        self.notifications = notifications
        self.timeSensitive = timeSensitive
        self.backgroundRefresh = backgroundRefresh
        self.pendingNotifications = pendingNotifications
    }

    static let unknown = SystemStatus(sharedStorage: AppGroup.isShared, notifications: "…", timeSensitive: "…",
                                      backgroundRefresh: "…", pendingNotifications: 0)

    /// Reads the live settings (device only: needs a real app bundle).
    @MainActor static func current() async -> SystemStatus {
        let center = UNUserNotificationCenter.current()
        let settings = await center.notificationSettings()
        let auth: String
        switch settings.authorizationStatus {
        case .notDetermined: auth = "Not asked yet"
        case .denied: auth = "Off"
        case .authorized: auth = "On"
        case .provisional: auth = "Quiet (provisional)"
        #if os(iOS)
        case .ephemeral: auth = "Temporary"
        #endif
        @unknown default: auth = "Unknown"
        }
        let ts: String
        switch settings.timeSensitiveSetting {
        case .enabled: ts = "On"
        case .disabled: ts = "Off"
        case .notSupported: ts = "Not available"
        @unknown default: ts = "Unknown"
        }
        var bg = "n/a"
        #if canImport(UIKit)
        switch UIApplication.shared.backgroundRefreshStatus {
        case .available: bg = "On"
        case .denied: bg = "Off"
        case .restricted: bg = "Restricted"
        @unknown default: bg = "Unknown"
        }
        #endif
        let pending = await center.pendingNotificationRequests().count
        return SystemStatus(sharedStorage: AppGroup.isShared, notifications: auth, timeSensitive: ts,
                            backgroundRefresh: bg, pendingNotifications: pending)
    }
}

extension AppGroup {
    /// True when iOS gave this build the shared container (a re-signed sideload may not have it).
    public static var isShared: Bool {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: id) != nil
    }
}

/// Everything on the diagnostics screen as plain text, for sharing.
public enum DiagnosticsReport {
    /// The fetches that matter, in screen order.
    static let checks: [(DiagnosticEvent.Source, DiagnosticEvent.Kind)] = [
        (.app, .forecast), (.app, .warnings),
        (.widget, .forecast), (.widget, .warnings),
        (.background, .forecast), (.background, .warnings),
        (.app, .schedule),
    ]

    static func when(_ date: Date, now: Date) -> String {
        TimeFormat.relative(since: date, now: now)
    }

    static func line(_ e: DiagnosticEvent?, now: Date) -> String {
        guard let e else { return "never" }
        return "\(e.ok ? "OK" : "FAILED") \(when(e.date, now: now)) – \(e.detail)"
    }

    public static func text(events: [DiagnosticEvent], system: SystemStatus, memory: [RememberedWarning],
                            appVersion: String, now: Date, timeZone: TimeZone) -> String {
        var out: [String] = []
        let stamp = DateFormatter()
        stamp.dateFormat = "EEE d MMM HH:mm:ss"
        stamp.timeZone = timeZone
        out.append("WeatherTempo \(appVersion) diagnostics, \(stamp.string(from: now))")
        out.append("")
        out.append("Shared storage (App Group): \(system.sharedStorage ? "yes" : "NO")")
        out.append("Notifications: \(system.notifications); time-sensitive: \(system.timeSensitive)")
        out.append("Background refresh: \(system.backgroundRefresh)")
        out.append("Scheduled notifications: \(system.pendingNotifications)")
        out.append("")
        for (source, kind) in checks {
            let e = events.first { $0.source == source && $0.kind == kind }
            out.append("\(source.name) \(kind.name.lowercased()): \(line(e, now: now))")
        }
        out.append("")
        out.append("Remembered warnings (\(memory.count)):")
        for r in memory.suffix(10).reversed() {
            out.append("  \(r.headline) [\(r.level.name)\(r.lifted ? ", lifted" : "")] \(r.locationID) id \(r.id)")
        }
        out.append("")
        out.append("Activity:")
        for e in events {
            let times = e.count > 1 ? " ×\(e.count) since \(stamp.string(from: e.firstDate))" : ""
            out.append("  \(stamp.string(from: e.date)) \(e.source.name) \(e.kind.name.lowercased()) "
                       + "\(e.ok ? "ok" : "FAILED")\(times): \(e.detail)")
        }
        return out.joined(separator: "\n")
    }
}

/// What the app, the widget and background refresh have been doing, and whether the phone
/// lets them: for checking notifications and background refresh on a sideloaded build.
public struct DiagnosticsView: View {
    private let store: KeyValueStoring
    @State private var events: [DiagnosticEvent] = []
    @State private var memory: [RememberedWarning] = []
    @State private var system = SystemStatus.unknown
    @State private var now = Date()
    @State private var testResult: String?

    public init(store: KeyValueStoring = AppGroup.defaults) {
        self.store = store
    }

    private var tz: TimeZone { .current }

    private var appVersion: String {
        let info = Bundle.main.infoDictionary
        let v = info?["CFBundleShortVersionString"] as? String ?? "?"
        let b = info?["CFBundleVersion"] as? String ?? "?"
        return "\(v) (\(b))"
    }

    public var body: some View {
        Form {
            Section {
                row("Shared storage", system.sharedStorage ? "Working" : "Not available", ok: system.sharedStorage)
                row("Notifications", system.notifications, ok: system.notifications == "On")
                row("Time-sensitive", system.timeSensitive, ok: system.timeSensitive == "On")
                row("Background refresh", system.backgroundRefresh, ok: system.backgroundRefresh == "On")
                row("Scheduled notifications", "\(system.pendingNotifications)", ok: nil)
            } header: {
                Text("Phone")
            } footer: {
                Text(system.sharedStorage
                     ? "The widget and app share their cache and this log."
                     : "Without shared storage the widget keeps its own cache, and its runs won't show here.")
            }

            Section("Last runs") {
                ForEach(Array(DiagnosticsReport.checks.enumerated()), id: \.offset) { _, check in
                    lastRun(check.0, check.1)
                }
            }

            Section {
                if memory.isEmpty {
                    Text("None yet").foregroundStyle(.secondary)
                }
                ForEach(Array(memory.suffix(8).reversed().enumerated()), id: \.offset) { _, r in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(r.headline).font(.subheadline)
                        Text("\(r.level.name)\(r.lifted ? " · lifted" : "") · \(r.locationID)")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }
                Button("Forget seen warnings") {
                    WarningNotifications.forget(in: store)
                    reload()
                }
            } header: {
                Text("Warnings seen")
            } footer: {
                Text("After forgetting, the next check notifies about whatever is in force again.")
            }

            Section {
                Button("Send a test notification") { Task { await sendTest() } }
                if let testResult { Text(testResult).font(.caption).foregroundStyle(.secondary) }
                ShareLink("Share report", item: DiagnosticsReport.text(
                    events: events, system: system, memory: memory, appVersion: appVersion, now: now, timeZone: tz))
            }

            Section("Activity") {
                if events.isEmpty { Text("Nothing logged yet").foregroundStyle(.secondary) }
                ForEach(events) { e in activity(e) }
                if !events.isEmpty {
                    Button("Clear log", role: .destructive) {
                        DiagnosticsLog.clear(in: store)
                        reload()
                    }
                }
            }
        }
        .navigationTitle("Diagnostics")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .refreshable { await load() }
        .task { await load() }
    }

    private func reload() {
        now = Date()
        events = DiagnosticsLog.events(in: store)
        memory = WarningNotifications.remembered(in: store)
    }

    private func load() async {
        reload()
        system = await SystemStatus.current()
    }

    private func sendTest() async {
        let center = UNUserNotificationCenter.current()
        if await center.notificationSettings().authorizationStatus == .notDetermined {
            _ = try? await center.requestAuthorization(options: [.alert, .sound])
        }
        let content = UNMutableNotificationContent()
        content.title = "WeatherTempo test"
        content.body = "Notifications are working. Warnings are sent the same way."
        content.sound = .default
        content.interruptionLevel = .timeSensitive
        do {
            try await center.add(UNNotificationRequest(identifier: "weathertempo.test", content: content, trigger: nil))
            testResult = "Sent. It should appear as a banner now."
            DiagnosticsLog.record(.app, .notification, ok: true, "Test notification", in: store)
        } catch {
            testResult = "Couldn't send: \(error.localizedDescription)"
            DiagnosticsLog.record(.app, .notification, ok: false, "Test notification: \(error.localizedDescription)", in: store)
        }
        await load()
    }

    // MARK: Rows

    private func row(_ title: String, _ value: String, ok: Bool?) -> some View {
        HStack {
            Text(title)
            Spacer()
            if let ok {
                Image(systemName: ok ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
                    .foregroundStyle(ok ? Theme.green : Theme.amberText)
                    .accessibilityHidden(true)
            }
            Text(value).foregroundStyle(.secondary)
        }
        .accessibilityElement(children: .combine)
    }

    private func lastRun(_ source: DiagnosticEvent.Source, _ kind: DiagnosticEvent.Kind) -> some View {
        let e = events.first { $0.source == source && $0.kind == kind }
        return VStack(alignment: .leading, spacing: 2) {
            HStack {
                statusIcon(e?.ok)
                Text("\(source.name) · \(kind.name)").font(.subheadline)
                Spacer()
                Text(e.map { DiagnosticsReport.when($0.date, now: now) } ?? "never")
                    .font(.caption).foregroundStyle(.secondary)
            }
            if let e { Text(e.detail).font(.caption).foregroundStyle(.secondary).lineLimit(2) }
        }
        .accessibilityElement(children: .combine)
    }

    private func activity(_ e: DiagnosticEvent) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack {
                statusIcon(e.ok)
                Text("\(e.source.name) · \(e.kind.name)").font(.subheadline)
                if e.count > 1 { Text("×\(e.count)").font(.caption).foregroundStyle(.secondary) }
                Spacer()
                Text(e.date, format: .dateTime.weekday(.abbreviated).hour().minute())
                    .font(.caption).foregroundStyle(.secondary)
            }
            Text(e.detail).font(.caption).foregroundStyle(.secondary)
        }
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder private func statusIcon(_ ok: Bool?) -> some View {
        switch ok {
        case .some(true):
            Image(systemName: "checkmark.circle.fill").foregroundStyle(Theme.green).accessibilityLabel("OK")
        case .some(false):
            Image(systemName: "xmark.octagon.fill").foregroundStyle(Theme.red).accessibilityLabel("Failed")
        case .none:
            Image(systemName: "circle.dashed").foregroundStyle(.secondary).accessibilityLabel("Never")
        }
    }
}
