import Foundation

/// A supported place. The list itself lives in `LocationData.generated.swift`,
/// generated from `src/locations.js` (the web app's single source of truth), so
/// ids stay identical to the Worker's `?location=<id>` keys.
public struct Location: Identifiable, Hashable, Codable, Sendable {
    public let id: String
    public let name: String
    public let region: String
    public let lat: Double
    public let lon: Double
    public let timezone: String
    /// Weather Underground PWS station; nil = Open-Meteo only (Christchurch is the only one).
    public let pwsStation: String?
    /// Key into `TidePort.all`; nil = inland, hide the tides panel.
    public let tidePort: String?
    public let tideLabel: String?

    public static let defaultID = "christchurch"

    /// Mirrors `getLocation()` in locations.js: unknown or nil ids fall back to Christchurch.
    public static func named(_ id: String?) -> Location {
        all.first { $0.id == id } ?? all.first { $0.id == defaultID }!
    }

    public var timeZone: TimeZone { TimeZone(identifier: timezone) ?? .current }
    public var hasTides: Bool { tideData != nil }
    public var tideData: TidePort? { tidePort.flatMap { TidePort.all[$0] } }
}
