import Foundation
import CoreLocation

struct ElevationService {

    // Open-Elevation (free, no key, global SRTM data)
    private static let apiURL = URL(string: "https://api.open-elevation.com/api/v1/lookup")!

    static func fetch(for coords: [CLLocationCoordinate2D]) async -> [Double]? {
        let sampled = resample(coords, maxCount: 100)
        let locations: [[String: Double]] = sampled.map {
            ["latitude": $0.latitude, "longitude": $0.longitude]
        }
        guard let body = try? JSONSerialization.data(withJSONObject: ["locations": locations]) else {
            return nil
        }
        var req = URLRequest(url: apiURL, timeoutInterval: 20)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = body

        guard let (data, _) = try? await URLSession.shared.data(for: req),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let results = json["results"] as? [[String: Any]]
        else { return nil }

        let elevs = results.compactMap { $0["elevation"] as? Double }
        return elevs.count == sampled.count ? elevs : nil
    }

    // Evenly sample array down to maxCount elements
    private static func resample<T>(_ array: [T], maxCount: Int) -> [T] {
        guard array.count > maxCount else { return array }
        return (0..<maxCount).map { i in
            array[Int(round(Double(i) * Double(array.count - 1) / Double(maxCount - 1)))]
        }
    }
}
