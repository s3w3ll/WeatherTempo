import SwiftUI
import WidgetKit
import WeatherTempoKit

/// One entry per point in time; all rendering lives in WeatherTempoKit so it can be
/// snapshot-tested on CI. This file is only WidgetKit plumbing.
struct WeatherEntry: TimelineEntry {
    let date: Date
    let snapshot: WidgetSnapshot
}

struct WeatherProvider: TimelineProvider {
    func placeholder(in context: Context) -> WeatherEntry {
        WeatherEntry(date: Date(), snapshot: .placeholder)
    }

    func getSnapshot(in context: Context, completion: @escaping (WeatherEntry) -> Void) {
        // The widget gallery asks for a quick preview: use sample data, don't hit the network.
        if context.isPreview {
            completion(WeatherEntry(date: Date(), snapshot: .placeholder))
            return
        }
        Task {
            let snap = await WidgetLoader.load()
            completion(WeatherEntry(date: snap.date, snapshot: snap))
        }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<WeatherEntry>) -> Void) {
        Task {
            let snap = await WidgetLoader.load()
            let entries = WidgetLoader.entries(from: snap).map { WeatherEntry(date: $0.date, snapshot: $0) }
            // iOS treats this as a hint and decides the real refresh time itself (typically
            // 15-60 min), same as the Scriptable widget.
            let next = snap.date.addingTimeInterval(30 * 60)
            completion(Timeline(entries: entries, policy: .after(next)))
        }
    }
}

struct WeatherEntryView: View {
    @Environment(\.widgetFamily) private var family
    let entry: WeatherEntry

    private var size: WidgetSize {
        switch family {
        case .systemSmall: return .small
        case .systemMedium: return .medium
        case .systemLarge: return .large
        case .accessoryRectangular: return .lockRectangular
        case .accessoryCircular: return .lockCircular
        case .accessoryInline: return .lockInline
        default: return .medium
        }
    }

    var body: some View {
        WeatherWidgetView(size: size, snapshot: entry.snapshot)
            .containerBackground(for: .widget) {
                if size.usesSkyBackground { WidgetBackground() } else { Color.clear }
            }
    }
}

struct WeatherTempoWidget: Widget {
    let kind = "WeatherTempoWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: WeatherProvider()) { entry in
            WeatherEntryView(entry: entry)
        }
        .configurationDisplayName("WeatherTempo")
        .description("Current conditions, MetService warnings and the forecast chart for your location.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge,
                            .accessoryRectangular, .accessoryCircular, .accessoryInline])
    }
}

@main
struct WeatherTempoWidgets: WidgetBundle {
    var body: some Widget {
        WeatherTempoWidget()
    }
}
