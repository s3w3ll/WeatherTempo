import Foundation

/// One notification the app wants iOS to deliver.
public struct PlannedAlert: Equatable, Sendable {
    public enum Kind: String, Sendable { case tempHigh, tempLow, uv, dailyUV, rain }
    public let kind: Kind
    public let fireDate: Date
    public let title: String
    public let body: String

    /// Stable per (kind, fire time) so re-planning replaces rather than duplicates.
    public var id: String { "\(AlertPlanner.idPrefix)\(kind.rawValue).\(Int(fireDate.timeIntervalSince1970))" }
}

/// Turns the hourly forecast and the user's thresholds into the notifications to schedule.
///
/// iOS can't wake the app at the moment a threshold is crossed, and there's no push server
/// here, so the crossing is predicted from the forecast and scheduled as a local
/// notification. The forecast changes, so the whole set is replanned on every refresh.
/// Pure and deterministic: everything it needs is passed in.
public enum AlertPlanner {
    public static let idPrefix = "weathertempo.alert."
    /// iOS keeps at most 64 pending local notifications; stay well below.
    public static let maxAlerts = 40

    public static func plan(
        hours: [WeatherPayload.Hour],
        settings: AlertSettings,
        locationName: String,
        timeZone: TimeZone,
        now: Date
    ) -> [PlannedAlert] {
        let s = settings.sanitized()
        let sorted = hours.sorted { $0.validTimeUtc < $1.validTimeUtc }
        var out: [PlannedAlert] = []

        if s.tempHighEnabled {
            out += temperatureCrossings(sorted, kind: .tempHigh, limit: s.tempHigh, tz: timeZone, now: now, place: locationName)
        }
        if s.tempLowEnabled {
            out += temperatureCrossings(sorted, kind: .tempLow, limit: s.tempLow, tz: timeZone, now: now, place: locationName)
        }
        if s.uvEnabled {
            out += uvCrossings(sorted, threshold: s.uvThreshold, tz: timeZone, now: now, place: locationName)
        }
        if s.dailyUVEnabled {
            out += dailyUV(sorted, threshold: s.uvThreshold, minutes: s.dailyUVMinutes, tz: timeZone, now: now, place: locationName)
        }
        if s.rainEnabled {
            out += rain(sorted, chance: s.rainChance, leadMinutes: s.rainLeadMinutes, tz: timeZone, now: now, place: locationName)
        }
        return Array(out.sorted { $0.fireDate < $1.fireDate }.prefix(maxAlerts))
    }

    // MARK: Temperature

    /// One alert each time the forecast *crosses* the limit (not every hour spent beyond it).
    /// If it's already beyond the limit at the first future hour, nothing fires until it has
    /// come back and crossed again.
    static func temperatureCrossings(
        _ hours: [WeatherPayload.Hour], kind: PlannedAlert.Kind, limit: Double,
        tz: TimeZone, now: Date, place: String
    ) -> [PlannedAlert] {
        let above = kind == .tempHigh
        func beyond(_ t: Double) -> Bool { above ? t > limit : t < limit }

        // Hour slots are labelled by their start; the slot containing `now` still counts as "now".
        let future = hours.filter { $0.validTimeUtc + 3600 > now.timeIntervalSince1970 && $0.temperature != nil }
        guard var wasBeyond = future.first.flatMap({ $0.temperature.map(beyond) }) else { return [] }

        var out: [PlannedAlert] = []
        for h in future.dropFirst() {
            guard let t = h.temperature else { continue }
            let isBeyond = beyond(t)
            defer { wasBeyond = isBeyond }
            guard isBeyond, !wasBeyond, h.date > now else { continue }

            let when = TimeFormat.hour(h.validTimeUtc, in: tz)
            let day = dayPhrase(h.date, now: now, tz: tz)
            let limitText = NumberFormat.trimmed(limit)
            out.append(PlannedAlert(
                kind: kind, fireDate: h.date,
                title: above ? "Warming up in \(place)" : "Cold in \(place)",
                body: "Forecast \(above ? "above" : "below") \(limitText)° from \(when) \(day) (\(Int(t.rounded()))°)."))
        }
        return out
    }

    // MARK: UV

    /// A run of consecutive hours at or above the threshold.
    private struct UVRun { var hours: [WeatherPayload.Hour] }

    private static func uvRuns(_ hours: [WeatherPayload.Hour], threshold: Double) -> [UVRun] {
        var runs: [UVRun] = []
        var current: [WeatherPayload.Hour] = []
        for h in hours {
            if let uv = h.uvIndex, uv >= threshold {
                if let last = current.last, h.validTimeUtc - last.validTimeUtc > 3600 {
                    runs.append(UVRun(hours: current)); current = []
                }
                current.append(h)
            } else if !current.isEmpty {
                runs.append(UVRun(hours: current)); current = []
            }
        }
        if !current.isEmpty { runs.append(UVRun(hours: current)) }
        return runs
    }

    private static func describe(_ run: UVRun, threshold: Double, tz: TimeZone) -> String {
        let start = TimeFormat.hour(run.hours.first!.validTimeUtc, in: tz)
        let end = TimeFormat.hour(run.hours.last!.validTimeUtc + 3600, in: tz)
        let peakHour = run.hours.max { ($0.uvIndex ?? 0) < ($1.uvIndex ?? 0) }!
        let peak = WeatherInsights.uvLabel(peakHour.uvIndex)
        return "UV \(NumberFormat.trimmed(threshold))+ from \(start) to \(end), peaking at \(peak) around \(TimeFormat.hour(peakHour.validTimeUtc, in: tz))."
    }

    /// One alert at the start of each run of high UV that hasn't started yet.
    static func uvCrossings(
        _ hours: [WeatherPayload.Hour], threshold: Double, tz: TimeZone, now: Date, place: String
    ) -> [PlannedAlert] {
        uvRuns(hours, threshold: threshold).compactMap { run in
            guard let first = run.hours.first, first.date > now else { return nil }
            return PlannedAlert(kind: .uv, fireDate: first.date, title: "UV rising in \(place)",
                                body: describe(run, threshold: threshold, tz: tz))
        }
    }

    /// A morning summary per day that will have high UV; silent on days that won't.
    static func dailyUV(
        _ hours: [WeatherPayload.Hour], threshold: Double, minutes: Int, tz: TimeZone, now: Date, place: String
    ) -> [PlannedAlert] {
        let cal = TimeFormat.calendar(tz)
        let runs = uvRuns(hours, threshold: threshold)
        var out: [PlannedAlert] = []
        var day = cal.startOfDay(for: now)

        for _ in 0..<7 {
            let next = cal.date(byAdding: .day, value: 1, to: day) ?? day.addingTimeInterval(86_400)
            defer { day = next }
            guard let fire = cal.date(byAdding: .minute, value: minutes, to: day), fire > now else { continue }

            // The day's longest high-UV stretch starting on this day.
            let todays = runs.filter { r in r.hours.first.map { $0.date >= day && $0.date < next } ?? false }
            guard let run = todays.max(by: { $0.hours.count < $1.hours.count }) else { continue }

            out.append(PlannedAlert(kind: .dailyUV, fireDate: fire, title: "UV today in \(place)",
                                    body: describe(run, threshold: threshold, tz: tz)))
        }
        return out
    }

    // MARK: Rain

    /// Smallest forecast amount that counts as rain; below this the "rain" is drizzle noise.
    static let minRainMm = 0.1

    /// One alert `leadMinutes` before each rainy spell. An hour is rainy when its chance is at
    /// least `chance` and some rain is forecast; spells separated by a single dry hour are
    /// merged so a brief lull doesn't cause a second alert.
    static func rain(
        _ hours: [WeatherPayload.Hour], chance: Double, leadMinutes: Int, tz: TimeZone, now: Date, place: String
    ) -> [PlannedAlert] {
        func rainy(_ h: WeatherPayload.Hour) -> Bool {
            (h.precipChance ?? 0) >= chance && (h.qpf ?? 0) >= minRainMm
        }

        var spells: [[WeatherPayload.Hour]] = []
        for h in hours where rainy(h) {
            if let last = spells.last?.last, h.validTimeUtc - last.validTimeUtc <= 2 * 3600 {
                spells[spells.count - 1].append(h)
            } else {
                spells.append([h])
            }
        }

        return spells.compactMap { spell in
            guard let first = spell.first, let last = spell.last, first.date > now else { return nil }
            let fire = first.date.addingTimeInterval(-Double(leadMinutes) * 60)
            guard fire > now else { return nil }          // too late to warn ahead; don't fire "now" on every refresh

            let total = spell.reduce(0) { $0 + ($1.qpf ?? 0) }
            let peakChance = spell.compactMap(\.precipChance).max() ?? chance
            let heaviest = spell.compactMap(\.qpf).max()
            let kind = WeatherInsights.RainIntensity.classify(qpf: heaviest)?.label ?? "Rain"
            let start = TimeFormat.hour(first.validTimeUtc, in: tz)
            let end = TimeFormat.hour(last.validTimeUtc + 3600, in: tz)
            let day = dayPhrase(first.date, now: now, tz: tz)
            return PlannedAlert(
                kind: .rain, fireDate: fire,
                title: "Rain coming in \(place)",
                body: "\(kind) from \(start) to \(end) \(day), up to \(Int(peakChance.rounded()))% chance, about \(NumberFormat.trimmed((total * 10).rounded() / 10)) mm.")
        }
    }

    // MARK: Wording

    private static func dayPhrase(_ date: Date, now: Date, tz: TimeZone) -> String {
        let cal = TimeFormat.calendar(tz)
        if cal.isDate(date, inSameDayAs: now) { return "today" }
        if let tomorrow = cal.date(byAdding: .day, value: 1, to: now), cal.isDate(date, inSameDayAs: tomorrow) { return "tomorrow" }
        return TimeFormat.weekday(date.timeIntervalSince1970, in: tz)
    }
}
