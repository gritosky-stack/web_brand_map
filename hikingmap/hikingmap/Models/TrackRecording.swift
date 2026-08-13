import Foundation
import CoreLocation

// MARK: - Sighting types

enum SightingType: String, CaseIterable, Codable {
    case deer    = "🦌"
    case boar    = "🐗"
    case fox     = "🦊"
    case wolf    = "🐺"
    case vista   = "🏔"
    case water   = "💧"
    case hazard  = "⚠️"
    case waypoint = "📍"

    var label: String {
        switch self {
        case .deer:     return "Олень"
        case .boar:     return "Кабан"
        case .fox:      return "Лиса"
        case .wolf:     return "Волк"
        case .vista:    return "Вид"
        case .water:    return "Вода"
        case .hazard:   return "Опасно"
        case .waypoint: return "Метка"
        }
    }

    var isHazard: Bool { self == .hazard }
    var isWaypoint: Bool { self == .waypoint }
}

// MARK: - Sighting

struct Sighting: Identifiable, Codable {
    let id: UUID
    let type: SightingType
    let coordinate: CodableCoordinate
    let timestamp: Date

    init(type: SightingType, coordinate: CLLocationCoordinate2D) {
        id = UUID()
        self.type = type
        self.coordinate = CodableCoordinate(coordinate)
        self.timestamp = Date()
    }
}

// MARK: - Track segment

struct TrackSegment: Identifiable, Codable {
    let id: UUID
    let number: Int
    let distanceKm: Double
    let duration: TimeInterval
    let ascent: Double
    let startIndex: Int
    let endIndex: Int

    var label: String { "S\(number)" }
    var durationFormatted: String {
        let m = Int(duration) / 60
        let s = Int(duration) % 60
        return String(format: "%d:%02d", m, s)
    }
}

// MARK: - Track photo

struct TrackPhoto: Identifiable, Codable {
    let id: UUID
    let coordinate: CodableCoordinate
    let localFilename: String
    let timestamp: Date

    init(coordinate: CLLocationCoordinate2D, localFilename: String) {
        id = UUID()
        self.coordinate = CodableCoordinate(coordinate)
        self.localFilename = localFilename
        self.timestamp = Date()
    }

    var localURL: URL {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent(localFilename)
    }
}

// MARK: - Track recording

struct TrackRecording: Identifiable, Codable {
    let id: UUID
    let startDate: Date
    var coordinates: [CodableCoordinate] = []
    var elevations: [Double] = []
    var sightings: [Sighting] = []
    var photos: [TrackPhoto] = []
    var segments: [TrackSegment] = []
    var linkedRouteId: String? = nil

    init() {
        id = UUID()
        startDate = Date()
    }

    var clCoordinates: [CLLocationCoordinate2D] { coordinates.map(\.clCoordinate) }

    var distanceKm: Double {
        guard coordinates.count > 1 else { return 0 }
        return zip(clCoordinates, clCoordinates.dropFirst()).reduce(0) { acc, pair in
            acc + CLLocation(latitude: pair.0.latitude, longitude: pair.0.longitude)
                .distance(from: CLLocation(latitude: pair.1.latitude, longitude: pair.1.longitude)) / 1000
        }
    }

    var ascent: Double {
        guard elevations.count > 1 else { return 0 }
        return zip(elevations, elevations.dropFirst()).reduce(0) { acc, pair in
            acc + max(0, pair.1 - pair.0)
        }
    }
}

// MARK: - Codable coordinate wrapper

struct CodableCoordinate: Codable {
    let latitude: Double
    let longitude: Double

    init(_ c: CLLocationCoordinate2D) {
        latitude  = c.latitude
        longitude = c.longitude
    }

    var clCoordinate: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
    }
}
