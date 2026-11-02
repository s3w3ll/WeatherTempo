import SwiftUI

/// Pixel zones of the swimlane meteogram. Values are copied from `ZONE` in src/chart.js
/// and must keep the 70/15/15 split: main 224 px, wind 48 px, precip 48 px
/// (a 320 px data area) with 4 px gaps, then the 32 px time/day axis.
public enum ChartZone {
    public static let top: Double = 0
    public static let cloudTop: Double = 8
    public static let cloudBot: Double = 50
    public static let tempTop: Double = 45
    public static let tempBot: Double = 224   // main zone: 224 px (70 % of 320)
    public static let windTop: Double = 228   // wind zone: 48 px (15 %), 4 px gap above
    public static let windBot: Double = 276
    public static let precipTop: Double = 280 // precip zone: 48 px (15 %), 4 px gap above
    public static let precipBot: Double = 328
    public static let timeTop: Double = 332   // hour labels
    public static let dayAxisTop: Double = 348 // day name strip
    public static let height: Double = 364
}

public enum ChartPad {
    public static let left: Double = 6
    public static let right: Double = 6
}

extension Color {
    /// CSS-style rgba(): channels 0-255, alpha 0-1. Keeps ported colours readable
    /// side by side with chart.js.
    init(r: Double, g: Double, b: Double, a: Double = 1) {
        self.init(.sRGB, red: r / 255, green: g / 255, blue: b / 255, opacity: a)
    }
}

/// Colours used by the chart. `light` is the current web theme (`C` in chart.js plus the
/// literals scattered through its draw methods). A `dark` palette can be added later
/// without touching the renderer.
public struct ChartPalette: Sendable {
    public var bg: Color
    public var bgDay: Color
    public var bgNight: Color
    public var tempFillTop: Color
    public var tempFillBottom: Color
    public var tempLine: Color
    public var feelsLine: Color
    public var pressLine: Color
    public var nowLine: Color
    public var nowLabel: Color
    public var grid: Color
    public var dayDivider: Color
    public var zoneSeparator: Color
    public var text: Color
    public var textMuted: Color
    public var halo: Color
    public var cloud: Color
    public var dayAxisBackground: Color
    public var windFillTop: Color
    public var windFillBottom: Color
    public var windLine: Color
    public var windShadow: Color
    public var windArrow: Color
    public var precipAreaTop: Color
    public var precipAreaBottom: Color
    public var precipLine: Color
    public var precipShadow: Color
    public var hoverLine: Color

    public static let light = ChartPalette(
        bg:               Color(r: 245, g: 248, b: 252),
        bgDay:            Color(r: 255, g: 200, b: 120, a: 0.38),
        bgNight:          Color(r: 20,  g: 40,  b: 80,  a: 0.14),
        tempFillTop:      Color(r: 255, g: 140, b: 20,  a: 0.28),
        tempFillBottom:   Color(r: 255, g: 160, b: 30,  a: 0.04),
        tempLine:         Color(r: 234, g: 124, b: 28),
        feelsLine:        Color(r: 10,  g: 165, b: 200, a: 0.85),
        pressLine:        Color(r: 20,  g: 40,  b: 80,  a: 0.30),
        nowLine:          Color(r: 20,  g: 40,  b: 80,  a: 0.55),
        nowLabel:         Color(r: 255, g: 255, b: 255, a: 0.7),
        grid:             Color(r: 20,  g: 40,  b: 80,  a: 0.07),
        dayDivider:       Color(r: 20,  g: 40,  b: 80,  a: 0.10),
        zoneSeparator:    Color(r: 255, g: 255, b: 255, a: 0.28),
        text:             Color(r: 26,  g: 38,  b: 64),
        textMuted:        Color(r: 86,  g: 112, b: 142),
        halo:             Color(r: 245, g: 248, b: 252, a: 0.8),
        cloud:            Color(r: 255, g: 255, b: 255, a: 0.95),
        dayAxisBackground: Color(r: 0,  g: 0,   b: 0,   a: 0.18),
        windFillTop:      Color(r: 220, g: 60,  b: 50,  a: 0.22),
        windFillBottom:   Color(r: 220, g: 60,  b: 50,  a: 0.03),
        windLine:         Color(r: 255, g: 90,  b: 70,  a: 0.60),
        windShadow:       Color(r: 255, g: 80,  b: 60,  a: 0.35),
        windArrow:        Color(r: 255, g: 90,  b: 70,  a: 0.85),
        precipAreaTop:    Color(r: 60,  g: 150, b: 255, a: 0.22),
        precipAreaBottom: Color(r: 60,  g: 150, b: 255, a: 0.02),
        precipLine:       Color(r: 60,  g: 150, b: 255, a: 0.85),
        precipShadow:     Color(r: 60,  g: 150, b: 255, a: 0.40),
        // chart.js draws its hover line in white, which vanishes on the light theme.
        hoverLine:        Color(r: 20,  g: 40,  b: 80,  a: 0.55)
    )
}
