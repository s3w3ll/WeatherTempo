import Foundation

/// Everything the tides card shows: the "now" level and direction, the next four
/// high/low events, and today's curve for the mini chart.
public struct TideSummary: Equatable {
    public enum Trend: String, Equatable {
        case rising, falling
        public var label: String { self == .rising ? "↑ Rising" : "↓ Falling" }
    }

    public let label: String
    public let currentHeight: Double
    public let trend: Trend
    public let events: [TideEvent]
    /// 10-minute samples from local midnight, 24 h inclusive.
    public let curve: [TideSample]
    public let now: Date

    public var minHeight: Double { curve.map(\.height).min() ?? 0 }
    public var maxHeight: Double { curve.map(\.height).max() ?? 1 }

    /// nil for inland locations (no tide port) so the card can be hidden.
    public init?(location: Location, now: Date = Date()) {
        guard let port = location.tideData else { return nil }

        self.label = location.tideLabel ?? "Tides"
        self.now = now
        self.currentHeight = TidePredictor.height(port: port, at: now)

        // Direction = sign of the change over the next 10 minutes.
        let soon = TidePredictor.height(port: port, at: now.addingTimeInterval(600))
        self.trend = soon >= currentHeight ? .rising : .falling

        self.events = TidePredictor.nextEvents(portID: port.id, count: 4, now: now)
        self.curve = TidePredictor.todayCurve(portID: port.id, timeZone: location.timeZone, hours: 24, now: now)
    }
}
