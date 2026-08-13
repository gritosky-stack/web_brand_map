import CoreLocation
import MapboxMaps

struct TrailSnapService {
    static let snapRadiusMeters: Double = 100.0

    // MARK: - In-memory snap (PSS trails loaded as flat segment array)

    typealias Segment = (CLLocationCoordinate2D, CLLocationCoordinate2D)

    /// Finds the nearest point on any stored segment within `snapRadiusMeters`, or nil.
    static func findSnapInMemory(
        near tapped: CLLocationCoordinate2D,
        segments: [Segment]
    ) -> CLLocationCoordinate2D? {
        var best: CLLocationCoordinate2D?
        var bestDist = snapRadiusMeters
        let loc = CLLocation(latitude: tapped.latitude, longitude: tapped.longitude)

        for (a, b) in segments {
            let candidate = nearestPointOnSegment(p: tapped, a: a, b: b)
            let dist = loc.distance(from: CLLocation(latitude: candidate.latitude,
                                                      longitude: candidate.longitude))
            if dist < bestDist {
                bestDist = dist
                best = candidate
            }
        }
        return best
    }

    // MARK: - Rendered-feature snap (fallback for OSM trails visible on map)

    /// Snap using already-queried rendered features (e.g. osm-snap layer).
    static func findSnap(
        near tapped: CLLocationCoordinate2D,
        features: [QueriedRenderedFeature]
    ) -> CLLocationCoordinate2D? {
        var best: CLLocationCoordinate2D?
        var bestDist = snapRadiusMeters
        let loc = CLLocation(latitude: tapped.latitude, longitude: tapped.longitude)

        for qf in features {
            let coords: [CLLocationCoordinate2D]
            switch qf.queriedFeature.feature.geometry {
            case .lineString(let ls):  coords = ls.coordinates
            case .multiLineString(let mls): coords = mls.coordinates.flatMap { $0 }
            default: continue
            }
            guard coords.count >= 2 else { continue }

            for i in 0..<(coords.count - 1) {
                let candidate = nearestPointOnSegment(p: tapped, a: coords[i], b: coords[i + 1])
                let dist = loc.distance(from: CLLocation(latitude: candidate.latitude,
                                                          longitude: candidate.longitude))
                if dist < bestDist { bestDist = dist; best = candidate }
            }
        }
        return best
    }

    // MARK: - Geometry

    static func nearestPointOnSegment(
        p: CLLocationCoordinate2D,
        a: CLLocationCoordinate2D,
        b: CLLocationCoordinate2D
    ) -> CLLocationCoordinate2D {
        let dx = b.longitude - a.longitude
        let dy = b.latitude  - a.latitude
        let lenSq = dx * dx + dy * dy
        guard lenSq > 1e-14 else { return a }
        let t = max(0, min(1,
            ((p.longitude - a.longitude) * dx + (p.latitude - a.latitude) * dy) / lenSq
        ))
        return CLLocationCoordinate2D(latitude: a.latitude + t * dy, longitude: a.longitude + t * dx)
    }
}
