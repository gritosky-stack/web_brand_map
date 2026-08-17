import Foundation
import CoreLocation

/// Точечный объект на карте: вода или укрытие.
///
/// Данные из OpenStreetMap, собраны `tools/tiles/fetch_poi.py` и лежат в бандле
/// двумя файлами — включаются в «Слоях» раздельно, потому что нужны в разных
/// ситуациях: воду ищут по ходу дня, крышу — при планировании ночёвки.
struct MapPoint: Identifiable {

    enum Kind: String, CaseIterable {
        case spring, well, tap          // вода
        case hut, shelter, camp         // крыша

        var isWater: Bool { self == .spring || self == .well || self == .tap }

        /// Значок на карте. Эмодзи, а не свой рисунок: точек тысячи, и рисовать
        /// каждой иконку дороже, чем взять готовый глиф.
        var emoji: String {
            switch self {
            case .spring:  return "💧"
            case .well:    return "🪣"
            case .tap:     return "🚰"
            case .hut:     return "🏠"
            case .shelter: return "⛺️"
            case .camp:    return "🏕"
            }
        }

        var title: String {
            switch self {
            case .spring:  return "Родник"
            case .well:    return "Колодец"
            case .tap:     return "Колонка"
            case .hut:     return "Дом"
            case .shelter: return "Навес"
            case .camp:    return "Кемпинг"
            }
        }
    }

    let id: String
    let kind: Kind
    let name: String?
    let ele: Double?
    /// `nil` — в OSM про это ничего не сказано. Именно `nil`, а не «нет»:
    /// молчание источника и его отрицательный ответ — разные вещи.
    let drinking: Bool?
    let seasonal: Bool?
    let shelterType: String?
    let fee: Bool?
    let coordinate: CLLocationCoordinate2D

    var title: String { name?.isEmpty == false ? name! : kind.title }

    /// Короткая приписка под названием. Пишем только то, что источник знает.
    var subtitle: String {
        var parts: [String] = [kind.title]
        if drinking == true { parts.append("питьевая") }
        if drinking == false { parts.append("не питьевая") }
        if seasonal == true { parts.append("пересыхает") }
        if fee == true { parts.append("платно") }
        if let e = ele { parts.append("\(Int(e)) м") }
        return parts.joined(separator: " · ")
    }
}

// MARK: - Хранилище

final class MapPointStore {
    static let shared = MapPointStore()

    private(set) lazy var water: [MapPoint] = Self.load("water")
    private(set) lazy var shelters: [MapPoint] = Self.load("shelters")

    private init() {}

    private static func load(_ resource: String) -> [MapPoint] {
        guard let url = Bundle.main.url(forResource: resource, withExtension: "geojson"),
              let data = try? Data(contentsOf: url),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let features = json["features"] as? [[String: Any]]
        else { return [] }

        return features.compactMap { feat -> MapPoint? in
            guard let geom = feat["geometry"] as? [String: Any],
                  let c = geom["coordinates"] as? [Double], c.count >= 2,
                  let props = feat["properties"] as? [String: Any],
                  let kind = MapPoint.Kind(rawValue: props["kind"] as? String ?? "")
            else { return nil }

            // Русское имя предпочтительнее сербского, сербское — латинского:
            // подписи на карте у нас на русском и сербском.
            let name = (props["nameRu"] as? String)
                ?? (props["name"] as? String)
                ?? (props["nameSr"] as? String)

            return MapPoint(
                id: (feat["id"] as? String) ?? UUID().uuidString,
                kind: kind,
                name: name,
                ele: Self.number(props["ele"]),
                drinking: props["drinking"] as? Bool,
                seasonal: props["seasonal"] as? Bool,
                shelterType: props["shelterType"] as? String,
                fee: props["fee"] as? Bool,
                coordinate: CLLocationCoordinate2D(latitude: c[1], longitude: c[0])
            )
        }
    }

    /// В OSM высота бывает и числом, и строкой вида «1032» или «1032 m».
    private static func number(_ any: Any?) -> Double? {
        if let d = any as? Double { return d }
        if let s = any as? String {
            return Double(s.replacingOccurrences(of: "m", with: "")
                           .trimmingCharacters(in: .whitespaces))
        }
        return nil
    }
}
