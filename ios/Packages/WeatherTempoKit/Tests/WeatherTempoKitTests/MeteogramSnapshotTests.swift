import Foundation
import ImageIO
import SwiftUI
import Testing
import UniformTypeIdentifiers
@testable import WeatherTempoKit

/// Renders the real chart to PNG with ImageRenderer so the drawing code is exercised in CI
/// and a human can look at it. Set METEOGRAM_OUT to a directory to keep the images (CI
/// uploads that directory as an artifact). Without it the test still renders and checks
/// the output is not blank.
@Suite @MainActor struct MeteogramSnapshotTests {

    private func render<V: View>(_ view: V, scale: CGFloat = 2) throws -> CGImage {
        let renderer = ImageRenderer(content: view)
        renderer.scale = scale
        return try #require(renderer.cgImage, "ImageRenderer produced no image")
    }

    private func save(_ image: CGImage, named name: String) throws {
        guard let dir = ProcessInfo.processInfo.environment["METEOGRAM_OUT"], !dir.isEmpty else { return }
        let dirURL = URL(fileURLWithPath: dir, isDirectory: true)
        try FileManager.default.createDirectory(at: dirURL, withIntermediateDirectories: true)
        let url = dirURL.appendingPathComponent("\(name).png")
        let dest = try #require(CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil))
        CGImageDestinationAddImage(dest, image, nil)
        #expect(CGImageDestinationFinalize(dest), "could not write \(name).png")
    }

    /// Number of distinct RGBA values among sampled pixels: a blank or single-colour image scores ~1.
    private func colourVariety(_ image: CGImage) -> Int {
        let w = image.width, h = image.height
        var data = [UInt8](repeating: 0, count: w * h * 4)
        guard let ctx = CGContext(
            data: &data, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
            space: CGColorSpace(name: CGColorSpace.sRGB)!,
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return 0 }
        ctx.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
        var seen = Set<UInt32>()
        for p in stride(from: 0, to: data.count - 3, by: 4 * 7) {
            seen.insert(UInt32(data[p]) << 24 | UInt32(data[p + 1]) << 16 | UInt32(data[p + 2]) << 8 | UInt32(data[p + 3]))
        }
        return seen.count
    }

    private func model(days: Int, viewport: Double = 390) -> MeteogramModel {
        let hours = Array(SampleData.hours().prefix(days * 24))
        return MeteogramModel(
            hours: hours,
            pxPerHour: MeteogramModel.pxPerHour(viewportWidth: viewport, days: days),
            now: SampleData.referenceStart.addingTimeInterval(14 * 3600))
    }

    @Test func rendersTwoDayChart() throws {
        let m = model(days: 2)
        let image = try render(MeteogramCanvas(model: m))
        #expect(image.width == Int(m.width * 2) && image.height == Int(m.height * 2))
        #expect(colourVariety(image) > 50, "chart looks blank")
        try save(image, named: "meteogram-2day")
    }

    @Test func rendersFiveDayChartWithBothDayLabelStyles() throws {
        let m = model(days: 5)
        let image = try render(MeteogramCanvas(model: m))
        #expect(colourVariety(image) > 50)
        try save(image, named: "meteogram-5day")
    }

    @Test func rendersHoverOverlay() throws {
        let m = model(days: 2)
        let composite = ZStack(alignment: .topLeading) {
            MeteogramCanvas(model: m)
            MeteogramHoverLayer(model: m, index: 20)
        }
        let image = try render(composite)
        try save(image, named: "meteogram-hover")
    }

    @Test func rendersWithMissingData() throws {
        // Sparse payload: no pressure, no cloud, no wind direction. Must not crash or go blank.
        let hours = (0..<48).map { i in
            WeatherPayload.Hour(validTimeUtc: SampleData.referenceStart.timeIntervalSince1970 + Double(i) * 3600,
                                temperature: 9 + Double(i % 7), dayOrNight: (6..<20).contains(i % 24) ? "D" : "N")
        }
        let m = MeteogramModel(hours: hours, pxPerHour: 8, now: SampleData.referenceStart)
        let image = try render(MeteogramCanvas(model: m))
        #expect(colourVariety(image) > 10)
        try save(image, named: "meteogram-sparse")
    }
}
