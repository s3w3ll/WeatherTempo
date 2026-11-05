import Foundation

/// Sun elevation from the low-precision formulas in the Astronomical Almanac (good to
/// about 0.1°, far finer than a chart pixel). Lets the chart place sunrise, sunset and
/// twilight at their real times instead of on hour boundaries.
public enum SolarPosition {
    private static let rad = Double.pi / 180

    /// Degrees above the horizon (negative below) at `date`, for a place in degrees
    /// (south and west negative).
    public static func elevation(at date: Date, latitude: Double, longitude: Double) -> Double {
        let n = date.timeIntervalSince1970 / 86_400 + 2_440_587.5 - 2_451_545.0   // days since J2000.0
        let meanLon = 280.460 + 0.9856474 * n
        let anomaly = (357.528 + 0.9856003 * n) * rad
        let eclLon = (meanLon + 1.915 * sin(anomaly) + 0.020 * sin(2 * anomaly)) * rad
        let obliquity = (23.439 - 0.0000004 * n) * rad

        let declination = asin(sin(obliquity) * sin(eclLon))
        let rightAscension = atan2(cos(obliquity) * sin(eclLon), cos(eclLon))
        let siderealDeg = (280.46061837 + 360.98564736629 * n).truncatingRemainder(dividingBy: 360)
        let hourAngle = siderealDeg * rad + longitude * rad - rightAscension

        let lat = latitude * rad
        let s = sin(lat) * sin(declination) + cos(lat) * cos(declination) * cos(hourAngle)
        return asin(min(1, max(-1, s))) / rad
    }
}

extension MeteogramModel {

    /// Background shade at a point in time.
    public enum SkyPhase: Equatable, Sendable { case day, twilight, night }

    /// A gradient stop for the chart background. Stops sit where the sun crosses:
    /// -0.833° (sunrise/sunset: day colour), -6° (end of civil twilight: twilight colour)
    /// and -12° (end of nautical twilight: night colour); the gradient fills in between.
    public struct SkyStop: Equatable, Sendable {
        public let x: Double
        public let phase: SkyPhase
    }

    static let skyThresholds: [(elevation: Double, phase: SkyPhase)] = [(-0.833, .day), (-6, .twilight), (-12, .night)]

    /// The phase whose threshold colour best matches an elevation, for the series ends.
    static func nearestPhase(_ e: Double) -> SkyPhase {
        e > -3.4 ? .day : e > -9 ? .twilight : .night
    }

    /// nil without coordinates (the background then falls back to hourly day/night).
    public var skyStops: [SkyStop]? {
        guard let lat = latitude, let lon = longitude, let first = hours.first, let last = hours.last else { return nil }
        let t0 = first.validTimeUtc, t1 = last.validTimeUtc + 3600
        func elev(_ t: Double) -> Double { SolarPosition.elevation(at: Date(timeIntervalSince1970: t), latitude: lat, longitude: lon) }
        func x(_ t: Double) -> Double { ChartPad.left + (t - t0) / 3600 * pxPerHour }

        var stops = [SkyStop(x: x(t0), phase: Self.nearestPhase(elev(t0)))]
        let step = 600.0   // 10 minutes: twilight bands last 30+ minutes, so no crossing is missed
        var a = t0, ea = elev(a)
        while a < t1 {
            let b = min(a + step, t1), eb = elev(b)
            // Each threshold crossed in this step, in time order (thresholds are ordered,
            // so rising crossings come lowest first and setting ones highest first).
            let crossed = Self.skyThresholds.filter { (ea - $0.elevation) * (eb - $0.elevation) < 0 }
            for th in (eb > ea ? crossed.reversed() : crossed) {
                var lo = a, hi = b
                for _ in 0..<12 {   // bisect to well under a minute
                    let mid = (lo + hi) / 2
                    if (elev(mid) - th.elevation) * (ea - th.elevation) > 0 { lo = mid } else { hi = mid }
                }
                stops.append(SkyStop(x: x((lo + hi) / 2), phase: th.phase))
            }
            a = b; ea = eb
        }
        stops.append(SkyStop(x: x(t1), phase: Self.nearestPhase(elev(t1))))
        return stops
    }
}
