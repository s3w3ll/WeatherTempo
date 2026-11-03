import Foundation

/// What the user wants to be told about. Stored as JSON under one key so the app and any
/// future extension read the same thing.
public struct AlertSettings: Codable, Equatable, Sendable {
    /// Notify when the forecast temperature rises above `tempHigh`.
    public var tempHighEnabled = false
    public var tempHigh = 25.0
    /// Notify when the forecast temperature falls below `tempLow`.
    public var tempLowEnabled = false
    public var tempLow = 3.0

    /// Notify when the forecast UV index reaches `uvThreshold`.
    public var uvEnabled = false
    /// Shared by the UV alert and the daily summary. 3 is where sun protection starts to matter.
    public var uvThreshold = 3.0

    /// A morning summary, sent only on days the forecast UV reaches `uvThreshold`.
    public var dailyUVEnabled = false
    /// Minutes after local midnight (420 = 7:00am), in the selected location's time zone.
    public var dailyUVMinutes = 7 * 60

    public init() {}

    public static let storeKey = "weatherTempo.alerts"
    public static let tempRange = -10.0...45.0
    public static let uvRange = 1.0...11.0

    public var anyEnabled: Bool { tempHighEnabled || tempLowEnabled || uvEnabled || dailyUVEnabled }

    /// Clamps hand-edited or corrupt values back into sensible bounds.
    public func sanitized() -> AlertSettings {
        var s = self
        s.tempHigh = min(max(s.tempHigh, Self.tempRange.lowerBound), Self.tempRange.upperBound)
        s.tempLow = min(max(s.tempLow, Self.tempRange.lowerBound), Self.tempRange.upperBound)
        s.uvThreshold = min(max(s.uvThreshold, Self.uvRange.lowerBound), Self.uvRange.upperBound)
        s.dailyUVMinutes = min(max(s.dailyUVMinutes, 0), 24 * 60 - 1)
        return s
    }

    public static func load(from store: KeyValueStoring) -> AlertSettings {
        guard let json = store.loadString(storeKey), let data = json.data(using: .utf8),
              let decoded = try? JSONDecoder().decode(AlertSettings.self, from: data) else { return AlertSettings() }
        return decoded.sanitized()
    }

    public func save(to store: KeyValueStoring) {
        guard let data = try? JSONEncoder().encode(self), let json = String(data: data, encoding: .utf8) else { return }
        store.saveString(json, for: Self.storeKey)
    }
}
