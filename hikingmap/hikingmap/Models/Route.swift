import UIKit
import CoreLocation

enum RouteType {
    case completed
    case planned
}

enum Difficulty: String, CaseIterable {
    case easy   = "Лёгкий"
    case medium = "Средний"
    case hard   = "Сложный"
    case expert = "Экспертный"

    var color: UIColor {
        switch self {
        case .easy:   return UIColor(hex: "#4CAF50")
        case .medium: return UIColor(hex: "#FF9800")
        case .hard:   return UIColor(hex: "#F44336")
        case .expert: return UIColor(hex: "#9C27B0")
        }
    }

    var fraction: Double {
        switch self {
        case .easy: return 0.25; case .medium: return 0.5
        case .hard: return 0.75; case .expert: return 1.0
        }
    }
}

struct Route: Identifiable, Equatable {
    let id: String
    let gpxFile: String          // e.g. "Samari - Lastra" (no extension)
    let gpxSubdir: String?       // e.g. "future_trips" or nil
    let name: String
    let type: RouteType
    let date: String?
    let description: String?
    let instagramUrl: String?
    let photos: [String]         // relative paths, e.g. "photos/route/IMG.JPG"
    let overrideAscent: Int?
    let overrideDescent: Int?
    let overrideTime: String?
    let overrideMinEle: Double?

    var isPlanned: Bool { type == .planned }

    var dotColor: UIColor {
        type == .completed
            ? UIColor(red: 1.0, green: 0.302, blue: 0.302, alpha: 1)
            : UIColor(red: 1.0, green: 0.843, blue: 0.0,   alpha: 1)
    }

    var lineColor: UIColor { dotColor }

    var typeBadgeText: String { isPlanned ? "ПЛАН" : "ПРОЙДЕН" }

    var formattedDate: String? {
        guard let date, !date.isEmpty else { return nil }
        let fmt = DateFormatter()
        fmt.dateFormat = "yyyy-MM-dd"
        guard let d = fmt.date(from: date) else { return date }
        fmt.dateStyle  = .long
        fmt.locale     = Locale(identifier: "ru_RU")
        return fmt.string(from: d)
    }

    static func == (lhs: Route, rhs: Route) -> Bool { lhs.id == rhs.id }
}

struct RouteStats {
    let distance: Double      // km
    let ascent: Double        // m
    let descent: Double       // m
    let minEle: Double        // m
    let maxEle: Double        // m
    let duration: String?
    let coordinates: [CLLocationCoordinate2D]
    let elevations: [Double]  // same count as coordinates
    let center: CLLocationCoordinate2D
    let boundsNE: CLLocationCoordinate2D
    let boundsSW: CLLocationCoordinate2D
    let photoCoordinates: [(index: Int, coordinate: CLLocationCoordinate2D)]

    var peakIndex: Int { elevations.enumerated().max(by: { $0.element < $1.element })?.offset ?? 0 }
    var peakCoord: CLLocationCoordinate2D { coordinates[peakIndex] }

    // Point at 50% distance — guaranteed on the route line, not at peak
    var midpointCoord: CLLocationCoordinate2D {
        guard !coordinates.isEmpty else { return center }
        return coordinates[coordinates.count / 2]
    }

    var difficulty: Difficulty {
        let score = distance + ascent / 100.0 + descent / 200.0
        switch score {
        case ..<15: return .easy
        case 15..<28: return .medium
        case 28..<45: return .hard
        default: return .expert
        }
    }

    // MARK: - Прореженный профиль для графика

    /// Сколько точек оставляем графику: `Chart` перерисовывает их на каждом
    /// кадре скраба, тысячи точек он не тянет
    static let chartSampleCount = 200

    /// Номера точек маршрута, попавшие в прореженный профиль. Одни и те же
    /// для координат, высот и дистанции — иначе профиль, его километры и
    /// точка на карте разъезжаются между собой.
    var sampledIndices: [Int] {
        let count = min(coordinates.count, elevations.count)
        guard count > RouteStats.chartSampleCount else { return Array(0..<count) }
        let step = Double(count) / Double(RouteStats.chartSampleCount)
        return (0..<RouteStats.chartSampleCount).map { Int(Double($0) * step) }
    }

    /// Пройденные километры в прореженных точках — посчитанные по **полной**
    /// геометрии, а не по прореженной ломаной.
    ///
    /// ⚠️ Раньше дистанцию считали по самой ломаной из 200 точек и растягивали
    /// одним коэффициентом до полной длины маршрута. Сходилось это только в
    /// сумме: ломаная срезает повороты неравномерно, и на серпантинах
    /// «10 км» на графике оказывались 10.9 км на самом деле. Camera по такому
    /// километру улетала мимо участка, а шкала показывала не то, что ось
    /// (фидбэк 2026-08-22).
    var sampledDistancesKm: [Double] {
        let indices = sampledIndices
        guard coordinates.count > 1, let last = indices.last, last > 0 else {
            return Array(repeating: 0, count: indices.count)
        }
        var cumulative = 0.0
        var result: [Double] = []
        result.reserveCapacity(indices.count)
        var cursor = 0
        for index in indices {
            while cursor < index {
                cumulative += TrailRouter.meters(coordinates[cursor], coordinates[cursor + 1])
                cursor += 1
            }
            result.append(cumulative / 1000)
        }
        return result
    }

    // Downsampled to ≤200 points for chart rendering
    var elevationSampled: [Double] {
        let indices = sampledIndices
        guard elevations.count > indices.count else { return elevations }
        return indices.map { elevations[$0] }
    }

    var coordinatesSampled: [CLLocationCoordinate2D] {
        let indices = sampledIndices
        guard coordinates.count > indices.count else { return coordinates }
        return indices.map { coordinates[$0] }
    }

    var elevationDownsampled: [Double] { elevationSampled }
}

// MARK: - Hex color helper
extension UIColor {
    convenience init(hex: String) {
        var h = hex.trimmingCharacters(in: .init(charactersIn: "#"))
        if h.count == 3 { h = h.map { "\($0)\($0)" }.joined() }
        var rgb: UInt64 = 0
        Scanner(string: h).scanHexInt64(&rgb)
        self.init(
            red:   CGFloat((rgb >> 16) & 0xFF) / 255,
            green: CGFloat((rgb >>  8) & 0xFF) / 255,
            blue:  CGFloat( rgb        & 0xFF) / 255,
            alpha: 1
        )
    }
}
