import SwiftUI

/// Widget sizes, independent of WidgetKit so these views can be snapshot-tested on the
/// CI runner. The extension maps `WidgetFamily` onto this.
public enum WidgetSize: Equatable, Sendable {
    case small, medium, large
    case lockRectangular, lockCircular, lockInline

    /// Home-screen widgets sit on the sky gradient; lock-screen ones use the system tint.
    public var usesSkyBackground: Bool {
        switch self {
        case .small, .medium, .large: return true
        case .lockRectangular, .lockCircular, .lockInline: return false
        }
    }
}

/// The large widget's fixed blue "sky" card (`skyTop/Mid/Bot` in the Scriptable widget).
public struct WidgetBackground: View {
    public init() {}

    public var body: some View {
        LinearGradient(
            stops: [
                .init(color: Color(r: 28, g: 63, b: 116), location: 0),
                .init(color: Color(r: 46, g: 92, b: 143), location: 0.55),
                .init(color: Color(r: 74, g: 125, b: 176), location: 1),
            ],
            startPoint: .top, endPoint: .bottom)
    }
}

private enum Sky {
    static let text = Color.white
    static let muted = Color(r: 169, g: 201, b: 232)
    static let cyan = Color(r: 95, g: 214, b: 242)
}

/// All widget layouts. Pure SwiftUI over a `WidgetSnapshot`; the extension adds only the
/// timeline plumbing.
public struct WeatherWidgetView: View {
    let size: WidgetSize
    let snapshot: WidgetSnapshot

    public init(size: WidgetSize, snapshot: WidgetSnapshot) {
        self.size = size
        self.snapshot = snapshot
    }

    public var body: some View {
        if let payload = snapshot.payload {
            let insights = WeatherInsights(payload: payload, now: snapshot.date, timeZone: snapshot.location.timeZone)
            switch size {
            case .small: SmallWidget(snapshot: snapshot, payload: payload, insights: insights)
            case .medium: MediumWidget(snapshot: snapshot, payload: payload, insights: insights)
            case .large: LargeWidget(snapshot: snapshot, payload: payload, insights: insights)
            case .lockRectangular: LockRectangular(payload: payload, insights: insights)
            case .lockCircular: LockCircular(payload: payload, insights: insights)
            case .lockInline: LockInline(payload: payload, insights: insights)
            }
        } else {
            Unavailable(size: size, location: snapshot.location)
        }
    }
}

// MARK: - Shared bits

private func temp(_ v: Double?) -> String { v.map { "\(Int($0.rounded()))°" } ?? "—" }

private func hiLo(_ insights: WeatherInsights, _ c: WeatherPayload.Current) -> String {
    let hl = insights.displayHighLow
    return "\(temp(hl?.high.temp ?? c.tempMax24h)) / \(temp(hl?.low.temp ?? c.tempMin24h))"
}

private func conditionText(_ c: WeatherPayload.Current) -> String { c.condition ?? c.cloudPhrase ?? "—" }

private func updatedText(_ payload: WeatherPayload, _ now: Date) -> String {
    "Updated \(TimeFormat.relative(since: payload.updatedDate, now: now))"
}

// MARK: - Small

private struct SmallWidget: View {
    let snapshot: WidgetSnapshot
    let payload: WeatherPayload
    let insights: WeatherInsights

    var body: some View {
        let c = payload.current
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text(snapshot.location.name.uppercased())
                    .font(.system(size: 10, weight: .medium)).foregroundStyle(Sky.muted).lineLimit(1)
                Spacer(minLength: 4)
                Text(insights.currentGlyph).font(.system(size: 18))
            }
            Spacer(minLength: 2)
            Text(temp(c.temp)).font(.system(size: 38, weight: .bold)).foregroundStyle(Sky.text)
                .minimumScaleFactor(0.8).lineLimit(1)
            Text(conditionText(c)).font(.system(size: 12)).foregroundStyle(Sky.muted).lineLimit(1)
            Spacer(minLength: 2)
            HStack {
                Text("Feels \(temp(c.feelsLike))")
                Spacer(minLength: 2)
                Text(hiLo(insights, c))
            }
            .font(.system(size: 10)).foregroundStyle(Sky.muted).lineLimit(1).minimumScaleFactor(0.8)
        }
    }
}

// MARK: - Medium

private struct MediumWidget: View {
    let snapshot: WidgetSnapshot
    let payload: WeatherPayload
    let insights: WeatherInsights

    var body: some View {
        let c = payload.current
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .center) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(snapshot.location.name.uppercased())
                        .font(.system(size: 10, weight: .medium)).foregroundStyle(Sky.muted)
                    HStack(spacing: 6) {
                        Text(insights.currentGlyph).font(.system(size: 26))
                        Text(temp(c.temp)).font(.system(size: 34, weight: .bold)).foregroundStyle(Sky.text)
                    }
                    Text(conditionText(c)).font(.system(size: 11)).foregroundStyle(Sky.muted).lineLimit(1)
                    if let rain = insights.nextRainToday {
                        Text(rain.summary(in: snapshot.location.timeZone))
                            .font(.system(size: 10, weight: .semibold)).foregroundStyle(Sky.cyan).lineLimit(1)
                    }
                }
                Spacer(minLength: 8)
                VStack(alignment: .leading, spacing: 4) {
                    stat("Feels", temp(c.feelsLike))
                    stat("Hi/Lo", hiLo(insights, c))
                    stat("Wind", "\(c.windSpeed.map { NumberFormat.trimmed($0) } ?? "—") km/h \(insights.currentWindCardinal)")
                    stat("Humidity", c.humidity.map { "\(NumberFormat.trimmed($0))%" } ?? "—")
                }
            }
            Spacer(minLength: 4)
            Text(updatedText(payload, snapshot.date)).font(.system(size: 9)).foregroundStyle(Sky.muted)
        }
    }

    private func stat(_ label: String, _ value: String) -> some View {
        HStack(spacing: 6) {
            Text(label).font(.system(size: 10)).foregroundStyle(Sky.muted)
            Spacer(minLength: 0)
            Text(value).font(.system(size: 10, weight: .medium)).foregroundStyle(Sky.text).lineLimit(1)
        }
        .frame(width: 118)
    }
}

// MARK: - Large

private struct LargeWidget: View {
    let snapshot: WidgetSnapshot
    let payload: WeatherPayload
    let insights: WeatherInsights

    private var tz: TimeZone { snapshot.location.timeZone }

    var body: some View {
        let c = payload.current
        VStack(alignment: .leading, spacing: 6) {
            header(c)
            rainLine
            WidgetChart(insights: insights, now: snapshot.date, tz: tz)
            DailyStrip(cells: insights.dailyStrip)
        }
    }

    private func header(_ c: WeatherPayload.Current) -> some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(temp(c.temp)).font(.system(size: 28, weight: .bold)).foregroundStyle(Sky.text)
                    Text(insights.currentGlyph).font(.system(size: 20))
                }
                Text("FEELS LIKE \(temp(c.feelsLike))")
                    .font(.system(size: 10, weight: .semibold)).foregroundStyle(Sky.muted)
                if payload.isStale(now: snapshot.date) {
                    Text(updatedText(payload, snapshot.date))
                        .font(.system(size: 9)).foregroundStyle(Sky.cyan)
                }
            }
            Spacer(minLength: 8)
            HStack(alignment: .top, spacing: 14) {
                column([("WIND", c.windSpeed.map { "\(Int($0.rounded())) km/h" } ?? "—"),
                        ("UV", c.uvIndex.map { "\(Int($0.rounded()))" } ?? "—")])
                column([("HUMIDITY", c.humidity.map { "\(Int($0.rounded()))%" } ?? "—"),
                        ("PRESSURE", c.pressure.map { "\(Int($0.rounded())) hPa" } ?? "—")])
            }
        }
    }

    private func column(_ rows: [(String, String)]) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            ForEach(Array(rows.enumerated()), id: \.offset) { _, r in
                HStack(spacing: 8) {
                    Text(r.0).font(.system(size: 9, weight: .semibold)).foregroundStyle(Sky.muted)
                    Text(r.1).font(.system(size: 11, weight: .semibold)).foregroundStyle(Sky.text)
                }
            }
        }
    }

    @ViewBuilder private var rainLine: some View {
        if let rain = insights.nextRainToday {
            Text(rain.summary(in: tz))
                .font(.system(size: 10, weight: .semibold)).foregroundStyle(Sky.cyan).lineLimit(1)
        }
    }
}

/// The next 30 hours on the compact meteogram layout, scaled to the widget's width.
private struct WidgetChart: View {
    let insights: WeatherInsights
    let now: Date
    let tz: TimeZone

    var body: some View {
        GeometryReader { geo in
            let hours = insights.upcomingHours(limit: 30)
            let pph = max(4, (geo.size.width - ChartPad.left - ChartPad.right) / Double(max(hours.count, 1)))
            MeteogramCanvas(
                model: MeteogramModel(hours: hours, pxPerHour: pph, now: now, timeZone: tz, layout: .compact),
                palette: .sky)
        }
        .frame(height: ChartLayout.compact.height)
    }
}

private struct DailyStrip: View {
    let cells: [WeatherInsights.DailyCell]

    var body: some View {
        HStack(spacing: 0) {
            ForEach(cells) { c in
                VStack(spacing: 2) {
                    Text(c.label).font(.system(size: 10, weight: .semibold)).foregroundStyle(Sky.muted)
                    Text(temp(c.high)).font(.system(size: 13, weight: .semibold)).foregroundStyle(Sky.text)
                    Text(temp(c.low)).font(.system(size: 11)).foregroundStyle(Sky.muted)
                    if let p = c.rainChance, p >= 20 {
                        Text("\(Int(p.rounded()))%").font(.system(size: 9, weight: .medium)).foregroundStyle(Sky.cyan)
                    } else {
                        Text(" ").font(.system(size: 9))
                    }
                }
                .frame(maxWidth: .infinity)
            }
        }
    }
}

// MARK: - Lock screen

private struct LockRectangular: View {
    let payload: WeatherPayload
    let insights: WeatherInsights

    var body: some View {
        let c = payload.current
        VStack(alignment: .leading, spacing: 1) {
            HStack(spacing: 4) {
                Text(insights.currentGlyph)
                Text(temp(c.temp)).fontWeight(.semibold)
                Text(conditionText(c)).lineLimit(1)
            }
            .font(.headline)
            Text("H/L \(hiLo(insights, c))").font(.caption)
            Text(insights.nextRainToday?.summary(in: insights.timeZone)
                 ?? "Wind \(c.windSpeed.map { "\(Int($0.rounded()))" } ?? "—") km/h \(insights.currentWindCardinal)")
                .font(.caption).lineLimit(1)
        }
    }
}

private struct LockCircular: View {
    let payload: WeatherPayload
    let insights: WeatherInsights

    var body: some View {
        VStack(spacing: 0) {
            Text(insights.currentGlyph).font(.system(size: 18))
            Text(temp(payload.current.temp)).font(.system(size: 16, weight: .semibold))
        }
    }
}

private struct LockInline: View {
    let payload: WeatherPayload
    let insights: WeatherInsights

    var body: some View {
        Text("\(insights.currentGlyph) \(temp(payload.current.temp)) \(conditionText(payload.current))")
    }
}

// MARK: - No data

private struct Unavailable: View {
    let size: WidgetSize
    let location: Location

    var body: some View {
        switch size {
        case .lockCircular:
            Image(systemName: "cloud.slash")
        case .lockInline:
            Text("WeatherTempo: open app")
        default:
            VStack(alignment: .leading, spacing: 4) {
                Text(location.name.uppercased()).font(.system(size: 10, weight: .medium))
                Text("No weather yet").font(.system(size: 15, weight: .semibold))
                Text("Open WeatherTempo to load data.").font(.system(size: 11)).opacity(0.8)
            }
            .foregroundStyle(size.usesSkyBackground ? Sky.text : .primary)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        }
    }
}
