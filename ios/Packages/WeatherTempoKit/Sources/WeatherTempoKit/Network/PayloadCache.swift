import Foundation

/// Stores the last good payload per location as raw JSON on disk.
///
/// Raw JSON (not a re-encoded model) so a later app version with extra fields
/// can still read what an older one wrote, and vice versa.
/// The app and the widget point this at the same App Group container, so the
/// widget can paint instantly from whatever the app last fetched.
public struct PayloadCache: Sendable {
    public let directory: URL

    public init(directory: URL) {
        self.directory = directory
    }

    /// App Group container if available (app + widget), otherwise the caches dir
    /// (unit tests, previews, or a build without the entitlement).
    public static func shared(appGroup: String = AppGroup.id) -> PayloadCache {
        let fm = FileManager.default
        let base = fm.containerURL(forSecurityApplicationGroupIdentifier: appGroup)
            ?? fm.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        return PayloadCache(directory: base.appendingPathComponent("WeatherTempo", isDirectory: true))
    }

    private func fileURL(for locationID: String) -> URL {
        // Location ids are slugs like "christchurch"; strip anything else so an id
        // can never escape the cache directory.
        let safe = locationID.filter { $0.isLetter || $0.isNumber || $0 == "-" || $0 == "_" }
        return directory.appendingPathComponent("\(safe.isEmpty ? "unknown" : safe).json")
    }

    public func save(data: Data, locationID: String) throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try data.write(to: fileURL(for: locationID), options: .atomic)
    }

    public func save(_ payload: WeatherPayload, locationID: String) throws {
        try save(data: JSONEncoder().encode(payload), locationID: locationID)
    }

    /// Returns nil if nothing is cached or the file no longer decodes.
    public func load(locationID: String) -> WeatherPayload? {
        guard let data = try? Data(contentsOf: fileURL(for: locationID)) else { return nil }
        return try? JSONDecoder().decode(WeatherPayload.self, from: data)
    }
}
