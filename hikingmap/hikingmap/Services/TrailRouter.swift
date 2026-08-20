import CoreLocation

/// Чем закончилась прокладка одного отрезка между опорными точками.
enum TrailRouteOutcome {
    /// Геометрия по тропам (концы — точки, куда роутер притянул запрос)
    /// и высоты по ней, если источник их дал.
    case trails(geometry: [CLLocationCoordinate2D], elevations: [Double]?)
    /// Троп рядом не нашлось — рисуем прямую, как было раньше.
    case straight
}

/// Прокладка пешеходного маршрута между двумя точками **по тропам**.
///
/// Порядок такой: сеть → офлайн-граф → прямая.
/// - `hiking-beta` у BRouter — профиль под пеший ход, тропы он предпочитает
///   асфальту, что нам и нужно; OSRM `foot` держим запасным сервером.
/// - Без сети остаётся `TrailGraph`: маршруты PSS из бандла плюс тропы из
///   загруженных векторных тайлов.
enum TrailRouter {
    /// Дальше этого опорную точку к тропе не притягиваем: тап посреди поля
    /// не должен уезжать за полкилометра на ближайшую дорогу.
    static let anchorSnapMeters = 150.0
    /// Короче этого прокладывать нечего.
    static let minLegMeters = 20.0

    private static let requestTimeout: TimeInterval = 12

    static func route(from start: CLLocationCoordinate2D,
                      to end: CLLocationCoordinate2D,
                      segments: [TrailSnapService.Segment],
                      segmentsToken: Int,
                      allowNetwork: Bool,
                      preferences: RoutingPreferences = .default) async -> TrailRouteOutcome {
        let straight = length(of: [start, end])
        guard straight > minLegMeters else { return .straight }

        if allowNetwork,
           let route = await networkRoute(start, end, preferences: preferences),
           isPlausible(route.geometry, straight: straight) {
            return .trails(geometry: route.geometry, elevations: route.elevations)
        }

        guard !segments.isEmpty else { return .straight }
        let graph = await TrailGraphCache.shared.graph(for: segments, token: segmentsToken)
        if let geometry = graph.path(from: start, to: end),
           isPlausible(geometry, straight: straight) {
            // Высоты у своего графа взять неоткуда — их снимет карта с рельефа
            return .trails(geometry: geometry, elevations: nil)
        }
        return .straight
    }

    /// Отсекает бред роутера: если тропы нет вовсе, он охотно уводит в обход
    /// горы на десятки километров, а рисующий ждал линию длиной с экран.
    private static func isPlausible(_ geometry: [CLLocationCoordinate2D], straight: Double) -> Bool {
        guard geometry.count >= 2 else { return false }
        return length(of: geometry) <= straight * 12 + 3000
    }

    // MARK: - Сеть

    private typealias NetworkRoute = (geometry: [CLLocationCoordinate2D], elevations: [Double]?)

    private static func networkRoute(_ a: CLLocationCoordinate2D,
                                     _ b: CLLocationCoordinate2D,
                                     preferences: RoutingPreferences) async -> NetworkRoute? {
        if let route = await brouter(a, b, preferences: preferences) { return route }
        guard let path = await osrmFoot(a, b) else { return nil }
        return (path, nil)   // OSRM высот не отдаёт
    }

    /// BRouter отдаёт высоту третьим числом в каждой точке — берём её сразу
    /// и не ходим потом в сеть за профилем.
    ///
    /// `preferences.brouterQueryItems` — оверрайды переменных профиля
    /// (`profile:<имя>`), см. `RoutingPreferences`. Экран правил маршрута
    /// их не редактирует напрямую, только через дружелюбный UI.
    private static func brouter(_ a: CLLocationCoordinate2D,
                                _ b: CLLocationCoordinate2D,
                                preferences: RoutingPreferences) async -> NetworkRoute? {
        var comps = URLComponents(string: "https://brouter.de/brouter")
        comps?.queryItems = [
            URLQueryItem(name: "lonlats", value: "\(fmt(a.longitude)),\(fmt(a.latitude))|\(fmt(b.longitude)),\(fmt(b.latitude))"),
            URLQueryItem(name: "profile", value: "hiking-beta"),
            URLQueryItem(name: "alternativeidx", value: "0"),
            URLQueryItem(name: "format", value: "geojson")
        ] + preferences.brouterQueryItems
        guard let url = comps?.url, let data = await get(url) else { return nil }

        // При ошибке BRouter отвечает текстом с тем же кодом 200 — разбор JSON
        // и есть проверка успеха
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let features = json["features"] as? [[String: Any]],
              let geometry = features.first?["geometry"] as? [String: Any],
              let raw = geometry["coordinates"] as? [[Any]]
        else { return nil }

        let path = raw.compactMap(coordinate(from:))
        guard path.count >= 2 else { return nil }
        let elevations = raw.compactMap { (point: [Any]) -> Double? in
            point.count >= 3 ? (point[2] as? NSNumber)?.doubleValue : nil
        }
        return (path, elevations.count == path.count ? elevations : nil)
    }

    private static func osrmFoot(_ a: CLLocationCoordinate2D,
                                 _ b: CLLocationCoordinate2D) async -> [CLLocationCoordinate2D]? {
        let pair = "\(fmt(a.longitude)),\(fmt(a.latitude));\(fmt(b.longitude)),\(fmt(b.latitude))"
        guard let url = URL(string: "https://routing.openstreetmap.de/routed-foot/route/v1/foot/"
                            + pair + "?overview=full&geometries=geojson"),
              let data = await get(url),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              (json["code"] as? String) == "Ok",
              let routes = json["routes"] as? [[String: Any]],
              let geometry = routes.first?["geometry"] as? [String: Any],
              let raw = geometry["coordinates"] as? [[Any]]
        else { return nil }

        let path = raw.compactMap(coordinate(from:))
        return path.count >= 2 ? path : nil
    }

    private static func get(_ url: URL) async -> Data? {
        var request = URLRequest(url: url, timeoutInterval: requestTimeout)
        request.setValue("hikingmap/1.0 (iOS)", forHTTPHeaderField: "User-Agent")
        guard let (data, response) = try? await URLSession.shared.data(for: request),
              let http = response as? HTTPURLResponse, http.statusCode == 200
        else { return nil }
        return data
    }

    private static func coordinate(from raw: [Any]) -> CLLocationCoordinate2D? {
        guard raw.count >= 2,
              let lon = (raw[0] as? NSNumber)?.doubleValue,
              let lat = (raw[1] as? NSNumber)?.doubleValue
        else { return nil }
        return CLLocationCoordinate2D(latitude: lat, longitude: lon)
    }

    private static func fmt(_ value: Double) -> String { String(format: "%.6f", value) }

    // MARK: - Геометрия

    static func meters(_ a: CLLocationCoordinate2D, _ b: CLLocationCoordinate2D) -> Double {
        CLLocation(latitude: a.latitude, longitude: a.longitude)
            .distance(from: CLLocation(latitude: b.latitude, longitude: b.longitude))
    }

    static func length(of path: [CLLocationCoordinate2D]) -> Double {
        guard path.count >= 2 else { return 0 }
        var total = 0.0
        for i in 1..<path.count { total += meters(path[i - 1], path[i]) }
        return total
    }
}
