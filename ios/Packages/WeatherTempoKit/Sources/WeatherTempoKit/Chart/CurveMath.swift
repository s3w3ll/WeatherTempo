import SwiftUI

public struct BezierSegment: Equatable, Sendable {
    public var control1: CGPoint
    public var control2: CGPoint
    public var end: CGPoint
}

public enum CurveMath {
    /// Catmull-Rom spline converted to cubic Béziers, one segment per consecutive pair.
    /// Direct port of `smoothPath()` in chart.js: tension is fixed at the 1/6 factor,
    /// and the first/last points are duplicated as their own neighbours.
    public static func catmullRom(_ pts: [CGPoint]) -> [BezierSegment] {
        guard pts.count >= 2 else { return [] }
        var out: [BezierSegment] = []
        out.reserveCapacity(pts.count - 1)
        for i in 1..<pts.count {
            let p0 = pts[max(0, i - 2)]
            let p1 = pts[i - 1]
            let p2 = pts[i]
            let p3 = pts[min(pts.count - 1, i + 1)]
            out.append(BezierSegment(
                control1: CGPoint(x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6),
                control2: CGPoint(x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6),
                end: p2))
        }
        return out
    }
}

extension Path {
    /// Port of `smoothPath(ctx, pts, startNew)`.
    ///
    /// With `startNew == false` no move/line to `pts[0]` is added: the curve continues
    /// from the path's *current* point, exactly like the canvas version. chart.js relies
    /// on this to splice the reversed feels-like curve onto the temperature curve.
    mutating func addSmoothCurve(through pts: [CGPoint], startNew: Bool = true) {
        guard pts.count >= 2 else { return }
        if startNew { move(to: pts[0]) }
        for s in CurveMath.catmullRom(pts) {
            addCurve(to: s.end, control1: s.control1, control2: s.control2)
        }
    }
}
