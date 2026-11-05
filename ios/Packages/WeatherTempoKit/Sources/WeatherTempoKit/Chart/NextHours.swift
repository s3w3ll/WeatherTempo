import Foundation

// "Next few hours" summary: a short plain-English line about what's coming, shown above
// the chart when no hour is selected. Pure text from the model, so it is unit-tested.

extension MeteogramModel {

    /// Hours the summary looks ahead.
    public static let nextHoursWindow = 12

    /// An hour counts as rainy with a measurable amount *and* a fair chance of it, so a
    /// 10 % chance of a trace doesn't read as "rain from 3pm".
    static func isRainy(_ h: Hour) -> Bool {
        (h.qpf ?? 0) > 0.1 && (h.precipChance ?? 100) >= 40
    }

    /// e.g. "Light rain from 4pm, about 2 hours. Warming to 17° by 3pm."
    /// Sentences, most important first: rain, then temperature, then strong gusts, then sun
    /// protection times (left out where the UV is shown separately, as on the large widget).
    /// nil when there are no future hours to talk about.
    public func nextHoursSummary(window: Int = MeteogramModel.nextHoursWindow,
                                 includeSunProtection: Bool = true) -> String? {
        let start = nowIndex
        guard hours.indices.contains(start) else { return nil }
        let end = min(hours.count, start + window)
        let span = start..<end
        var parts: [String] = [rainSentence(span, window: window)]
        if let t = temperatureSentence(span) { parts.append(t) }
        if let g = gustSentence(span) { parts.append(g) }
        if includeSunProtection, let sun = sunProtection(window: window) { parts.append(sun.sentence) }
        return parts.map { $0 + "." }.joined(separator: " ")
    }

    // MARK: Sun protection

    /// SunSmart NZ's line: from UV 3, cover up, hat, sunscreen.
    public static let sunProtectionUV = 3.0

    /// The stretch of UV 3+ that is under way or starts within the window, followed to its
    /// end (it may run past the window). Hourly data, so times are to the hour.
    public struct SunProtection: Equatable, Sendable {
        /// Already under way (the current hour is in it).
        public let ongoing: Bool
        /// "10am", "5pm" (the end is the end of the last UV 3+ hour).
        public let from: String
        public let until: String
        public let peak: Double

        /// "Sun protection 10am to 5pm (UV up to 9, very high)" /
        /// "Sun protection until 5pm (UV up to 9, very high)"
        public var sentence: String {
            let when = ongoing ? "until \(until)" : "\(from) to \(until)"
            return "Sun protection \(when) (UV up to \(Int(peak.rounded())), \(Self.category(peak)))"
        }

        /// "10am–5pm" / "until 5pm", for tight spaces.
        public var compactTimes: String { ongoing ? "until \(until)" : "\(from)–\(until)" }

        /// WHO UV categories in words.
        static func category(_ uv: Double) -> String {
            switch uv.rounded() {
            case ..<3: return "low"
            case ..<6: return "moderate"
            case ..<8: return "high"
            case ..<11: return "very high"
            default: return "extreme"
            }
        }
    }

    public func sunProtection(window: Int = MeteogramModel.nextHoursWindow) -> SunProtection? {
        guard hours.indices.contains(nowIndex) else { return nil }
        let threshold = Self.sunProtectionUV
        func high(_ i: Int) -> Bool { (hours[i].uvIndex ?? 0) >= threshold }
        // From the hour in progress (the one before nowIndex) to the end of the window.
        let first = max(0, nowIndex - 1)
        let last = min(hours.count, nowIndex + window)
        guard let r = (first..<last).first(where: high) else { return nil }
        let e = (r..<hours.count).first { !high($0) } ?? hours.count
        let peak = hours[r..<e].compactMap(\.uvIndex).max() ?? threshold
        return SunProtection(
            ongoing: r < nowIndex,
            from: TimeFormat.hour(hours[r].validTimeUtc, in: timeZone),
            until: TimeFormat.hour(hours[e - 1].validTimeUtc + 3600, in: timeZone),
            peak: peak)
    }

    private func at(_ i: Int) -> String { TimeFormat.hour(hours[i].validTimeUtc, in: timeZone) }

    private func intensityLabel(_ run: Range<Int>) -> String {
        let peak = hours[run].compactMap(\.qpf).max()
        return (WeatherInsights.RainIntensity.classify(qpf: peak) ?? .light).label
    }

    private func rainSentence(_ span: Range<Int>, window: Int) -> String {
        let a = span.lowerBound
        // First rainy hour in the window, and where that spell ends (it may run past the window).
        guard let r = span.first(where: { Self.isRainy(hours[$0]) }) else {
            return "Dry for the next \(span.count) hour\(span.count == 1 ? "" : "s")"
        }
        let e = (r..<hours.count).first { !Self.isRainy(hours[$0]) } ?? hours.count
        let label = intensityLabel(r..<e)

        if r == a {
            return e < span.upperBound ? "\(label) easing by \(at(e))" : "\(label) for the next \(span.count) hours"
        }
        guard e <= span.upperBound else { return "\(label) from \(at(r))" }
        let d = e - r
        return "\(label) from \(at(r)), about \(d) hour\(d == 1 ? "" : "s")"
    }

    /// The bigger of the coming rise or fall, if it's at least 2°; otherwise "steady".
    private func temperatureSentence(_ span: Range<Int>) -> String? {
        let temps = span.compactMap { i in hours[i].temperature.map { (i, $0) } }
        guard let first = temps.first, temps.count > 1 else { return nil }
        let hi = temps.max { $0.1 < $1.1 }!, lo = temps.min { $0.1 < $1.1 }!
        let rise = hi.1 - first.1, fall = first.1 - lo.1
        let deg = { (t: Double) in "\(Int(t.rounded()))°" }
        if rise >= 2 && rise >= fall { return "Warming to \(deg(hi.1)) by \(at(hi.0))" }
        if fall >= 2 { return "Cooling to \(deg(lo.1)) by \(at(lo.0))" }
        return "Staying around \(deg(first.1))"
    }

    /// Only worth a mention at 50 km/h and up (a "strong" gust on the Beaufort scale).
    private func gustSentence(_ span: Range<Int>) -> String? {
        let gusts = span.compactMap { i in hours[i].windGust.map { (i, $0) } }
        guard let peak = gusts.max(by: { $0.1 < $1.1 }), peak.1 >= 50 else { return nil }
        return "Gusts to \(Int(peak.1.rounded())) km/h around \(at(peak.0))"
    }
}
