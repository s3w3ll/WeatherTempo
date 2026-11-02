import Foundation
import Testing
@testable import WeatherTempoKit

@Suite struct PayloadCacheTests {
    private func tempCache() -> PayloadCache {
        PayloadCache(directory: FileManager.default.temporaryDirectory
            .appendingPathComponent("wt-cache-\(UUID().uuidString)", isDirectory: true))
    }

    @Test func roundTrips() throws {
        let cache = tempCache()
        let payload = try JSONDecoder().decode(WeatherPayload.self, from: Fixture.data("worker-full"))
        try cache.save(payload, locationID: "christchurch")
        #expect(cache.load(locationID: "christchurch") == payload)
    }

    @Test func missingEntryIsNil() {
        #expect(tempCache().load(locationID: "auckland") == nil)
    }

    @Test func corruptFileIsNilNotACrash() throws {
        let cache = tempCache()
        try cache.save(data: Data("not json".utf8), locationID: "auckland")
        #expect(cache.load(locationID: "auckland") == nil)
    }

    @Test func locationIDCannotEscapeDirectory() throws {
        let cache = tempCache()
        let payload = try JSONDecoder().decode(WeatherPayload.self, from: Fixture.data("worker-sparse"))
        try cache.save(payload, locationID: "../../evil")
        let files = try FileManager.default.contentsOfDirectory(atPath: cache.directory.path)
        #expect(files == ["evil.json"])
    }
}
