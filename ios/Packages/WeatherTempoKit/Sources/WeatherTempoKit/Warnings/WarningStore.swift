import Foundation

/// The last warnings fetched for each location, in the App Group defaults the app and the
/// widget share. The widget falls back to these when its own MetService fetch fails, and the
/// app shows them straight away at launch, before the first fetch lands.
///
/// The polygons are dropped: the list is already filtered to the location, and they are the
/// only bulky part of an alert.
public enum WarningStore {
    static func key(_ locationID: String) -> String { "weatherTempo.warnings.\(locationID)" }

    public static func save(_ warnings: [WeatherWarning], locationID: String, in store: KeyValueStoring) {
        let slim = warnings.map {
            WeatherWarning(id: $0.id, headline: $0.headline, event: $0.event, level: $0.level,
                           onset: $0.onset, expires: $0.expires, areaDescription: $0.areaDescription,
                           details: $0.details, instruction: $0.instruction, web: $0.web, polygons: [])
        }
        guard let data = try? JSONEncoder().encode(slim), let json = String(data: data, encoding: .utf8) else { return }
        store.saveString(json, for: key(locationID))
    }

    /// Saved warnings still in force at `now`, most severe first.
    public static func load(locationID: String, in store: KeyValueStoring, now: Date) -> [WeatherWarning] {
        guard let json = store.loadString(key(locationID)), let data = json.data(using: .utf8),
              let saved = try? JSONDecoder().decode([WeatherWarning].self, from: data) else { return [] }
        return saved.filter { $0.isCurrent(at: now) }.ordered()
    }
}

extension WeatherWarning {
    /// The headline without MetService's colour suffix ("Heavy Rain Warning - Orange" →
    /// "Heavy Rain Warning"), for places where the colour is already shown.
    public var shortHeadline: String { Self.shortHeadline(headline) }
}
