import Foundation
import CoreLocation
import ImageIO

struct GPXPoint {
    let coordinate: CLLocationCoordinate2D
    var elevation: Double
}

// MARK: - XML SAX parser
final class GPXParser: NSObject, XMLParserDelegate {
    private var points: [GPXPoint] = []
    private var currentElement = ""
    private var currentLat: Double?
    private var currentLon: Double?
    private var eleBuffer = ""
    private var inTrkpt = false

    func parse(data: Data) -> [GPXPoint] {
        points = []
        let parser = XMLParser(data: data)
        parser.delegate = self
        parser.parse()
        return points
    }

    func parser(_ parser: XMLParser, didStartElement el: String,
                namespaceURI: String?, qualifiedName: String?,
                attributes: [String: String] = [:]) {
        currentElement = el
        if el == "trkpt" {
            inTrkpt    = true
            currentLat = Double(attributes["lat"] ?? "")
            currentLon = Double(attributes["lon"] ?? "")
            eleBuffer  = ""
        }
    }

    func parser(_ parser: XMLParser, foundCharacters string: String) {
        if inTrkpt && currentElement == "ele" { eleBuffer += string }
    }

    func parser(_ parser: XMLParser, didEndElement el: String,
                namespaceURI: String?, qualifiedName: String?) {
        if el == "trkpt" {
            if let lat = currentLat, let lon = currentLon {
                let ele = Double(eleBuffer.trimmingCharacters(in: .whitespacesAndNewlines)) ?? 0
                points.append(GPXPoint(
                    coordinate: CLLocationCoordinate2D(latitude: lat, longitude: lon),
                    elevation: ele
                ))
            }
            inTrkpt = false
        }
    }
}

// MARK: - Loader + stats
enum GPXLoader {
    static func loadStats(for route: Route) -> RouteStats? {
        guard let data = loadData(for: route) else { return nil }
        let raw = GPXParser().parse(data: data)
        guard raw.count >= 2 else { return nil }
        return computeStats(raw, route: route)
    }

    private static func loadData(for route: Route) -> Data? {
        let bundle = Bundle.main
        let name   = route.gpxFile
        let subdir = route.gpxSubdir.map { "GPX/\($0)" } ?? "GPX"

        for dir in [subdir, nil] {
            guard let url = bundle.url(forResource: name, withExtension: "gpx",
                                       subdirectory: dir) else { continue }
            do { return try Data(contentsOf: url) } catch {
                print("[GPX] Ошибка чтения \(dir ?? "")/\(name).gpx: \(error)")
            }
        }

        // Поиск по имени спотыкается о форму Юникода: `Bundle.url(forResource:)`
        // приводит запрос к декомпозированной форме (наследие HFS+) и сравнивает
        // байты, а файлы в репозитории лежат в композированной. Разница вылезает
        // только на разложимых буквах — во всём наборе это одна «й» (и + краткая),
        // из-за неё «Хайдучка…» не находилась ни в какой форме запроса.
        // Перечисление отдаёт имена как есть, а сравнение строк в Swift
        // каноническое — оно от формы не зависит и находит файл.
        if let urls = bundle.urls(forResourcesWithExtension: "gpx", subdirectory: subdir),
           let url = urls.first(where: { $0.deletingPathExtension().lastPathComponent == name }) {
            do { return try Data(contentsOf: url) } catch {
                print("[GPX] Ошибка чтения \(url.lastPathComponent): \(error)")
            }
        }

        print("[GPX] Файл не найден в бандле: \(name).gpx (subdir: \(subdir))")
        return nil
    }

    private static func computeStats(_ raw: [GPXPoint], route: Route) -> RouteStats {
        var pts = filterSpikes(raw)
        pts = smooth(pts, window: 15)

        var distance = 0.0, ascent = 0.0, descent = 0.0
        for i in 1..<pts.count {
            let a = pts[i-1], b = pts[i]
            distance += CLLocation(latitude: a.coordinate.latitude, longitude: a.coordinate.longitude)
                .distance(from: CLLocation(latitude: b.coordinate.latitude, longitude: b.coordinate.longitude))
            let dh = b.elevation - a.elevation
            if dh > 0.3 { ascent += dh } else if dh < -0.3 { descent += -dh }
        }

        let coords     = pts.map(\.coordinate)
        let elevations = pts.map(\.elevation)
        let lats       = coords.map(\.latitude)
        let lons       = coords.map(\.longitude)

        let center = CLLocationCoordinate2D(
            latitude:  (lats.min()! + lats.max()!) / 2,
            longitude: (lons.min()! + lons.max()!) / 2
        )
        let sw = CLLocationCoordinate2D(latitude: lats.min()!, longitude: lons.min()!)
        let ne = CLLocationCoordinate2D(latitude: lats.max()!, longitude: lons.max()!)

        let photoCoords = extractPhotoGPS(route.photos)

        return RouteStats(
            distance:         distance / 1000,
            ascent:           route.overrideAscent.map(Double.init)  ?? ascent,
            descent:          route.overrideDescent.map(Double.init) ?? descent,
            minEle:           route.overrideMinEle ?? (elevations.min() ?? 0),
            maxEle:           elevations.max() ?? 0,
            duration:         route.overrideTime,
            coordinates:      coords,
            elevations:       elevations,
            center:           center,
            boundsNE:         ne,
            boundsSW:         sw,
            photoCoordinates: photoCoords
        )
    }

    // MARK: - Photo GPS extraction
    private static func extractPhotoGPS(_ photos: [String]) -> [(index: Int, coordinate: CLLocationCoordinate2D)] {
        photos.enumerated().compactMap { idx, path in
            let url: URL?
            if let u = Bundle.main.url(forResource: path, withExtension: nil) {
                url = u
            } else {
                let file   = (path as NSString).lastPathComponent
                let subdir = (path as NSString).deletingLastPathComponent
                url = Bundle.main.url(forResource: file, withExtension: nil,
                                      subdirectory: subdir.isEmpty ? nil : subdir)
            }
            guard let url,
                  let src   = CGImageSourceCreateWithURL(url as CFURL, nil),
                  let props = CGImageSourceCopyPropertiesAtIndex(src, 0, nil) as? [String: Any],
                  let gps   = props[kCGImagePropertyGPSDictionary as String] as? [String: Any],
                  let lat   = gps[kCGImagePropertyGPSLatitude    as String] as? Double,
                  let latRef = gps[kCGImagePropertyGPSLatitudeRef  as String] as? String,
                  let lon    = gps[kCGImagePropertyGPSLongitude   as String] as? Double,
                  let lonRef = gps[kCGImagePropertyGPSLongitudeRef as String] as? String
            else { return nil }
            return (index: idx, coordinate: CLLocationCoordinate2D(
                latitude:  latRef == "S" ? -lat : lat,
                longitude: lonRef == "W" ? -lon : lon
            ))
        }
    }

    // MARK: - Spike filter + smoother
    private static func filterSpikes(_ input: [GPXPoint]) -> [GPXPoint] {
        guard input.count > 4 else { return input }
        var pts = input
        for _ in 0..<4 {
            for i in 0..<pts.count {
                var neighbors: [Double] = []
                for d in 1...2 {
                    if i - d >= 0         { neighbors.append(pts[i - d].elevation) }
                    if i + d < pts.count  { neighbors.append(pts[i + d].elevation) }
                }
                guard !neighbors.isEmpty else { continue }
                let ref = neighbors.reduce(0, +) / Double(neighbors.count)
                if abs(pts[i].elevation - ref) > 80 { pts[i].elevation = ref }
            }
        }
        return pts
    }

    private static func smooth(_ pts: [GPXPoint], window: Int = 15) -> [GPXPoint] {
        let half = window / 2
        return pts.enumerated().map { (i, pt) in
            let lo  = max(0, i - half)
            let hi  = min(pts.count - 1, i + half)
            let avg = pts[lo...hi].map(\.elevation).reduce(0, +) / Double(hi - lo + 1)
            return GPXPoint(coordinate: pt.coordinate, elevation: avg)
        }
    }
}
