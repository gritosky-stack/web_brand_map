import Foundation
import CoreLocation

struct CavePoint: Identifiable, Codable {
    let id: String
    let name: String
    let nameSr: String?
    let coordinate: CodableCoordinate
    let depth: Double?
    let length: Double?
    let difficulty: String?
    let hasWater: Bool
    let website: String?
    let wikipedia: String?
    let ele: Double?

    var clCoordinate: CLLocationCoordinate2D { coordinate.clCoordinate }

    var depthProfile: [Double] {
        guard let d = depth, d > 0 else { return [] }
        return [0, -d*0.12, -d*0.28, -d*0.55, -d*0.78, -d*0.91, -d, -d*0.95,
                -d*0.82, -d*0.65, -d*0.45, -d*0.22, -d*0.08, 0]
    }

    var difficultyColor: String {
        switch difficulty {
        case "I":           return "#4CAF50"
        case "II":          return "#8BC34A"
        case "III":         return "#FF9800"
        case "IV":          return "#F44336"
        case "V", "VI":     return "#9C27B0"
        default:            return "#FF9800"
        }
    }
}

// MARK: - Cave store
final class CaveStore {
    static let shared = CaveStore()
    private(set) var caves: [CavePoint] = []

    private init() { load() }

    // Rough contour of Serbia + Kosovo (clockwise, lat/lon pairs).
    // Использую для точечной фильтрации пещер — bbox пропускал соседей
    // (Босния, Венгрия, Румыния, Болгария, Македония, Албания).
    private static let serbiaKosovoPolygon: [(lat: Double, lon: Double)] = [
        (46.18, 19.55), (46.18, 20.25), (45.97, 20.80),
        (45.10, 21.55), (44.70, 22.34), (44.40, 22.62),
        (43.80, 22.60), (43.20, 22.99), (42.35, 23.00),
        (42.30, 22.50), (41.90, 22.36), (42.00, 21.60),
        (41.85, 20.55), (42.55, 20.05), (43.00, 19.30),
        (43.55, 19.20), (43.72, 19.05), (44.35, 19.06),
        (44.85, 19.35), (45.10, 19.05), (45.80, 18.90),
        (45.95, 19.10), (45.87, 19.55)
    ]

    private static func inSerbiaOrKosovo(lat: Double, lon: Double) -> Bool {
        let poly = serbiaKosovoPolygon
        var inside = false
        var j = poly.count - 1
        for i in 0..<poly.count {
            let (yi, xi) = (poly[i].lat, poly[i].lon)
            let (yj, xj) = (poly[j].lat, poly[j].lon)
            if ((yi > lat) != (yj > lat)) &&
               (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) {
                inside.toggle()
            }
            j = i
        }
        return inside
    }

    private func load() {
        guard let url = Bundle.main.url(forResource: "caves", withExtension: "geojson"),
              let data = try? Data(contentsOf: url),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let features = json["features"] as? [[String: Any]]
        else { return }

        caves = features.compactMap { feat -> CavePoint? in
            guard let geom = feat["geometry"] as? [String: Any],
                  let coordArr = geom["coordinates"] as? [Double],
                  coordArr.count >= 2,
                  let props = feat["properties"] as? [String: Any],
                  let name = props["name"] as? String
            else { return nil }

            let lat = coordArr[1], lon = coordArr[0]
            guard Self.inSerbiaOrKosovo(lat: lat, lon: lon) else { return nil }

            let id = (feat["id"] as? String) ?? UUID().uuidString
            return CavePoint(
                id: id,
                name: name,
                nameSr: props["name:sr"] as? String,
                coordinate: CodableCoordinate(
                    CLLocationCoordinate2D(latitude: lat, longitude: lon)
                ),
                depth: props["depth"] as? Double,
                length: props["length"] as? Double,
                difficulty: props["difficulty"] as? String,
                hasWater: (props["water"] as? String) == "yes",
                website: props["website"] as? String,
                wikipedia: props["wikipedia"] as? String,
                ele: props["ele"] as? Double
            )
        }
    }
}
