import Foundation
import ImageIO
#if canImport(AppKit)
import AppKit
#endif
import SwiftUI
import Testing
import UniformTypeIdentifiers
@testable import WeatherTempoKit

/// Renders the whole dashboard (iPhone width) to PNG so the layout can be reviewed from CI
/// artifacts without a Mac. Same METEOGRAM_OUT convention as the chart snapshots.
@MainActor @Suite struct DashboardSnapshotTests {

    private func render(_ state: DashboardState, width: CGFloat = 390) throws -> CGImage {
        let view = DashboardContent(state: state)
            .frame(width: width)
            .fixedSize(horizontal: false, vertical: true)
            .background(DashboardBackground())
            .environment(\.staticRender, true)   // ImageRenderer can't draw ScrollViews or menu Pickers
        let renderer = ImageRenderer(content: view)
        renderer.scale = 2
        return try #require(renderer.cgImage, "ImageRenderer produced no image")
    }

    private func save(_ image: CGImage, named name: String) throws {
        guard let dir = ProcessInfo.processInfo.environment["METEOGRAM_OUT"], !dir.isEmpty else { return }
        let dirURL = URL(fileURLWithPath: dir, isDirectory: true)
        try FileManager.default.createDirectory(at: dirURL, withIntermediateDirectories: true)
        let url = dirURL.appendingPathComponent("\(name).png")
        let dest = try #require(CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil))
        CGImageDestinationAddImage(dest, image, nil)
        #expect(CGImageDestinationFinalize(dest))
    }

    @Test func rendersFullDashboard() throws {
        let image = try render(.sample)
        #expect(image.width == 780)
        #expect(image.height > 2 * 1500, "dashboard should be a tall scrolling page, got \(image.height / 2) pt")
        try save(image, named: "dashboard-christchurch")
    }

    @Test func rendersChartZoomLevels() throws {
        // The selected days fill the viewport: 5 = whole forecast visible, 2 = scroll for the rest.
        for days in [5, 2] {
            var state = DashboardState.sample
            state.chartDays = days
            try save(try render(state), named: "dashboard-\(days)day-zoom")
        }
    }

    @Test func rendersAtAccessibilityTextSize() throws {
        // Dynamic Type at an accessibility size: stats go to one column, headers stack.
        let view = DashboardContent(state: .sample)
            .frame(width: 390)
            .fixedSize(horizontal: false, vertical: true)
            .background(DashboardBackground())
            .environment(\.staticRender, true)
            .environment(\.dynamicTypeSize, .accessibility1)
        let renderer = ImageRenderer(content: view)
        renderer.scale = 2
        try save(try #require(renderer.cgImage), named: "dashboard-accessibility1")
    }

    @Test func rendersMetServiceWarnings() throws {
        var state = DashboardState.sample      // Tue 3 Nov, 2pm
        state.warnings = [
            try #require(CAPParser.warning(capXML(id: "snap-orange", onset: "2026-11-03T20:00:00+13:00",
                                                  expires: "2026-11-04T09:00:00+13:00"))),
            try #require(CAPParser.warning(capXML(id: "snap-yellow", headline: "Strong Wind Watch", colour: "Yellow",
                                                  onset: "2026-11-04T06:00:00+13:00", expires: "2026-11-04T18:00:00+13:00",
                                                  area: "Canterbury High Country"))),
        ]
        try save(try render(state), named: "dashboard-warnings")
    }

    @Test func rendersInDarkMode() throws {
        let view = DashboardContent(state: .sample)
            .frame(width: 390)
            .fixedSize(horizontal: false, vertical: true)
            .background(DashboardBackground())
            .environment(\.staticRender, true)
            .environment(\.colorScheme, .dark)
        let renderer = ImageRenderer(content: view)
        renderer.scale = 2
        // The theme's colours are platform dynamic colours; on the Mac test host they follow
        // the drawing appearance, so render under the dark one.
        var image: CGImage?
        #if canImport(AppKit) && !targetEnvironment(macCatalyst)
        NSAppearance(named: .darkAqua)!.performAsCurrentDrawingAppearance { image = renderer.cgImage }
        #else
        image = renderer.cgImage
        #endif
        try save(try #require(image), named: "dashboard-dark")
    }

    @Test func rendersInlandLocationWithoutTides() throws {
        var state = DashboardState.sample
        state.location = .named("hamilton")
        let image = try render(state)
        try save(image, named: "dashboard-inland")
    }

    @Test func rendersOfflineBannerOverCachedData() throws {
        var state = DashboardState.sample
        state.banner = StatusPolicy.banner(
            payload: state.payload, lastRefreshFailed: true, now: state.now.addingTimeInterval(20 * 60))
        try save(try render(state), named: "dashboard-offline")
    }

    @Test func rendersLoadingAndErrorStates() throws {
        try save(try render(DashboardState(location: .named("christchurch"), payload: nil)), named: "dashboard-loading")
        let error = DashboardState(
            location: .named("christchurch"), payload: nil,
            banner: StatusPolicy.banner(payload: nil, lastRefreshFailed: true))
        try save(try render(error), named: "dashboard-error")
    }
}
