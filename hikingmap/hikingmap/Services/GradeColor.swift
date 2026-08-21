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

    /// Узел раскраски: доля пройденного пути (0…1) и цвет уклона в этой
    /// точке. Одно и то же представление и для графика, и для линии на карте
    /// — чтобы они не начали рассказывать разные истории.
    struct GradeStop {
        let position: Double
        let color: UIColor
    }

    /// Узлы раскраски по маршруту. Считаются по **полной** геометрии, как и
    /// у линии на карте, и раскладываются по накопленному расстоянию.
    ///
    /// ⚠️ Именно по полной, а не по прореженному до 200 точек профилю. На
    /// прореженных точках (у 11-километрового маршрута это шаг ~57 м)
    /// сглаживание уклона окном в 60 м фактически не работает: цвет прыгал на
    /// каждой точке, график становился полосатым, и на одном и том же участке
    /// карта показывала ровный подъём, а график — чересполосицу (фидбэк
    /// 2026-08-22).
    ///
    /// - `gradeResolution` — потолок числа точек для расчёта уклона. Полная
    ///   геометрия бывает в тысячи точек, а профиль пересобирается на каждом
    ///   кадре скраба; 800 точек — это шаг в десятки метров, мельче окна
    ///   сглаживания, то есть на цвет уже не влияет.
    /// - `maxStops` — потолок числа узлов в самом градиенте, как у `mapGradient`.
    static func gradeStops(coordinates: [CLLocationCoordinate2D],
                           elevations: [Double],
                           gradeResolution: Int = 800,
                           maxStops: Int = 200) -> [GradeStop] {
        guard coordinates.count == elevations.count, coordinates.count > 1 else { return [] }

        // Прореживаем вход, сохраняя концы
        var coords = coordinates
        var eles = elevations
        if coordinates.count > gradeResolution {
            let step = Double(coordinates.count) / Double(gradeResolution)
            var indices = (0..<gradeResolution).map { Int(Double($0) * step) }
            if indices.last != coordinates.count - 1 { indices.append(coordinates.count - 1) }
            coords = indices.map { coordinates[$0] }
            eles   = indices.map { elevations[$0] }
        }

        let grades = pointGrades(coordinates: coords, elevations: eles)
        guard grades.count == coords.count, grades.count > 1 else { return [] }

        var cumulative = [Double](repeating: 0, count: coords.count)
        for i in 1..<coords.count {
            cumulative[i] = cumulative[i - 1] + TrailRouter.meters(coords[i - 1], coords[i])
        }
        guard let total = cumulative.last, total > 0 else { return [] }

        let step = max(1, Int((Double(coords.count) / Double(maxStops)).rounded(.up)))
        var indices = Array(stride(from: 0, to: coords.count, by: step))
        if indices.last != coords.count - 1 { indices.append(coords.count - 1) }

        // Позиции обязаны строго расти: две точки на одном месте дают одну и
        // ту же долю пути, и градиент отвалился бы молча
        var stops: [GradeStop] = []
        stops.reserveCapacity(indices.count)
        for i in indices {
            let position = min(1, max(0, cumulative[i] / total))
            if let last = stops.last, position <= last.position { continue }
            stops.append(GradeStop(position: position, color: color(forGradePercent: grades[i])))
        }
        guard stops.count > 1 else { return [] }
        if stops[0].position > 0 {
            stops.insert(GradeStop(position: 0, color: stops[0].color), at: 0)
        }
        if stops[stops.count - 1].position < 1 {
            stops.append(GradeStop(position: 1, color: stops[stops.count - 1].color))
        }
        return stops
    }

    /// Готовый градиент для графика из уже посчитанных узлов. `fallback` —
    /// если узлов нет (высот меньше двух точек, геометрия вырождена): график
    /// остаётся в своём привычном сплошном цвете.
    static func gradient(stops: [GradeStop], opacity: Double = 1.0, fallback: Color) -> Gradient {
        guard stops.count > 1 else { return Gradient(colors: [fallback.opacity(opacity)]) }
        return Gradient(stops: stops.map {
            Gradient.Stop(color: Color($0.color).opacity(opacity), location: CGFloat($0.position))
        })
    }

    /// Непрерывный горизонтальный градиент для графика высот — то же самое,
    /// одним вызовом, когда узлы больше нигде не нужны.
    static func gradient(coordinates: [CLLocationCoordinate2D],
                          elevations: [Double],
                          opacity: Double = 1.0,
                          fallback: Color) -> Gradient {
        gradient(stops: gradeStops(coordinates: coordinates, elevations: elevations),
                 opacity: opacity, fallback: fallback)
    }

    /// Выражение `line-gradient` для линии маршрута — цвет по уклону вдоль
    /// одной цельной линии. nil (нет высот / не совпало число точек) —
    /// сигнал вызывающей стороне рисовать сплошным цветом типа маршрута.
    ///
    /// Узлы берутся из общего `gradeStops` — того же, из которого красится
    /// график высот. Это не «для красоты одинаково»: пока у карты и графика
    /// были свои расчёты, один и тот же участок выходил на карте ровным
    /// подъёмом, а на графике чересполосицей, и по цвету нельзя было понять,
    /// куда именно улетела камера (фидбэк 2026-08-22).
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
    static func mapGradient(coordinates: [CLLocationCoordinate2D],
                            elevations: [Double],
                            maxStops: Int = 200) -> Exp? {
        let stops = gradeStops(coordinates: coordinates, elevations: elevations, maxStops: maxStops)
        guard stops.count > 1 else { return nil }

        // Аргументы собираем массивом, а не result builder'ом: у билдера
        // `Exp` нет `buildArray`, циклом внутри него не пройтись.
        var args: [Exp.Argument] = [
            .expression(Exp(.linear)),
            .expression(Exp(.lineProgress))
        ]
        for stop in stops {
            args.append(.number(stop.position))
            args.append(.expression(rgba(stop.color)))
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
