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

/// Vertical geometry of the chart as a value, so the same renderer can draw the full
/// dashboard chart (`.web`) or a tighter one for widgets (`.compact`).
public struct ChartLayout: Equatable, Sendable {
    public var cloudTop: Double
    public var cloudBot: Double
    public var tempTop: Double
    public var tempBot: Double
    public var windTop: Double
    public var windBot: Double
    public var precipTop: Double
    public var precipBot: Double
    public var timeTop: Double
    public var dayAxisTop: Double
    public var height: Double
    public var showDayAxis: Bool
    /// UV and dew point curves. Off in widgets, where the chart is too small for them.
    public var detailedLayers: Bool

    /// The dashboard chart: exactly chart.js's `ZONE` (364 px, 70/15/15).
    public static let web = ChartLayout(
        cloudTop: ChartZone.cloudTop, cloudBot: ChartZone.cloudBot,
        tempTop: ChartZone.tempTop, tempBot: ChartZone.tempBot,
        windTop: ChartZone.windTop, windBot: ChartZone.windBot,
        precipTop: ChartZone.precipTop, precipBot: ChartZone.precipBot,
        timeTop: ChartZone.timeTop, dayAxisTop: ChartZone.dayAxisTop,
        height: ChartZone.height, showDayAxis: true, detailedLayers: true)

    /// Widgets: 192 px tall, no day strip (the widget has its own daily row). Labels stay
    /// at their normal 9-11 pt sizes: shrinking the 364 px layout to fit would have made
    /// them unreadable, so the zones are tightened instead.
    public static let compact = ChartLayout(
        cloudTop: 4, cloudBot: 28,
        tempTop: 26, tempBot: 112,
        windTop: 116, windBot: 140,
        precipTop: 144, precipBot: 168,
        timeTop: 172, dayAxisTop: 192,
        height: 192, showDayAxis: false, detailedLayers: false)
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
    public var gustLine: Color
    public var freezingLine: Color
    public var dewLine: Color
    public var uvLine: Color
    public var uvFill: Color
    /// Sunshine glow at full strength (a clear daytime hour); scaled down by cloud cover.
    public var sunGlow: Color

    public static let light = ChartPalette(
        bg:               Color(r: 245, g: 248, b: 252),
        // Daytime base is now a pale, neutral warm: the sunshine glow adds the gold on top
        // only where the sky is actually clear, so overcast days look grey, not sunny.
        bgDay:            Color(r: 255, g: 228, b: 190, a: 0.22),
        bgNight:          Color(r: 20,  g: 40,  b: 80,  a: 0.14),
        tempFillTop:      Color(r: 255, g: 140, b: 20,  a: 0.28),
        tempFillBottom:   Color(r: 255, g: 160, b: 30,  a: 0.04),
        tempLine:         Color(r: 234, g: 124, b: 28),
        feelsLine:        Color(r: 10,  g: 165, b: 200, a: 0.85),
        pressLine:        Color(r: 20,  g: 40,  b: 80,  a: 0.30),
        nowLine:          Color(r: 20,  g: 40,  b: 80,  a: 0.55),
        // chart.js uses white here, which disappears against the white cloud band.
        nowLabel:         Color(r: 20,  g: 40,  b: 80,  a: 0.75),
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
        hoverLine:        Color(r: 20,  g: 40,  b: 80,  a: 0.55),
        gustLine:         Color(r: 200, g: 50,  b: 40,  a: 0.55),
        freezingLine:     Color(r: 40,  g: 110, b: 220, a: 0.55),
        dewLine:          Color(r: 30,  g: 120, b: 200, a: 0.70),
        uvLine:           Color(r: 150, g: 70,  b: 200, a: 0.85),
        uvFill:           Color(r: 150, g: 70,  b: 200, a: 0.10),
        sunGlow:          Color(r: 255, g: 190, b: 60,  a: 0.50)
    )
}

extension ChartPalette {
    /// The large widget's look: transparent over the sky-blue gradient, white text, yellow
    /// temperature, cyan feels-like. Values from COLORS in ios-widget/WeatherTempo.js.
    public static let sky = ChartPalette(
        bg:               .clear,
        bgDay:            Color(r: 255, g: 255, b: 255, a: 0.07),
        bgNight:          Color(r: 8,   g: 20,  b: 45,  a: 0.28),
        tempFillTop:      Color(r: 242, g: 201, b: 76,  a: 0.30),
        tempFillBottom:   Color(r: 242, g: 201, b: 76,  a: 0.02),
        tempLine:         Color(r: 242, g: 201, b: 76),
        feelsLine:        Color(r: 95,  g: 214, b: 242, a: 0.9),
        pressLine:        Color(r: 255, g: 255, b: 255, a: 0.30),
        nowLine:          Color(r: 255, g: 255, b: 255, a: 0.6),
        nowLabel:         Color(r: 255, g: 255, b: 255, a: 0.85),
        grid:             Color(r: 255, g: 255, b: 255, a: 0.10),
        dayDivider:       Color(r: 255, g: 255, b: 255, a: 0.16),
        zoneSeparator:    Color(r: 255, g: 255, b: 255, a: 0.18),
        text:             .white,
        textMuted:        Color(r: 196, g: 219, b: 242),
        halo:             Color(r: 28,  g: 63,  b: 116, a: 0.85),
        cloud:            Color(r: 255, g: 255, b: 255, a: 0.30),
        dayAxisBackground: Color(r: 0,  g: 0,   b: 0,   a: 0.15),
        windFillTop:      Color(r: 229, g: 72,  b: 77,  a: 0.30),
        windFillBottom:   Color(r: 229, g: 72,  b: 77,  a: 0.03),
        windLine:         Color(r: 255, g: 110, b: 110, a: 0.85),
        windShadow:       Color(r: 229, g: 72,  b: 77,  a: 0.35),
        windArrow:        Color(r: 255, g: 120, b: 120, a: 0.95),
        precipAreaTop:    Color(r: 63,  g: 169, b: 245, a: 0.30),
        precipAreaBottom: Color(r: 63,  g: 169, b: 245, a: 0.03),
        precipLine:       Color(r: 127, g: 216, b: 247, a: 0.9),
        precipShadow:     Color(r: 63,  g: 169, b: 245, a: 0.4),
        hoverLine:        Color(r: 255, g: 255, b: 255, a: 0.6),
        gustLine:         Color(r: 255, g: 150, b: 150, a: 0.65),
        freezingLine:     Color(r: 160, g: 210, b: 255, a: 0.7),
        dewLine:          Color(r: 160, g: 210, b: 255, a: 0.7),
        uvLine:           Color(r: 215, g: 170, b: 255, a: 0.9),
        uvFill:           Color(r: 215, g: 170, b: 255, a: 0.12),
        sunGlow:          Color(r: 255, g: 214, b: 90,  a: 0.28)
    )
}
