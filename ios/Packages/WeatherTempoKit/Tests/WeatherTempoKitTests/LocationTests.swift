import Foundation
import Testing
@testable import WeatherTempoKit

@Suite struct LocationTests {
    /// Fixtures/locations-golden.json is src/locations.js evaluated under node.
    @Test func matchesLocationsJS() throws {
        let golden = try JSONDecoder().decode([Location].self, from: Fixture.data("locations-golden"))
        #expect(Location.all == golden)
        #expect(Location.all.count == 24)
    }

    @Test func idsAreUnique() {
        let ids = Location.all.map(\.id)
        #expect(Set(ids).count == ids.count)
    }

    @Test func everyTidePortHasConstants() {
        for l in Location.all where l.tidePort != nil {
            #expect(l.hasTides, "\(l.id) -> \(l.tidePort!) has no constants")
        }
    }

    @Test func inlandLocationsHaveNoTides() {
        let hamilton = Location.named("hamilton")
        #expect(hamilton.tidePort == nil)
        #expect(!hamilton.hasTides)
    }

    @Test func christchurchIsTheOnlyPWSLocationAndUsesLyttelton() {
        let pws = Location.all.filter { $0.pwsStation != nil }
        #expect(pws.map(\.id) == ["christchurch"])
        let chc = Location.named("christchurch")
        #expect(chc.pwsStation == "ICHRIS810")
        #expect(chc.tidePort == "lyttelton")
        #expect(chc.tideLabel == "New Brighton Beach — Tides")
    }

    @Test func unknownOrNilFallsBackToChristchurch() {
        #expect(Location.named("atlantis").id == "christchurch")
        #expect(Location.named(nil).id == "christchurch")
        #expect(Location.named("dunedin").id == "dunedin")
    }

    @Test func timeZonesResolve() {
        for l in Location.all {
            #expect(TimeZone(identifier: l.timezone) != nil, "\(l.id): \(l.timezone)")
        }
    }
}
