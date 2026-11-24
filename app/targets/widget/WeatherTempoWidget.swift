import SwiftUI
import WidgetKit

// A deliberately small, self-contained widget. It fetches the same Cloudflare Worker
// JSON as the app and shows values straight from it (no forecasting logic lives here,
// so there is nothing to drift from the TypeScript core). The chart, tides and the
// sentence summaries stay in the app.

private let workerURL = "https://weathertempo-pws-proxy.forgesync.workers.dev"
private let locationID = "christchurch"   // TODO: share the chosen location once an App Group is available
private let placeName = "Christchurch"

// MARK: - Data

struct Payload: Decodable {
    struct Current: Decodable {
        var temp: Double?
        var feelsLike: Double?
        var humidity: Double?
        var windSpeed: Double?
        var windCardinal: String?
        var condition: String?
        var iconCode: Int?
        var tempMax24h: Double?
        var tempMin24h: Double?
        var sunriseUtc: Double?
        var sunsetUtc: Double?
    }
    struct Hour: Decodable {
        var validTimeUtc: Double
        var qpf: Double?
    }
    var current: Current
    var hourly: [Hour]
}

struct WarningsPayload: Decodable {
    struct Item: Decodable {
        var level: String
        var headline: String
    }
    var warnings: [Item]
}

struct Snapshot {
    var date: Date
    var payload: Payload?
    var warnings: [WarningsPayload.Item]

    static let placeholder = Snapshot(
        date: Date(),
        payload: Payload(
            current: .init(temp: 17, feelsLike: 16, humidity: 62, windSpeed: 14, windCardinal: "NE",
                           condition: "Partly Cloudy", iconCode: 30, tempMax24h: 20, tempMin24h: 9,
                           sunriseUtc: nil, sunsetUtc: nil),
            hourly: []),
        warnings: [])
}

enum Loader {
    static func get<T: Decodable>(_ path: String, as: T.Type) async -> T? {
        guard let url = URL(string: "\(workerURL)\(path)") else { return nil }
        var req = URLRequest(url: url)
        req.timeoutInterval = 12
        req.cachePolicy = .reloadIgnoringLocalCacheData
        guard let (data, resp) = try? await URLSession.shared.data(for: req),
              (resp as? HTTPURLResponse)?.statusCode == 200 else { return nil }
        return try? JSONDecoder().decode(T.self, from: data)
    }

    static func load() async -> Snapshot {
        async let p = get("/?location=\(locationID)", as: Payload.self)
        async let w = get("/warnings?location=\(locationID)", as: WarningsPayload.self)
        let payload = await p
        let warnings = (await w)?.warnings ?? []
        return Snapshot(date: Date(), payload: payload, warnings: warnings)
    }
}

// MARK: - Timeline

struct Entry: TimelineEntry {
    let date: Date
    let snapshot: Snapshot
}

struct Provider: TimelineProvider {
    func placeholder(in context: Context) -> Entry { Entry(date: Date(), snapshot: .placeholder) }

    func getSnapshot(in context: Context, completion: @escaping (Entry) -> Void) {
        if context.isPreview { completion(placeholder(in: context)); return }
        Task {
            let s = await Loader.load()
            completion(Entry(date: s.date, snapshot: s))
        }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<Entry>) -> Void) {
        Task {
            let s = await Loader.load()
            // iOS treats the date as a hint and picks the real refresh time itself.
            let next = s.date.addingTimeInterval(30 * 60)
            completion(Timeline(entries: [Entry(date: s.date, snapshot: s)], policy: .after(next)))
        }
    }
}

// MARK: - Helpers

private func temp(_ v: Double?) -> String { v.map { "\(Int($0.rounded()))°" } ?? "—" }

/// Same mapping as iconFor() in the app's display.ts (TWC icon codes).
private func glyph(_ c: Payload.Current, at now: Date) -> String {
    var day = true
    if let rise = c.sunriseUtc, let set = c.sunsetUtc, rise > 0, set > 0 {
        let t = now.timeIntervalSince1970
        // Sunrise/sunset are for one day; compare time of day so it works for any date.
        let secs = t.truncatingRemainder(dividingBy: 86_400)
        let r = rise.truncatingRemainder(dividingBy: 86_400), s = set.truncatingRemainder(dividingBy: 86_400)
        day = r <= s ? (secs >= r && secs < s) : (secs >= r || secs < s)
    }
    switch c.iconCode ?? -1 {
    case 32, 36: return "☀️"
    case 31: return "🌙"
    case 30, 34: return day ? "⛅" : "☁️"
    case 29, 33, 27, 28: return day ? "🌥️" : "☁️"
    case 26: return "☁️"
    case 9, 11, 45: return "🌦️"
    case 12, 39, 40: return "🌧️"
    case 13, 14, 15, 16, 41, 42, 43, 46: return "❄️"
    case 4, 17, 18, 35, 37, 38, 47: return "⛈️"
    case 19, 20, 21, 22: return "🌫️"
    case 23, 24: return "💨"
    default: return day ? "⛅" : "☁️"
    }
}

private func rainLabel(_ qpf: Double) -> String { qpf >= 4 ? "Heavy rain" : qpf >= 1 ? "Moderate rain" : "Light rain" }

/// "Moderate rain at 5pm": the next hour today with more than 0.1 mm.
private func nextRain(_ p: Payload, now: Date) -> String? {
    let cal = Calendar(identifier: .gregorian)
    var tzCal = cal
    tzCal.timeZone = TimeZone(identifier: "Pacific/Auckland") ?? .current
    for h in p.hourly where h.validTimeUtc >= now.timeIntervalSince1970 - 1800 {
        let d = Date(timeIntervalSince1970: h.validTimeUtc)
        guard let q = h.qpf, q > 0.1 else { continue }
        guard tzCal.isDate(d, inSameDayAs: now) else { return nil }
        let f = DateFormatter()
        f.timeZone = tzCal.timeZone
        f.locale = Locale(identifier: "en_NZ")
        f.dateFormat = "ha"
        return "\(rainLabel(q)) at \(f.string(from: d).lowercased())"
    }
    return nil
}

private func shortHeadline(_ s: String) -> String {
    for suffix in [" - Yellow", " - Orange", " - Red"] where s.hasSuffix(suffix) { return String(s.dropLast(suffix.count)) }
    return s
}

private func warningColor(_ level: String) -> Color {
    switch level.lowercased() {
    case "red": return Color(red: 0.86, green: 0.15, blue: 0.15)
    case "orange": return Color(red: 0.96, green: 0.55, blue: 0.10)
    default: return Color(red: 0.98, green: 0.80, blue: 0.20)
    }
}

private struct WarningBadge: View {
    let w: WarningsPayload.Item
    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: "exclamationmark.triangle.fill")
            Text(shortHeadline(w.headline)).lineLimit(1).minimumScaleFactor(0.75)
        }
        .font(.system(size: 10, weight: .bold))
        .foregroundStyle(.black)
        .padding(.horizontal, 7).padding(.vertical, 3)
        .background(warningColor(w.level), in: Capsule())
    }
}

private let skyText = Color.white
private let skyMuted = Color(white: 1, opacity: 0.78)
private let skyCyan = Color(red: 0.62, green: 0.90, blue: 1.0)

private struct Sky: View {
    var body: some View {
        LinearGradient(colors: [Color(red: 0.12, green: 0.25, blue: 0.52), Color(red: 0.16, green: 0.38, blue: 0.68),
                                Color(red: 0.15, green: 0.33, blue: 0.58)],
                       startPoint: .top, endPoint: .bottom)
    }
}

// MARK: - Views

struct SmallView: View {
    let s: Snapshot
    var body: some View {
        if let c = s.payload?.current {
            VStack(alignment: .leading, spacing: 0) {
                HStack {
                    Text(placeName.uppercased()).font(.system(size: 10, weight: .medium)).foregroundStyle(skyMuted)
                    Spacer(minLength: 4)
                    Text(glyph(c, at: s.date)).font(.system(size: 18))
                }
                Spacer(minLength: 2)
                Text(temp(c.temp)).font(.system(size: 38, weight: .bold)).foregroundStyle(skyText).minimumScaleFactor(0.8)
                Text(c.condition ?? "—").font(.system(size: 12)).foregroundStyle(skyMuted).lineLimit(1)
                Spacer(minLength: 2)
                if let w = s.warnings.first {
                    WarningBadge(w: w)
                } else {
                    HStack {
                        Text("Feels \(temp(c.feelsLike))")
                        Spacer(minLength: 2)
                        Text("\(temp(c.tempMax24h)) / \(temp(c.tempMin24h))")
                    }
                    .font(.system(size: 10)).foregroundStyle(skyMuted).lineLimit(1).minimumScaleFactor(0.8)
                }
            }
        } else {
            Unavailable()
        }
    }
}

struct MediumView: View {
    let s: Snapshot
    var body: some View {
        if let p = s.payload {
            let c = p.current
            VStack(alignment: .leading, spacing: 0) {
                HStack {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(placeName.uppercased()).font(.system(size: 10, weight: .medium)).foregroundStyle(skyMuted)
                        HStack(spacing: 6) {
                            Text(glyph(c, at: s.date)).font(.system(size: 26))
                            Text(temp(c.temp)).font(.system(size: 34, weight: .bold)).foregroundStyle(skyText)
                        }
                        Text(c.condition ?? "—").font(.system(size: 11)).foregroundStyle(skyMuted).lineLimit(1)
                        if let rain = nextRain(p, now: s.date) {
                            Text(rain).font(.system(size: 10, weight: .semibold)).foregroundStyle(skyCyan).lineLimit(1)
                        }
                    }
                    Spacer(minLength: 8)
                    VStack(spacing: 4) {
                        stat("Feels", temp(c.feelsLike))
                        stat("Hi/Lo", "\(temp(c.tempMax24h)) / \(temp(c.tempMin24h))")
                        stat("Wind", "\(c.windSpeed.map { String(Int($0.rounded())) } ?? "—") km/h \(c.windCardinal ?? "")")
                        stat("Humidity", c.humidity.map { "\(Int($0.rounded()))%" } ?? "—")
                    }
                }
                Spacer(minLength: 4)
                if let w = s.warnings.first {
                    HStack(spacing: 6) {
                        WarningBadge(w: w)
                        if s.warnings.count > 1 { Text("+\(s.warnings.count - 1)").font(.system(size: 10, weight: .bold)).foregroundStyle(skyText) }
                    }
                } else {
                    Text("Updated \(s.date, style: .relative) ago").font(.system(size: 9)).foregroundStyle(skyMuted)
                }
            }
        } else {
            Unavailable()
        }
    }

    private func stat(_ label: String, _ value: String) -> some View {
        HStack(spacing: 6) {
            Text(label).font(.system(size: 10)).foregroundStyle(skyMuted)
            Spacer(minLength: 0)
            Text(value).font(.system(size: 10, weight: .medium)).foregroundStyle(skyText).lineLimit(1)
        }
        .frame(width: 118)
    }
}

struct LockRectangularView: View {
    let s: Snapshot
    var body: some View {
        if let p = s.payload {
            let c = p.current
            VStack(alignment: .leading, spacing: 1) {
                HStack(spacing: 4) {
                    Text(glyph(c, at: s.date))
                    Text(temp(c.temp)).fontWeight(.semibold)
                    Text(c.condition ?? "").lineLimit(1)
                }
                .font(.headline)
                if let w = s.warnings.first {
                    Text("\(Image(systemName: "exclamationmark.triangle.fill")) \(shortHeadline(w.headline))")
                        .font(.caption.weight(.semibold)).lineLimit(1)
                    Text(w.level.capitalized).font(.caption)
                } else {
                    Text("H/L \(temp(c.tempMax24h)) / \(temp(c.tempMin24h))").font(.caption)
                    Text(nextRain(p, now: s.date) ?? "Wind \(c.windSpeed.map { String(Int($0.rounded())) } ?? "—") km/h \(c.windCardinal ?? "")")
                        .font(.caption).lineLimit(1)
                }
            }
        } else {
            Text("Open WeatherTempo")
        }
    }
}

struct LockCircularView: View {
    let s: Snapshot
    var body: some View {
        VStack(spacing: 0) {
            if s.warnings.first != nil {
                Image(systemName: "exclamationmark.triangle.fill").font(.system(size: 16, weight: .bold))
            } else if let c = s.payload?.current {
                Text(glyph(c, at: s.date)).font(.system(size: 18))
            } else {
                Image(systemName: "cloud.slash")
            }
            Text(temp(s.payload?.current.temp)).font(.system(size: 16, weight: .semibold))
        }
    }
}

struct LockInlineView: View {
    let s: Snapshot
    var body: some View {
        if let w = s.warnings.first {
            Text("\(Image(systemName: "exclamationmark.triangle.fill")) \(w.level.capitalized) · \(shortHeadline(w.headline))")
        } else if let c = s.payload?.current {
            Text("\(glyph(c, at: s.date)) \(temp(c.temp)) \(c.condition ?? "")")
        } else {
            Text("WeatherTempo: open app")
        }
    }
}

struct Unavailable: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(placeName.uppercased()).font(.system(size: 10, weight: .medium))
            Text("No weather yet").font(.system(size: 15, weight: .semibold))
            Text("Will retry shortly.").font(.system(size: 11)).opacity(0.8)
        }
        .foregroundStyle(skyText)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }
}

struct EntryView: View {
    @Environment(\.widgetFamily) private var family
    let entry: Entry

    var body: some View {
        switch family {
        case .systemSmall:
            SmallView(s: entry.snapshot).containerBackground(for: .widget) { Sky() }
        case .systemMedium:
            MediumView(s: entry.snapshot).containerBackground(for: .widget) { Sky() }
        case .accessoryRectangular:
            LockRectangularView(s: entry.snapshot).containerBackground(for: .widget) { Color.clear }
        case .accessoryCircular:
            LockCircularView(s: entry.snapshot).containerBackground(for: .widget) { Color.clear }
        case .accessoryInline:
            LockInlineView(s: entry.snapshot).containerBackground(for: .widget) { Color.clear }
        default:
            MediumView(s: entry.snapshot).containerBackground(for: .widget) { Sky() }
        }
    }
}

struct WeatherTempoWidget: Widget {
    let kind = "WeatherTempoWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: Provider()) { entry in
            EntryView(entry: entry)
        }
        .configurationDisplayName("WeatherTempo")
        .description("Current conditions and MetService warnings for Christchurch.")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryRectangular, .accessoryCircular, .accessoryInline])
    }
}

@main
struct WeatherTempoWidgets: WidgetBundle {
    var body: some Widget {
        WeatherTempoWidget()
    }
}
