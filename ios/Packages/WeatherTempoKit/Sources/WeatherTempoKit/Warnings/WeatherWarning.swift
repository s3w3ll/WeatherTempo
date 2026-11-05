import Foundation

/// A MetService watch or warning (one CAP alert), reduced to what the app shows.
/// Source: MetService public CAP feed, licensed CC BY 4.0, so the UI credits MetService.
public struct WeatherWarning: Codable, Equatable, Identifiable, Sendable {
    /// MetService's colour code: yellow = watch / minor, orange = warning, red = take action now.
    public enum Level: String, Codable, Sendable, Comparable, CaseIterable {
        case yellow, orange, red

        public static func < (a: Level, b: Level) -> Bool { a.rank < b.rank }
        private var rank: Int { switch self { case .yellow: 0; case .orange: 1; case .red: 2 } }

        /// What VoiceOver says for the colour.
        public var spokenName: String {
            switch self {
            case .yellow: return "Yellow alert"
            case .orange: return "Orange warning"
            case .red: return "Red warning"
            }
        }

        /// From the CAP `ColourCode` parameter, falling back to the CAP severity.
        init(colourCode: String?, severity: String?) {
            switch colourCode?.lowercased() {
            case "red": self = .red
            case "orange": self = .orange
            case "yellow": self = .yellow
            default:
                switch severity?.lowercased() {
                case "extreme": self = .red
                case "severe": self = .orange
                default: self = .yellow
                }
            }
        }
    }

    public struct Point: Codable, Equatable, Sendable {
        public let lat: Double
        public let lon: Double
        public init(lat: Double, lon: Double) { self.lat = lat; self.lon = lon }
    }

    public let id: String
    /// "Heavy Rain Warning - Orange", "Severe Thunderstorm Watch"
    public let headline: String
    /// CAP event: "rain", "wind", "thunderstorm", "snow"…
    public let event: String
    public let level: Level
    public let onset: Date?
    public let expires: Date?
    /// "Canterbury Plains, Christchurch"
    public let areaDescription: String
    public let details: String
    public let instruction: String?
    public let web: URL?
    public let polygons: [[Point]]

    public init(id: String, headline: String, event: String, level: Level, onset: Date?, expires: Date?,
                areaDescription: String, details: String, instruction: String? = nil, web: URL? = nil,
                polygons: [[Point]]) {
        self.id = id; self.headline = headline; self.event = event; self.level = level
        self.onset = onset; self.expires = expires; self.areaDescription = areaDescription
        self.details = details; self.instruction = instruction; self.web = web; self.polygons = polygons
    }

    /// Still in force (or yet to start) at `now`. No expiry counts as current.
    public func isCurrent(at now: Date) -> Bool { expires.map { $0 > now } ?? true }

    /// True when any of the alert's polygons contains the point (ray casting; NZ is far
    /// from the antimeridian's awkward cases except the Chathams, which have their own areas).
    public func covers(latitude: Double, longitude: Double) -> Bool {
        polygons.contains { Self.contains($0, lat: latitude, lon: longitude) }
    }

    static func contains(_ poly: [Point], lat: Double, lon: Double) -> Bool {
        guard poly.count >= 3 else { return false }
        var inside = false
        var j = poly.count - 1
        for i in poly.indices {
            let a = poly[i], b = poly[j]
            if (a.lat > lat) != (b.lat > lat),
               lon < (b.lon - a.lon) * (lat - a.lat) / (b.lat - a.lat) + a.lon {
                inside.toggle()
            }
            j = i
        }
        return inside
    }

    /// "Until 9pm", "Until Sat 3am", "From Fri 12pm to 9pm".
    public func timing(now: Date, timeZone: TimeZone) -> String {
        func when(_ d: Date, relativeTo ref: Date) -> String {
            let cal = TimeFormat.calendar(timeZone)
            let t = TimeFormat.hour(d.timeIntervalSince1970, in: timeZone)
            return cal.isDate(d, inSameDayAs: ref) ? t : "\(TimeFormat.weekday(d.timeIntervalSince1970, in: timeZone, long: false)) \(t)"
        }
        switch (onset, expires) {
        case let (start?, end?) where start > now: return "From \(when(start, relativeTo: now)) to \(when(end, relativeTo: start))"
        case let (start?, nil) where start > now: return "From \(when(start, relativeTo: now))"
        case let (_, end?): return "Until \(when(end, relativeTo: now))"
        default: return "In force now"
        }
    }

    /// The first sentence of the details, for notifications and the collapsed card.
    public var summary: String {
        let text = details.replacingOccurrences(of: "\n", with: " ").trimmingCharacters(in: .whitespaces)
        if let r = text.range(of: ". ") { return String(text[..<r.lowerBound]) + "." }
        return text
    }
}

extension Array where Element == WeatherWarning {
    /// Most severe first, then soonest.
    func ordered() -> [WeatherWarning] {
        sorted { a, b in
            a.level != b.level ? a.level > b.level
                : (a.onset ?? .distantPast) < (b.onset ?? .distantPast)
        }
    }
}
