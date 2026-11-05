import Foundation

/// What the app remembers about a warning it has seen, notified or not, so a reissue of the
/// same warning stays quiet and a lifted one can be reported.
public struct RememberedWarning: Codable, Equatable, Sendable {
    public let id: String
    /// What the warning is about ("rain", "wind"): reissues and upgrades keep it.
    public let hazard: String
    public let headline: String
    public let level: WeatherWarning.Level
    public let expires: Date?
    public let locationID: String
    public var lifted: Bool
}

/// A notification to deliver now.
public struct WarningNotice: Equatable, Sendable {
    public let id: String
    public let title: String
    public let body: String
}

/// Which warnings to notify about, and what the notifications say.
///
/// MetService reissues a warning under a new id every time it updates the text or timing, so
/// "notify each id once" would repeat the same warning several times a day. Instead:
/// - a warning for a hazard that has nothing in force yet notifies (**new**);
/// - a reissue at the same or a lower level is remembered silently;
/// - a reissue at a higher level notifies (**upgraded**, e.g. watch → orange → red);
/// - when a hazard disappears from a complete feed well before its expiry, that notifies
///   too (**lifted**), if the setting is on.
public enum WarningNotifications {
    static let storeKey = "weatherTempo.warningMemory"
    /// Version 1 kept only the ids it had notified.
    static let legacyKey = "weatherTempo.notifiedWarnings"
    static let idPrefix = "weathertempo.warning."
    static let memory = 100
    /// A warning ending within this of the check simply ran its course: not "lifted".
    static let naturalEndMargin: TimeInterval = 30 * 60
    /// A just-expired warning still counts as in force for reissues (MetService sometimes
    /// reissues right at the old expiry).
    static let reissueGrace: TimeInterval = 60 * 60

    // MARK: Decision (pure)

    static func hazard(_ w: WeatherWarning) -> String {
        let e = w.event.trimmingCharacters(in: .whitespaces).lowercased()
        return e.isEmpty ? WeatherWarning.shortHeadline(w.headline).lowercased() : e
    }

    /// The notices for one complete-or-not warnings check, and the updated memory.
    static func decide(
        _ fetch: WarningFetch, locationID: String, placeName: String, timeZone: TimeZone,
        memory: [RememberedWarning], legacyIDs: Set<String> = [], liftedEnabled: Bool, now: Date
    ) -> (notices: [WarningNotice], memory: [RememberedWarning]) {
        var mem = memory
        var notices: [WarningNotice] = []

        func inForce(_ r: RememberedWarning) -> Bool {
            r.locationID == locationID && !r.lifted && (r.expires.map { $0 > now.addingTimeInterval(-reissueGrace) } ?? true)
        }

        // Most severe first, so of two new alerts for one hazard only the higher notifies.
        for w in fetch.warnings.ordered() {
            guard !mem.contains(where: { $0.id == w.id }) else { continue }
            let key = hazard(w)
            let earlier = mem.filter { inForce($0) && $0.hazard == key }
            mem.append(RememberedWarning(id: w.id, hazard: key, headline: w.headline, level: w.level,
                                         expires: w.expires, locationID: locationID, lifted: false))
            if legacyIDs.contains(w.id) { continue }       // notified by the previous version

            let timing = w.timing(now: now, timeZone: timeZone)
            if let top = earlier.map(\.level).max() {
                guard w.level > top else { continue }       // a reissue: stay quiet
                notices.append(WarningNotice(
                    id: idPrefix + w.id, title: "\(w.headline) – \(placeName)",
                    body: "Upgraded from \(top.name.lowercased()). \(timing). \(w.summary)"))
            } else {
                notices.append(WarningNotice(
                    id: idPrefix + w.id, title: "\(w.headline) – \(placeName)",
                    body: "\(timing). \(w.summary)"))
            }
        }

        // Lifted: a hazard we were tracking has gone from a feed we read in full, while it
        // still had a while to run.
        if fetch.complete && liftedEnabled {
            let current = Set(fetch.warnings.map(hazard))
            let gone = mem.filter {
                $0.locationID == locationID && !$0.lifted && !current.contains($0.hazard)
                    && ($0.expires.map { $0 > now.addingTimeInterval(naturalEndMargin) } ?? true)
            }
            for key in Set(gone.map(\.hazard)).sorted() {
                let chain = gone.filter { $0.hazard == key }
                guard let top = chain.max(by: { $0.level < $1.level }) else { continue }
                let short = WeatherWarning.shortHeadline(top.headline)
                notices.append(WarningNotice(
                    id: idPrefix + "lifted." + top.id, title: "\(short) lifted – \(placeName)",
                    body: "MetService no longer has the \(top.headline) in force for \(placeName)."))
                for i in mem.indices where mem[i].locationID == locationID && mem[i].hazard == key {
                    mem[i].lifted = true
                }
            }
        }

        // Forget long-gone warnings first, then cap.
        let cutoff = now.addingTimeInterval(-7 * 86_400)
        mem = mem.filter { $0.expires.map { $0 > cutoff } ?? true }
        return (notices, Array(mem.suffix(Self.memory)))
    }

    // MARK: Store

    static func remembered(in store: KeyValueStoring) -> [RememberedWarning] {
        guard let json = store.loadString(storeKey), let data = json.data(using: .utf8) else { return [] }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .secondsSince1970
        return (try? decoder.decode([RememberedWarning].self, from: data)) ?? []
    }

    static func save(_ memory: [RememberedWarning], in store: KeyValueStoring) {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .secondsSince1970
        guard let data = try? encoder.encode(memory), let json = String(data: data, encoding: .utf8) else { return }
        store.saveString(json, for: storeKey)
    }

    static func legacyIDs(in store: KeyValueStoring) -> Set<String> {
        guard let json = store.loadString(legacyKey), let data = json.data(using: .utf8),
              let ids = try? JSONDecoder().decode([String].self, from: data) else { return [] }
        return Set(ids)
    }

    /// Forget everything (diagnostics): the next check notifies whatever is in force.
    public static func forget(in store: KeyValueStoring = AppGroup.defaults) {
        save([], in: store)
        store.saveString("[]", for: legacyKey)
    }

    /// Decides what to notify for a fetch and records it. Callers deliver the notices.
    public static func process(
        _ fetch: WarningFetch, location: Location, settings: AlertSettings,
        store: KeyValueStoring, now: Date
    ) -> [WarningNotice] {
        guard settings.warningsEnabled else { return [] }
        let result = decide(fetch, locationID: location.id, placeName: location.name, timeZone: location.timeZone,
                            memory: remembered(in: store), legacyIDs: legacyIDs(in: store),
                            liftedEnabled: settings.warningLiftedEnabled, now: now)
        save(result.memory, in: store)
        return result.notices
    }
}

extension WeatherWarning {
    /// "Heavy Rain Warning - Orange" → "Heavy Rain Warning".
    static func shortHeadline(_ headline: String) -> String {
        for level in Level.allCases {
            for dash in [" - ", " – ", " — "] {
                let suffix = dash + level.rawValue
                if headline.lowercased().hasSuffix(suffix.lowercased()) {
                    return String(headline.dropLast(suffix.count))
                }
            }
        }
        return headline
    }
}
