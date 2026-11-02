import Foundation
import Testing
@testable import WeatherTempoKit

private actor CallCounter {
    private(set) var count = 0
    func next() -> Int { count += 1; return count }
}

private func response(_ status: Int, url: URL) -> HTTPURLResponse {
    HTTPURLResponse(url: url, statusCode: status, httpVersion: nil, headerFields: nil)!
}

@Suite struct WeatherClientTests {
    @Test func buildsRequestWithLocationQuery() async {
        let client = WeatherClient(load: { _ in throw WeatherClientError.notHTTP })
        let req = await client.request(locationID: "christchurch")
        #expect(req.url?.absoluteString.hasSuffix("?location=christchurch") == true)
        #expect(req.cachePolicy == .reloadIgnoringLocalCacheData)
        #expect(req.timeoutInterval == 10)
    }

    @Test func retriesTransientFailureThenSucceeds() async throws {
        let body = try Fixture.data("worker-sparse")
        let counter = CallCounter()
        let client = WeatherClient(maxAttempts: 3, retryDelay: .milliseconds(1)) { req in
            let n = await counter.next()
            if n < 3 { return (Data(), response(503, url: req.url!)) }
            return (body, response(200, url: req.url!))
        }
        let payload = try await client.fetch(locationID: "christchurch")
        #expect(payload.hourly.count == 1)
        #expect(await counter.count == 3)
    }

    @Test func doesNotRetryClientErrors() async {
        let counter = CallCounter()
        let client = WeatherClient(maxAttempts: 3, retryDelay: .milliseconds(1)) { req in
            _ = await counter.next()
            return (Data(), response(400, url: req.url!))
        }
        await #expect(throws: WeatherClientError.http(status: 400)) {
            try await client.fetch(locationID: "nowhere")
        }
        #expect(await counter.count == 1)
    }

    @Test func givesUpAfterMaxAttempts() async {
        let counter = CallCounter()
        let client = WeatherClient(maxAttempts: 2, retryDelay: .milliseconds(1)) { req in
            _ = await counter.next()
            return (Data(), response(500, url: req.url!))
        }
        await #expect(throws: WeatherClientError.http(status: 500)) {
            try await client.fetch(locationID: "christchurch")
        }
        #expect(await counter.count == 2)
    }

    @Test func emptyHourlyIsTreatedAsFailure() async throws {
        let json = #"{"meta":{"updated":"2026-05-21T19:25:43Z"},"current":{},"hourly":[],"daily":[]}"#
        let client = WeatherClient(maxAttempts: 1) { req in
            (Data(json.utf8), response(200, url: req.url!))
        }
        await #expect(throws: PayloadError.emptyHourly) {
            try await client.fetch(locationID: "christchurch")
        }
    }
}
