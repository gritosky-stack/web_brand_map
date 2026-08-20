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

    /// Выражение `line-gradient` для линии маршрута — цвет по уклону вдоль
    /// одной цельной линии. nil (нет высот / не совпало число точек) —
    /// сигнал вызывающей стороне рисовать сплошным цветом типа маршрута.
    ///
    /// ⚠️ Раскраска идёт именно градиентом по **одной** `LineString`, а не
    /// набором двухточечных отрезков со свойством "grade". Отрезки Mapbox
    /// упрощает по-тайлово (Дуглас — Пекер, `tolerance` по умолчанию), и
    /// каждый из них — метры длиной: ниже z≈11 они схлопывались в точку и
    /// выкидывались, маршрут пропадал с карты целиком. У цельной линии
    /// упрощать нечего — она видна на любом зуме, и фича в источнике одна
    /// вместо тысяч.
    ///
    /// Требует у источника `lineMetrics = true` — без него `line-progress`
    /// не считается и слой останется без цвета.
    ///
    /// `maxStops` — потолок числа узлов градиента: у нарисованного по тропам
    /// маршрута точек тысячи, а на глаз хватает пары сотен (тот же приём,
    /// что с прореживанием профиля до 200 точек на графике).
    static func mapGradient(coordinates: [CLLocationCoordinate2D],
                            elevations: [Double],
                            maxStops: Int = 200) -> Exp? {
        guard coordinates.count == elevations.count, coordinates.count > 1 else { return nil }
        let grades = pointGrades(coordinates: coordinates, elevations: elevations)
        guard grades.count == coordinates.count else { return nil }

        // line-progress — доля пройденного пути, поэтому узлы ставим по
        // накопленному расстоянию, а не по номеру точки: между точками
        // маршрута разрывы очень разные.
        var cum = [Double](repeating: 0, count: coordinates.count)
        for i in 1..<coordinates.count {
            cum[i] = cum[i - 1] + TrailRouter.meters(coordinates[i - 1], coordinates[i])
        }
        guard let total = cum.last, total > 0 else { return nil }

        let step = max(1, Int((Double(coordinates.count) / Double(maxStops)).rounded(.up)))
        var indices = Array(stride(from: 0, to: coordinates.count, by: step))
        if indices.last != coordinates.count - 1 { indices.append(coordinates.count - 1) }

        // Узлы interpolate обязаны строго возрастать: две точки на одном
        // месте дали бы одинаковый line-progress и выражение отвалилось бы.
        var stops: [(Double, UIColor)] = []
        stops.reserveCapacity(indices.count)
        for i in indices {
            let p = min(1.0, max(0.0, cum[i] / total))
            if let last = stops.last, p <= last.0 { continue }
            stops.append((p, color(forGradePercent: grades[i])))
        }
        guard stops.count > 1 else { return nil }
        if stops[0].0 > 0 { stops.insert((0, stops[0].1), at: 0) }
        if stops[stops.count - 1].0 < 1 { stops.append((1, stops[stops.count - 1].1)) }

        // Аргументы собираем массивом, а не result builder'ом: у билдера
        // `Exp` нет `buildArray`, циклом внутри него не пройтись.
        var args: [Exp.Argument] = [
            .expression(Exp(.linear)),
            .expression(Exp(.lineProgress))
        ]
        for (position, color) in stops {
            args.append(.number(position))
            args.append(.expression(rgba(color)))
        }
        return Exp(operator: .interpolate, arguments: args)
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
