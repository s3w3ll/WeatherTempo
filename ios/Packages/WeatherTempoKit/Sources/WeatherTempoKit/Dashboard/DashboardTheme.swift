import SwiftUI

/// An sRGB colour as plain numbers, so contrast can be computed (and unit-tested) without
/// going through SwiftUI's opaque `Color`.
struct RGB: Equatable {
    let r: Double, g: Double, b: Double
    init(_ r: Double, _ g: Double, _ b: Double) { self.r = r; self.g = g; self.b = b }

    var color: Color { Color(r: r, g: g, b: b) }

    /// WCAG relative luminance.
    var luminance: Double {
        func lin(_ c: Double) -> Double { let v = c / 255; return v <= 0.03928 ? v / 12.92 : pow((v + 0.055) / 1.055, 2.4) }
        return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
    }

    /// WCAG contrast ratio, 1...21. Body text needs 4.5, large/bold text 3.
    func contrast(against other: RGB) -> Double {
        let a = luminance, b = other.luminance
        return (max(a, b) + 0.05) / (min(a, b) + 0.05)
    }
}

/// The raw numbers behind `Theme` and the widget's `Sky` colours.
enum ThemeRGB {
    // Surfaces
    static let page = RGB(238, 242, 248)
    /// The card colour (white at 72 % over `page`), pre-blended.
    static let card = RGB(250, 251, 253)

    // Text on cards (all >= 4.5:1 on `card`, see AccessibilityContrastTests)
    static let text = RGB(26, 38, 64)
    static let strong = RGB(10, 20, 38)
    static let muted = RGB(86, 112, 142)
    static let fade = RGB(96, 117, 138)
    static let warmText = RGB(176, 93, 21)
    static let cyanText = RGB(8, 125, 152)
    static let redText = RGB(208, 57, 81)
    static let blue = RGB(37, 99, 216)

    // Graphics (arrows, curves, dots): brighter, never used for small text
    static let warm = RGB(234, 124, 28)
    static let cyan = RGB(10, 165, 200)
    static let red = RGB(214, 59, 84)
    static let green = RGB(31, 159, 91)

    // Widget "sky": white / muted / cyan text must read on every stop of the gradient
    static let skyTop = RGB(22, 50, 96)
    static let skyMid = RGB(34, 72, 122)
    static let skyBottom = RGB(40, 84, 134)
    static let skyWhite = RGB(255, 255, 255)
    static let skyMuted = RGB(196, 219, 242)
    static let skyCyan = RGB(135, 226, 248)
}

/// Colours from the web theme's CSS variables (style.css `:root`), adjusted where the web
/// values fail WCAG AA contrast for small text. Light theme only for now; the app forces
/// light mode so these fixed colours never end up on a dark background.
enum Theme {
    static let bg = ThemeRGB.page.color
    static let bgGlowTop = Color(r: 120, g: 170, b: 230, a: 0.22)
    static let bgGlowBottom = Color(r: 220, g: 210, b: 255, a: 0.32)
    static let text = ThemeRGB.text.color
    static let strong = ThemeRGB.strong.color
    static let muted = ThemeRGB.muted.color
    static let fade = ThemeRGB.fade.color
    static let warm = ThemeRGB.warm.color
    static let cyan = ThemeRGB.cyan.color
    static let red = ThemeRGB.red.color
    static let green = ThemeRGB.green.color
    static let blue = ThemeRGB.blue.color
    /// Darker twins of warm/cyan/red for *text*; the bright ones stay for arrows and curves.
    static let warmText = ThemeRGB.warmText.color
    static let cyanText = ThemeRGB.cyanText.color
    static let redText = ThemeRGB.redText.color
    static let card = Color.white.opacity(0.72)
    static let cardBorder = Color.white.opacity(0.9)
    static let separator = Color(r: 20, g: 40, b: 80, a: 0.10)
}

private struct StaticRenderKey: EnvironmentKey { static let defaultValue = false }

extension EnvironmentValues {
    /// True when rendering to an image (CI snapshots): ImageRenderer can't draw ScrollView
    /// contents or menu Pickers, so views swap them for static equivalents.
    var staticRender: Bool {
        get { self[StaticRenderKey.self] }
        set { self[StaticRenderKey.self] = newValue }
    }
}

extension View {
    /// The rounded translucent panel every dashboard section sits on.
    func dashboardCard() -> some View {
        padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.card, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(Theme.cardBorder, lineWidth: 1))
            .shadow(color: Color(r: 20, g: 40, b: 80, a: 0.06), radius: 8, y: 2)
    }
}

struct DashboardBackground: View {
    var body: some View {
        ZStack {
            Theme.bg
            RadialGradient(colors: [Theme.bgGlowTop, .clear], center: .topLeading, startRadius: 0, endRadius: 420)
            RadialGradient(colors: [Theme.bgGlowBottom, .clear], center: .bottomTrailing, startRadius: 0, endRadius: 420)
        }
        .ignoresSafeArea()
    }
}


/// A fixed-size font that still follows Dynamic Type. `Font.system(size:)` ignores the user's
/// text size; `@ScaledMetric` scales the number the same way a text style would. Large sizes
/// scale relative to `.largeTitle` so a 56 pt temperature doesn't triple at accessibility sizes.
struct ScaledFont: ViewModifier {
    @ScaledMetric private var size: CGFloat
    private let weight: Font.Weight

    init(size: CGFloat, weight: Font.Weight, style: Font.TextStyle) {
        _size = ScaledMetric(wrappedValue: size, relativeTo: style)
        self.weight = weight
    }

    func body(content: Content) -> some View {
        content.font(.system(size: size, weight: weight))
    }
}

extension View {
    func scaledFont(_ size: CGFloat, weight: Font.Weight = .regular, relativeTo style: Font.TextStyle = .body) -> some View {
        modifier(ScaledFont(size: size, weight: weight, style: style))
    }
}
