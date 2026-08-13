import Foundation
import CoreLocation

struct CustomRoute: Identifiable, Codable {
    var id: String
    var name: String
    var date: Date
    var waypointLats: [Double]
    var waypointLons: [Double]
    var distanceKm: Double
    var elevations: [Double]?   // fetched async after save

    var coordinates: [CLLocationCoordinate2D] {
        zip(waypointLats, waypointLons).map { CLLocationCoordinate2D(latitude: $0, longitude: $1) }
    }

    // MARK: - Computed elevation stats
    var ascentM: Double? {
        guard let e = elevations, e.count >= 2 else { return nil }
        return zip(e, e.dropFirst()).reduce(0) { $0 + max(0, $1.1 - $1.0) }
    }
    var descentM: Double? {
        guard let e = elevations, e.count >= 2 else { return nil }
        return zip(e, e.dropFirst()).reduce(0) { $0 + max(0, $1.0 - $1.1) }
    }
    var maxElevationM: Double? { elevations?.max() }
    var minElevationM: Double? { elevations?.min() }

    init(name: String, waypoints: [CLLocationCoordinate2D], distanceKm: Double) {
        self.id           = UUID().uuidString
        self.name         = name
        self.date         = Date()
        self.waypointLats = waypoints.map(\.latitude)
        self.waypointLons = waypoints.map(\.longitude)
        self.distanceKm   = distanceKm
        self.elevations   = nil
    }

    /// Create from recorded track coordinates and elevations.
    static func from(coordinates: [CLLocationCoordinate2D], elevations: [Double], name: String) -> CustomRoute? {
        guard coordinates.count >= 2 else { return nil }
        var dist = 0.0
        for i in 1..<coordinates.count {
            dist += CLLocation(latitude: coordinates[i-1].latitude, longitude: coordinates[i-1].longitude)
                .distance(from: CLLocation(latitude: coordinates[i].latitude, longitude: coordinates[i].longitude))
        }
        var route = CustomRoute(name: name, waypoints: coordinates, distanceKm: dist / 1000.0)
        if elevations.count == coordinates.count { route.elevations = elevations }
        return route
    }

    /// Parse a GPX file and return a CustomRoute (nil if the GPX has fewer than 2 track points).
    static func from(gpxData: Data, name: String) -> CustomRoute? {
        let rawPoints = GPXParser().parse(data: gpxData)
        guard rawPoints.count >= 2 else { return nil }

        let coords = rawPoints.map(\.coordinate)
        var dist = 0.0
        for i in 1..<coords.count {
            dist += CLLocation(latitude: coords[i-1].latitude, longitude: coords[i-1].longitude)
                .distance(from: CLLocation(latitude: coords[i].latitude, longitude: coords[i].longitude))
        }

        var route = CustomRoute(name: name, waypoints: coords, distanceKm: dist / 1000.0)
        let elevs = rawPoints.map(\.elevation)
        if elevs.contains(where: { $0 > 1 }) {
            route.elevations = elevs
        }
        return route
    }

    // MARK: - GPX export
    func gpxString() -> String {
        let name = self.name.replacingOccurrences(of: "&", with: "&amp;")
        var xml = """
        <?xml version="1.0" encoding="UTF-8"?>
        <gpx version="1.1" creator="HikingMap – Totskii Wild"
             xmlns="http://www.topografix.com/GPX/1/1">
          <trk>
            <name>\(name)</name>
            <trkseg>
        """
        let coords = coordinates
        for (i, coord) in coords.enumerated() {
            let elePart: String
            if let elevs = elevations, i < elevs.count {
                elePart = "\n        <ele>\(String(format: "%.1f", elevs[i]))</ele>"
            } else {
                elePart = ""
            }
            xml += """

          <trkpt lat="\(String(format: "%.7f", coord.latitude))" lon="\(String(format: "%.7f", coord.longitude))">\(elePart)
          </trkpt>
        """
        }
        xml += "\n    </trkseg>\n  </trk>\n</gpx>"
        return xml
    }
}

// MARK: - Store

final class CustomRouteStore: ObservableObject {
    static let shared = CustomRouteStore()

    @Published var routes: [CustomRoute] = []
    private let key = "hikingmap.custom_routes.v1"

    init() { load() }

    func add(_ route: CustomRoute) {
        routes.insert(route, at: 0)
        persist()
    }

    func update(_ route: CustomRoute) {
        if let idx = routes.firstIndex(where: { $0.id == route.id }) {
            routes[idx] = route
            persist()
        }
    }

    func remove(id: String) {
        routes.removeAll { $0.id == id }
        persist()
    }

    private func persist() {
        if let data = try? JSONEncoder().encode(routes) {
            UserDefaults.standard.set(data, forKey: key)
        }
    }

    private func load() {
        guard let data = UserDefaults.standard.data(forKey: key),
              let decoded = try? JSONDecoder().decode([CustomRoute].self, from: data)
        else { return }
        routes = decoded
    }
}
