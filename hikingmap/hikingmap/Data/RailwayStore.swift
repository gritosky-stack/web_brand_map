import Foundation
import CoreLocation

/// Железные дороги и станции Сербии из бандла.
///
/// Данные извлечены из OpenStreetMap (`tools/tiles/extract_railways.py`):
/// действующие пути и 1023 станции. Весь набор — 1,6 МБ, поэтому он лежит
/// прямо в приложении, а не в скачиваемых тайлах.
///
/// Так и должно быть: железные дороги нужны на любой основе, включая спутник,
/// и до того, как пользователь скачает топокарту. В тайлах они были бы
/// доступны только на своей основе и только после загрузки.
enum RailwayStore {

    struct Station {
        let name: String
        /// Вокзал против остановки или полустанка — рисуются по-разному
        let isMajor: Bool
        let coordinate: CLLocationCoordinate2D
    }

    /// Сырой GeoJSON для источника карты — отдаём строкой, разбирать его
    /// на нашей стороне незачем, C++ парсер Mapbox сделает это быстрее.
    static let geoJSONString: String? = {
        guard let url = Bundle.main.url(forResource: "railways", withExtension: "geojson"),
              let data = try? Data(contentsOf: url)
        else { return nil }
        return String(data: data, encoding: .utf8)
    }()

    /// Станции для флажков. Разбираем один раз при первом обращении.
    static let stations: [Station] = {
        guard let url = Bundle.main.url(forResource: "railways", withExtension: "geojson"),
              let data = try? Data(contentsOf: url),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let features = json["features"] as? [[String: Any]]
        else { return [] }

        return features.compactMap { feature in
            guard let props = feature["properties"] as? [String: Any],
                  (props["kind"] as? String) == "station",
                  let name = props["name"] as? String,
                  let geometry = feature["geometry"] as? [String: Any],
                  let coords = geometry["coordinates"] as? [Double],
                  coords.count >= 2
            else { return nil }

            return Station(
                name: name,
                isMajor: (props["subclass"] as? String) == "station",
                coordinate: CLLocationCoordinate2D(latitude: coords[1], longitude: coords[0])
            )
        }
    }()
}
