import Foundation

/// Mirrors the JSON returned by `workers/pws-proxy.js`.
///
/// Decoding rules (the Worker is loosely typed, so the client is lenient):
/// - every number is `Double`; the Worker mixes ints and floats
/// - almost everything is optional; Open-Meteo can return nulls and the
///   `meta.sourceStatus` block was added after the first payloads shipped
/// - only `hourly[].validTimeUtc` is required, because a row without a
///   timestamp can't be placed on the chart
public struct WeatherPayload: Codable, Sendable, Equatable {
    public var meta: Meta
    public var current: Current
    public var today: Today?
    public var hourly: [Hour]
    public var daily: [Day]

    public struct Meta: Codable, Sendable, Equatable {
        public var updated: String
        public var location: String?
        public var lat: Double?
        public var lon: Double?
        public var sourceStatus: SourceStatus?
    }

    public struct SourceStatus: Codable, Sendable, Equatable {
        public var openMeteo: String?
        public var pws: String?
        public var currentSource: String?
    }

    public struct Current: Codable, Sendable, Equatable {
        public var temp: Double?
        public var feelsLike: Double?
        public var humidity: Double?
        public var pressure: Double?
        public var windSpeed: Double?
        public var windGust: Double?
        public var windDirection: Double?
        public var windCardinal: String?
        public var uvIndex: Double?
        public var dewPoint: Double?
        public var solarRad: Double?
        public var condition: String?
        public var cloudPhrase: String?
        public var iconCode: Int?
        public var sunriseUtc: Double?
        public var sunsetUtc: Double?
        public var tempMax24h: Double?
        public var tempMin24h: Double?
    }

    public struct Today: Codable, Sendable, Equatable {
        public var moonPhase: String?
        public var moonPhaseCode: String?
        public var moonPhaseDay: Int?
    }

    public struct Hour: Codable, Sendable, Equatable {
        public var validTimeUtc: Double
        public var temperature: Double?
        public var temperatureFeelsLike: Double?
        public var relativeHumidity: Double?
        public var windSpeed: Double?
        public var windDirection: Double?
        public var windDirectionCardinal: String?
        public var windGust: Double?
        public var cloudCover: Double?
        public var qpf: Double?
        public var precipChance: Double?
        public var precipType: String?
        public var pressureMeanSeaLevel: Double?
        public var uvIndex: Double?
        public var iconCode: Int?
        public var dayOrNight: String?
        public var wxPhraseMedium: String?

        public var date: Date { Date(timeIntervalSince1970: validTimeUtc) }
    }

    public struct Day: Codable, Sendable, Equatable {
        public var calendarDayTemperatureMax: Double?
        public var calendarDayTemperatureMin: Double?
        public var temperatureMax: Double?
        public var temperatureMin: Double?
        public var sunriseTimeUtc: Double?
        public var sunsetTimeUtc: Double?
    }
}

// MARK: - Freshness & validation

public enum PayloadError: Error, Equatable {
    case emptyHourly
    case unparseableTimestamp(String)
}

extension WeatherPayload {
    /// The web app flags data older than 45 minutes (see CLAUDE.md "Verify data freshness").
    public static let staleAfter: TimeInterval = 45 * 60

    /// `meta.updated` comes from the Worker's JS `toISOString()` (`…43.123Z`), but
    /// the old Python pipeline wrote microseconds with an offset (`…43.624884+00:00`).
    /// Foundation's handling of >3 fractional digits isn't something to rely on, so
    /// trim to milliseconds first, then fall back to the no-fraction form.
    public var updatedDate: Date? {
        let trimmed = meta.updated.replacingOccurrences(
            of: #"(\.\d{3})\d+"#, with: "$1", options: .regularExpression)

        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = withFraction.date(from: trimmed) { return d }

        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return plain.date(from: trimmed)
    }

    public func age(now: Date = Date()) -> TimeInterval? {
        updatedDate.map { now.timeIntervalSince($0) }
    }

    /// Stale = older than the threshold, or the Worker says the PWS reading is stale.
    /// An unparseable timestamp counts as stale: better a banner than silent bad data.
    public func isStale(now: Date = Date()) -> Bool {
        if meta.sourceStatus?.pws == "stale" { return true }
        guard let age = age(now: now) else { return true }
        return age > Self.staleAfter
    }

    /// Mirrors the "well-formed" check in `DataFetcher` (src/app.js).
    public func validate() throws {
        guard !hourly.isEmpty else { throw PayloadError.emptyHourly }
        guard updatedDate != nil else { throw PayloadError.unparseableTimestamp(meta.updated) }
    }
}
