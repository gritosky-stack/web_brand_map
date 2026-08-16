import CoreLocation
import MapboxMaps

struct TrailSnapService {
    static let snapRadiusMeters: Double = 100.0

    // MARK: - In-memory snap (PSS trails loaded as flat segment array)

    typealias Segment = (CLLocationCoordinate2D, CLLocationCoordinate2D)

    /// Finds the nearest point on any stored segment within `snapRadiusMeters`, or nil.
    ///
    /// Отрезков тут сотни тысяч (маршруты PSS плюс тропы из тайлов), а зовут
    /// это с главного потока на каждый тап — поэтому сначала грубый отсев по
    /// «коробке», и никаких `CLLocation` в цикле.
    static func findSnapInMemory(
        near tapped: CLLocationCoordinate2D,
        segments: [Segment]
    ) -> CLLocationCoordinate2D? {
        var best: CLLocationCoordinate2D?
        var bestDist = snapRadiusMeters

        let dLat = snapRadiusMeters / 110_540.0
        let dLon = snapRadiusMeters / (111_320.0 * max(0.2, cos(tapped.latitude * .pi / 180)))

        for (a, b) in segments {
            if min(a.latitude,  b.latitude)  > tapped.latitude  + dLat { continue }
            if max(a.latitude,  b.latitude)  < tapped.latitude  - dLat { continue }
            if min(a.longitude, b.longitude) > tapped.longitude + dLon { continue }
            if max(a.longitude, b.longitude) < tapped.longitude - dLon { continue }

            let candidate = nearestPointOnSegment(p: tapped, a: a, b: b)
            let dist = planarMeters(tapped, candidate)
            if dist < bestDist {
                bestDist = dist
                best = candidate
            }
        }
        return best
    }

    /// Плоское приближение расстояния. На сотне метров ошибка меньше
    /// полупроцента, зато без тригонометрии и аллокаций в горячем цикле.
    static func planarMeters(_ a: CLLocationCoordinate2D, _ b: CLLocationCoordinate2D) -> Double {
        let midLat = (a.latitude + b.latitude) * 0.5 * .pi / 180
        let dx = (b.longitude - a.longitude) * 111_320.0 * cos(midLat)
        let dy = (b.latitude  - a.latitude)  * 110_540.0
        return (dx * dx + dy * dy).squareRoot()
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
