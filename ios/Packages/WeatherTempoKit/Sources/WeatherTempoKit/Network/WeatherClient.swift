import Foundation

public enum WeatherClientError: Error, Equatable {
    case http(status: Int)
    case notHTTP
}

/// Fetches the payload from the Cloudflare Worker, with timeout + retry like
/// `DataFetcher.fetchFromWorker` in src/app.js.
///
/// The network call is injected (`DataLoader`) so tests can run without a network.
public actor WeatherClient {
    public typealias DataLoader = @Sendable (URLRequest) async throws -> (Data, URLResponse)

    public static let defaultBaseURL = URL(string: "https://weathertempo-pws-proxy.forgesync.workers.dev")!

    private let baseURL: URL
    private let maxAttempts: Int
    private let retryDelay: Duration
    private let load: DataLoader

    public init(
        baseURL: URL = WeatherClient.defaultBaseURL,
        maxAttempts: Int = 3,
        retryDelay: Duration = .milliseconds(500),
        load: @escaping DataLoader = { try await URLSession.shared.data(for: $0) }
    ) {
        self.baseURL = baseURL
        self.maxAttempts = max(1, maxAttempts)
        self.retryDelay = retryDelay
        self.load = load
    }

    public func request(locationID: String) -> URLRequest {
        var comps = URLComponents(url: baseURL, resolvingAgainstBaseURL: false)!
        comps.queryItems = [URLQueryItem(name: "location", value: locationID)]
        var req = URLRequest(url: comps.url!)
        req.timeoutInterval = 10
        req.cachePolicy = .reloadIgnoringLocalCacheData  // the Worker sends Cache-Control: no-store
        return req
    }

    /// Fetches, decodes and validates. Retries transient failures (network errors,
    /// 5xx, bad payload) with a growing delay; 4xx fails immediately because
    /// retrying an unknown-location error can never succeed.
    public func fetch(locationID: String) async throws -> WeatherPayload {
        let req = request(locationID: locationID)
        var lastError: Error = WeatherClientError.notHTTP

        for attempt in 1...maxAttempts {
            do {
                let (data, response) = try await load(req)
                guard let http = response as? HTTPURLResponse else { throw WeatherClientError.notHTTP }
                guard (200..<300).contains(http.statusCode) else {
                    throw WeatherClientError.http(status: http.statusCode)
                }
                let payload = try JSONDecoder().decode(WeatherPayload.self, from: data)
                try payload.validate()
                return payload
            } catch {
                lastError = error
                if case WeatherClientError.http(let status) = error, (400..<500).contains(status) {
                    throw error
                }
                if attempt < maxAttempts {
                    try await Task.sleep(for: retryDelay * attempt)
                }
            }
        }
        throw lastError
    }
}
