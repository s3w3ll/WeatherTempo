import Foundation
import Testing
@testable import WeatherTempoKit

private let chc = Location.named(Location.defaultID)
private let nz = MeteogramModel.nzTimeZone
/// Thu 5 Nov 2026, 8pm NZDT.
private let thursdayEvening = ISO8601DateFormatter().date(from: "2026-11-05T07:00:00Z")!

/// A CAP 1.2 alert shaped like MetService's (signature block included, since the parser
/// has to skip it).
func capXML(id: String, headline: String = "Heavy Rain Warning - Orange", colour: String? = "Orange",
            severity: String = "Severe", msgType: String = "Alert", status: String = "Actual",
            onset: String = "2026-11-06T09:00:00+13:00", expires: String = "2026-11-07T03:00:00+13:00",
            area: String = "Canterbury Plains,Christchurch",
            polygon: String = "-43.30,172.30 -43.30,173.00 -43.80,173.00 -43.80,172.30 -43.30,172.30") -> Data {
    let colourParam = colour.map {
        "<parameter><valueName>ColourCode</valueName><value>\($0)</value></parameter>"
    } ?? ""
    return Data("""
    <?xml version="1.0" encoding="UTF-8" standalone="no"?><alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">\
    <identifier>\(id)</identifier><sender>https://www.metservice.com</sender><sent>2026-11-05T20:18:59+13:00</sent>\
    <status>\(status)</status><msgType>\(msgType)</msgType><scope>Public</scope><info><category>Met</category>\
    <event>rain</event><responseType>Prepare</responseType><urgency>Expected</urgency><severity>\(severity)</severity>\
    <certainty>Likely</certainty><onset>\(onset)</onset><expires>\(expires)</expires>\
    <senderName>Meteorological Service of New Zealand Limited</senderName><headline>\(headline)</headline>\
    <description>Periods of heavy rain. Expect 80 to 100 mm about the foothills.

    Streams and rivers may rise rapidly.</description>\
    <instruction>Avoid driving through flood water.</instruction><web>https://metservice.com/warnings/home</web>\
    \(colourParam)<parameter><valueName>NextUpdate</valueName><value>2026-11-06T11:00:00+13:00</value></parameter>\
    <area><areaDesc>\(area)</areaDesc><polygon>\(polygon)</polygon></area></info>\
    <Signature xmlns="http://www.w3.org/2000/09/xmldsig#"><SignedInfo><DigestValue>abc=</DigestValue></SignedInfo>\
    <SignatureValue>xyz==</SignatureValue></Signature></alert>
    """.utf8)
}

func rssXML(_ ids: [String]) -> Data {
    let items = ids.map {
        "<item><title>Alert</title><guid>\($0)</guid><link>https://alerts.metservice.com/cap/alert?id=\($0)</link></item>"
    }.joined()
    return Data("""
    <?xml version="1.0" encoding="UTF-8" ?><rss version="2.0"><channel><title>Metservice Public CAP Alerts</title>\
    <link>https://www.metservice.com</link>\(items)</channel></rss>
    """.utf8)
}

@Suite struct CAPParserTests {
    @Test func parsesTheFieldsTheAppUses() throws {
        let w = try #require(CAPParser.warning(capXML(id: "a1")))
        #expect(w.id == "a1")
        #expect(w.headline == "Heavy Rain Warning - Orange")
        #expect(w.event == "rain")
        #expect(w.level == .orange)
        #expect(w.onset == ISO8601DateFormatter().date(from: "2026-11-05T20:00:00Z"))
        #expect(w.areaDescription == "Canterbury Plains, Christchurch")
        #expect(w.details.hasPrefix("Periods of heavy rain."))
        #expect(w.instruction == "Avoid driving through flood water.")
        #expect(w.web?.host == "metservice.com")
        #expect(w.polygons.count == 1 && w.polygons[0].count == 5)
    }

    @Test func levelFallsBackToSeverity() throws {
        #expect(CAPParser.warning(capXML(id: "r", colour: "Red"))?.level == .red)
        #expect(CAPParser.warning(capXML(id: "s", colour: nil, severity: "Extreme"))?.level == .red)
        #expect(CAPParser.warning(capXML(id: "m", colour: nil, severity: "Moderate"))?.level == .yellow)
    }

    @Test func cancellationsAndExercisesAreIgnored() {
        #expect(CAPParser.warning(capXML(id: "c", msgType: "Cancel")) == nil)
        #expect(CAPParser.warning(capXML(id: "e", status: "Exercise")) == nil)
        #expect(CAPParser.warning(Data("not xml".utf8)) == nil)
    }

    @Test func rssGivesTheAlertLinks() {
        let links = CAPParser.alertLinks(rssXML(["x", "y"]))
        #expect(links.map(\.absoluteString) == [
            "https://alerts.metservice.com/cap/alert?id=x", "https://alerts.metservice.com/cap/alert?id=y"])
        #expect(CAPParser.alertLinks(rssXML([])).isEmpty)   // the channel's own <link> isn't an alert
    }
}

@Suite struct WeatherWarningTests {
    private func warning(onset: Date? = nil, expires: Date? = nil, polygon: String? = nil) throws -> WeatherWarning {
        let w = try #require(CAPParser.warning(polygon.map { capXML(id: "w", polygon: $0) } ?? capXML(id: "w")))
        return WeatherWarning(id: w.id, headline: w.headline, event: w.event, level: w.level,
                              onset: onset ?? w.onset, expires: expires ?? w.expires,
                              areaDescription: w.areaDescription, details: w.details, polygons: w.polygons)
    }

    @Test func coversPointsInsideItsPolygonOnly() throws {
        let w = try warning()
        #expect(w.covers(latitude: chc.lat, longitude: chc.lon))
        #expect(!w.covers(latitude: -36.85, longitude: 174.76))        // Auckland
        #expect(!w.covers(latitude: -43.55, longitude: 171.9))         // just west of the box
    }

    @Test func concavePolygonsWork() throws {
        // a "C" shape opening east: the notch around lon 172.8 is outside
        let c = "-43.3,172.3 -43.3,173.0 -43.4,173.0 -43.4,172.5 -43.7,172.5 -43.7,173.0 -43.8,173.0 -43.8,172.3"
        let w = try warning(polygon: c)
        #expect(w.covers(latitude: -43.35, longitude: 172.8))
        #expect(!w.covers(latitude: -43.55, longitude: 172.8))
        #expect(w.covers(latitude: -43.55, longitude: 172.4))
    }

    @Test func currentUntilItExpires() throws {
        let w = try warning()       // expires Sat 7 Nov 3am NZDT
        #expect(w.isCurrent(at: thursdayEvening))
        #expect(!w.isCurrent(at: ISO8601DateFormatter().date(from: "2026-11-06T14:00:01Z")!))
    }

    @Test func timingReadsNaturally() throws {
        let w = try warning()       // Fri 9am to Sat 3am
        #expect(w.timing(now: thursdayEvening, timeZone: nz) == "From Fri 9am to Sat 3am")
        let started = ISO8601DateFormatter().date(from: "2026-11-06T02:00:00Z")!   // Fri 3pm
        #expect(w.timing(now: started, timeZone: nz) == "Until Sat 3am")
        let sameDay = try warning(expires: ISO8601DateFormatter().date(from: "2026-11-06T08:00:00Z")!)   // Fri 9pm
        #expect(sameDay.timing(now: started, timeZone: nz) == "Until 9pm")
    }

    @Test func summaryIsTheFirstSentence() throws {
        #expect(try warning().summary == "Periods of heavy rain.")
    }

    @Test func orderedMostSevereFirst() throws {
        let base = try warning()
        func with(_ id: String, _ level: WeatherWarning.Level, _ hoursIn: Double) -> WeatherWarning {
            WeatherWarning(id: id, headline: id, event: "", level: level,
                           onset: thursdayEvening.addingTimeInterval(hoursIn * 3600), expires: nil,
                           areaDescription: "", details: "", polygons: base.polygons)
        }
        let sorted = [with("y", .yellow, 1), with("o2", .orange, 5), with("o1", .orange, 2)].ordered()
        #expect(sorted.map(\.id) == ["o1", "o2", "y"])
    }
}

@Suite struct WarningClientTests {
    final class Counter: @unchecked Sendable {
        var urls: [String] = []
        let lock = NSLock()
        func add(_ u: String) { lock.lock(); urls.append(u); lock.unlock() }
    }

    private func client(feed: [String], alerts: [String: Data], counter: Counter) -> WarningClient {
        WarningClient { req in
            let url = req.url!.absoluteString
            counter.add(url)
            let ok = HTTPURLResponse(url: req.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
            if url == WarningClient.feedURL.absoluteString { return (rssXML(feed), ok) }
            let id = String(url.split(separator: "=").last!)
            guard let d = alerts[id] else { throw URLError(.badServerResponse) }
            return (d, ok)
        }
    }

    @Test func keepsOnlyCurrentAlertsCoveringThePlace() async throws {
        let counter = Counter()
        let c = client(feed: ["here", "auckland", "expired", "broken"], alerts: [
            "here": capXML(id: "here"),
            "auckland": capXML(id: "auckland", polygon: "-36.5,174.5 -36.5,175.0 -37.0,175.0 -37.0,174.5"),
            "expired": capXML(id: "expired", expires: "2026-11-05T12:00:00+13:00"),
        ], counter: counter)
        let found = try await c.warnings(latitude: chc.lat, longitude: chc.lon, now: thursdayEvening)
        #expect(found.map(\.id) == ["here"])
    }

    @Test func alertDocumentsAreFetchedOnce() async throws {
        let counter = Counter()
        let c = client(feed: ["here"], alerts: ["here": capXML(id: "here")], counter: counter)
        _ = try await c.warnings(latitude: chc.lat, longitude: chc.lon, now: thursdayEvening)
        _ = try await c.warnings(latitude: chc.lat, longitude: chc.lon, now: thursdayEvening)
        #expect(counter.urls.filter { $0.contains("id=here") }.count == 1)
        #expect(counter.urls.filter { $0 == WarningClient.feedURL.absoluteString }.count == 2)
    }
}

@Suite struct WarningNotificationTests {
    @Test func eachAlertIsNotifiedOnce() throws {
        let w = try #require(CAPParser.warning(capXML(id: "n1")))
        let store = InMemoryStore()
        #expect(WarningNotifications.toNotify([w], notified: WarningNotifications.notified(in: store)).count == 1)
        WarningNotifications.markNotified([w], in: store)
        #expect(WarningNotifications.toNotify([w], notified: WarningNotifications.notified(in: store)).isEmpty)
    }

    @Test func memoryIsBounded() throws {
        let store = InMemoryStore()
        let many = (0..<150).map { i in
            WeatherWarning(id: "id\(i)", headline: "", event: "", level: .yellow, onset: nil, expires: nil,
                           areaDescription: "", details: "", polygons: [])
        }
        WarningNotifications.markNotified(many, in: store)
        let ids = WarningNotifications.notified(in: store)
        #expect(ids.count == WarningNotifications.memory)
        #expect(ids.last == "id149")
    }

    @Test func notificationText() throws {
        let w = try #require(CAPParser.warning(capXML(id: "t")))
        let c = WarningNotifications.content(w, locationName: "Christchurch", now: thursdayEvening, timeZone: nz)
        #expect(c.id == "weathertempo.warning.t")
        #expect(c.title == "Heavy Rain Warning - Orange – Christchurch")
        #expect(c.body == "From Fri 9am to Sat 3am. Periods of heavy rain.")
    }

    @Test func oldSettingsTurnWarningsOn() throws {
        let store = InMemoryStore([AlertSettings.storeKey: #"{"rainEnabled":true}"#])
        let s = AlertSettings.load(from: store)
        #expect(s.warningsEnabled && s.rainEnabled)
    }
}

/// A MetService client that serves `alerts` (by id) from a feed listing them, without the
/// network; `offline: true` fails every request.
func fakeWarningClient(_ alerts: [String: Data] = [:], offline: Bool = false) -> WarningClient {
    WarningClient { req in
        if offline { throw URLError(.notConnectedToInternet) }
        let url = req.url!.absoluteString
        let ok = HTTPURLResponse(url: req.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
        if url == WarningClient.feedURL.absoluteString { return (rssXML(alerts.keys.sorted()), ok) }
        guard let d = alerts[String(url.split(separator: "=").last!)] else { throw URLError(.badServerResponse) }
        return (d, ok)
    }
}

@Suite struct WarningStoreTests {
    @Test func roundTripsWithoutPolygonsAndDropsExpired() throws {
        let store = InMemoryStore()
        let current = try #require(CAPParser.warning(capXML(id: "now")))
        let old = try #require(CAPParser.warning(capXML(id: "old", expires: "2026-11-05T12:00:00+13:00")))
        WarningStore.save([current, old], locationID: "christchurch", in: store)
        let back = WarningStore.load(locationID: "christchurch", in: store, now: thursdayEvening)
        #expect(back.map(\.id) == ["now"])
        #expect(back[0].polygons.isEmpty && back[0].headline == current.headline && back[0].expires == current.expires)
        #expect(WarningStore.load(locationID: "dunedin", in: store, now: thursdayEvening).isEmpty)
    }

    @Test func shortHeadlineDropsTheColour() throws {
        func w(_ h: String) -> WeatherWarning {
            WeatherWarning(id: h, headline: h, event: "", level: .orange, onset: nil, expires: nil,
                           areaDescription: "", details: "", polygons: [])
        }
        #expect(w("Heavy Rain Warning - Orange").shortHeadline == "Heavy Rain Warning")
        #expect(w("Strong Wind Watch – yellow").shortHeadline == "Strong Wind Watch")
        #expect(w("Severe Thunderstorm Watch").shortHeadline == "Severe Thunderstorm Watch")
        #expect(w("Red").shortHeadline == "Red")
    }
}
