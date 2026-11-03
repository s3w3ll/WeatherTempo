import SwiftUI

/// Colours from the web theme's CSS variables (style.css `:root`). Light theme only for now;
/// the app forces light mode so these fixed colours never end up on a dark background.
enum Theme {
    static let bg = Color(r: 238, g: 242, b: 248)
    static let bgGlowTop = Color(r: 120, g: 170, b: 230, a: 0.22)
    static let bgGlowBottom = Color(r: 220, g: 210, b: 255, a: 0.32)
    static let text = Color(r: 26, g: 38, b: 64)
    static let strong = Color(r: 10, g: 20, b: 38)
    static let muted = Color(r: 86, g: 112, b: 142)
    static let fade = Color(r: 120, g: 146, b: 173)
    static let warm = Color(r: 234, g: 124, b: 28)
    static let cyan = Color(r: 10, g: 165, b: 200)
    static let red = Color(r: 214, g: 59, b: 84)
    static let green = Color(r: 31, g: 159, b: 91)
    static let blue = Color(r: 37, g: 99, b: 216)
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
