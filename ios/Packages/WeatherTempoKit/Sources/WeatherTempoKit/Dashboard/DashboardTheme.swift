import SwiftUI
#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

/// An sRGB colour as plain numbers, so contrast can be computed (and unit-tested) without
/// going through SwiftUI's opaque `Color`.
struct RGB: Equatable {
    let r: Double, g: Double, b: Double
    init(_ r: Double, _ g: Double, _ b: Double) { self.r = r; self.g = g; self.b = b }

    var color: Color { Color(r: r, g: g, b: b) }

    #if canImport(UIKit)
    func platform(_ a: Double) -> UIColor { UIColor(red: r / 255, green: g / 255, blue: b / 255, alpha: a) }
    #elseif canImport(AppKit)
    func platform(_ a: Double) -> NSColor { NSColor(srgbRed: r / 255, green: g / 255, blue: b / 255, alpha: a) }
    #endif

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
    static let fade = RGB(88, 108, 130)
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
    static let amberText = RGB(133, 77, 0)

    /// Dark-mode twins. Text keeps >= 4.5:1 on `Dark.card` (AccessibilityContrastTests).
    enum Dark {
        static let page = RGB(13, 19, 30)
        /// The dark card colour (88 % over `page`), pre-blended.
        static let card = RGB(24, 32, 46)
        static let text = RGB(226, 232, 242)
        static let strong = RGB(245, 248, 252)
        static let muted = RGB(150, 170, 196)
        static let fade = RGB(140, 158, 180)
        static let warmText = RGB(255, 170, 90)
        static let cyanText = RGB(90, 205, 235)
        static let redText = RGB(255, 120, 140)
        static let blue = RGB(110, 160, 255)
        static let amberText = RGB(255, 190, 90)
    }
}

extension Color {
    /// A colour that follows light / dark mode. Built on the platform's dynamic colours, so
    /// it resolves wherever SwiftUI draws it (views, Canvas, widgets) without plumbing.
    static func adaptive(_ light: RGB, _ dark: RGB, lightAlpha: Double = 1, darkAlpha: Double = 1) -> Color {
        #if canImport(UIKit)
        return Color(uiColor: UIColor { $0.userInterfaceStyle == .dark ? dark.platform(darkAlpha) : light.platform(lightAlpha) })
        #elseif canImport(AppKit)
        return Color(nsColor: NSColor(name: nil) { appearance in
            appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? dark.platform(darkAlpha) : light.platform(lightAlpha)
        })
        #else
        return light.color
        #endif
    }
}

/// Colours from the web theme's CSS variables (style.css `:root`), adjusted where the web
/// values fail WCAG AA contrast for small text. Each follows light / dark mode; the bright
/// graphics colours (warm, cyan, red, green) read on both, so they stay fixed.
enum Theme {
    static let bg = Color.adaptive(ThemeRGB.page, ThemeRGB.Dark.page)
    static let bgGlowTop = Color.adaptive(RGB(120, 170, 230), RGB(40, 80, 150), lightAlpha: 0.22, darkAlpha: 0.30)
    static let bgGlowBottom = Color.adaptive(RGB(220, 210, 255), RGB(70, 50, 120), lightAlpha: 0.32, darkAlpha: 0.30)
    static let text = Color.adaptive(ThemeRGB.text, ThemeRGB.Dark.text)
    static let strong = Color.adaptive(ThemeRGB.strong, ThemeRGB.Dark.strong)
    static let muted = Color.adaptive(ThemeRGB.muted, ThemeRGB.Dark.muted)
    static let fade = Color.adaptive(ThemeRGB.fade, ThemeRGB.Dark.fade)
    static let warm = ThemeRGB.warm.color
    static let cyan = ThemeRGB.cyan.color
    static let red = ThemeRGB.red.color
    static let green = ThemeRGB.green.color
    static let blue = Color.adaptive(ThemeRGB.blue, ThemeRGB.Dark.blue)
    /// Darker twins of warm/cyan/red for *text* (lighter ones in dark mode); the bright ones
    /// stay for arrows and curves.
    static let warmText = Color.adaptive(ThemeRGB.warmText, ThemeRGB.Dark.warmText)
    static let cyanText = Color.adaptive(ThemeRGB.cyanText, ThemeRGB.Dark.cyanText)
    static let redText = Color.adaptive(ThemeRGB.redText, ThemeRGB.Dark.redText)
    static let amberText = Color.adaptive(ThemeRGB.amberText, ThemeRGB.Dark.amberText)
    static let card = Color.adaptive(RGB(255, 255, 255), ThemeRGB.Dark.card, lightAlpha: 0.72, darkAlpha: 0.88)
    static let cardBorder = Color.adaptive(RGB(255, 255, 255), RGB(255, 255, 255), lightAlpha: 0.9, darkAlpha: 0.08)
    static let separator = Color.adaptive(RGB(20, 40, 80), RGB(255, 255, 255), lightAlpha: 0.10, darkAlpha: 0.12)
    static let cardShadow = Color.adaptive(RGB(20, 40, 80), RGB(0, 0, 0), lightAlpha: 0.06, darkAlpha: 0.35)
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
            .shadow(color: Theme.cardShadow, radius: 8, y: 2)
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
