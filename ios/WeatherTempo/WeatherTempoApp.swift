import SwiftUI
import WeatherTempoKit

@main
struct WeatherTempoApp: App {
    @State private var model = DashboardModel()

    var body: some Scene {
        WindowGroup {
            DashboardView(model: model)
                // The theme's colours are fixed light-mode values; dark mode comes later.
                .preferredColorScheme(.light)
        }
    }
}
