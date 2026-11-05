import Foundation

/// Fetches MetService's current watches and warnings and keeps the ones covering a place.
///
/// The RSS index is small and lists every alert in the country; each alert's polygon is
/// only in its CAP document, so those are fetched too (in parallel) and cached by URL,
/// since a published CAP alert never changes (updates get a new identifier).
public actor WarningClient {
    public typealias DataLoader = @Sendable (URLRequest) async throws -> (Data, URLResponse)

    public static let feedURL = URL(string: "https://alerts.metservice.com/cap/rss")!

    private let load: DataLoader
    private struct Entry { let warning: WeatherWarning? }
    private var cache: [URL: Entry] = [:]

    public init(load: @escaping DataLoader = { try await URLSession.shared.data(for: $0) }) {
        self.load = load
    }

    private static func request(_ url: URL) -> URLRequest {
        var r = URLRequest(url: url)
        r.timeoutInterval = 10
        r.cachePolicy = .reloadIgnoringLocalCacheData
        return r
    }

    /// Current alerts whose area contains the point, most severe first.
    public func warnings(latitude: Double, longitude: Double, now: Date) async throws -> [WeatherWarning] {
        try await fetch(latitude: latitude, longitude: longitude, now: now).warnings
    }

    /// As `warnings`, plus whether every alert in the feed could be read.
    public func fetch(latitude: Double, longitude: Double, now: Date) async throws -> WarningFetch {
        let (data, response) = try await load(Self.request(Self.feedURL))
        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            throw WeatherClientError.http(status: http.statusCode)
        }
        let links = CAPParser.alertLinks(data)

        let missing = links.filter { cache[$0] == nil }
        let load = self.load
        let fetched = await withTaskGroup(of: (URL, WeatherWarning?)?.self) { group in
            for url in missing {
                group.addTask {
                    guard let (d, _) = try? await load(Self.request(url)) else { return nil }   // retry next time
                    return (url, CAPParser.warning(d))
                }
            }
            var out: [(URL, WeatherWarning?)] = []
            for await r in group { if let r { out.append(r) } }
            return out
        }
        for (url, w) in fetched { cache[url] = Entry(warning: w) }
        // Forget alerts that have left the feed.
        let live = Set(links)
        cache = cache.filter { live.contains($0.key) }

        let warnings = links.compactMap { cache[$0]?.warning }
            .filter { $0.isCurrent(at: now) && $0.covers(latitude: latitude, longitude: longitude) }
            .ordered()
        return WarningFetch(warnings: warnings, complete: links.allSatisfy { cache[$0] != nil })
    }
}

/// The result of one warnings check.
public struct WarningFetch: Equatable, Sendable {
    /// Current alerts covering the place, most severe first.
    public var warnings: [WeatherWarning]
    /// Every alert in MetService's feed was read. When false, a warning missing from
    /// `warnings` may only have failed to download, so it mustn't be taken as lifted.
    public var complete: Bool

    public init(warnings: [WeatherWarning], complete: Bool = true) {
        self.warnings = warnings
        self.complete = complete
    }
}

/// Runs `body`, keeping its error instead of throwing it (for `async let` alongside other work).
func catching<T: Sendable>(_ body: @Sendable () async throws -> T) async -> Result<T, Error> {
    do { return .success(try await body()) } catch { return .failure(error) }
}
