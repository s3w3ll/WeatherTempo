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
            // Darker than the Scriptable widget's gradient: its light-blue bottom stop gave the
            // muted and cyan text only ~2.5:1 contrast (AccessibilityContrastTests keeps this honest).
            stops: [
                .init(color: ThemeRGB.skyTop.color, location: 0),
                .init(color: ThemeRGB.skyMid.color, location: 0.55),
                .init(color: ThemeRGB.skyBottom.color, location: 1),
            ],
            startPoint: .top, endPoint: .bottom)
    }
}

private enum Sky {
    static let text = ThemeRGB.skyWhite.color
    static let muted = ThemeRGB.skyMuted.color
    static let cyan = ThemeRGB.skyCyan.color
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
            let warnings = snapshot.activeWarnings
            switch size {
            case .small:
                SmallWidget(snapshot: snapshot, payload: payload, insights: insights, warning: warnings.first)
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel(spokenWarnings(warnings, snapshot) + summary(payload, insights))
            case .medium:
                MediumWidget(snapshot: snapshot, payload: payload, insights: insights, warnings: warnings)
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel(spokenWarnings(warnings, snapshot) + summary(payload, insights))
            case .large:
                LargeWidget(snapshot: snapshot, payload: payload, insights: insights, warnings: warnings)
            case .lockRectangular: LockRectangular(payload: payload, insights: insights, warning: warnings.first)
            case .lockCircular: LockCircular(payload: payload, insights: insights, warning: warnings.first)
            case .lockInline: LockInline(payload: payload, insights: insights, warning: warnings.first)
            }
        } else {
            Unavailable(size: size, location: snapshot.location)
        }
    }
}

// MARK: - Shared bits

/// What VoiceOver reads for a widget: the dashboard's conditions sentence plus the rain outlook.
private func summary(_ payload: WeatherPayload, _ insights: WeatherInsights) -> String {
    var s = AccessibilityText.current(payload, insights)
    if let rain = insights.nextRainToday { s += " " + rain.summary(in: insights.timeZone) + "." }
    return s
}

/// Warnings first in what VoiceOver reads ("Orange warning: Heavy Rain Warning - Orange,
/// from Fri 9am to Sat 3am. "), since they matter most.
func spokenWarnings(_ warnings: [WeatherWarning], _ snapshot: WidgetSnapshot) -> String {
    warnings.map { w in
        let when = w.timing(now: snapshot.date, timeZone: snapshot.location.timeZone)
        let lowered = when.prefix(1).lowercased() + String(when.dropFirst())
        return "\(w.level.spokenName): \(w.headline), \(lowered). "
    }.joined()
}

/// A MetService warning as a coloured badge: the level's colour as the fill, so the short
/// headline (no "- Orange" suffix) still says which level it is.
private struct WarningBadge: View {
    let warning: WeatherWarning
    var detail: String? = nil
    var extra = 0
    var fontSize: CGFloat = 10

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: "exclamationmark.triangle.fill").font(.system(size: fontSize - 1, weight: .bold))
            Text(warning.shortHeadline).font(.system(size: fontSize, weight: .bold))
                .lineLimit(1).minimumScaleFactor(0.75).layoutPriority(1)
            if let detail {
                Text(detail).font(.system(size: fontSize, weight: .medium)).lineLimit(1)
            }
            if extra > 0 {
                Text("+\(extra)").font(.system(size: fontSize, weight: .bold))
            }
        }
        .foregroundStyle(ThemeRGB.warningInk(warning.level).color)
        .padding(.horizontal, 7).padding(.vertical, 3)
        .background(ThemeRGB.warningFill(warning.level).color, in: Capsule())
    }
}

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
    let warning: WeatherWarning?

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
            // A warning takes the feels-like row: it's what matters while one is in force.
            if let warning {
                WarningBadge(warning: warning, fontSize: 9)
            } else {
                HStack {
                    Text("Feels \(temp(c.feelsLike))")
                    Spacer(minLength: 2)
                    Text(hiLo(insights, c))
                }
                .font(.system(size: 10)).foregroundStyle(Sky.muted).lineLimit(1).minimumScaleFactor(0.8)
            }
        }
    }
}

// MARK: - Medium

private struct MediumWidget: View {
    let snapshot: WidgetSnapshot
    let payload: WeatherPayload
    let insights: WeatherInsights
    let warnings: [WeatherWarning]

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
            if let w = warnings.first {
                WarningBadge(warning: w, detail: w.timing(now: snapshot.date, timeZone: snapshot.location.timeZone),
                             extra: warnings.count - 1)
            } else {
                Text(updatedText(payload, snapshot.date)).font(.system(size: 9)).foregroundStyle(Sky.muted)
            }
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
    let warnings: [WeatherWarning]

    private var tz: TimeZone { snapshot.location.timeZone }

    var body: some View {
        let c = payload.current
        VStack(alignment: .leading, spacing: 6) {
            Group {
                header(c)
                rainLine
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(spokenWarnings(warnings, snapshot) + AccessibilityText.current(payload, insights)
                                + (insights.nextHoursSummary.map { " Next 12 hours: " + $0 } ?? ""))
            WidgetChart(insights: insights, now: snapshot.date, location: snapshot.location, warnings: warnings)
                .accessibilityHidden(true)
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
            // The widget has no spare height, so a warning takes the stats' place (the chart
            // below still shows wind and pressure).
            if let w = warnings.first {
                warningPanel(w)
            } else {
                HStack(alignment: .top, spacing: 14) {
                    column([("WIND", c.windSpeed.map { "\(Int($0.rounded())) km/h" } ?? "—"),
                            ("UV", uvValue(c))])
                    column([("HUMIDITY", c.humidity.map { "\(Int($0.rounded()))%" } ?? "—"),
                            ("PRESSURE", c.pressure.map { "\(Int($0.rounded())) hPa" } ?? "—")])
                }
            }
        }
    }

    private func warningPanel(_ w: WeatherWarning) -> some View {
        let more = warnings.count - 1
        return VStack(alignment: .leading, spacing: 2) {
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Image(systemName: "exclamationmark.triangle.fill").font(.system(size: 10, weight: .bold))
                Text(w.shortHeadline).font(.system(size: 12, weight: .bold)).lineLimit(1).minimumScaleFactor(0.8)
            }
            Text(w.timing(now: snapshot.date, timeZone: tz)).font(.system(size: 10, weight: .semibold)).lineLimit(1)
            Text(more > 0 ? "+\(more) more · MetService" : "MetService")
                .font(.system(size: 9, weight: .medium))
        }
        .foregroundStyle(ThemeRGB.warningInk(w.level).color)
        .padding(.horizontal, 9).padding(.vertical, 6)
        .frame(maxWidth: 210, alignment: .leading)
        .background(ThemeRGB.warningFill(w.level).color, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
    }

    /// The sun protection window when there is one ("9 · 10am–5pm"), else the UV now.
    private func uvValue(_ c: WeatherPayload.Current) -> String {
        if let sun = insights.sunProtection { return "\(Int(sun.peak.rounded())) · \(sun.compactTimes)" }
        return c.uvIndex.map { "\(Int($0.rounded()))" } ?? "—"
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

    /// The same "next 12 hours" sentence as the dashboard chart; falls back to the old
    /// rain-today line if there's no hourly data to summarise.
    @ViewBuilder private var rainLine: some View {
        if let line = insights.nextHoursSummary ?? insights.nextRainToday?.summary(in: tz) {
            Text(line)
                .font(.system(size: 10, weight: .semibold)).foregroundStyle(Sky.cyan)
                .lineLimit(2).minimumScaleFactor(0.85)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

/// The next 30 hours on the compact meteogram layout, scaled to the widget's width.
private struct WidgetChart: View {
    let insights: WeatherInsights
    let now: Date
    let location: Location
    let warnings: [WeatherWarning]

    var body: some View {
        GeometryReader { geo in
            let hours = insights.upcomingHours(limit: 30)
            let pph = max(4, (geo.size.width - ChartPad.left - ChartPad.right) / Double(max(hours.count, 1)))
            MeteogramCanvas(
                model: MeteogramModel(hours: hours, pxPerHour: pph, now: now, timeZone: location.timeZone,
                                      layout: .compact, latitude: location.lat, longitude: location.lon,
                                      warnings: warnings),
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
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(AccessibilityText.daily(c))
            }
        }
    }
}

// MARK: - Lock screen

private struct LockRectangular: View {
    let payload: WeatherPayload
    let insights: WeatherInsights
    let warning: WeatherWarning?

    var body: some View {
        let c = payload.current
        VStack(alignment: .leading, spacing: 1) {
            HStack(spacing: 4) {
                Text(insights.currentGlyph)
                Text(temp(c.temp)).fontWeight(.semibold)
                Text(conditionText(c)).lineLimit(1)
            }
            .font(.headline)
            // The lock screen is one colour, so the level is spelled out, ahead of the
            // timing so truncation never cuts it off. The warning takes the hi/lo line too.
            if let warning {
                Text("\(Image(systemName: "exclamationmark.triangle.fill")) \(warning.shortHeadline)")
                    .font(.caption.weight(.semibold)).lineLimit(1)
                Text("\(warning.level.name) · \(warning.timing(now: insights.now, timeZone: insights.timeZone))")
                    .font(.caption).lineLimit(1)
            } else {
                Text("H/L \(hiLo(insights, c))").font(.caption)
                Text(insights.nextRainToday?.summary(in: insights.timeZone)
                     ?? "Wind \(c.windSpeed.map { "\(Int($0.rounded()))" } ?? "—") km/h \(insights.currentWindCardinal)")
                    .font(.caption).lineLimit(1)
            }
        }
    }
}

private struct LockCircular: View {
    let payload: WeatherPayload
    let insights: WeatherInsights
    let warning: WeatherWarning?

    var body: some View {
        VStack(spacing: 0) {
            if let warning {
                Image(systemName: "exclamationmark.triangle.fill").font(.system(size: 16, weight: .bold))
                    .accessibilityLabel(warning.level.spokenName)
            } else {
                Text(insights.currentGlyph).font(.system(size: 18))
            }
            Text(temp(payload.current.temp)).font(.system(size: 16, weight: .semibold))
        }
    }
}

private struct LockInline: View {
    let payload: WeatherPayload
    let insights: WeatherInsights
    let warning: WeatherWarning?

    var body: some View {
        if let warning {
            // Inline space is short: level first so it survives truncation.
            Text("\(Image(systemName: "exclamationmark.triangle.fill")) \(warning.level.name) · \(warning.shortHeadline)")
        } else {
            Text("\(insights.currentGlyph) \(temp(payload.current.temp)) \(conditionText(payload.current))")
        }
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
