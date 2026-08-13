import Foundation
import CoreLocation

struct PSSRoute: Identifiable {
    let id: String
    let name: String
    let url: String?
    let coordinates: [CLLocationCoordinate2D]
    let elevations: [Double]        // same count as coordinates, or empty

    // MARK: - Computed stats

    var distanceKm: Double {
        guard coordinates.count >= 2 else { return 0 }
        var d = 0.0
        for i in 1..<coordinates.count {
            d += CLLocation(latitude: coordinates[i-1].latitude, longitude: coordinates[i-1].longitude)
                .distance(from: CLLocation(latitude: coordinates[i].latitude, longitude: coordinates[i].longitude))
        }
        return d / 1000.0
    }

    var ascent: Double {
        guard elevations.count >= 2 else { return 0 }
        return zip(elevations, elevations.dropFirst()).reduce(0.0) { $0 + max(0, $1.1 - $1.0) }
    }

    var descent: Double {
        guard elevations.count >= 2 else { return 0 }
        return zip(elevations, elevations.dropFirst()).reduce(0.0) { $0 + max(0, $1.0 - $1.1) }
    }

    var maxElevation: Double { elevations.max() ?? 0 }
    var minElevation: Double { elevations.min() ?? 0 }

    var difficulty: Difficulty {
        let score = distanceKm + ascent / 100.0 + descent / 200.0
        switch score {
        case ..<15:    return .easy
        case 15..<28:  return .medium
        case 28..<45:  return .hard
        default:       return .expert
        }
    }

    var midpoint: CLLocationCoordinate2D {
        guard !coordinates.isEmpty else { return CLLocationCoordinate2D() }
        return coordinates[coordinates.count / 2]
    }

    var bounds: (sw: CLLocationCoordinate2D, ne: CLLocationCoordinate2D)? {
        guard !coordinates.isEmpty else { return nil }
        let lats = coordinates.map(\.latitude)
        let lons = coordinates.map(\.longitude)
        return (
            sw: CLLocationCoordinate2D(latitude: lats.min()!, longitude: lons.min()!),
            ne: CLLocationCoordinate2D(latitude: lats.max()!, longitude: lons.max()!)
        )
    }

    // MARK: - RouteStats bridge (for ElevationChartView reuse)

    func makeStats() -> RouteStats {
        let lats = coordinates.map(\.latitude)
        let lons = coordinates.map(\.longitude)
        return RouteStats(
            distance:         distanceKm,
            ascent:           ascent,
            descent:          descent,
            minEle:           minElevation,
            maxEle:           maxElevation,
            duration:         nil,
            coordinates:      coordinates,
            elevations:       elevations,
            center:           midpoint,
            boundsNE:         CLLocationCoordinate2D(latitude: lats.max() ?? 0, longitude: lons.max() ?? 0),
            boundsSW:         CLLocationCoordinate2D(latitude: lats.min() ?? 0, longitude: lons.min() ?? 0),
            photoCoordinates: []
        )
    }
}
