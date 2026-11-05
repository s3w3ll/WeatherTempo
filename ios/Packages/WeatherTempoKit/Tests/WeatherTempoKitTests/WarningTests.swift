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
    private let later = thursdayEvening.addingTimeInterval(3600)

    private func alert(_ id: String, _ level: String = "Orange", headline: String? = nil, event: String = "rain",
                       expires: String = "2026-11-07T03:00:00+13:00") throws -> WeatherWarning {
        var w = try #require(CAPParser.warning(capXML(id: id, headline: headline ?? "Heavy Rain Warning - \(level)",
                                                      colour: level, expires: expires)))
        w = WeatherWarning(id: w.id, headline: w.headline, event: event, level: w.level, onset: w.onset,
                           expires: w.expires, areaDescription: w.areaDescription, details: w.details,
                           polygons: w.polygons)
        return w
    }

    private func decide(_ warnings: [WeatherWarning], complete: Bool = true, memory: [RememberedWarning] = [],
                        legacy: Set<String> = [], lifted: Bool = true, location: String = "christchurch",
                        now: Date = thursdayEvening) -> (notices: [WarningNotice], memory: [RememberedWarning]) {
        WarningNotifications.decide(WarningFetch(warnings: warnings, complete: complete), locationID: location,
                                    placeName: "Christchurch", timeZone: nz, memory: memory, legacyIDs: legacy,
                                    liftedEnabled: lifted, now: now)
    }

    @Test func aNewWarningNotifiesOnce() throws {
        let first = decide([try alert("a")])
        #expect(first.notices == [WarningNotice(
            id: "weathertempo.warning.a", title: "Heavy Rain Warning - Orange – Christchurch",
            body: "From Fri 9am to Sat 3am. Periods of heavy rain.")])
        #expect(decide([try alert("a")], memory: first.memory, now: later).notices.isEmpty)
    }

    @Test func aReissueAtTheSameOrLowerLevelIsQuiet() throws {
        let m = decide([try alert("a")]).memory
        #expect(decide([try alert("b")], memory: m, now: later).notices.isEmpty)               // same level, new id
        #expect(decide([try alert("c", "Yellow")], memory: m, now: later).notices.isEmpty)     // downgraded
    }

    @Test func anUpgradeNotifies() throws {
        let watch = decide([try alert("w", "Yellow", headline: "Heavy Rain Watch")]).memory
        let up = decide([try alert("o")], memory: watch, now: later)
        #expect(up.notices.map(\.id) == ["weathertempo.warning.o"])
        #expect(up.notices[0].body.hasPrefix("Upgraded from yellow. "))
        let red = decide([try alert("r", "Red")], memory: up.memory, now: later).notices
        #expect(red.first?.body.hasPrefix("Upgraded from orange. ") == true)
    }

    @Test func differentHazardsAreSeparate() throws {
        let m = decide([try alert("rain")]).memory
        let wind = decide([try alert("rain"), try alert("wind", headline: "Strong Wind Warning - Orange", event: "wind")],
                          memory: m, now: later)
        #expect(wind.notices.map(\.id) == ["weathertempo.warning.wind"])
    }

    @Test func twoNewAlertsForOneHazardNotifyOnlyTheWorse() throws {
        let n = decide([try alert("y", "Yellow"), try alert("o")]).notices
        #expect(n.map(\.id) == ["weathertempo.warning.o"])
    }

    @Test func aWarningGoneEarlyFromACompleteFeedIsLifted() throws {
        let m = decide([try alert("a")]).memory
        let gone = decide([], memory: m, now: later)
        #expect(gone.notices == [WarningNotice(
            id: "weathertempo.warning.lifted.a", title: "Heavy Rain Warning lifted – Christchurch",
            body: "MetService no longer has the Heavy Rain Warning - Orange in force for Christchurch.")])
        #expect(decide([], memory: gone.memory, now: later.addingTimeInterval(600)).notices.isEmpty)   // once
    }

    @Test func liftedNeedsACompleteFeedTheSettingAndTimeLeft() throws {
        let m = decide([try alert("a")]).memory
        #expect(decide([], complete: false, memory: m, now: later).notices.isEmpty)    // an alert failed to load
        #expect(decide([], memory: m, lifted: false, now: later).notices.isEmpty)     // setting off
        // Sat 2:45am: 15 minutes before its 3am expiry it simply ran its course
        let nearEnd = ISO8601DateFormatter().date(from: "2026-11-06T13:45:00Z")!
        #expect(decide([], memory: m, now: nearEnd).notices.isEmpty)
        // another place's warnings aren't this place's to lift
        #expect(decide([], memory: m, location: "dunedin", now: later).notices.isEmpty)
    }

    @Test func aReissueKeepsTheHazardInForce() throws {
        let m = decide([try alert("a")]).memory
        let reissued = decide([try alert("b")], memory: m, now: later)
        #expect(reissued.notices.isEmpty)
        // "a" left the feed but "b" (same hazard) is there: nothing was lifted
        #expect(decide([try alert("b")], memory: reissued.memory, now: later.addingTimeInterval(600)).notices.isEmpty)
    }

    @Test func idsNotifiedByTheOldVersionStayQuietButAreTracked() throws {
        let r = decide([try alert("old")], legacy: ["old"])
        #expect(r.notices.isEmpty)
        #expect(r.memory.map(\.id) == ["old"])
    }

    @Test func memoryIsPrunedAndBounded() throws {
        var m: [RememberedWarning] = []
        for i in 0..<150 {
            m = decide([try alert("id\(i)", event: "e\(i)")], memory: m, lifted: false).memory
        }
        #expect(m.count == WarningNotifications.memory && m.last?.id == "id149")
        // a week after they all expired, they're forgotten
        let nextWeek = thursdayEvening.addingTimeInterval(10 * 86_400)
        #expect(decide([], memory: m, now: nextWeek).memory.isEmpty)
    }

    @Test func processRespectsTheSwitchAndStoresMemory() throws {
        let store = InMemoryStore()
        var settings = AlertSettings()
        settings.warningsEnabled = false
        let fetch = WarningFetch(warnings: [try alert("p")])
        #expect(WarningNotifications.process(fetch, location: chc, settings: settings, store: store, now: thursdayEvening).isEmpty)
        settings.warningsEnabled = true
        #expect(WarningNotifications.process(fetch, location: chc, settings: settings, store: store, now: thursdayEvening).count == 1)
        #expect(WarningNotifications.process(fetch, location: chc, settings: settings, store: store, now: later).isEmpty)
        WarningNotifications.forget(in: store)
        #expect(WarningNotifications.process(fetch, location: chc, settings: settings, store: store, now: later).count == 1)
    }

    @Test func oldSettingsTurnWarningsOn() throws {
        let store = InMemoryStore([AlertSettings.storeKey: #"{"rainEnabled":true}"#])
        let s = AlertSettings.load(from: store)
        #expect(s.warningsEnabled && s.warningLiftedEnabled && s.rainEnabled)
    }

    @Test func clientReportsIncompleteFeeds() async throws {
        let c = WarningClient { req in
            let url = req.url!.absoluteString
            let ok = HTTPURLResponse(url: req.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
            if url == WarningClient.feedURL.absoluteString { return (rssXML(["good", "broken"]), ok) }
            if url.hasSuffix("good") { return (capXML(id: "good"), ok) }
            throw URLError(.timedOut)
        }
        let f = try await c.fetch(latitude: chc.lat, longitude: chc.lon, now: thursdayEvening)
        #expect(f.warnings.map(\.id) == ["good"] && !f.complete)
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
