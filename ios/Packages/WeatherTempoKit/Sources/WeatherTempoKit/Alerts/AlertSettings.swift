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

    /// Notify ahead of forecast rain.
    public var rainEnabled = false
    /// An hour counts as rainy when its chance is at least this (and some rain is forecast).
    public var rainChance = 50.0
    /// How long before the rain starts to send the alert.
    public var rainLeadMinutes = 60

    /// Notify as soon as MetService issues a watch or warning covering the location.
    /// On by default: it's a safety feature, and permission is asked the first time one arrives.
    public var warningsEnabled = true
    /// Also notify when MetService lifts a warning well before its planned end.
    public var warningLiftedEnabled = true

    public init() {}

    /// Decodes every field leniently so settings saved by an older build (missing newer
    /// keys) keep their values instead of resetting everything to defaults.
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let d = AlertSettings()
        tempHighEnabled = try c.decodeIfPresent(Bool.self, forKey: .tempHighEnabled) ?? d.tempHighEnabled
        tempHigh = try c.decodeIfPresent(Double.self, forKey: .tempHigh) ?? d.tempHigh
        tempLowEnabled = try c.decodeIfPresent(Bool.self, forKey: .tempLowEnabled) ?? d.tempLowEnabled
        tempLow = try c.decodeIfPresent(Double.self, forKey: .tempLow) ?? d.tempLow
        uvEnabled = try c.decodeIfPresent(Bool.self, forKey: .uvEnabled) ?? d.uvEnabled
        uvThreshold = try c.decodeIfPresent(Double.self, forKey: .uvThreshold) ?? d.uvThreshold
        dailyUVEnabled = try c.decodeIfPresent(Bool.self, forKey: .dailyUVEnabled) ?? d.dailyUVEnabled
        dailyUVMinutes = try c.decodeIfPresent(Int.self, forKey: .dailyUVMinutes) ?? d.dailyUVMinutes
        rainEnabled = try c.decodeIfPresent(Bool.self, forKey: .rainEnabled) ?? d.rainEnabled
        rainChance = try c.decodeIfPresent(Double.self, forKey: .rainChance) ?? d.rainChance
        rainLeadMinutes = try c.decodeIfPresent(Int.self, forKey: .rainLeadMinutes) ?? d.rainLeadMinutes
        warningsEnabled = try c.decodeIfPresent(Bool.self, forKey: .warningsEnabled) ?? d.warningsEnabled
        warningLiftedEnabled = try c.decodeIfPresent(Bool.self, forKey: .warningLiftedEnabled) ?? d.warningLiftedEnabled
    }

    public static let storeKey = "weatherTempo.alerts"
    public static let tempRange = -10.0...45.0
    public static let uvRange = 1.0...11.0
    public static let rainChanceRange = 10.0...90.0
    public static let rainLeadOptions = [30, 60, 120, 180]

    public var anyEnabled: Bool { tempHighEnabled || tempLowEnabled || uvEnabled || dailyUVEnabled || rainEnabled }

    /// Clamps hand-edited or corrupt values back into sensible bounds.
    public func sanitized() -> AlertSettings {
        var s = self
        s.tempHigh = min(max(s.tempHigh, Self.tempRange.lowerBound), Self.tempRange.upperBound)
        s.tempLow = min(max(s.tempLow, Self.tempRange.lowerBound), Self.tempRange.upperBound)
        s.uvThreshold = min(max(s.uvThreshold, Self.uvRange.lowerBound), Self.uvRange.upperBound)
        s.dailyUVMinutes = min(max(s.dailyUVMinutes, 0), 24 * 60 - 1)
        s.rainChance = min(max(s.rainChance, Self.rainChanceRange.lowerBound), Self.rainChanceRange.upperBound)
        s.rainLeadMinutes = min(max(s.rainLeadMinutes, 0), 6 * 60)
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
