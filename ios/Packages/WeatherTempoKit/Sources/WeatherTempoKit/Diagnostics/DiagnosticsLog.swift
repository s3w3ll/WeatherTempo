import Foundation

/// One thing that happened in the app, the widget or a background refresh.
public struct DiagnosticEvent: Codable, Equatable, Identifiable, Sendable {
    public enum Source: String, Codable, Sendable, CaseIterable {
        case app, widget, background
        public var name: String {
            switch self {
            case .app: return "App"
            case .widget: return "Widget"
            case .background: return "Background"
            }
        }
    }

    public enum Kind: String, Codable, Sendable, CaseIterable {
        case forecast, warnings, notification, schedule
        public var name: String {
            switch self {
            case .forecast: return "Forecast"
            case .warnings: return "Warnings"
            case .notification: return "Notification"
            case .schedule: return "Background task"
            }
        }
    }

    /// When it last happened (repeats update this rather than adding a row).
    public var date: Date
    /// When the first of a run of identical events happened.
    public var firstDate: Date
    public var count: Int
    public let source: Source
    public let kind: Kind
    public let ok: Bool
    public let detail: String

    public var id: String { "\(firstDate.timeIntervalSince1970)-\(source.rawValue)-\(kind.rawValue)" }

    func repeats(_ other: DiagnosticEvent) -> Bool {
        source == other.source && kind == other.kind && ok == other.ok && detail == other.detail
    }
}

/// A short rolling log in the App Group defaults, so the app, the widget and the background
/// task all write to the same place and the diagnostics screen can show what each did.
/// If the widget's entries never appear in the app, the App Group isn't shared.
public enum DiagnosticsLog {
    static let storeKey = "weatherTempo.diagnostics"
    static let capacity = 80

    public static func record(
        _ source: DiagnosticEvent.Source, _ kind: DiagnosticEvent.Kind, ok: Bool, _ detail: String,
        at date: Date = Date(), in store: KeyValueStoring = AppGroup.defaults
    ) {
        var log = events(in: store)
        let event = DiagnosticEvent(date: date, firstDate: date, count: 1, source: source, kind: kind, ok: ok, detail: detail)
        // The newest event of the same source and kind: if it says the same thing, bump it
        // instead of adding a row, so the app's 5-minute refreshes can't push out the rest.
        if let i = log.firstIndex(where: { $0.source == source && $0.kind == kind }), log[i].repeats(event) {
            log[i].date = date
            log[i].count += 1
            let bumped = log.remove(at: i)
            log.insert(bumped, at: 0)
        } else {
            log.insert(event, at: 0)
        }
        save(Array(log.prefix(capacity)), in: store)
    }

    /// Newest first.
    public static func events(in store: KeyValueStoring = AppGroup.defaults) -> [DiagnosticEvent] {
        guard let json = store.loadString(storeKey), let data = json.data(using: .utf8) else { return [] }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .secondsSince1970
        return (try? decoder.decode([DiagnosticEvent].self, from: data)) ?? []
    }

    /// The latest event from `source` of `kind`, if any.
    public static func last(_ source: DiagnosticEvent.Source, _ kind: DiagnosticEvent.Kind,
                            in store: KeyValueStoring = AppGroup.defaults) -> DiagnosticEvent? {
        events(in: store).first { $0.source == source && $0.kind == kind }
    }

    public static func clear(in store: KeyValueStoring = AppGroup.defaults) {
        store.saveString("[]", for: storeKey)
    }

    private static func save(_ log: [DiagnosticEvent], in store: KeyValueStoring) {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .secondsSince1970
        guard let data = try? encoder.encode(log), let json = String(data: data, encoding: .utf8) else { return }
        store.saveString(json, for: storeKey)
    }

    /// A short, human description of a fetch error ("Offline", "HTTP 503", "Timed out").
    public static func describe(_ error: Error) -> String {
        if let e = error as? WeatherClientError {
            switch e {
            case .http(status: let status): return "HTTP \(status)"
            case .notHTTP: return "Not an HTTP response"
            }
        }
        if let e = error as? URLError {
            switch e.code {
            case .notConnectedToInternet: return "Offline"
            case .timedOut: return "Timed out"
            case .cannotFindHost, .dnsLookupFailed: return "Can't find server"
            case .networkConnectionLost: return "Connection lost"
            case .cancelled: return "Cancelled"
            default: return "Network error \(e.code.rawValue)"
            }
        }
        if error is DecodingError { return "Unreadable data" }
        return String(describing: error).prefix(80).description
    }

    /// "2 in force: Heavy Rain Warning - Orange; Strong Wind Watch" / "None in force".
    public static func describe(_ fetch: WarningFetch) -> String {
        let base = fetch.warnings.isEmpty
            ? "None in force"
            : "\(fetch.warnings.count) in force: " + fetch.warnings.map(\.headline).joined(separator: "; ")
        return fetch.complete ? base : base + " (some alerts didn't load)"
    }
}
