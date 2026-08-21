import SwiftUI
import Charts
import CoreLocation
import UIKit

// MARK: - Профиль высот
//
// Один график на все карточки: обычные маршруты (`ElevationChartView`), PSS и
// свои (`CustomElevationChart`). Раньше это были две почти дословные копии,
// и каждая доработка — выделение участка, щипок, ось X — правилась дважды и
// потихоньку расходилась. Обёртки остались только ради акцентного цвета и
// подписи слева в шапке.

struct ProfileChart: View {
    /// Акцент карточки: оранжевый у обычных и PSS, фиолетовый у своих
    let accent: Color

    @EnvironmentObject var appState: AppState

    @State private var scrubIndex: Int? = nil
    /// Выделенный жестом «двойной тап + протяжка» участок. Держится, пока по
    /// нему смотрят: новое выделение или уход бегунка за его пределы снимают.
    @State private var selectedRange: ClosedRange<Int>? = nil
    /// Чем занято текущее касание. nil — ещё не решили: палец не сдвинулся
    /// настолько, чтобы считать это ведением, и это вполне может быть первый
    /// тап из двойного.
    @State private var dragKind: ProfileDragKind? = nil
    /// Предыдущее касание, если оно было тапом на месте — по нему и
    /// распознаём двойной тап
    @State private var lastTap: ProfileScrub.TapMark? = nil
    /// Видимый по X участок графика после «щипка». nil — весь маршрут
    @State private var visibleRange: ClosedRange<Int>? = nil
    /// Диапазон на начало текущего жеста «щипка» — масштаб считаем от него,
    /// а не покадрово, иначе дрейф накапливается
    @State private var pinchBaseRange: ClosedRange<Int>? = nil

    // Считаем при создании: тело перерисовывается на каждом кадре скраба,
    // а всё это — проходы по всему маршруту
    private let samples: [(index: Int, elevation: Double)]
    private let coordinates: [CLLocationCoordinate2D]
    /// Пройденные километры в каждой точке, уже с поправкой на полную длину
    /// маршрута: прореженная ломаная срезает повороты и всегда короче
    private let distanceKm: [Double]
    private let totalKm: Double
    private let minY: Double
    private let maxY: Double
    private let peak: Double
    private let bottom: Double
    /// Участки постоянного уклона — как полосы в brouter.de
    private let bands: [ProfileBands.Band]
    /// Номер участка для каждой точки профиля
    private let bandOfIndex: [Int]

    /// Узлы раскраски по уклону — те же, что у линии маршрута на карте:
    /// считаются по полной геометрии и раскладываются по доле пройденного
    /// пути. Ось X у графика тоже в километрах, поэтому цвет ложится на
    /// кривую там же, где он лежит на тропе.
    private let gradeStops: [GradeColor.GradeStop]

    /// `gradeCoordinates`/`gradeElevations` — **полная** геометрия маршрута
    /// для раскраски (у карточек она есть), тогда как сам график рисуется по
    /// прореженным `coordinates`/`elevations`. Не передали — красим по
    /// прореженным, как раньше.
    init(elevations: [Double],
         coordinates: [CLLocationCoordinate2D],
         totalKm: Double,
         accent: Color,
         distancesKm: [Double]? = nil,
         gradeCoordinates: [CLLocationCoordinate2D]? = nil,
         gradeElevations: [Double]? = nil) {
        self.accent      = accent
        self.coordinates = coordinates
        self.totalKm     = totalKm
        samples = elevations.enumerated().map { (index: $0.offset, elevation: $0.element) }
        peak    = elevations.max() ?? 0
        bottom  = elevations.min() ?? 0
        minY    = floor((bottom - 80) / 100) * 100
        maxY    = ceil((peak + 80) / 100) * 100

        // Километры в точках профиля. Правильные — те, что посчитаны по полной
        // геометрии (их даёт карточка); запасной путь — по самой прореженной
        // ломаной с поправкой на полную длину, он локально врёт на изгибах.
        if let distancesKm, distancesKm.count == elevations.count {
            distanceKm = distancesKm
        } else {
            let measured = ProfileScrub.cumulativeKm(coordinates)
            let scale    = (measured.last ?? 0) > 0 && totalKm > 0 ? totalKm / measured.last! : 1
            distanceKm   = measured.map { $0 * scale }
        }

        bands       = ProfileBands.build(coordinates: coordinates,
                                         elevations: elevations,
                                         distanceKm: distanceKm)
        bandOfIndex = ProfileBands.indexMap(bands: bands, pointCount: elevations.count)

        let gradeCoords = gradeCoordinates ?? coordinates
        let gradeEles   = gradeElevations ?? elevations
        gradeStops = GradeColor.gradeStops(coordinates: gradeCoords, elevations: gradeEles)
    }

    private var yStride: Double {
        let range = maxY - minY
        if range < 300 { return 100 }
        if range < 700 { return 200 }
        return 300
    }

    private var fullRange: ClosedRange<Int> {
        0...max(samples.count - 1, 0)
    }
    private var effectiveRange: ClosedRange<Int> {
        visibleRange ?? fullRange
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            headerRow
            chartBody
        }
    }

    // MARK: - Шапка

    private var headerRow: some View {
        HStack(spacing: 8) {
            Label("\(Int(peak)) м", systemImage: "mountain.2.fill")
                .font(.caption)
                .foregroundColor(accent)
            Spacer(minLength: 4)
            if let sel = selectedRange, sel.upperBound > sel.lowerBound {
                selectionChip(sel)
            } else if let idx = scrubIndex, idx < samples.count {
                Text("\(Int(samples[idx].elevation)) м")
                    .font(.system(size: 12, weight: .semibold).monospacedDigit())
                    .foregroundColor(.white)
                    .padding(.horizontal, 8).padding(.vertical, 3)
                    .background(accent.opacity(0.25))
                    .clipShape(Capsule())
                    .animation(.none, value: idx)
            } else {
                Text("Мин \(Int(bottom)) м")
                    .font(.caption)
                    .foregroundColor(DS.textSecondary)
            }
        }
    }

    /// Что за участок выделен: длина и средний уклон — как «Segment length»
    /// и «Type» в подсказке brouter.de
    private func selectionChip(_ sel: ClosedRange<Int>) -> some View {
        let km    = max(0, (distanceKm[safe: sel.upperBound] ?? 0)
                         - (distanceKm[safe: sel.lowerBound] ?? 0))
        let dh    = (samples[safe: sel.upperBound]?.elevation ?? 0)
                  - (samples[safe: sel.lowerBound]?.elevation ?? 0)
        let grade = km > 0 ? dh / (km * 1000) * 100 : 0
        return HStack(spacing: 6) {
            Text(ProfileBands.lengthLabel(km))
            Text(ProfileBands.gradeLabel(grade))
                .foregroundColor(Color(GradeColor.color(forGradePercent: grade)))
        }
        .font(.system(size: 12, weight: .semibold).monospacedDigit())
        .foregroundColor(.white)
        .padding(.horizontal, 8).padding(.vertical, 3)
        .background(Color.white.opacity(0.14))
        .clipShape(Capsule())
    }

    // MARK: - График

    private var chartBody: some View {
        Chart {
            if let sel = selectedRange {
                RectangleMark(
                    xStart: .value("selStart", km(sel.lowerBound)),
                    xEnd:   .value("selEnd", km(sel.upperBound))
                )
                .foregroundStyle(Color.white.opacity(0.12))
            }

            ForEach(samples, id: \.index) { pt in
                AreaMark(
                    x: .value("км", km(pt.index)),
                    yStart: .value("base", minY),
                    yEnd:   .value("ele",  pt.elevation)
                )
                .foregroundStyle(LinearGradient(gradient: visibleAreaGradient, startPoint: .leading, endPoint: .trailing))
                .interpolationMethod(.catmullRom)

                LineMark(
                    x: .value("км", km(pt.index)),
                    y: .value("ele", pt.elevation)
                )
                .foregroundStyle(LinearGradient(gradient: visibleLineGradient, startPoint: .leading, endPoint: .trailing))
                .lineStyle(StrokeStyle(lineWidth: 2.4, lineCap: .round, lineJoin: .round))
                .interpolationMethod(.catmullRom)
            }

            if let sel = selectedRange {
                RuleMark(x: .value("selStart", km(sel.lowerBound)))
                    .foregroundStyle(Color.white.opacity(0.5))
                    .lineStyle(StrokeStyle(lineWidth: 1))
                RuleMark(x: .value("selEnd", km(sel.upperBound)))
                    .foregroundStyle(Color.white.opacity(0.5))
                    .lineStyle(StrokeStyle(lineWidth: 1))
            }

            if let idx = scrubIndex, idx < samples.count {
                RuleMark(x: .value("scrub", km(idx)))
                    .foregroundStyle(Color.white.opacity(0.55))
                    .lineStyle(StrokeStyle(lineWidth: 1, dash: [3, 3]))

                PointMark(
                    x: .value("scrub", km(idx)),
                    y: .value("ele", samples[idx].elevation)
                )
                .foregroundStyle(Color.white)
                .symbolSize(55)
            }
        }
        .chartXScale(domain: kmDomain)
        .chartYScale(domain: minY...maxY)
        .chartXAxis {
            // Шаг подбирается под видимый кусок: после «щипка» он меняется
            // на лету, иначе на растянутом графике осталась бы одна подпись
            AxisMarks(values: xTicks) { value in
                AxisGridLine(stroke: StrokeStyle(lineWidth: 0.5, dash: [4, 4]))
                    .foregroundStyle(Color.white.opacity(0.10))
                AxisValueLabel {
                    if let tick = value.as(Double.self) {
                        Text(xTickLabel(tick))
                            .font(.system(size: 9).monospacedDigit())
                            .foregroundColor(DS.textSecondary)
                    }
                }
            }
        }
        .chartYAxis {
            AxisMarks(values: yTicks) { value in
                let isPeak = (value.as(Double.self)).map { abs($0 - peak) < 0.001 } ?? false
                AxisGridLine(stroke: StrokeStyle(lineWidth: isPeak ? 0.9 : 0.5,
                                                 dash: isPeak ? [] : [4, 4]))
                    .foregroundStyle(isPeak ? accent.opacity(0.55) : Color.white.opacity(0.12))
                AxisValueLabel {
                    if let v = value.as(Double.self) {
                        Text("\(Int(v))м")
                            .font(.system(size: 9).monospacedDigit())
                            .foregroundColor(isPeak ? accent : DS.textSecondary)
                    }
                }
            }
        }
        .chartOverlay { proxy in
            GeometryReader { geo in
                Rectangle().fill(.clear).contentShape(Rectangle())
                    .gesture(chartDragGesture(proxy: proxy, geo: geo))
                    .simultaneousGesture(zoomGesture())
            }
        }
        .frame(height: 132)
        .onDisappear { releaseSelection() }
    }

    private var visibleLineGradient: Gradient {
        GradeColor.gradient(stops: visibleStops, fallback: accent)
    }
    private var visibleAreaGradient: Gradient {
        GradeColor.gradient(stops: visibleStops, opacity: 0.4, fallback: accent)
    }

    /// Узлы, обрезанные по видимому куску и растянутые обратно на 0…1.
    ///
    /// ⚠️ Градиент кладётся на рамку марок, а она после «щипка» — это видимое
    /// окно, а не весь маршрут: без обрезки цвета всего маршрута сжимались бы
    /// в это окно и разъезжались с кривой. Обрезаем арифметикой по готовым
    /// узлам, уклоны заново не считаем.
    private var visibleStops: [GradeColor.GradeStop] {
        let range = effectiveRange
        guard !gradeStops.isEmpty, totalKm > 0,
              range.lowerBound > fullRange.lowerBound || range.upperBound < fullRange.upperBound
        else { return gradeStops }

        let from = km(range.lowerBound) / totalKm
        let to   = km(range.upperBound) / totalKm
        guard to > from else { return gradeStops }

        let span = to - from
        var windowed: [GradeColor.GradeStop] = []
        windowed.reserveCapacity(gradeStops.count)
        for stop in gradeStops where stop.position >= from && stop.position <= to {
            windowed.append(GradeColor.GradeStop(position: (stop.position - from) / span,
                                                 color: stop.color))
        }
        // Края окна попали между узлами — дотягиваем цветом соседа
        if windowed.first?.position != 0 {
            let colour = gradeStops.last(where: { $0.position <= from })?.color
                ?? gradeStops[0].color
            windowed.insert(GradeColor.GradeStop(position: 0, color: colour), at: 0)
        }
        if windowed.last?.position != 1 {
            let colour = gradeStops.first(where: { $0.position >= to })?.color
                ?? gradeStops[gradeStops.count - 1].color
            windowed.append(GradeColor.GradeStop(position: 1, color: colour))
        }
        return windowed
    }

    // MARK: - Ось X (дистанция)

    /// Километр в точке профиля
    private func km(_ index: Int) -> Double { distanceKm[safe: index] ?? 0 }

    /// Домен оси X — километры видимого куска.
    ///
    /// ⚠️ Ось идёт **по расстоянию**, а не по номерам точек профиля. В
    /// записанном треке точки густеют там, где шли медленно (подъём), и на
    /// «индексной» оси первый километр растягивался на полграфика: подписи
    /// стояли неравномерно, начало оси выглядело пустым, а засечка «5» не
    /// совпадала с тем, что показывала шкала скраба под пальцем.
    private var kmDomain: ClosedRange<Double> {
        let range = effectiveRange
        let from = km(range.lowerBound)
        let to   = km(range.upperBound)
        return to > from ? from...to : from...(from + 1)
    }

    /// Засечки — «круглые» километры из лестницы, до восьми штук на видимый
    /// кусок. С пятью на 19-километровом маршруте шаг выпадал в 5 км, и
    /// первая подпись появлялась только на четверти графика.
    private var xTicks: [Double] {
        let domain = kmDomain
        let span = domain.upperBound - domain.lowerBound
        guard span > 0 else { return [] }

        let ladder: [Double] = [0.1, 0.2, 0.25, 0.5, 1, 2, 2.5, 5, 10, 20, 50, 100]
        let step = ladder.first(where: { span / $0 <= 8 }) ?? ladder[ladder.count - 1]

        // Подпись у самого края наезжает на рамку графика и на подписи высот
        let margin = span * 0.04
        var ticks: [Double] = []
        var value = (domain.lowerBound / step).rounded(.up) * step
        while value <= domain.upperBound {
            if value > domain.lowerBound + margin, value < domain.upperBound - margin {
                ticks.append(value)
            }
            value += step
        }
        return ticks
    }

    private func xTickLabel(_ km: Double) -> String {
        abs(km - km.rounded()) < 0.05
            ? "\(Int(km.rounded()))"
            : String(format: "%.1f", km)
    }

    /// Ближайшая точка профиля к заданному километру — бинарным поиском по
    /// накопленной дистанции
    private func index(forKm target: Double) -> Int? {
        let range = effectiveRange
        guard range.upperBound < distanceKm.count,
              range.upperBound > range.lowerBound else { return nil }
        // За краями графика тянем к его концам, а не бросаем жест
        if target <= distanceKm[range.lowerBound] { return range.lowerBound }
        if target >= distanceKm[range.upperBound] { return range.upperBound }

        var lo = range.lowerBound, hi = range.upperBound
        while lo < hi {
            let mid = (lo + hi) / 2
            if distanceKm[mid] < target { lo = mid + 1 } else { hi = mid }
        }
        if lo > range.lowerBound,
           abs(distanceKm[lo - 1] - target) < abs(distanceKm[lo] - target) { return lo - 1 }
        return lo
    }

    // MARK: - Ось Y

    /// Обычная сетка плюс отдельная полка на самой высокой точке маршрута —
    /// её подпись справа показывает пик, а не круглую сотню метров рядом.
    private var yTicks: [Double] {
        var values: [Double] = []
        var v = minY
        while v <= maxY {
            // Круглая линия впритык к пику не нужна: две подписи слипнутся
            if abs(v - peak) > yStride * 0.4 { values.append(v) }
            v += yStride
        }
        values.append(peak)
        return values.sorted()
    }

    // MARK: - Жесты

    /// Экранная точка → индекс в `samples`, с поправкой на плот-фрейм графика
    private func chartIndex(at location: CGPoint, proxy: ChartProxy, geo: GeometryProxy) -> Int? {
        guard let anchor = proxy.plotFrame else { return nil }
        let plotFrame = geo[anchor]
        let x = location.x - plotFrame.origin.x
        // Ось в километрах — сначала километр под пальцем, потом точка профиля
        guard let km: Double = proxy.value(atX: x) else { return nil }
        return index(forKm: km)
    }

    /// Единый жест над графиком: ведение пальцем — скраб, а протяжка сразу
    /// после короткого тапа рядом — выделение участка.
    ///
    /// ⚠️ Двойной тап распознаём **сами**, а не отдельным
    /// `TapGesture(count: 2).sequenced(before:)`. Скраб — это
    /// `DragGesture(minimumDistance: 0)`, он срабатывает в момент касания и
    /// уводит тап в провал ещё на первом пальце: до второго тапа дело не
    /// доходило ни при каком приоритете жестов, и выделение не работало
    /// вообще. Плюс `onChanged` есть только у жестов с `Value: Equatable`, а
    /// у последовательности с `TapGesture` значение первого шага — `Void`.
    /// Один `DragGesture` снимает обе проблемы разом.
    ///
    /// ⚠️ Пока палец не проехал `scrubSlop`, касание считается неопределённым
    /// и **ничего не публикует**. Иначе первый тап из двойного успевал
    /// сойти за скраб: карта видела точку вне кадра и отлетала на весь
    /// маршрут ровно посреди выделения, а в конце жеста прилетала обратно.
    private func chartDragGesture(proxy: ChartProxy, geo: GeometryProxy) -> some Gesture {
        DragGesture(minimumDistance: 0)
            .onChanged { drag in
                if dragKind == nil {
                    if ProfileScrub.isSecondTap(after: lastTap, at: drag.startLocation) {
                        dragKind = .rangeSelect
                        releaseSelection()
                    } else if ProfileScrub.isScrubMove(drag) {
                        dragKind = .scrub
                    } else {
                        return          // ещё не решили — молчим
                    }
                }
                if dragKind == .rangeSelect {
                    guard let start = chartIndex(at: drag.startLocation, proxy: proxy, geo: geo),
                          let current = chartIndex(at: drag.location, proxy: proxy, geo: geo)
                    else { return }
                    selectedRange = min(start, current)...max(start, current)
                } else if let rawIdx = chartIndex(at: drag.location, proxy: proxy, geo: geo) {
                    // Ушли за пределы выделенного участка — значит смотрим уже
                    // не на него: снимаем выделение и отпускаем кадр карты
                    if let sel = selectedRange, !sel.contains(rawIdx) { releaseSelection() }
                    scrubIndex = rawIdx
                    let band = bandOfIndex.indices.contains(rawIdx)
                        ? bands[safe: bandOfIndex[rawIdx]] : nil
                    ProfileScrub.publish(index: rawIdx,
                                         elevation: samples[rawIdx].elevation,
                                         coordinates: coordinates,
                                         distanceKm: distanceKm,
                                         totalKm: totalKm,
                                         segmentKm: band?.km,
                                         segmentGrade: band?.gradePercent,
                                         to: appState)
                }
            }
            .onEnded { drag in
                switch dragKind {
                case .rangeSelect:
                    lastTap = nil
                    if let range = selectedRange, range.upperBound > range.lowerBound {
                        UIImpactFeedbackGenerator(style: .light).impactOccurred()
                        ProfileScrub.focusSegment(coordinates: coordinates, range: range, to: appState)
                    }
                case .scrub:
                    scrubIndex = nil
                    appState.endProfileScrub()
                    lastTap = ProfileScrub.tapMark(for: drag)
                case nil:
                    // Касание так и осталось тапом — от него ждём второго
                    lastTap = ProfileScrub.tapMark(for: drag)
                }
                dragKind = nil
            }
    }

    /// Снять выделение и отпустить кадр, который карта держала по участку
    private func releaseSelection() {
        selectedRange = nil
        appState.profileSelectionCoordinates = []
    }

    /// Щипок — сжимает/растягивает график по X. Зум идёт от центра текущего
    /// видимого участка, без панорамирования — им не так легко промахнуться
    /// одним пальцем скраба следом.
    private func zoomGesture() -> some Gesture {
        MagnificationGesture()
            .onChanged { scale in
                let base = pinchBaseRange ?? effectiveRange
                if pinchBaseRange == nil { pinchBaseRange = base }
                visibleRange = clampedRange(base: base, scale: scale)
            }
            .onEnded { _ in
                pinchBaseRange = nil
            }
    }

    private func clampedRange(base: ClosedRange<Int>, scale: CGFloat) -> ClosedRange<Int>? {
        let full = fullRange
        let minWidth = 10.0
        let maxWidth = Double(full.upperBound - full.lowerBound)
        guard maxWidth > minWidth, scale.isFinite, scale > 0 else { return nil }
        let baseWidth = Double(base.upperBound - base.lowerBound)
        let newWidth = min(maxWidth, max(minWidth, baseWidth / Double(scale)))
        let center = Double(base.lowerBound + base.upperBound) / 2
        var lower = Int((center - newWidth / 2).rounded())
        var upper = Int((center + newWidth / 2).rounded())
        if lower < full.lowerBound { upper += full.lowerBound - lower; lower = full.lowerBound }
        if upper > full.upperBound { lower -= upper - full.upperBound; upper = full.upperBound }
        lower = max(full.lowerBound, lower)
        upper = min(full.upperBound, upper)
        guard lower < upper else { return nil }
        // Почти весь маршрут — считаем, что вернулись к полному виду
        if lower <= full.lowerBound, upper >= full.upperBound { return nil }
        return lower...upper
    }
}

// MARK: - Участки постоянного уклона

/// Разбиение профиля на участки, внутри которых уклон примерно одинаков —
/// то же, что цветные полосы в brouter.de. Из них берутся «длина участка» и
/// «тип» (средний уклон, +/-N%) в шкале скраба.
enum ProfileBands {

    struct Band {
        /// Индексы точек профиля, от и до
        let range: ClosedRange<Int>
        /// Длина участка, км
        let km: Double
        /// Средний уклон по участку: + вверх, − вниз
        let gradePercent: Double
    }

    /// Границы классов уклона. Совпадают по духу с узлами палитры
    /// `GradeColor`: где меняется цвет, там и кончается участок.
    private static let classBounds: [Double] = [-16, -8, -3, 3, 8, 16]

    /// Короче этого участок не заводим: на шуме высот профиль иначе
    /// распадается на десятки полос по два десятка метров, и «длина участка»
    /// перестаёт что-либо значить.
    private static let minBandMeters: Double = 150

    private static func classIndex(_ grade: Double) -> Int {
        var index = 0
        for bound in classBounds where grade >= bound { index += 1 }
        return index
    }

    static func build(coordinates: [CLLocationCoordinate2D],
                      elevations: [Double],
                      distanceKm: [Double]) -> [Band] {
        guard elevations.count > 1,
              distanceKm.count == elevations.count else { return [] }
        // Уклон берём сглаженный — тот же, которым красится линия
        let grades = GradeColor.segmentGrades(coordinates: coordinates, elevations: elevations)
        guard grades.count == elevations.count - 1 else { return [] }

        var starts: [Int] = [0]
        for i in 1..<grades.count where classIndex(grades[i]) != classIndex(grades[i - 1]) {
            starts.append(i)
        }

        // Слишком короткие куски прирастают к предыдущему
        var merged: [Int] = [0]
        for start in starts.dropFirst() {
            guard let previous = merged.last else { continue }
            if (distanceKm[start] - distanceKm[previous]) * 1000 >= minBandMeters {
                merged.append(start)
            }
        }
        let lastPoint = elevations.count - 1
        if merged.count > 1, let previous = merged.last,
           (distanceKm[lastPoint] - distanceKm[previous]) * 1000 < minBandMeters {
            merged.removeLast()
        }

        return merged.enumerated().map { position, start in
            let end = position + 1 < merged.count ? merged[position + 1] : lastPoint
            let km = max(0, distanceKm[end] - distanceKm[start])
            let dh = elevations[end] - elevations[start]
            return Band(range: start...end,
                        km: km,
                        gradePercent: km > 0 ? dh / (km * 1000) * 100 : 0)
        }
    }

    /// Для каждой точки профиля — номер её участка. Скраб идёт по точкам, и
    /// искать участок перебором на каждом кадре не хочется.
    static func indexMap(bands: [Band], pointCount: Int) -> [Int] {
        guard !bands.isEmpty, pointCount > 0 else { return [] }
        var map = [Int](repeating: 0, count: pointCount)
        for (i, band) in bands.enumerated() {
            for p in band.range where p < pointCount { map[p] = i }
        }
        return map
    }

    /// «+16%» / «−4%» / «0%»
    static func gradeLabel(_ percent: Double) -> String {
        let rounded = percent.rounded()
        if abs(rounded) < 0.5 { return "0%" }
        return String(format: "%+.0f%%", rounded)
    }

    /// «0.7 км» для длинного участка, «320 м» для короткого
    static func lengthLabel(_ km: Double) -> String {
        km >= 1 ? String(format: "%.1f км", km) : "\(Int((km * 1000).rounded())) м"
    }
}

// MARK: - Общее для всех профилей

/// Чем занято текущее касание над графиком высот
enum ProfileDragKind {
    case scrub
    case rangeSelect
}

/// Скраб по профилю: где точка на карте, сколько до неё километров и
/// прячется ли интерфейс.
enum ProfileScrub {

    // MARK: - Распознавание тапов и ведения

    /// Отпущенное касание, которое оказалось тапом на месте
    struct TapMark {
        let time: Date
        let location: CGPoint
    }

    /// Насколько может «поехать» палец, чтобы касание всё ещё считалось тапом
    private static let tapSlop: CGFloat = 8
    /// С какого сдвига касание считается ведением. Больше `tapSlop`: между
    /// ними лежит «пока не решили», и в этой зоне мы ничего не публикуем —
    /// иначе первый тап из двойного успевал сойти за скраб и уводил камеру.
    private static let scrubSlop: CGFloat = 12
    /// Окно между тапами — как у системного двойного тапа
    private static let doubleTapWindow: TimeInterval = 0.4
    /// Насколько далеко друг от друга могут стоять два тапа
    private static let doubleTapDistance: CGFloat = 44

    /// Касание закончилось: если палец не поехал, запоминаем его как тап —
    /// следующее касание рядом и вовремя будет вторым тапом. Иначе nil,
    /// чтобы обычная протяжка не считалась половиной двойного тапа.
    static func tapMark(for drag: DragGesture.Value) -> TapMark? {
        let moved = hypot(drag.translation.width, drag.translation.height)
        guard moved < tapSlop else { return nil }
        return TapMark(time: Date(), location: drag.startLocation)
    }

    /// Палец проехал достаточно, чтобы это было именно ведение
    static func isScrubMove(_ drag: DragGesture.Value) -> Bool {
        hypot(drag.translation.width, drag.translation.height) >= scrubSlop
    }

    static func isSecondTap(after previous: TapMark?, at location: CGPoint) -> Bool {
        guard let previous else { return false }
        guard Date().timeIntervalSince(previous.time) < doubleTapWindow else { return false }
        return hypot(location.x - previous.location.x,
                     location.y - previous.location.y) < doubleTapDistance
    }

    /// Нарастающая дистанция по прореженным точкам — считается один раз
    /// на создание графика, а не на каждый кадр ведения пальцем.
    static func cumulativeKm(_ coordinates: [CLLocationCoordinate2D]) -> [Double] {
        guard coordinates.count > 1 else { return coordinates.isEmpty ? [] : [0] }
        var result: [Double] = [0]
        result.reserveCapacity(coordinates.count)
        var total = 0.0
        for i in 1..<coordinates.count {
            total += TrailRouter.meters(coordinates[i - 1], coordinates[i])
            result.append(total / 1000)
        }
        return result
    }

    static func publish(index: Int,
                        elevation: Double,
                        coordinates: [CLLocationCoordinate2D],
                        distanceKm: [Double],
                        totalKm: Double,
                        segmentKm: Double?,
                        segmentGrade: Double?,
                        to appState: AppState) {
        if index < coordinates.count { appState.scrubberCoordinate = coordinates[index] }
        let walked = index < distanceKm.count ? distanceKm[index] : 0
        appState.scrubberReadout = ScrubberReadout(elevationM: elevation,
                                                   distanceKm: walked,
                                                   totalKm: totalKm,
                                                   segmentKm: segmentKm,
                                                   segmentGrade: segmentGrade)
        if !appState.isScrubbingProfile {
            // Кадр карты карта подберёт сама — ей нужна геометрия маршрута
            appState.scrubRouteCoordinates = coordinates
            appState.isScrubbingProfile = true
        }
    }

    /// Выделили участок графика (двойной тап + протяжка) — просим карту
    /// облететь к его bounding box. `range` — индексы в прореженных
    /// координатах графика, те же, что публикует `publish`.
    ///
    /// Заодно кладём геометрию участка в `AppState`: пока выделение живо,
    /// карта держит кадр по нему, а не по всему маршруту.
    static func focusSegment(coordinates: [CLLocationCoordinate2D],
                             range: ClosedRange<Int>,
                             to appState: AppState) {
        let lower = max(0, range.lowerBound)
        let upper = min(coordinates.count - 1, range.upperBound)
        guard lower < upper else { return }
        let slice = Array(coordinates[lower...upper])
        guard let first = slice.first else { return }
        var minLat = first.latitude, maxLat = first.latitude
        var minLon = first.longitude, maxLon = first.longitude
        for c in slice {
            minLat = min(minLat, c.latitude); maxLat = max(maxLat, c.latitude)
            minLon = min(minLon, c.longitude); maxLon = max(maxLon, c.longitude)
        }
        appState.profileSelectionCoordinates = slice
        appState.flySegmentRequest.send((
            sw: CLLocationCoordinate2D(latitude: minLat, longitude: minLon),
            ne: CLLocationCoordinate2D(latitude: maxLat, longitude: maxLon)
        ))
    }
}

extension Array {
    /// Безопасный доступ по индексу: участок под пальцем может не найтись
    /// на вырожденном профиле, и это не повод падать
    subscript(safe index: Int) -> Element? {
        indices.contains(index) ? self[index] : nil
    }
}
