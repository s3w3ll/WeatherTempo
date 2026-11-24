import SwiftUI
import WidgetKit

// A deliberately small, self-contained widget. It fetches the same Cloudflare Worker
// JSON as the app and shows values straight from it (no forecasting logic lives here,
// so there is nothing to drift from the TypeScript core). The large size adds a compact
// 30-hour meteogram drawn straight from the hourly data, like the old Swift app's widget.

private let workerURL = "https://weathertempo-pws-proxy.forgesync.workers.dev"
private let locationID = "christchurch"   // TODO: share the chosen location once an App Group is available
private let placeName = "Christchurch"

// MARK: - Data

struct Payload: Decodable {
    struct Current: Decodable {
        var temp: Double?
        var feelsLike: Double?
        var humidity: Double?
        var windSpeed: Double?
        var windCardinal: String?
        var condition: String?
        var iconCode: Int?
        var tempMax24h: Double?
        var tempMin24h: Double?
        var sunriseUtc: Double?
        var sunsetUtc: Double?
        var pressure: Double?
        var uvIndex: Double?
    }
    struct Hour: Decodable {
        var validTimeUtc: Double
        var qpf: Double?
        var temperature: Double?
        var temperatureFeelsLike: Double?
        var windSpeed: Double?
        var windDirection: Double?
        var cloudCover: Double?
        var precipChance: Double?
    }
    struct Day: Decodable {
        var temperatureMax: Double?
        var temperatureMin: Double?
        var sunriseTimeUtc: Double?
        var sunsetTimeUtc: Double?
    }
    var current: Current
    var hourly: [Hour]
    var daily: [Day]?
}

struct WarningsPayload: Decodable {
    struct Item: Decodable {
        var level: String
        var headline: String
    }
    var warnings: [Item]
}

struct Snapshot {
    var date: Date
    var payload: Payload?
    var warnings: [WarningsPayload.Item]

    static let placeholder = Snapshot(
        date: Date(),
        payload: Payload(
            current: .init(temp: 17, feelsLike: 16, humidity: 62, windSpeed: 14, windCardinal: "NE",
                           condition: "Partly Cloudy", iconCode: 30, tempMax24h: 20, tempMin24h: 9,
                           sunriseUtc: nil, sunsetUtc: nil, pressure: 1016, uvIndex: 3),
            hourly: [], daily: nil),
        warnings: [])
}

enum Loader {
    static func get<T: Decodable>(_ path: String, as: T.Type) async -> T? {
        guard let url = URL(string: "\(workerURL)\(path)") else { return nil }
        var req = URLRequest(url: url)
        req.timeoutInterval = 12
        req.cachePolicy = .reloadIgnoringLocalCacheData
        guard let (data, resp) = try? await URLSession.shared.data(for: req),
              (resp as? HTTPURLResponse)?.statusCode == 200 else { return nil }
        return try? JSONDecoder().decode(T.self, from: data)
    }

    static func load() async -> Snapshot {
        async let p = get("/?location=\(locationID)", as: Payload.self)
        async let w = get("/warnings?location=\(locationID)", as: WarningsPayload.self)
        let payload = await p
        let warnings = (await w)?.warnings ?? []
        return Snapshot(date: Date(), payload: payload, warnings: warnings)
    }
}

// MARK: - Timeline

struct Entry: TimelineEntry {
    let date: Date
    let snapshot: Snapshot
}

struct Provider: TimelineProvider {
    func placeholder(in context: Context) -> Entry { Entry(date: Date(), snapshot: .placeholder) }

    func getSnapshot(in context: Context, completion: @escaping (Entry) -> Void) {
        if context.isPreview { completion(placeholder(in: context)); return }
        Task {
            let s = await Loader.load()
            completion(Entry(date: s.date, snapshot: s))
        }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<Entry>) -> Void) {
        Task {
            let s = await Loader.load()
            // iOS treats the date as a hint and picks the real refresh time itself.
            let next = s.date.addingTimeInterval(30 * 60)
            completion(Timeline(entries: [Entry(date: s.date, snapshot: s)], policy: .after(next)))
        }
    }
}

// MARK: - Helpers

private func temp(_ v: Double?) -> String { v.map { "\(Int($0.rounded()))°" } ?? "—" }

/// Same mapping as iconFor() in the app's display.ts (TWC icon codes).
private func glyph(_ c: Payload.Current, at now: Date) -> String {
    var day = true
    if let rise = c.sunriseUtc, let set = c.sunsetUtc, rise > 0, set > 0 {
        let t = now.timeIntervalSince1970
        // Sunrise/sunset are for one day; compare time of day so it works for any date.
        let secs = t.truncatingRemainder(dividingBy: 86_400)
        let r = rise.truncatingRemainder(dividingBy: 86_400), s = set.truncatingRemainder(dividingBy: 86_400)
        day = r <= s ? (secs >= r && secs < s) : (secs >= r || secs < s)
    }
    switch c.iconCode ?? -1 {
    case 32, 36: return "☀️"
    case 31: return "🌙"
    case 30, 34: return day ? "⛅" : "☁️"
    case 29, 33, 27, 28: return day ? "🌥️" : "☁️"
    case 26: return "☁️"
    case 9, 11, 45: return "🌦️"
    case 12, 39, 40: return "🌧️"
    case 13, 14, 15, 16, 41, 42, 43, 46: return "❄️"
    case 4, 17, 18, 35, 37, 38, 47: return "⛈️"
    case 19, 20, 21, 22: return "🌫️"
    case 23, 24: return "💨"
    default: return day ? "⛅" : "☁️"
    }
}

private func rainLabel(_ qpf: Double) -> String { qpf >= 4 ? "Heavy rain" : qpf >= 1 ? "Moderate rain" : "Light rain" }

/// "Moderate rain at 17:00": the next hour today with more than 0.1 mm.
private func nextRain(_ p: Payload, now: Date) -> String? {
    let cal = Calendar(identifier: .gregorian)
    var tzCal = cal
    tzCal.timeZone = TimeZone(identifier: "Pacific/Auckland") ?? .current
    for h in p.hourly where h.validTimeUtc >= now.timeIntervalSince1970 - 1800 {
        let d = Date(timeIntervalSince1970: h.validTimeUtc)
        guard let q = h.qpf, q > 0.1 else { continue }
        guard tzCal.isDate(d, inSameDayAs: now) else { return nil }
        let f = DateFormatter()
        f.timeZone = tzCal.timeZone
        f.locale = Locale(identifier: "en_NZ")
        f.dateFormat = "HH:mm"
        return "\(rainLabel(q)) at \(f.string(from: d))"
    }
    return nil
}

private func shortHeadline(_ s: String) -> String {
    for suffix in [" - Yellow", " - Orange", " - Red"] where s.hasSuffix(suffix) { return String(s.dropLast(suffix.count)) }
    return s
}

private func warningColor(_ level: String) -> Color {
    switch level.lowercased() {
    case "red": return Color(red: 0.86, green: 0.15, blue: 0.15)
    case "orange": return Color(red: 0.96, green: 0.55, blue: 0.10)
    default: return Color(red: 0.98, green: 0.80, blue: 0.20)
    }
}

private struct WarningBadge: View {
    let w: WarningsPayload.Item
    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: "exclamationmark.triangle.fill")
            Text(shortHeadline(w.headline)).lineLimit(1).minimumScaleFactor(0.75)
        }
        .font(.system(size: 10, weight: .bold))
        .foregroundStyle(.black)
        .padding(.horizontal, 7).padding(.vertical, 3)
        .background(warningColor(w.level), in: Capsule())
    }
}

private let skyText = Color.white
private let skyMuted = Color(white: 1, opacity: 0.78)
private let skyCyan = Color(red: 0.62, green: 0.90, blue: 1.0)

private struct Sky: View {
    var body: some View {
        LinearGradient(colors: [Color(red: 0.12, green: 0.25, blue: 0.52), Color(red: 0.16, green: 0.38, blue: 0.68),
                                Color(red: 0.15, green: 0.33, blue: 0.58)],
                       startPoint: .top, endPoint: .bottom)
    }
}

// MARK: - Views

struct SmallView: View {
    let s: Snapshot
    var body: some View {
        if let c = s.payload?.current {
            VStack(alignment: .leading, spacing: 0) {
                HStack {
                    Text(placeName.uppercased()).font(.system(size: 10, weight: .medium)).foregroundStyle(skyMuted)
                    Spacer(minLength: 4)
                    Text(glyph(c, at: s.date)).font(.system(size: 18))
                }
                Spacer(minLength: 2)
                Text(temp(c.temp)).font(.system(size: 38, weight: .bold)).foregroundStyle(skyText).minimumScaleFactor(0.8)
                Text(c.condition ?? "—").font(.system(size: 12)).foregroundStyle(skyMuted).lineLimit(1)
                Spacer(minLength: 2)
                if let w = s.warnings.first {
                    WarningBadge(w: w)
                } else {
                    HStack {
                        Text("Feels \(temp(c.feelsLike))")
                        Spacer(minLength: 2)
                        Text("\(temp(c.tempMax24h)) / \(temp(c.tempMin24h))")
                    }
                    .font(.system(size: 10)).foregroundStyle(skyMuted).lineLimit(1).minimumScaleFactor(0.8)
                }
            }
        } else {
            Unavailable()
        }
    }
}

struct MediumView: View {
    let s: Snapshot
    var body: some View {
        if let p = s.payload {
            let c = p.current
            VStack(alignment: .leading, spacing: 0) {
                HStack {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(placeName.uppercased()).font(.system(size: 10, weight: .medium)).foregroundStyle(skyMuted)
                        HStack(spacing: 6) {
                            Text(glyph(c, at: s.date)).font(.system(size: 26))
                            Text(temp(c.temp)).font(.system(size: 34, weight: .bold)).foregroundStyle(skyText)
                        }
                        Text(c.condition ?? "—").font(.system(size: 11)).foregroundStyle(skyMuted).lineLimit(1)
                        if let rain = nextRain(p, now: s.date) {
                            Text(rain).font(.system(size: 10, weight: .semibold)).foregroundStyle(skyCyan).lineLimit(1)
                        }
                    }
                    Spacer(minLength: 8)
                    VStack(spacing: 4) {
                        stat("Feels", temp(c.feelsLike))
                        stat("Hi/Lo", "\(temp(c.tempMax24h)) / \(temp(c.tempMin24h))")
                        stat("Wind", "\(c.windSpeed.map { String(Int($0.rounded())) } ?? "—") km/h \(c.windCardinal ?? "")")
                        stat("Humidity", c.humidity.map { "\(Int($0.rounded()))%" } ?? "—")
                    }
                }
                Spacer(minLength: 4)
                if let w = s.warnings.first {
                    HStack(spacing: 6) {
                        WarningBadge(w: w)
                        if s.warnings.count > 1 { Text("+\(s.warnings.count - 1)").font(.system(size: 10, weight: .bold)).foregroundStyle(skyText) }
                    }
                } else {
                    Text("Updated \(s.date, style: .relative) ago").font(.system(size: 9)).foregroundStyle(skyMuted)
                }
            }
        } else {
            Unavailable()
        }
    }

    private func stat(_ label: String, _ value: String) -> some View {
        HStack(spacing: 6) {
            Text(label).font(.system(size: 10)).foregroundStyle(skyMuted)
            Spacer(minLength: 0)
            Text(value).font(.system(size: 10, weight: .medium)).foregroundStyle(skyText).lineLimit(1)
        }
        .frame(width: 118)
    }
}

// MARK: - Large (with chart)

private let nzTZ = TimeZone(identifier: "Pacific/Auckland") ?? .current

private func hourText(_ t: Double, _ fmt: String = "HH:mm") -> String {
    let f = DateFormatter()
    f.timeZone = nzTZ
    f.locale = Locale(identifier: "en_NZ")
    f.dateFormat = fmt
    return f.string(from: Date(timeIntervalSince1970: t))
}

/// Compact meteogram: temperature + feels-like over cloud cover and day/night shading,
/// then wind and rain lanes, then hour labels. Mirrors the old app's `.compact` layout.
struct WidgetChart: View {
    let hours: [Payload.Hour]
    let days: [Payload.Day]
    let now: Date

    // Zones (points), after ChartLayout.compact in the old Swift app.
    private let cloudTop = 4.0, cloudBot = 28.0
    private let tempTop = 26.0, tempBot = 108.0
    private let windTop = 114.0, windBot = 136.0
    private let rainTop = 142.0, rainBot = 164.0
    private let timeTop = 168.0
    static let height = 182.0

    private let tempLine = Color(red: 242/255, green: 201/255, blue: 76/255)
    private let feelsLine = Color(red: 95/255, green: 214/255, blue: 242/255).opacity(0.9)
    private let windLine = Color(red: 1, green: 110/255, blue: 110/255).opacity(0.85)
    private let rainLine = Color(red: 127/255, green: 216/255, blue: 247/255).opacity(0.9)
    private let rainFill = Color(red: 63/255, green: 169/255, blue: 245/255)
    private let night = Color(red: 8/255, green: 20/255, blue: 45/255).opacity(0.28)
    private let dayWash = Color.white.opacity(0.07)
    private let muted = Color(red: 196/255, green: 219/255, blue: 242/255)

    var body: some View {
        Canvas { ctx, size in
            guard hours.count > 1 else { return }
            let w = Double(size.width)
            let pph = w / Double(hours.count)
            let t0 = hours[0].validTimeUtc
            func x(_ i: Int) -> Double { Double(i) * pph + pph / 2 }
            func xAt(_ t: Double) -> Double { (t - t0) / 3600 * pph + pph / 2 }
            func hline(_ y: Double) -> Path {
                var p = Path(); p.move(to: CGPoint(x: 0, y: y)); p.addLine(to: CGPoint(x: w, y: y)); return p
            }
            func vline(_ xx: Double) -> Path {
                var p = Path(); p.move(to: CGPoint(x: xx, y: 0)); p.addLine(to: CGPoint(x: xx, y: rainBot)); return p
            }

            // Day / night bands from each day's sunrise and sunset.
            ctx.fill(Path(CGRect(x: 0, y: 0, width: w, height: rainBot)), with: .color(night))
            for d in days {
                guard let r = d.sunriseTimeUtc, let st = d.sunsetTimeUtc else { continue }
                let a = max(0, xAt(r)), b = min(w, xAt(st))
                if b > a { ctx.fill(Path(CGRect(x: a, y: 0, width: b - a, height: rainBot)), with: .color(dayWash)) }
            }

            // Cloud cover: a band whose opacity follows the cover.
            for (i, h) in hours.enumerated() {
                let c = (h.cloudCover ?? 0) / 100
                guard c > 0.05 else { continue }
                ctx.fill(Path(CGRect(x: Double(i) * pph, y: cloudTop, width: pph + 0.5, height: cloudBot - cloudTop)),
                         with: .color(Color.white.opacity(0.32 * c)))
            }

            func line(_ vals: [Double?], _ y: (Double) -> Double) -> Path {
                var p = Path()
                var started = false
                for (i, v) in vals.enumerated() {
                    guard let v = v else { continue }
                    let pt = CGPoint(x: x(i), y: y(v))
                    if started { p.addLine(to: pt) } else { p.move(to: pt); started = true }
                }
                return p
            }
            func area(_ vals: [Double?], _ y: (Double) -> Double, base: Double) -> Path {
                var p = line(vals, y)
                if let first = vals.firstIndex(where: { $0 != nil }), let last = vals.lastIndex(where: { $0 != nil }) {
                    p.addLine(to: CGPoint(x: x(last), y: base))
                    p.addLine(to: CGPoint(x: x(first), y: base))
                    p.closeSubpath()
                }
                return p
            }

            // Temperature scale shared by temp and feels-like.
            var temps: [Double] = []
            for h in hours {
                if let t = h.temperature { temps.append(t) }
                if let f = h.temperatureFeelsLike { temps.append(f) }
            }
            let lo = (temps.min() ?? 0) - 1
            let hi = (temps.max() ?? 1) + 1
            func ty(_ v: Double) -> Double { tempBot - (v - lo) / max(hi - lo, 1) * (tempBot - tempTop) }

            let tv: [Double?] = hours.map { $0.temperature }
            ctx.fill(area(tv, ty, base: tempBot),
                     with: .linearGradient(Gradient(colors: [tempLine.opacity(0.30), tempLine.opacity(0.02)]),
                                           startPoint: CGPoint(x: 0, y: tempTop), endPoint: CGPoint(x: 0, y: tempBot)))
            ctx.stroke(line(hours.map { $0.temperatureFeelsLike }, ty), with: .color(feelsLine),
                       style: StrokeStyle(lineWidth: 1.2, dash: [3, 2]))
            ctx.stroke(line(tv, ty), with: .color(tempLine), lineWidth: 2)

            // High and low labels on the temperature curve.
            var hiI = -1, loI = -1
            for (i, v) in tv.enumerated() {
                guard let v = v else { continue }
                if hiI < 0 || v > (tv[hiI] ?? -999) { hiI = i }
                if loI < 0 || v < (tv[loI] ?? 999) { loI = i }
            }
            for (i, dy) in [(hiI, -8.0), (loI, 8.0)] where i >= 0 {
                guard let v = tv[i] else { continue }
                let xx = min(max(x(i), 10), w - 10)
                ctx.draw(Text("\(Int(v.rounded()))°").font(.system(size: 9, weight: .bold)).foregroundColor(.white),
                         at: CGPoint(x: xx, y: ty(v) + dy))
            }

            // Wind lane (scaled to at least 60 km/h) with direction arrows every 3 hours.
            let maxWind = max(60, hours.compactMap { $0.windSpeed }.max() ?? 0)
            func wy(_ v: Double) -> Double { windBot - min(v, maxWind) / maxWind * (windBot - windTop) }
            let wv: [Double?] = hours.map { $0.windSpeed }
            ctx.fill(area(wv, wy, base: windBot), with: .color(windLine.opacity(0.22)))
            ctx.stroke(line(wv, wy), with: .color(windLine), lineWidth: 1.2)
            for (i, h) in hours.enumerated() where i % 3 == 1 {
                guard let dir = h.windDirection else { continue }
                // Points where the wind blows to: from-direction + 180°, then compass → screen angle.
                let a = (dir + 180 - 90) * Double.pi / 180
                let cx = x(i), cy = (windTop + windBot) / 2
                let tip = CGPoint(x: cx + cos(a) * 4, y: cy + sin(a) * 4)
                var p = Path()
                p.move(to: CGPoint(x: cx - cos(a) * 4, y: cy - sin(a) * 4))
                p.addLine(to: tip)
                p.move(to: tip)
                p.addLine(to: CGPoint(x: tip.x + cos(a + 2.5) * 3, y: tip.y + sin(a + 2.5) * 3))
                p.move(to: tip)
                p.addLine(to: CGPoint(x: tip.x + cos(a - 2.5) * 3, y: tip.y + sin(a - 2.5) * 3))
                ctx.stroke(p, with: .color(Color.white.opacity(0.8)), lineWidth: 1)
            }

            // Rain lane: chance as an area, amount as bars (5 mm fills the lane).
            func ry(_ v: Double) -> Double { rainBot - v / 100 * (rainBot - rainTop) }
            let pv: [Double?] = hours.map { $0.precipChance }
            ctx.fill(area(pv, ry, base: rainBot), with: .color(rainFill.opacity(0.25)))
            ctx.stroke(line(pv, ry), with: .color(rainLine), lineWidth: 1)
            for (i, h) in hours.enumerated() {
                guard let q = h.qpf, q > 0.05 else { continue }
                let bh = min(q / 5, 1) * (rainBot - rainTop)
                ctx.fill(Path(CGRect(x: x(i) - pph * 0.3, y: rainBot - bh, width: pph * 0.6, height: bh)),
                         with: .color(rainFill.opacity(0.9)))
            }

            // Zone separators.
            ctx.stroke(hline(tempBot + 3), with: .color(Color.white.opacity(0.18)), lineWidth: 1)
            ctx.stroke(hline(windBot + 3), with: .color(Color.white.opacity(0.18)), lineWidth: 1)

            // Midnight dividers with the day name, and hour labels every 6 hours.
            for (i, h) in hours.enumerated() {
                let hr = Int(hourText(h.validTimeUtc, "H")) ?? 0
                if hr == 0 {
                    let xx = Double(i) * pph
                    ctx.stroke(vline(xx), with: .color(Color.white.opacity(0.22)), lineWidth: 1)
                    ctx.draw(Text(hourText(h.validTimeUtc, "EEE")).font(.system(size: 8, weight: .bold)).foregroundColor(muted),
                             at: CGPoint(x: xx + 3, y: cloudTop + 2), anchor: .topLeading)
                }
                if hr % 6 == 0 {
                    ctx.draw(Text(hourText(h.validTimeUtc, "HH:00")).font(.system(size: 8)).foregroundColor(muted),
                             at: CGPoint(x: min(max(x(i), 12), w - 12), y: timeTop + 6))
                }
            }

            // Now line.
            let nx = xAt(now.timeIntervalSince1970)
            if nx >= 0 && nx <= w {
                ctx.stroke(vline(nx), with: .color(Color.white.opacity(0.6)), lineWidth: 1)
            }
        }
        .frame(height: WidgetChart.height)
    }
}

/// Five days from the hourly data: high, low and the day's peak rain chance (NZ calendar days).
struct DayCell: Identifiable {
    let id: Int
    let label: String
    let hi: Double?
    let lo: Double?
    let rain: Double?
}

private func dayCells(_ p: Payload, now: Date) -> [DayCell] {
    var cal = Calendar(identifier: .gregorian)
    cal.timeZone = nzTZ
    let today = cal.startOfDay(for: now)
    var out: [DayCell] = []
    for k in 0..<5 {
        guard let start = cal.date(byAdding: .day, value: k, to: today),
              let end = cal.date(byAdding: .day, value: 1, to: start) else { continue }
        let s0 = start.timeIntervalSince1970, s1 = end.timeIntervalSince1970
        let hs = p.hourly.filter { $0.validTimeUtc >= s0 && $0.validTimeUtc < s1 }
        if hs.isEmpty { continue }
        let t = hs.compactMap { $0.temperature }
        // Prefer the daily high/low (calendar day) when the API has it, as the app does.
        let d = (p.daily ?? []).first { day in
            guard let r = day.sunriseTimeUtc else { return false }
            return r >= s0 && r < s1
        }
        out.append(DayCell(id: k, label: k == 0 ? "Today" : hourText(s0, "EEE"),
                           hi: d?.temperatureMax ?? t.max(), lo: d?.temperatureMin ?? t.min(),
                           rain: hs.compactMap { $0.precipChance }.max()))
    }
    return out
}

struct LargeView: View {
    let s: Snapshot

    var body: some View {
        if let p = s.payload {
            let c = p.current
            let nowT = s.date.timeIntervalSince1970
            let upcoming = Array(p.hourly.filter { $0.validTimeUtc >= nowT - 3600 }.prefix(30))
            VStack(alignment: .leading, spacing: 6) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 2) {
                        HStack(spacing: 6) {
                            Text(temp(c.temp)).font(.system(size: 28, weight: .bold)).foregroundStyle(skyText)
                            Text(glyph(c, at: s.date)).font(.system(size: 20))
                        }
                        Text("FEELS LIKE \(temp(c.feelsLike))").font(.system(size: 10, weight: .semibold)).foregroundStyle(skyMuted)
                        Text(c.condition ?? "—").font(.system(size: 10)).foregroundStyle(skyMuted).lineLimit(1)
                    }
                    Spacer(minLength: 8)
                    if let w = s.warnings.first {
                        VStack(alignment: .trailing, spacing: 3) {
                            WarningBadge(w: w)
                            Text(s.warnings.count > 1 ? "+\(s.warnings.count - 1) more · MetService" : "MetService")
                                .font(.system(size: 9, weight: .medium)).foregroundStyle(skyMuted)
                        }
                    } else {
                        HStack(alignment: .top, spacing: 14) {
                            column([("WIND", c.windSpeed.map { "\(Int($0.rounded())) km/h \(c.windCardinal ?? "")" } ?? "—"),
                                    ("UV", c.uvIndex.map { "\(Int($0.rounded()))" } ?? "—")])
                            column([("HUMIDITY", c.humidity.map { "\(Int($0.rounded()))%" } ?? "—"),
                                    ("PRESSURE", c.pressure.map { "\(Int($0.rounded())) hPa" } ?? "—")])
                        }
                    }
                }
                Text(nextRain(p, now: s.date) ?? "Hi/Lo \(temp(c.tempMax24h)) / \(temp(c.tempMin24h)) · Updated \(hourText(nowT))")
                    .font(.system(size: 10, weight: .semibold)).foregroundStyle(skyCyan).lineLimit(1)
                WidgetChart(hours: upcoming, days: p.daily ?? [], now: s.date)
                HStack(spacing: 0) {
                    ForEach(dayCells(p, now: s.date)) { d in
                        VStack(spacing: 2) {
                            Text(d.label).font(.system(size: 10, weight: .semibold)).foregroundStyle(skyMuted)
                            Text(temp(d.hi)).font(.system(size: 13, weight: .semibold)).foregroundStyle(skyText)
                            Text(temp(d.lo)).font(.system(size: 11)).foregroundStyle(skyMuted)
                            Text(rainText(d.rain)).font(.system(size: 9, weight: .medium)).foregroundStyle(skyCyan)
                        }
                        .frame(maxWidth: .infinity)
                    }
                }
            }
        } else {
            Unavailable()
        }
    }

    private func rainText(_ r: Double?) -> String {
        guard let r = r, r >= 20 else { return " " }
        return "\(Int(r.rounded()))%"
    }

    private func column(_ rows: [(String, String)]) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            ForEach(Array(rows.enumerated()), id: \.offset) { _, r in
                HStack(spacing: 6) {
                    Text(r.0).font(.system(size: 9, weight: .semibold)).foregroundStyle(skyMuted)
                    Text(r.1).font(.system(size: 11, weight: .semibold)).foregroundStyle(skyText).lineLimit(1)
                }
            }
        }
    }
}

struct LockRectangularView: View {
    let s: Snapshot
    var body: some View {
        if let p = s.payload {
            let c = p.current
            VStack(alignment: .leading, spacing: 1) {
                HStack(spacing: 4) {
                    Text(glyph(c, at: s.date))
                    Text(temp(c.temp)).fontWeight(.semibold)
                    Text(c.condition ?? "").lineLimit(1)
                }
                .font(.headline)
                if let w = s.warnings.first {
                    Text("\(Image(systemName: "exclamationmark.triangle.fill")) \(shortHeadline(w.headline))")
                        .font(.caption.weight(.semibold)).lineLimit(1)
                    Text(w.level.capitalized).font(.caption)
                } else {
                    Text("H/L \(temp(c.tempMax24h)) / \(temp(c.tempMin24h))").font(.caption)
                    Text(nextRain(p, now: s.date) ?? "Wind \(c.windSpeed.map { String(Int($0.rounded())) } ?? "—") km/h \(c.windCardinal ?? "")")
                        .font(.caption).lineLimit(1)
                }
            }
        } else {
            Text("Open WeatherTempo")
        }
    }
}

struct LockCircularView: View {
    let s: Snapshot
    var body: some View {
        VStack(spacing: 0) {
            if s.warnings.first != nil {
                Image(systemName: "exclamationmark.triangle.fill").font(.system(size: 16, weight: .bold))
            } else if let c = s.payload?.current {
                Text(glyph(c, at: s.date)).font(.system(size: 18))
            } else {
                Image(systemName: "cloud.slash")
            }
            Text(temp(s.payload?.current.temp)).font(.system(size: 16, weight: .semibold))
        }
    }
}

struct LockInlineView: View {
    let s: Snapshot
    var body: some View {
        if let w = s.warnings.first {
            Text("\(Image(systemName: "exclamationmark.triangle.fill")) \(w.level.capitalized) · \(shortHeadline(w.headline))")
        } else if let c = s.payload?.current {
            Text("\(glyph(c, at: s.date)) \(temp(c.temp)) \(c.condition ?? "")")
        } else {
            Text("WeatherTempo: open app")
        }
    }
}

struct Unavailable: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(placeName.uppercased()).font(.system(size: 10, weight: .medium))
            Text("No weather yet").font(.system(size: 15, weight: .semibold))
            Text("Will retry shortly.").font(.system(size: 11)).opacity(0.8)
        }
        .foregroundStyle(skyText)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }
}

struct EntryView: View {
    @Environment(\.widgetFamily) private var family
    let entry: Entry

    var body: some View {
        switch family {
        case .systemSmall:
            SmallView(s: entry.snapshot).containerBackground(for: .widget) { Sky() }
        case .systemMedium:
            MediumView(s: entry.snapshot).containerBackground(for: .widget) { Sky() }
        case .systemLarge:
            LargeView(s: entry.snapshot).containerBackground(for: .widget) { Sky() }
        case .accessoryRectangular:
            LockRectangularView(s: entry.snapshot).containerBackground(for: .widget) { Color.clear }
        case .accessoryCircular:
            LockCircularView(s: entry.snapshot).containerBackground(for: .widget) { Color.clear }
        case .accessoryInline:
            LockInlineView(s: entry.snapshot).containerBackground(for: .widget) { Color.clear }
        default:
            MediumView(s: entry.snapshot).containerBackground(for: .widget) { Sky() }
        }
    }
}

struct WeatherTempoWidget: Widget {
    let kind = "WeatherTempoWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: Provider()) { entry in
            EntryView(entry: entry)
        }
        .configurationDisplayName("WeatherTempo")
        .description("Current conditions, the next 30 hours and MetService warnings for Christchurch.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge, .accessoryRectangular, .accessoryCircular, .accessoryInline])
    }
}

@main
struct WeatherTempoWidgets: WidgetBundle {
    var body: some Widget {
        WeatherTempoWidget()
    }
}
