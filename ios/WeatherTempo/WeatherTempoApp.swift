import SwiftUI
import WeatherTempoKit

@main
struct WeatherTempoApp: App {
    var body: some Scene {
        WindowGroup {
            DebugDataView()
        }
    }
}

/// Task 1 milestone screen: proves the Worker -> decode -> cache path works on
/// device. Replaced by the real DashboardView in Task 4.
struct DebugDataView: View {
    @State private var summary = "Loading…"
    private let client = WeatherClient()
    private let cache = PayloadCache.shared()
    private let locationID = "christchurch"

    var body: some View {
        VStack(spacing: 12) {
            Text("WeatherTempo").font(.largeTitle.bold())
            Text(summary)
                .font(.callout.monospaced())
                .multilineTextAlignment(.center)
            Button("Refresh") { Task { await load() } }
                .buttonStyle(.borderedProminent)
        }
        .padding()
        .task { await load() }
    }

    private func load() async {
        // Cache-first so the screen is never blank, then refresh from the network.
        if let cached = cache.load(locationID: locationID) {
            summary = describe(cached, source: "cache")
        }
        do {
            let payload = try await client.fetch(locationID: locationID)
            try? cache.save(payload, locationID: locationID)
            summary = describe(payload, source: "network")
        } catch {
            summary += "\n\nFetch failed: \(error)"
        }
    }

    private func describe(_ p: WeatherPayload, source: String) -> String {
        let temp = p.current.temp.map { String(format: "%.1f°", $0) } ?? "—"
        return """
        [\(source)] \(p.meta.location ?? "?")
        \(temp)  \(p.current.condition ?? "—")
        \(p.hourly.count) hourly · \(p.daily.count) daily
        \(p.isStale() ? "STALE" : "fresh")
        """
    }
}
