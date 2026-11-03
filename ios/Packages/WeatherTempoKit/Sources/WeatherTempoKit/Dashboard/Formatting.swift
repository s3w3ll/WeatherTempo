import Foundation

/// Time and number formatting that matches the web app's output (`fmtHourOnly`,
/// `fmtShortTime`, `fmtRelative`, and the `.replace(/ (am|pm)$/i, "$1")` compaction).
/// Built from Calendar components rather than DateFormatter so "2pm" / "6:32am" are
/// identical on every device and locale, and trivially testable.
public enum TimeFormat {
    public static let dash = "—"

    public static func calendar(_ timeZone: TimeZone) -> Calendar {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = timeZone
        return c
    }

    private static func parts(_ utcSec: Double?, _ tz: TimeZone) -> (h12: Int, minute: Int, suffix: String)? {
        // The JS treats 0 and null alike ("!utcSec").
        guard let s = utcSec, s != 0 else { return nil }
        let c = calendar(tz)
        let d = Date(timeIntervalSince1970: s)
        let h = c.component(.hour, from: d)
        return (h % 12 == 0 ? 12 : h % 12, c.component(.minute, from: d), h < 12 ? "am" : "pm")
    }

    /// "2pm", "10am", "12am"; "—" when missing.
    public static func hour(_ utcSec: Double?, in tz: TimeZone) -> String {
        guard let p = parts(utcSec, tz) else { return dash }
        return "\(p.h12)\(p.suffix)"
    }

    /// "6:32am" (compact) or "6:32 am" (spaced, used for sunrise/sunset); "—" when missing.
    public static func hourMinute(_ utcSec: Double?, in tz: TimeZone, spaced: Bool = false) -> String {
        guard let p = parts(utcSec, tz) else { return dash }
        return "\(p.h12):\(String(format: "%02d", p.minute))\(spaced ? " " : "")\(p.suffix)"
    }

    /// "just now", "12 min ago", "3h ago"; "—" when unknown. Same thresholds as `fmtRelative`.
    public static func relative(since date: Date?, now: Date = Date()) -> String {
        guard let date else { return dash }
        let minutes = now.timeIntervalSince(date) / 60
        if minutes < 2 { return "just now" }
        if minutes < 60 { return "\(Int(minutes.rounded())) min ago" }
        return "\(Int((minutes / 60).rounded()))h ago"
    }

    /// "Tuesday" / "Tue"
    public static func weekday(_ utcSec: Double, in tz: TimeZone, long: Bool = true) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_NZ")
        f.timeZone = tz
        f.dateFormat = long ? "EEEE" : "EEE"
        return f.string(from: Date(timeIntervalSince1970: utcSec))
    }

    /// "4 Nov"
    public static func dayMonth(_ utcSec: Double, in tz: TimeZone) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_NZ")
        f.timeZone = tz
        f.dateFormat = "d MMM"
        return f.string(from: Date(timeIntervalSince1970: utcSec))
    }

    /// yyyyMMdd as an Int in the given calendar: equal keys = same local calendar day.
    static func dayKey(_ utcSec: Double, in cal: Calendar) -> Int {
        let c = cal.dateComponents([.year, .month, .day], from: Date(timeIntervalSince1970: utcSec))
        return (c.year ?? 0) * 10_000 + (c.month ?? 0) * 100 + (c.day ?? 0)
    }
}

public enum NumberFormat {
    /// 6.5 -> "6.5", 7.0 -> "7", 7.04 -> "7" (JS prints these numbers raw; the Worker rounds to 1 dp).
    public static func trimmed(_ v: Double) -> String {
        let r = (v * 10).rounded() / 10
        return r == r.rounded() ? String(Int(r)) : String(format: "%.1f", r)
    }

    public static func rounded(_ v: Double?, suffix: String = "") -> String {
        v.map { "\(Int($0.rounded()))\(suffix)" } ?? TimeFormat.dash
    }
}

/// Emoji and compass helpers (`iconFor`, `MOON_EMOJI`, `degToCard` in app.js).
public enum WeatherGlyph {
    /// TWC icon code -> emoji. `dayOrNight` "N" = night, anything else (incl. nil) = day.
    public static func emoji(iconCode: Int?, dayOrNight: String?) -> String {
        let day = dayOrNight != "N"
        let code = iconCode ?? 0   // JS: +null === 0
        switch code {
        case 32, 36: return "☀️"
        case 31: return "🌙"
        case 30, 34: return day ? "⛅" : "☁️"
        case 29, 33, 27, 28: return day ? "🌥️" : "☁️"
        case 26: return "☁️"
        case 9, 11: return "🌦️"
        case 12, 39, 40: return "🌧️"
        case 13, 14, 15, 16, 41, 42, 43, 46: return "❄️"
        case 17, 18, 35, 37, 38, 47: return "⛈️"
        case 19, 20, 21, 22: return "🌫️"
        case 23, 24: return "💨"
        default: return day ? "⛅" : "☁️"
        }
    }

    public static func moon(code: String?) -> String {
        switch code {
        case "NM", "WNM": return "🌑"
        case "WXC": return "🌒"
        case "FQ": return "🌓"
        case "WXG": return "🌔"
        case "FM": return "🌕"
        case "WNG": return "🌖"
        case "LQ": return "🌗"
        case "WNC": return "🌘"
        default: return "🌕"
        }
    }

    private static let points = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
                                 "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"]

    public static func cardinal(degrees: Double) -> String {
        let i = Int((degrees / 22.5).rounded()) % 16
        return points[(i + 16) % 16]
    }
}
