import Foundation
#if canImport(FoundationXML)
import FoundationXML
#endif

/// Reads MetService's CAP feed: the RSS index (one item per current alert) and the
/// individual CAP 1.2 alert documents it links to.
enum CAPParser {

    /// Alert document URLs from the RSS index, in feed order.
    static func alertLinks(_ rss: Data) -> [URL] {
        let d = Collector()
        parse(rss, d)
        return d.itemLinks.compactMap { URL(string: $0) }
    }

    /// One CAP alert, or nil for anything that isn't a live public alert (tests, exercises,
    /// cancellations) or is missing what the app needs.
    static func warning(_ cap: Data) -> WeatherWarning? {
        let d = Collector()
        guard parse(cap, d) else { return nil }
        let f = d.fields
        guard let id = f["identifier"], f["status"] == nil || f["status"] == "Actual",
              f["msgType"] != "Cancel" else { return nil }

        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime]
        let polygons = d.polygons.map(points).filter { $0.count >= 3 }
        return WeatherWarning(
            id: id,
            headline: f["headline"] ?? f["event"]?.capitalized ?? "Weather warning",
            event: f["event"] ?? "",
            level: .init(colourCode: d.parameters["ColourCode"], severity: f["severity"]),
            onset: f["onset"].flatMap(iso.date(from:)) ?? f["effective"].flatMap(iso.date(from:)),
            expires: f["expires"].flatMap(iso.date(from:)),
            areaDescription: d.areas.joined(separator: ", ").replacingOccurrences(of: ",", with: ", ")
                .replacingOccurrences(of: ",  ", with: ", "),
            details: f["description"] ?? "",
            instruction: f["instruction"],
            web: f["web"].flatMap(URL.init(string:)),
            polygons: polygons)
    }

    /// CAP polygon text: "lat,lon lat,lon …".
    static func points(_ text: String) -> [WeatherWarning.Point] {
        text.split(whereSeparator: { $0 == " " || $0 == "\n" || $0 == "\t" }).compactMap { pair in
            let parts = pair.split(separator: ",")
            guard parts.count == 2, let lat = Double(parts[0]), let lon = Double(parts[1]) else { return nil }
            return WeatherWarning.Point(lat: lat, lon: lon)
        }
    }

    @discardableResult
    private static func parse(_ data: Data, _ delegate: Collector) -> Bool {
        let p = XMLParser(data: data)
        p.delegate = delegate
        return p.parse()
    }

    /// Collects element text. Simple fields keep their first occurrence (the first `<info>`
    /// block, if an alert has several languages); areas, polygons and parameters are lists.
    private final class Collector: NSObject, XMLParserDelegate {
        var fields: [String: String] = [:]
        var areas: [String] = []
        var polygons: [String] = []
        var parameters: [String: String] = [:]
        var itemLinks: [String] = []

        private var stack: [String] = []
        private var text = ""
        private var paramName: String?

        func parser(_ parser: XMLParser, didStartElement name: String, namespaceURI: String?,
                    qualifiedName: String?, attributes: [String: String] = [:]) {
            stack.append(name)
            text = ""
        }

        func parser(_ parser: XMLParser, foundCharacters string: String) { text += string }

        func parser(_ parser: XMLParser, foundCDATA block: Data) {
            text += String(decoding: block, as: UTF8.self)
        }

        func parser(_ parser: XMLParser, didEndElement name: String, namespaceURI: String?, qualifiedName: String?) {
            let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
            let inSignature = stack.contains("Signature")
            switch name {
            case _ where inSignature: break
            case "link" where stack.contains("item"): if !t.isEmpty { itemLinks.append(t) }
            case "polygon": polygons.append(t)
            case "areaDesc": areas.append(t)
            case "valueName": paramName = t
            case "value": if let n = paramName, parameters[n] == nil { parameters[n] = t }; paramName = nil
            default: if fields[name] == nil, !t.isEmpty { fields[name] = t }
            }
            stack.removeLast()
            text = ""
        }
    }
}
