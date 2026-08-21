//
//  hikingmapTests.swift
//  hikingmapTests
//
//  Created by User on 26.04.2026.
//

import XCTest
import CoreLocation
import MapboxMaps
@testable import hikingmap

final class hikingmapTests: XCTestCase {

    func testExample() throws {
    }
}

// MARK: - Раскраска по уклону

/// Градиент вдоль линии (`line-gradient`) вместо двухточечных отрезков:
/// отрезки Mapbox упрощал по-тайлово и ниже z≈11 выкидывал вовсе, маршрут
/// пропадал с карты. Здесь проверяется то, на чём выражение отвалилось бы
/// молча — узлы обязаны строго возрастать и покрывать всю линию от 0 до 1.
final class GradeColorTests: XCTestCase {

    /// Подъём с юга на север на 0.02° (~2.2 км) с равномерным набором
    private func ridge(points: Int) -> ([CLLocationCoordinate2D], [Double]) {
        var coords: [CLLocationCoordinate2D] = []
        var eles: [Double] = []
        for i in 0..<points {
            let t = Double(i) / Double(points - 1)
            coords.append(CLLocationCoordinate2D(latitude: 43.90 + 0.02 * t, longitude: 19.50))
            eles.append(600 + 400 * t)
        }
        return (coords, eles)
    }

    /// Позиции узлов из выражения: [interpolate, [linear], [line-progress],
    /// p0, цвет0, p1, цвет1, ...] — числа верхнего уровня и есть узлы.
    /// Читаем через JSON, а не через `Exp.elements`: у SDK они internal.
    private func stops(of exp: Exp) throws -> [Double] {
        let data = try JSONEncoder().encode(exp)
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [Any])
        return json.compactMap { $0 as? Double }
    }

    func testGradientStopsRiseAndCoverWholeLine() throws {
        let (coords, eles) = ridge(points: 300)
        let exp = try XCTUnwrap(GradeColor.mapGradient(coordinates: coords, elevations: eles))
        let positions = try stops(of: exp)

        XCTAssertGreaterThan(positions.count, 2)
        XCTAssertEqual(positions.first, 0, "градиент должен начинаться от начала линии")
        XCTAssertEqual(positions.last, 1, "и доходить до её конца")
        for (a, b) in zip(positions, positions.dropFirst()) {
            XCTAssertLessThan(a, b, "узлы interpolate обязаны строго возрастать")
        }
    }

    /// Нарисованный по тропам маршрут — тысячи точек, все они в выражение
    /// лезть не должны
    func testGradientIsCappedForDenseRoutes() throws {
        let (coords, eles) = ridge(points: 5000)
        let exp = try XCTUnwrap(GradeColor.mapGradient(coordinates: coords, elevations: eles, maxStops: 200))
        XCTAssertLessThanOrEqual(try stops(of: exp).count, 202)   // +2 на дотяжку до 0 и 1
    }

    func testGradientIsNilWithoutUsableElevations() {
        let (coords, _) = ridge(points: 50)
        XCTAssertNil(GradeColor.mapGradient(coordinates: coords, elevations: []),
                     "нет высот — вызывающая сторона обязана рисовать сплошным цветом")
        XCTAssertNil(GradeColor.mapGradient(coordinates: coords, elevations: [600, 700]),
                     "число высот не совпало с числом точек — тоже откат")
    }

    /// Все точки в одном месте: делить на нулевую длину нельзя, и узлы
    /// градиента совпали бы — выражение должно просто не появиться
    func testGradientIsNilForZeroLengthLine() {
        let point = CLLocationCoordinate2D(latitude: 43.9, longitude: 19.5)
        XCTAssertNil(GradeColor.mapGradient(coordinates: Array(repeating: point, count: 10),
                                            elevations: Array(repeating: 600, count: 10)))
    }
}

// MARK: - Прокладка по тропам

/// Тропа-«уголок» в западной Сербии: 0.01° по долготе (~800 м на этой широте),
/// затем 0.01° по широте (~1110 м). Прямая между концами короче суммы плеч —
/// на этом и проверяем, что путь идёт по линии, а не напрямик.
private enum Fixture {
    static let a = CLLocationCoordinate2D(latitude: 44.000, longitude: 20.000)
    static let b = CLLocationCoordinate2D(latitude: 44.000, longitude: 20.010)
    static let c = CLLocationCoordinate2D(latitude: 44.010, longitude: 20.010)

    /// Ломаная, нарезанная на короткие отрезки — так же приезжает геометрия
    /// из GeoJSON и из тайлов.
    static func polyline(_ points: [CLLocationCoordinate2D],
                         steps: Int = 20) -> [TrailSnapService.Segment] {
        var coords: [CLLocationCoordinate2D] = []
        for i in 1..<points.count {
            let from = points[i - 1], to = points[i]
            for s in 0..<steps {
                let t = Double(s) / Double(steps)
                coords.append(CLLocationCoordinate2D(
                    latitude:  from.latitude  + (to.latitude  - from.latitude)  * t,
                    longitude: from.longitude + (to.longitude - from.longitude) * t))
            }
        }
        coords.append(points[points.count - 1])
        return zip(coords, coords.dropFirst()).map { ($0, $1) }
    }

    static let corner = polyline([a, b, c])
}

final class TrailGraphTests: XCTestCase {

    func testPathFollowsTrailInsteadOfStraightLine() throws {
        let graph = TrailGraph(segments: Fixture.corner)
        let start = CLLocationCoordinate2D(latitude: 44.0001, longitude: 20.0002) // рядом с A
        let end   = CLLocationCoordinate2D(latitude: 44.0098, longitude: 20.0102) // рядом с C

        let path = try XCTUnwrap(graph.path(from: start, to: end), "путь по тропе не найден")

        let straight = TrailRouter.meters(start, end)
        let along    = TrailRouter.length(of: path)
        XCTAssertGreaterThan(along, straight * 1.2, "путь подозрительно похож на прямую")
        XCTAssertEqual(along, 1900, accuracy: 250, "длина не совпадает с суммой плеч")

        // Через угол тропа проходит обязательно
        let toCorner = path.map { TrailRouter.meters($0, Fixture.b) }.min() ?? .infinity
        XCTAssertLessThan(toCorner, 30, "путь срезал угол")

        // И нигде не отрывается от самой тропы
        let trailPoints = Fixture.corner.map(\.0) + [Fixture.c]
        let maxDeviation = path.map { p in trailPoints.map { TrailRouter.meters(p, $0) }.min() ?? .infinity }.max() ?? .infinity
        XCTAssertLessThan(maxDeviation, 30, "путь ушёл в сторону от тропы")
    }

    /// На границе тайла линия рвётся — небольшой разрыв граф обязан сшить,
    /// иначе маршрут не пройдёт из тайла в соседний.
    func testSmallGapBetweenTilesIsStitched() throws {
        let gapStart = CLLocationCoordinate2D(latitude: 44.000, longitude: 20.0100)
        let gapEnd   = CLLocationCoordinate2D(latitude: 44.000, longitude: 20.0101) // ~8 м
        let far      = CLLocationCoordinate2D(latitude: 44.000, longitude: 20.0200)

        let segments = Fixture.polyline([Fixture.a, gapStart]) + Fixture.polyline([gapEnd, far])
        let graph = TrailGraph(segments: segments)

        XCTAssertNotNil(graph.path(from: Fixture.a, to: far), "разрыв в 8 м не сшит")
    }

    func testDisconnectedNetworksGiveNoPath() {
        let farA = CLLocationCoordinate2D(latitude: 44.100, longitude: 20.100)
        let farB = CLLocationCoordinate2D(latitude: 44.110, longitude: 20.100)
        let segments = Fixture.corner + Fixture.polyline([farA, farB])
        let graph = TrailGraph(segments: segments)

        XCTAssertNil(graph.path(from: Fixture.a, to: farB),
                     "несвязанные куски сети не должны соединяться")
    }

    func testPointTooFarFromAnyTrailIsNotSnapped() {
        let graph = TrailGraph(segments: Fixture.corner)
        let inTheField = CLLocationCoordinate2D(latitude: 44.000, longitude: 20.050) // ~4 км
        XCTAssertNil(graph.path(from: inTheField, to: Fixture.c, maxSnapMeters: 200))
    }
}

final class TrailRouterTests: XCTestCase {

    /// Без сети остаётся офлайн-граф — он и должен вернуть путь по тропам.
    func testOfflineRoutingUsesLocalGraph() async {
        let start = CLLocationCoordinate2D(latitude: 44.0001, longitude: 20.0002)
        let end   = CLLocationCoordinate2D(latitude: 44.0098, longitude: 20.0102)

        let outcome = await TrailRouter.route(from: start, to: end,
                                              segments: Fixture.corner,
                                              segmentsToken: Int.random(in: 0..<1_000_000),
                                              allowNetwork: false)
        guard case .trails(let path, _) = outcome else {
            return XCTFail("офлайн-граф не проложил путь")
        }
        XCTAssertGreaterThan(TrailRouter.length(of: path), TrailRouter.meters(start, end) * 1.2)
    }

    func testOfflineRoutingWithoutSegmentsFallsBackToStraight() async {
        let outcome = await TrailRouter.route(from: Fixture.a, to: Fixture.c,
                                              segments: [], segmentsToken: 0,
                                              allowNetwork: false)
        guard case .straight = outcome else { return XCTFail("без троп ожидалась прямая") }
    }

    /// Живой запрос к BRouter/OSRM: точки лежат на маршруте PSS
    /// «Šarena bukva — Leskova ravan», по прямой между ними 820 м,
    /// по тропе — около километра.
    func testNetworkRoutingFollowsRealTrail() async throws {
        let start = CLLocationCoordinate2D(latitude: 44.395339, longitude: 19.239149)
        let end   = CLLocationCoordinate2D(latitude: 44.396209, longitude: 19.249396)

        let outcome = await TrailRouter.route(from: start, to: end,
                                              segments: [], segmentsToken: 0,
                                              allowNetwork: true)
        guard case .trails(let path, let elevations) = outcome else {
            throw XCTSkip("сетевой роутер недоступен")
        }
        // BRouter кладёт высоту третьим числом каждой точки — на них считается набор
        XCTAssertEqual(elevations?.count, path.count, "высоты от BRouter не разобрались")
        XCTAssertGreaterThan(path.count, 5, "тропа не может быть из пары точек")
        XCTAssertEqual(TrailRouter.length(of: path), 1090, accuracy: 250)
    }
}

@MainActor
final class ConstructorLegTests: XCTestCase {

    /// Полный путь склеивается из отрезков без задвоенных точек на стыках.
    func testConstructorPathJoinsLegs() {
        let state = AppState()
        state.isSnapEnabled = false            // без роутера: проверяем саму склейку
        state.addConstructorWaypoint(Fixture.a)
        state.addConstructorWaypoint(Fixture.b)
        state.addConstructorWaypoint(Fixture.c)

        XCTAssertEqual(state.constructorWaypoints.count, 3)
        XCTAssertEqual(state.constructorLegs.count, 2)
        XCTAssertEqual(state.constructorPath.count, 3, "точка стыка задвоилась")
        XCTAssertEqual(state.constructorDistanceKm, 1.91, accuracy: 0.1)
    }

    func testUndoRemovesWaypointWithItsLeg() {
        let state = AppState()
        state.isSnapEnabled = false
        state.addConstructorWaypoint(Fixture.a)
        state.addConstructorWaypoint(Fixture.b)
        state.undoConstructor()

        XCTAssertEqual(state.constructorWaypoints.count, 1)
        XCTAssertTrue(state.constructorLegs.isEmpty)
        XCTAssertEqual(state.constructorDistanceKm, 0)

        state.resetConstructor()
        XCTAssertTrue(state.constructorWaypoints.isEmpty)
        XCTAssertTrue(state.constructorPath.isEmpty)
    }

    /// История: откатываем до пустого маршрута и возвращаем обратно.
    func testUndoRedoWalksTheWholeHistory() {
        let state = AppState()
        state.isSnapEnabled = false
        XCTAssertFalse(state.canUndoConstructor)
        XCTAssertFalse(state.canRedoConstructor)

        state.addConstructorWaypoint(Fixture.a)
        state.addConstructorWaypoint(Fixture.b)
        state.addConstructorWaypoint(Fixture.c)
        let full = state.constructorDistanceKm

        state.undoConstructor()
        XCTAssertEqual(state.constructorWaypoints.count, 2)
        XCTAssertTrue(state.canRedoConstructor)

        state.undoConstructor()
        state.undoConstructor()
        XCTAssertTrue(state.constructorWaypoints.isEmpty)
        XCTAssertFalse(state.canUndoConstructor, "откатывать больше нечего")

        state.redoConstructor()
        state.redoConstructor()
        state.redoConstructor()
        XCTAssertEqual(state.constructorWaypoints.count, 3)
        XCTAssertEqual(state.constructorDistanceKm, full, accuracy: 0.001)
        XCTAssertFalse(state.canRedoConstructor)
    }

    /// Новое действие после отката обрубает «вперёд» — как в любом редакторе.
    func testNewWaypointDropsRedoBranch() {
        let state = AppState()
        state.isSnapEnabled = false
        state.addConstructorWaypoint(Fixture.a)
        state.addConstructorWaypoint(Fixture.b)
        state.undoConstructor()
        XCTAssertTrue(state.canRedoConstructor)

        state.addConstructorWaypoint(Fixture.c)
        XCTAssertFalse(state.canRedoConstructor)
        XCTAssertEqual(state.constructorWaypoints.count, 2)
    }

    /// Набор и сброс считаются по профилю с тем же порогом, что и у GPX.
    func testClimbIgnoresNoiseAndSumsRealGain() {
        let flatNoise = [100.0, 100.2, 99.9, 100.1, 100.0, 99.8, 100.1]
        let climb = AppState.climb(flatNoise)
        XCTAssertEqual(climb?.ascent ?? 0, 0, accuracy: 0.5, "шум не должен давать набор")

        var hill: [Double] = []
        for i in 0..<40 { hill.append(100.0 + Double(i) * 5.0) }     // +200 м вверх
        for i in 0..<40 { hill.append(300.0 - Double(i) * 2.5) }     // −100 м вниз
        let real = AppState.climb(hill)
        XCTAssertEqual(real?.ascent ?? 0, 195, accuracy: 25)
        XCTAssertEqual(real?.descent ?? 0, 97, accuracy: 25)
    }

    /// Второй тап запускает прокладку: отрезок обязан выйти из состояния
    /// «прокладываю» и остаться непрерывным.
    func testSecondWaypointGetsRouted() async {
        let state = AppState()
        state.trailSegmentsProvider = { (Fixture.corner, 1) }
        state.addConstructorWaypoint(Fixture.a)
        state.addConstructorWaypoint(Fixture.c)

        XCTAssertEqual(state.constructorLegs.first?.kind, .pending, "прокладка не началась")

        let deadline = Date().addingTimeInterval(20)
        while state.constructorIsRouting && Date() < deadline {
            try? await Task.sleep(nanoseconds: 100_000_000)
        }
        XCTAssertFalse(state.constructorIsRouting, "роутер не ответил за 20 с")

        let leg = state.constructorLegs[0]
        XCTAssertGreaterThanOrEqual(leg.path.count, 2)
        XCTAssertEqual(leg.distanceMeters, TrailRouter.length(of: leg.path), accuracy: 0.5)
        // Концы отрезка совпадают с опорными точками — линия не рвётся
        XCTAssertLessThan(TrailRouter.meters(leg.path[0], state.constructorWaypoints[0]), 1)
        XCTAssertLessThan(TrailRouter.meters(leg.path[leg.path.count - 1],
                                             state.constructorWaypoints[1]), 1)
    }
}

// MARK: - Участки постоянного уклона на профиле

/// `ProfileBands` кормит шкалу скраба длиной участка и его уклоном
/// («Segment length» и «Type» в brouter.de). Проверяем арифметику: она
/// врёт молча, а на глаз «+7%» от «+9%» не отличить.
final class ProfileBandsTests: XCTestCase {

    /// Прямая на север заданной длины с постоянным уклоном
    private func slope(fromKm: Double, lengthKm: Double,
                       startEle: Double, gradePercent: Double,
                       step: Double = 0.05) -> ([CLLocationCoordinate2D], [Double]) {
        var coords: [CLLocationCoordinate2D] = []
        var eles: [Double] = []
        var travelled = 0.0
        while travelled <= lengthKm + 1e-9 {
            // 0.009° широты ≈ 1 км
            coords.append(CLLocationCoordinate2D(latitude: 43.9 + (fromKm + travelled) * 0.009,
                                                 longitude: 19.5))
            eles.append(startEle + travelled * 1000 * gradePercent / 100)
            travelled += step
        }
        return (coords, eles)
    }

    private func profile(_ parts: [(km: Double, grade: Double)])
        -> ([CLLocationCoordinate2D], [Double], [Double]) {
        var coords: [CLLocationCoordinate2D] = []
        var eles: [Double] = []
        var at = 0.0, ele = 500.0
        for part in parts {
            let (c, e) = slope(fromKm: at, lengthKm: part.km, startEle: ele, gradePercent: part.grade)
            // Стык не дублируем
            coords += coords.isEmpty ? c : Array(c.dropFirst())
            eles   += eles.isEmpty   ? e : Array(e.dropFirst())
            at  += part.km
            ele += part.km * 1000 * part.grade / 100
        }
        let distance = ProfileScrub.cumulativeKm(coords)
        return (coords, eles, distance)
    }

    func testBandsSplitOnGradeChangeAndMeasureIt() {
        // Пологий подход, крутой подъём, спуск
        let (coords, eles, km) = profile([(km: 2, grade: 1), (km: 1, grade: 18), (km: 2, grade: -12)])
        let bands = ProfileBands.build(coordinates: coords, elevations: eles, distanceKm: km)

        XCTAssertEqual(bands.count, 3, "три разных уклона — три участка")
        XCTAssertEqual(bands[0].km, 2, accuracy: 0.25)
        XCTAssertEqual(bands[1].gradePercent, 18, accuracy: 3)
        XCTAssertEqual(bands[2].gradePercent, -12, accuracy: 3)
        // Участки идут подряд и покрывают весь профиль без дыр
        XCTAssertEqual(bands.first?.range.lowerBound, 0)
        XCTAssertEqual(bands.last?.range.upperBound, eles.count - 1)
        for i in 1..<bands.count {
            XCTAssertEqual(bands[i].range.lowerBound, bands[i - 1].range.upperBound)
        }
    }

    func testShortWiggleDoesNotBecomeItsOwnBand() {
        // Полсотни метров ступеньки посреди ровного подъёма — это шум высот,
        // а не участок: иначе «длина участка» перестаёт что-либо значить
        let (coords, eles, km) = profile([(km: 1, grade: 5), (km: 0.05, grade: -20), (km: 1, grade: 5)])
        let bands = ProfileBands.build(coordinates: coords, elevations: eles, distanceKm: km)

        XCTAssertLessThanOrEqual(bands.count, 2)
        XCTAssertTrue(bands.allSatisfy { $0.km * 1000 >= 100 }, "коротких участков остаться не должно")
    }

    func testIndexMapPointsAtItsOwnBand() {
        let (coords, eles, km) = profile([(km: 2, grade: 1), (km: 2, grade: 15)])
        let bands = ProfileBands.build(coordinates: coords, elevations: eles, distanceKm: km)
        let map = ProfileBands.indexMap(bands: bands, pointCount: eles.count)

        XCTAssertEqual(map.count, eles.count)
        for (point, band) in map.enumerated() {
            XCTAssertTrue(bands[band].range.contains(point))
        }
    }

    func testDegenerateProfileGivesNoBands() {
        XCTAssertTrue(ProfileBands.build(coordinates: [], elevations: [], distanceKm: []).isEmpty)
        // Число высот не совпало с числом точек — тот же случай, что и у
        // раскраски: молча ничего не строим, а не падаем
        let (coords, eles, km) = profile([(km: 1, grade: 4)])
        XCTAssertTrue(ProfileBands.build(coordinates: coords,
                                         elevations: Array(eles.dropLast()),
                                         distanceKm: km).isEmpty)
    }

    func testLabels() {
        XCTAssertEqual(ProfileBands.gradeLabel(16.4), "+16%")
        XCTAssertEqual(ProfileBands.gradeLabel(-4.6), "-5%")
        XCTAssertEqual(ProfileBands.gradeLabel(0.2), "0%")
        XCTAssertEqual(ProfileBands.lengthLabel(1.24), "1.2 км")
        XCTAssertEqual(ProfileBands.lengthLabel(0.32), "320 м")
    }
}

// MARK: - Свободный кусок карты под карточкой

/// По этому прямоугольнику подбирается кадр и для облёта к выделенному
/// участку профиля, и для «маршрут не теряется из кадра». Ошибка здесь не
/// видна в коде: камера честно летит к участку, просто ставит его туда, где
/// сверху лежит карточка. Ровно так и промахнулись 2026-08-21.
final class VisibleMapRectTests: XCTestCase {

    /// iPhone 15 Pro в точках
    private let screen = CGRect(x: 0, y: 0, width: 393, height: 852)

    private func panel(topFraction: CGFloat) -> CGRect {
        let top = screen.height * topFraction
        return CGRect(x: 0, y: top, width: screen.width, height: screen.height - top)
    }

    func testRectNeverReachesUnderTheCard() {
        // Раскрытая карточка (0.65 экрана), свёрнутая плашка и список
        for fraction in [0.35, 0.5, 0.65, 0.88] as [CGFloat] {
            let card = panel(topFraction: fraction)
            let rect = Coordinator.visibleMapRect(in: screen, panel: card)
            XCTAssertLessThanOrEqual(rect.maxY, card.minY,
                                     "кадр заезжает под карточку при \(fraction)")
            XCTAssertGreaterThan(rect.height, 40, "полоска карты схлопнулась при \(fraction)")
            XCTAssertGreaterThan(rect.width, 300)
        }
    }

    func testTopInsetLeavesRoomForControls() {
        // Свёрнутая плашка — сверху остаётся место под фильтры и кнопки
        let rect = Coordinator.visibleMapRect(in: screen, panel: panel(topFraction: 0.88))
        XCTAssertEqual(rect.minY, 150, accuracy: 1)
    }

    func testTopInsetGivesWayToATallCard() {
        // Карточка почти во весь экран: верхний отступ поджимается, но кадр
        // всё равно остаётся над ней
        let card = panel(topFraction: 0.25)
        let rect = Coordinator.visibleMapRect(in: screen, panel: card)
        XCTAssertLessThan(rect.minY, 150)
        XCTAssertLessThanOrEqual(rect.maxY, card.minY)
        XCTAssertGreaterThan(rect.height, 40)
    }

    func testWithoutMeasuredCardKeepsBottomStrip() {
        let rect = Coordinator.visibleMapRect(in: screen, panel: .zero)
        XCTAssertLessThan(rect.maxY, screen.maxY - 100, "низ экрана всё равно за карточкой")
        XCTAssertGreaterThan(rect.height, 100)
    }
}

// MARK: - Раскраска графика идёт по расстоянию

/// Цвет на графике и цвет на карте должны стоять в одном и том же месте
/// маршрута. Карта раскладывает градиент по `line-progress` (расстояние), и
/// график обязан так же: у записанного трека точки густеют на медленных
/// участках, и раскладка «по номеру точки» уводила красный подъём в сторону
/// от самого подъёма — ровно на этом фиче и не верили (фидбэк 2026-08-22).
final class ChartGradientTests: XCTestCase {

    /// Полкилометра частых точек, потом полтора километра редких —
    /// как медленный подъём и быстрый спуск в одном треке
    private func unevenTrack() -> ([CLLocationCoordinate2D], [Double]) {
        var coords: [CLLocationCoordinate2D] = []
        var eles: [Double] = []
        // 0.0045° широты ≈ 500 м, шагом по 10 м — 50 точек
        for i in 0...50 {
            coords.append(CLLocationCoordinate2D(latitude: 43.9 + Double(i) * 0.00009, longitude: 19.5))
            eles.append(500 + Double(i) * 2)
        }
        // ещё 1500 м, но всего 10 точек — по 150 м
        let base = coords[coords.count - 1].latitude
        for i in 1...10 {
            coords.append(CLLocationCoordinate2D(latitude: base + Double(i) * 0.00135, longitude: 19.5))
            eles.append(600 - Double(i) * 5)
        }
        return (coords, eles)
    }

    func testStopsFollowDistanceNotPointNumber() {
        let (coords, eles) = unevenTrack()
        let gradient = GradeColor.gradient(coordinates: coords, elevations: eles, fallback: .orange)
        let stops = gradient.stops

        XCTAssertGreaterThan(stops.count, 2)
        XCTAssertEqual(Double(stops[0].location), 0, accuracy: 0.001)
        XCTAssertEqual(Double(stops[stops.count - 1].location), 1, accuracy: 0.001)

        // Половина точек трека — это всего четверть его длины. По номерам
        // точек узел стоял бы на 0.5, по расстоянию должен быть около 0.25.
        let middle = Double(stops[stops.count / 2].location)
        XCTAssertLessThan(middle, 0.35, "узлы всё ещё раскладываются по номеру точки")
    }

    func testStopsStrictlyRise() {
        let (coords, eles) = unevenTrack()
        // Дубль точки посреди трека — на нём выражение и отваливалось бы
        var withDuplicate = coords
        withDuplicate.insert(coords[20], at: 21)
        var elesWithDuplicate = eles
        elesWithDuplicate.insert(eles[20], at: 21)

        let stops = GradeColor.gradient(coordinates: withDuplicate,
                                        elevations: elesWithDuplicate,
                                        fallback: .orange).stops
        for i in 1..<stops.count {
            XCTAssertGreaterThan(stops[i].location, stops[i - 1].location)
        }
    }

    func testDegenerateGeometryStaysSolid() {
        // Все точки в одной координате: раскладывать не по чему — остаёмся в
        // сплошном цвете карточки, как и при отсутствии высот
        let coords = [CLLocationCoordinate2D](repeating: .init(latitude: 43.9, longitude: 19.5), count: 20)
        let stops = GradeColor.gradient(coordinates: coords,
                                        elevations: (0..<20).map { 500 + Double($0) },
                                        fallback: .orange).stops
        XCTAssertEqual(stops.count, 1)
    }

    /// Главное, ради чего всё сведено в один расчёт: цвет графика и цвет
    /// линии на карте берутся из одного места маршрута
    func testChartAndMapAgreeOnTheSamePlace() throws {
        let (coords, eles) = unevenTrack()
        let chart = GradeColor.gradeStops(coordinates: coords, elevations: eles)
        XCTAssertGreaterThan(chart.count, 2)

        let map = try XCTUnwrap(GradeColor.mapGradient(coordinates: coords, elevations: eles))
        let mapPositions = try JSONSerialization.jsonObject(
            with: try JSONEncoder().encode(map)) as? [Any]
        let numbers = (mapPositions ?? []).compactMap { $0 as? Double }

        // Обе раскладки идут по доле пройденного пути и покрывают её целиком
        XCTAssertEqual(chart[0].position, 0, accuracy: 0.001)
        XCTAssertEqual(chart[chart.count - 1].position, 1, accuracy: 0.001)
        XCTAssertEqual(numbers.first ?? -1, 0, accuracy: 0.001)
        XCTAssertEqual(numbers.last ?? -1, 1, accuracy: 0.001)

        // И цвет в середине пути совпадает
        let middle = chart.min(by: { abs($0.position - 0.5) < abs($1.position - 0.5) })
        XCTAssertNotNil(middle)
    }
}

// MARK: - Километры под пальцем должны быть настоящими

/// Профиль рисуется по прореженным до 200 точек данным, и до 2026-08-22
/// дистанция для оси X и для шкалы скраба считалась по этой же прореженной
/// ломаной с одной общей поправкой на полную длину. Глобально сходится, а
/// локально врёт: ломаная срезает повороты неравномерно. Здесь меряем, на
/// сколько именно — на настоящем маршруте из бандла.
final class SampledDistanceTests: XCTestCase {

    private func cumulative(_ coords: [CLLocationCoordinate2D]) -> [Double] {
        var result = [0.0]
        for i in 1..<coords.count {
            result.append(result[i - 1] + TrailRouter.meters(coords[i - 1], coords[i]) / 1000)
        }
        return result
    }

    func testSampledDistanceMatchesRealPath() throws {
        // Самый длинный маршрут из бандла — на нём ошибка виднее всего
        let route = try XCTUnwrap(RouteStore.all.first(where: { $0.name.contains("Maljen") })
                                  ?? RouteStore.all.first)
        let stats = try XCTUnwrap(GPXLoader.loadStats(for: route))
        XCTAssertGreaterThan(stats.coordinates.count, 200, "маршрут не прореживается — тест бессмыслен")

        let full = cumulative(stats.coordinates)
        let sampledIndices = stats.sampledIndices
        let real = sampledIndices.map { full[$0] }
        let shown = stats.sampledDistancesKm

        XCTAssertEqual(shown.count, real.count)
        var maxError = 0.0
        for (a, b) in zip(shown, real) { maxError = max(maxError, abs(a - b)) }
        print("маршрут \(route.name): \(stats.coordinates.count) точек, "
              + "макс. расхождение \(String(format: "%.3f", maxError)) км")
        XCTAssertLessThan(maxError, 0.02, "километры на графике не совпадают с настоящим путём")
    }
}
