import Foundation

public struct StatusBanner: Equatable {
    public enum Level: String, Equatable { case info, warning, error }
    public let level: Level
    public let message: String

    public init(_ level: Level, _ message: String) {
        self.level = level
        self.message = message
    }
}

/// Decides when the dashboard tells the user the data can't be fully trusted, and how
/// loudly. Kept as one pure function so the whole policy lives (and is tested) in one place.
///
/// Inputs are the payload being shown (live or cached, possibly nil), whether the most
/// recent refresh attempt failed, and the clock.
public enum StatusPolicy {
    public static func banner(
        payload: WeatherPayload?,
        lastRefreshFailed: Bool,
        now: Date = Date(),
        timeZone: TimeZone = MeteogramModel.nzTimeZone
    ) -> StatusBanner? {

        // Nothing to show at all: the one genuinely blocking case.
        guard let payload else {
            return lastRefreshFailed
                ? StatusBanner(.error, "Can't reach the weather service and nothing is saved yet")
                : nil
        }

        let age = payload.age(now: now)
        let ageText = TimeFormat.relative(since: payload.updatedDate, now: now)
        let at = payload.updatedDate.map { TimeFormat.hourMinute($0.timeIntervalSince1970, in: timeZone) }

        // We tried to refresh and couldn't: what's on screen is old.
        if lastRefreshFailed {
            return StatusBanner(.warning, "Offline, showing data from \(at ?? "earlier") (\(ageText))")
        }

        // Worker answered, but a station exists for this place and didn't supply the reading
        // (statuses: ok / no-observation / stale / http-4xx / bad-json / unreachable / n/a).
        if let pws = payload.meta.sourceStatus?.pws, pws != "ok", pws != "n/a" {
            return StatusBanner(.warning, "Live station unavailable, current conditions from forecast model")
        }

        // Worker answered but its data is old (same 45 min threshold as the web app).
        if let age, age > WeatherPayload.staleAfter {
            return StatusBanner(.warning, "Data is \(ageText.replacingOccurrences(of: " ago", with: "")) old")
        }

        return nil
    }
}
