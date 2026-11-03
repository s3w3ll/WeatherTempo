import Foundation
import ImageIO
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
