import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

/// Temperature and UV alert preferences. Switching anything on asks for notification
/// permission the first time.
public struct AlertSettingsView: View {
    @Bindable var coordinator: AlertCoordinator
    @Environment(\.dismiss) private var dismiss

    public init(coordinator: AlertCoordinator) {
        self.coordinator = coordinator
    }

    public var body: some View {
        NavigationStack {
            Form {
                if coordinator.authorization == .denied { permissionDenied }

                Section {
                    Toggle("Above", isOn: $coordinator.settings.tempHighEnabled)
                    if coordinator.settings.tempHighEnabled {
                        Stepper(value: $coordinator.settings.tempHigh, in: AlertSettings.tempRange, step: 1) {
                            Text("Warn above \(Int(coordinator.settings.tempHigh))°C")
                        }
                    }
                    Toggle("Below", isOn: $coordinator.settings.tempLowEnabled)
                    if coordinator.settings.tempLowEnabled {
                        Stepper(value: $coordinator.settings.tempLow, in: AlertSettings.tempRange, step: 1) {
                            Text("Warn below \(Int(coordinator.settings.tempLow))°C")
                        }
                    }
                } header: {
                    Text("Temperature")
                } footer: {
                    Text("You're notified when the forecast crosses the limit, at the hour it happens.")
                }

                Section {
                    Stepper(value: $coordinator.settings.uvThreshold, in: AlertSettings.uvRange, step: 1) {
                        Text("UV level \(Int(coordinator.settings.uvThreshold))")
                    }
                    Toggle("When UV reaches this level", isOn: $coordinator.settings.uvEnabled)
                    Toggle("Daily summary", isOn: $coordinator.settings.dailyUVEnabled)
                    if coordinator.settings.dailyUVEnabled {
                        DatePicker("Send at", selection: dailyTime, displayedComponents: .hourAndMinute)
                    }
                } header: {
                    Text("UV")
                } footer: {
                    Text("The daily summary only arrives on days UV is forecast to reach the level, and says when.")
                }

                if !coordinator.planned.isEmpty {
                    Section("Scheduled") {
                        ForEach(Array(coordinator.planned.prefix(6)), id: \.id) { alert in
                            VStack(alignment: .leading, spacing: 2) {
                                Text(alert.title).font(.subheadline.weight(.semibold))
                                Text(alert.body).font(.caption).foregroundStyle(.secondary)
                            }
                        }
                    }
                }

                Section {
                } footer: {
                    Text("Alerts come from the forecast and are rescheduled whenever it refreshes, so open the app now and then. iOS may also refresh it in the background.")
                }
            }
            .navigationTitle("Alerts")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .task { await coordinator.refreshAuthorization() }
            .onChange(of: coordinator.settings.anyEnabled) { _, on in
                if on { Task { await coordinator.ensureAuthorized() } }
            }
        }
        .presentationDetents([.large])
    }

    private var permissionDenied: some View {
        Section {
            Label("Notifications are turned off for WeatherTempo.", systemImage: "bell.slash")
            #if canImport(UIKit)
            Button("Open Settings") {
                if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
            }
            #endif
        }
    }

    /// The stored minutes-after-midnight as a Date the picker understands, and back.
    private var dailyTime: Binding<Date> {
        Binding(
            get: {
                let cal = Calendar.current
                return cal.date(byAdding: .minute, value: coordinator.settings.dailyUVMinutes,
                                to: cal.startOfDay(for: Date())) ?? Date()
            },
            set: { date in
                let c = Calendar.current.dateComponents([.hour, .minute], from: date)
                coordinator.settings.dailyUVMinutes = (c.hour ?? 7) * 60 + (c.minute ?? 0)
            })
    }
}
