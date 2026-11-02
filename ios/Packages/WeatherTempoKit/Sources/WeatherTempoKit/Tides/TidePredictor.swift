import Foundation

// Port of src/tides.js. Same maths, same constants (see TidePorts.generated.swift):
//
//   h(t) = Z0 + Σ Aᵢ · cos( σᵢ · Δt + V₀ᵢ − gᵢ )
//
// Δt is hours since J2000.0 (2000-01-01 12:00 UTC); σ is speed in °/h; V₀ is the
// equilibrium argument at J2000.0; g is the Greenwich phase lag from LINZ.
// Nodal corrections are omitted (≲3 % amplitude error), exactly like the JS.

public struct TideConstituent: Sendable, Equatable {
    public let name: String
    /// Angular speed, degrees per hour.
    public let speed: Double
    /// Amplitude, metres.
    public let amplitude: Double
    /// Greenwich phase lag, degrees.
    public let phase: Double
    /// Equilibrium argument at J2000.0, degrees.
    public let v0: Double
}

public struct TidePort: Sendable, Equatable {
    public let id: String
    /// Mean level above chart datum, metres.
    public let z0: Double
    public let constituents: [TideConstituent]
}

public struct TideSample: Sendable, Equatable {
    public let time: Date
    public let height: Double
}

public struct TideEvent: Sendable, Equatable {
    public enum Kind: String, Sendable { case high, low }
    public let kind: Kind
    public let time: Date
    public let height: Double
}

public enum TidePredictor {
    /// 2000-01-01 12:00:00 UTC as a Unix timestamp (JS: `Date.UTC(2000, 0, 1, 12)`).
    static let j2000: TimeInterval = 946_728_000
    private static let deg = Double.pi / 180

    /// Water level in metres above chart datum.
    public static func height(port: TidePort, at date: Date) -> Double {
        let t = (date.timeIntervalSince1970 - j2000) / 3600  // hours since J2000.0
        var h = port.z0
        for c in port.constituents {
            h += c.amplitude * cos((c.speed * t + c.v0 - c.phase) * deg)
        }
        return h
    }

    /// nil if the port id is unknown.
    public static func height(portID: String, at date: Date) -> Double? {
        TidePort.all[portID].map { height(port: $0, at: date) }
    }

    /// Regularly spaced samples, both ends inclusive; heights rounded to mm like the JS.
    public static func sample(portID: String, from start: Date, to end: Date, stepMinutes: Int = 10) -> [TideSample] {
        guard let port = TidePort.all[portID], stepMinutes > 0 else { return [] }
        let step = Double(stepMinutes) * 60
        let count = Int(floor(end.timeIntervalSince(start) / step))
        guard count >= 0 else { return [] }
        return (0...count).map { i in
            let time = start.addingTimeInterval(Double(i) * step)
            return TideSample(time: time, height: round(height(port: port, at: time), places: 3))
        }
    }

    /// High/low turning points: scans at 6-minute resolution for strict local extrema
    /// (a flat neighbour yields no event, as in the JS), heights rounded to cm.
    public static func events(portID: String, from start: Date, to end: Date) -> [TideEvent] {
        guard let port = TidePort.all[portID] else { return [] }
        let step: TimeInterval = 6 * 60
        let count = Int(floor(end.timeIntervalSince(start) / step))
        guard count >= 2 else { return [] }

        let points = (0...count).map { i -> (time: Date, h: Double) in
            let time = start.addingTimeInterval(Double(i) * step)
            return (time, height(port: port, at: time))
        }

        var events: [TideEvent] = []
        for i in 1..<(points.count - 1) {
            let prev = points[i - 1].h, curr = points[i].h, next = points[i + 1].h
            if curr > prev && curr > next {
                events.append(TideEvent(kind: .high, time: points[i].time, height: round(curr, places: 2)))
            } else if curr < prev && curr < next {
                events.append(TideEvent(kind: .low, time: points[i].time, height: round(curr, places: 2)))
            }
        }
        return events
    }

    /// The next `count` events at or after `now` (searches 6 h back to 72 h ahead, like the JS).
    public static func nextEvents(portID: String, count: Int = 4, now: Date = Date()) -> [TideEvent] {
        events(portID: portID, from: now.addingTimeInterval(-6 * 3600), to: now.addingTimeInterval(72 * 3600))
            .filter { $0.time >= now }
            .prefix(count)
            .map { $0 }
    }

    /// Curve starting at local midnight in `timeZone`. Uses Calendar, so DST days are
    /// handled correctly (the JS version derives the offset by hand).
    public static func todayCurve(
        portID: String,
        timeZone: TimeZone = TimeZone(identifier: "Pacific/Auckland")!,
        hours: Int = 48,
        now: Date = Date()
    ) -> [TideSample] {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        let start = calendar.startOfDay(for: now)
        return sample(portID: portID, from: start, to: start.addingTimeInterval(Double(hours) * 3600))
    }

    private static func round(_ x: Double, places: Int) -> Double {
        let f = pow(10.0, Double(places))
        return (x * f).rounded() / f
    }
}
