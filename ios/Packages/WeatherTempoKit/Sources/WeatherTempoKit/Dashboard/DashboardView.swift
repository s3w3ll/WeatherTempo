import SwiftUI

/// The dashboard body, as a plain non-scrolling stack of cards driven entirely by a
/// `DashboardState`. `DashboardView` wraps it in the scroll view and refresh plumbing;
/// previews and CI snapshots render this directly.
public struct DashboardContent: View {
    let state: DashboardState
    var onPickLocation: () -> Void = {}
    var onChangeDays: (Int) -> Void = { _ in }
    /// nil hides the alerts button (previews, snapshots).
    var onOpenAlerts: (() -> Void)?
    @Environment(\.staticRender) private var staticRender

    public init(state: DashboardState, onPickLocation: @escaping () -> Void = {},
                onChangeDays: @escaping (Int) -> Void = { _ in }, onOpenAlerts: (() -> Void)? = nil) {
        self.state = state
        self.onPickLocation = onPickLocation
        self.onChangeDays = onChangeDays
        self.onOpenAlerts = onOpenAlerts
    }

    public var body: some View {
        VStack(spacing: 14) {
            header
            if let banner = state.banner { StatusBannerView(banner: banner) }

            if let payload = state.payload {
                let insights = WeatherInsights(payload: payload, now: state.now, timeZone: state.location.timeZone)
                ConditionsCard(payload: payload, insights: insights)
                chartCard(payload)
                ForEach(Array(insights.dayForecasts.enumerated()), id: \.offset) { _, f in
                    DayForecastCard(forecast: f, timeZone: state.location.timeZone)
                }
                if let tides = TideSummary(location: state.location, now: state.now) {
                    TidesCard(tides: tides, timeZone: state.location.timeZone)
                }
                footer(payload)
            } else {
                emptyState
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .dynamicTypeSize(...DynamicTypeSize.accessibility3)
    }

    // MARK: Header

    private var header: some View {
        HStack(alignment: .firstTextBaseline) {
            Button(action: onPickLocation) {
                HStack(spacing: 6) {
                    Image(systemName: "mappin.and.ellipse").foregroundStyle(Theme.cyan)
                    Text("\(state.location.name), \(state.location.region)")
                        .font(.headline).foregroundStyle(Theme.strong).lineLimit(1).minimumScaleFactor(0.8)
                    Image(systemName: "chevron.down").font(.caption.weight(.bold)).foregroundStyle(Theme.muted)
                }
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Location: \(state.location.name). Change location")
            Spacer(minLength: 8)
            if state.isRefreshing {
                ProgressView().controlSize(.small).accessibilityLabel("Refreshing")
            } else if let p = state.payload {
                Text(TimeFormat.relative(since: p.updatedDate, now: state.now))
                    .font(.caption).foregroundStyle(Theme.fade)
            }
            if let onOpenAlerts {
                Button(action: onOpenAlerts) {
                    Image(systemName: "bell").foregroundStyle(Theme.muted)
                        .frame(minWidth: 32, minHeight: 32)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Alerts")
            }
        }
    }

    // MARK: Chart

    private func chartCard(_ payload: WeatherPayload) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("Forecast").font(.headline).foregroundStyle(Theme.strong)
                Spacer()
                if staticRender {
                    Text("\(state.chartDays) days ⌄").font(.subheadline).foregroundStyle(Theme.muted)
                } else {
                    Picker("Days shown", selection: Binding(get: { state.chartDays }, set: onChangeDays)) {
                        ForEach(DashboardModel.validChartDays, id: \.self) { Text("\($0) day\($0 == 1 ? "" : "s")").tag($0) }
                    }
                    .pickerStyle(.menu)
                    .tint(Theme.muted)
                }
            }
            MeteogramView(hours: payload.hourly, days: state.chartDays,
                          timeZone: state.location.timeZone, now: state.now,
                          latitude: state.location.lat, longitude: state.location.lon)
        }
        .dashboardCard()
    }

    // MARK: Footer / empty state

    /// The web footer prints the data timestamp as yyyyMMddHHmm, handy for spotting stale data.
    private func footer(_ payload: WeatherPayload) -> some View {
        let stamp: String = {
            guard let d = payload.updatedDate else { return "" }
            let c = TimeFormat.calendar(state.location.timeZone).dateComponents([.year, .month, .day, .hour, .minute], from: d)
            return String(format: "%04d%02d%02d%02d%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0, c.hour ?? 0, c.minute ?? 0)
        }()
        return Text(stamp).font(.system(size: 10).monospacedDigit()).foregroundStyle(Theme.fade)
            .frame(maxWidth: .infinity).padding(.top, 4)
    }

    private var emptyState: some View {
        VStack(spacing: 12) {
            if state.banner?.level == .error {
                Image(systemName: "wifi.exclamationmark").font(.largeTitle).foregroundStyle(Theme.muted)
                Text("No weather data yet").font(.headline).foregroundStyle(Theme.strong)
                Text("Pull down to try again.").font(.subheadline).foregroundStyle(Theme.muted)
            } else {
                ProgressView()
                Text("Fetching weather…").font(.subheadline).foregroundStyle(Theme.muted)
            }
        }
        .frame(maxWidth: .infinity, minHeight: 240)
    }
}

struct StatusBannerView: View {
    let banner: StatusBanner

    private var tint: Color {
        switch banner.level {
        case .info: return Theme.blue
        case .warning: return Color(r: 133, g: 77, b: 0)
        case .error: return Color(r: 180, g: 30, b: 55)
        }
    }

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Image(systemName: banner.level == .error ? "exclamationmark.octagon.fill" : "exclamationmark.triangle.fill")
            Text(banner.message).font(.footnote.weight(.medium)).fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .foregroundStyle(tint)
        .padding(.horizontal, 12).padding(.vertical, 10)
        .background(tint.opacity(0.12), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

/// The live dashboard: scroll view, pull-to-refresh, periodic refresh while the app is
/// active, and the location sheet.
public struct DashboardView: View {
    let model: DashboardModel
    let alerts: AlertCoordinator?
    @Environment(\.scenePhase) private var scenePhase
    @State private var showingLocations = false
    @State private var showingAlerts = false

    public init(model: DashboardModel, alerts: AlertCoordinator? = nil) {
        self.model = model
        self.alerts = alerts
    }

    public var body: some View {
        // The timeline re-renders every minute so "3 min ago" and the now marker stay current.
        TimelineView(.everyMinute) { timeline in
            ScrollView {
                DashboardContent(
                    state: model.state(now: timeline.date),
                    onPickLocation: { showingLocations = true },
                    onChangeDays: { model.setChartDays($0) },
                    onOpenAlerts: alerts == nil ? nil : { showingAlerts = true })
            }
            .refreshable { await model.refresh() }
        }
        .background(DashboardBackground())
        .task(id: scenePhase) {
            guard scenePhase == .active else { return }
            await model.activate()
            // Same 5 minute cadence as the web app; cancelled automatically when the app backgrounds.
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(DashboardModel.refreshInterval))
                await model.refreshIfStale()
            }
        }
        .sheet(isPresented: $showingAlerts) {
            if let alerts { AlertSettingsView(coordinator: alerts) }
        }
        .sheet(isPresented: $showingLocations) {
            LocationPicker(selectedID: model.location.id) { picked in
                showingLocations = false
                Task { await model.select(picked) }
            }
        }
    }
}

struct LocationPicker: View {
    let selectedID: String
    let onSelect: (Location) -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List(Location.all) { loc in
                Button { onSelect(loc) } label: {
                    HStack {
                        Text(loc.name).foregroundStyle(Theme.strong)
                        Spacer()
                        if loc.id == selectedID { Image(systemName: "checkmark").foregroundStyle(Theme.cyan) }
                    }
                }
            }
            .navigationTitle("Select Location")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
        .presentationDetents([.medium, .large])
    }
}

#if DEBUG
#Preview("Dashboard") {
    ScrollView { DashboardContent(state: .sample) }.background(DashboardBackground())
}
#endif
