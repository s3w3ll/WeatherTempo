import CoreGraphics
import SwiftUI
import Testing
@testable import WeatherTempoKit

@Suite struct CurveMathTests {
    private func close(_ a: CGPoint, _ b: CGPoint) -> Bool { abs(a.x - b.x) < 1e-9 && abs(a.y - b.y) < 1e-9 }

    @Test func fewerThanTwoPointsGivesNoSegments() {
        #expect(CurveMath.catmullRom([]).isEmpty)
        #expect(CurveMath.catmullRom([CGPoint(x: 1, y: 1)]).isEmpty)
    }

    /// Expected values worked out by hand from chart.js smoothPath():
    ///   cp1 = p1 + (p2 - p0) / 6      cp2 = p2 - (p3 - p1) / 6
    /// with the end points standing in for their own missing neighbours.
    @Test func matchesHandComputedControlPoints() throws {
        let pts = [CGPoint(x: 0, y: 0), CGPoint(x: 10, y: 10), CGPoint(x: 20, y: 0)]
        let segs = CurveMath.catmullRom(pts)
        #expect(segs.count == 2)

        // i = 1: p0 = pts[0], p1 = pts[0], p2 = pts[1], p3 = pts[2]
        #expect(close(segs[0].control1, CGPoint(x: 10.0 / 6, y: 10.0 / 6)))
        #expect(close(segs[0].control2, CGPoint(x: 10 - 20.0 / 6, y: 10)))
        #expect(close(segs[0].end, pts[1]))

        // i = 2: p0 = pts[0], p1 = pts[1], p2 = pts[2], p3 = pts[2] (clamped)
        #expect(close(segs[1].control1, CGPoint(x: 10 + 20.0 / 6, y: 10)))
        #expect(close(segs[1].control2, CGPoint(x: 20 - 10.0 / 6, y: 10.0 / 6)))
        #expect(close(segs[1].end, pts[2]))
    }

    @Test func straightLineStaysStraight() {
        let pts = (0..<5).map { CGPoint(x: Double($0) * 8, y: 100 - Double($0) * 8) }
        for s in CurveMath.catmullRom(pts) {
            // every control point lies on y = 100 - x
            #expect(abs(s.control1.y - (100 - s.control1.x)) < 1e-9)
            #expect(abs(s.control2.y - (100 - s.control2.x)) < 1e-9)
        }
    }

    @Test func startNewFalseContinuesFromCurrentPoint() {
        var path = Path()
        path.move(to: CGPoint(x: 100, y: 100))
        path.addSmoothCurve(through: [CGPoint(x: 0, y: 0), CGPoint(x: 10, y: 10)], startNew: false)
        // The first drawn element must be the move we made, with no implicit jump to pts[0].
        var elements: [Path.Element] = []
        path.forEach { elements.append($0) }
        #expect(elements.count == 2)  // move + one curve
        if case .move(let to) = elements[0] { #expect(to == CGPoint(x: 100, y: 100)) } else { Issue.record("expected move") }
        if case .curve = elements[1] {} else { Issue.record("expected curve") }
    }
}
