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
