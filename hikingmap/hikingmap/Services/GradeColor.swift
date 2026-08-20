import UIKit
import SwiftUI
import CoreLocation
import MapboxMaps

/// Цвет участка маршрута по локальному уклону (набор/спуск на сегмент) —
/// общий расчёт для линии на карте (`mapExpression`/`mapFeatures`) и для
/// графика высот (`gradient`), чтобы обе отрисовки рассказывали одну и ту
/// же историю одинаковыми цветами на одних и тех же сегментах.
///
/// Палитра продолжает уже существующую шкалу сложности маршрута
/// (`Difficulty.easy…expert`: зелёный → оранжевый → красный → фиолетовый)
/// в синий/голубой для спуска — а не вводит отдельный язык цвета под одну
/// фичу.
enum GradeColor {

    /// Узлы линейной интерполяции: (уклон %, цвет). Повтор значения в
    /// -2/+2 держит плоскую зелёную зону вокруг нуля вместо резкой границы
    /// ровно на нуле — маршрут почти никогда не идёт идеально горизонтально.
    private static let stops: [(grade: Double, color: UIColor)] = [
        (-25, DS.gradeDescentSteepUI),
        (-10, DS.gradeDescentGentleUI),
        ( -2, Difficulty.easy.color),
        (  2, Difficulty.easy.color),
        (  8, Difficulty.medium.color),
        ( 16, Difficulty.hard.color),
        ( 28, Difficulty.expert.color)
    ]

    static func color(forGradePercent grade: Double) -> UIColor {
        guard let first = stops.first, let last = stops.last else { return Difficulty.easy.color }
        if grade <= first.grade { return first.color }
        if grade >= last.grade { return last.color }
        for i in 1..<stops.count {
            let (g0, c0) = stops[i - 1]
            let (g1, c1) = stops[i]
            if grade <= g1 {
                let t = g1 > g0 ? (grade - g0) / (g1 - g0) : 0
                return lerp(c0, c1, t)
            }
        }
        return last.color
    }

    /// Локальный уклон (%) между соседними точками, сглаженный скользящим
    /// средним по расстоянию (не по числу точек — иначе на плотной записи
    /// трека, точка каждые 5 м, и на редких PSS-треках получалось бы разное
    /// по факту окно сглаживания). В духе `GPXParser.smooth` для самого
    /// профиля высот: без этого цвет дрожал бы на шуме GPS/DEM почти на
    /// каждом сегменте.
    static func segmentGrades(coordinates: [CLLocationCoordinate2D],
                               elevations: [Double],
                               smoothingRadiusMeters: Double = 60) -> [Double] {
        guard coordinates.count == elevations.count, coordinates.count > 1 else { return [] }
        let n = coordinates.count - 1
        guard n > 0 else { return [] }

        var segDist  = [Double](repeating: 0, count: n)
        var segGrade = [Double](repeating: 0, count: n)
        var midDist  = [Double](repeating: 0, count: n)
        var cum = 0.0
        for i in 0..<n {
            let d  = TrailRouter.meters(coordinates[i], coordinates[i + 1])
            let dh = elevations[i + 1] - elevations[i]
            segDist[i]  = d
            segGrade[i] = d > 1 ? (dh / d) * 100 : 0
            midDist[i]  = cum + d / 2
            cum += d
        }
        guard n > 2 else { return segGrade }

        var smoothed = [Double](repeating: 0, count: n)
        var lo = 0, hi = 0
        var windowDistSum = segDist[0]
        var windowGradeSum = segGrade[0] * segDist[0]
        for i in 0..<n {
            while hi < n - 1, midDist[hi + 1] - midDist[i] <= smoothingRadiusMeters {
                hi += 1
                windowDistSum += segDist[hi]
                windowGradeSum += segGrade[hi] * segDist[hi]
            }
            while lo < i, midDist[i] - midDist[lo] > smoothingRadiusMeters {
                windowDistSum -= segDist[lo]
                windowGradeSum -= segGrade[lo] * segDist[lo]
                lo += 1
            }
            smoothed[i] = windowDistSum > 0 ? windowGradeSum / windowDistSum : segGrade[i]
        }
        return smoothed
    }

    /// Уклон в точках (не в сегментах) — усреднение двух соседних
    /// сегментов, чтобы градиент на графике/линии был непрерывным от
    /// вершины до вершины, а не обрывался на границах сегментов.
    static func pointGrades(coordinates: [CLLocationCoordinate2D], elevations: [Double]) -> [Double] {
        let seg = segmentGrades(coordinates: coordinates, elevations: elevations)
        guard !seg.isEmpty else { return [] }
        guard seg.count > 1 else { return [seg[0], seg[0]] }
        var pts = [Double](repeating: 0, count: seg.count + 1)
        pts[0] = seg[0]
        pts[pts.count - 1] = seg[seg.count - 1]
        for i in 1..<(pts.count - 1) {
            pts[i] = (seg[i - 1] + seg[i]) / 2
        }
        return pts
    }

    /// Непрерывный горизонтальный градиент для графика высот — общий метод
    /// для `ElevationChartView` и `CustomElevationChart`. `fallback`
    /// используется, если высот меньше двух точек (например, ещё не
    /// догрузились) — так график остаётся в своём привычном сплошном цвете,
    /// а не в цвете уклона по умолчанию.
    static func gradient(coordinates: [CLLocationCoordinate2D],
                          elevations: [Double],
                          opacity: Double = 1.0,
                          fallback: Color) -> Gradient {
        let grades = pointGrades(coordinates: coordinates, elevations: elevations)
        guard grades.count > 1 else { return Gradient(colors: [fallback.opacity(opacity)]) }
        let stops = grades.enumerated().map { i, g in
            Gradient.Stop(color: Color(color(forGradePercent: g)).opacity(opacity),
                          location: CGFloat(Double(i) / Double(grades.count - 1)))
        }
        return Gradient(stops: stops)
    }

    /// Фичи для карты: по одному 2-точечному отрезку на сегмент со
    /// свойством "grade" — Mapbox раскрашивает их через `mapExpression()`.
    /// Пустой результат (нет высот / не совпало число точек) — сигнал
    /// вызывающей стороне откатиться на сплошную линию цвета типа маршрута.
    static func mapFeatures(coordinates: [CLLocationCoordinate2D], elevations: [Double]) -> [Feature] {
        guard coordinates.count == elevations.count, coordinates.count > 1 else { return [] }
        let grades = segmentGrades(coordinates: coordinates, elevations: elevations)
        guard grades.count == coordinates.count - 1 else { return [] }
        var features: [Feature] = []
        features.reserveCapacity(grades.count)
        for i in 0..<grades.count {
            var f = Feature(geometry: .lineString(LineString([coordinates[i], coordinates[i + 1]])))
            f.properties = ["grade": .number(grades[i])]
            features.append(f)
        }
        return features
    }

    /// Mapbox-выражение `line-color` по свойству "grade" — те же узлы,
    /// что у `color(forGradePercent:)`.
    static func mapExpression(propertyName: String = "grade") -> Exp {
        Exp(.interpolate) {
            Exp(.linear)
            Exp(.get) { propertyName }
            -25.0; rgba(DS.gradeDescentSteepUI)
            -10.0; rgba(DS.gradeDescentGentleUI)
             -2.0; rgba(Difficulty.easy.color)
              2.0; rgba(Difficulty.easy.color)
              8.0; rgba(Difficulty.medium.color)
             16.0; rgba(Difficulty.hard.color)
             28.0; rgba(Difficulty.expert.color)
        }
    }

    private static func rgba(_ c: UIColor) -> Exp {
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        c.getRed(&r, green: &g, blue: &b, alpha: &a)
        return Exp(.rgba) { Double(r) * 255; Double(g) * 255; Double(b) * 255; Double(a) }
    }

    private static func lerp(_ a: UIColor, _ b: UIColor, _ t: Double) -> UIColor {
        var ar: CGFloat = 0, ag: CGFloat = 0, ab: CGFloat = 0, aa: CGFloat = 0
        var br: CGFloat = 0, bg: CGFloat = 0, bb: CGFloat = 0, ba: CGFloat = 0
        a.getRed(&ar, green: &ag, blue: &ab, alpha: &aa)
        b.getRed(&br, green: &bg, blue: &bb, alpha: &ba)
        let ct = CGFloat(t)
        return UIColor(red: ar + (br - ar) * ct,
                        green: ag + (bg - ag) * ct,
                        blue: ab + (bb - ab) * ct,
                        alpha: 1)
    }
}
