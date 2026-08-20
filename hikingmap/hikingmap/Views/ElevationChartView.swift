import SwiftUI
import Charts
import CoreLocation

struct ElevationChartView: View {
    let stats: RouteStats
    @EnvironmentObject var appState: AppState

    @State private var scrubIndex: Int? = nil
    /// Выделенный жестом «двойной тап + протяжка» участок — держится, пока
    /// не сделают новое выделение (не спадает само по себе)
    @State private var selectedRange: ClosedRange<Int>? = nil
    /// Идёт протяжка выделения прямо сейчас — глушим на это время скраб
    @State private var isRangeSelecting = false
    /// Видимый по X участок графика после «щипка». nil — весь маршрут
    @State private var visibleRange: ClosedRange<Int>? = nil
    /// Диапазон на начало текущего жеста «щипка» — масштаб считаем от него,
    /// а не покадрово, иначе дрейф накапливается
    @State private var pinchBaseRange: ClosedRange<Int>? = nil

    // Считаем при создании: тело перерисовывается на каждом кадре скраба,
    // а `elevationSampled`/`coordinatesSampled` — это проход по всему маршруту
    private let samples: [(index: Int, elevation: Double)]
    private let scrubCoordinates: [CLLocationCoordinate2D]
    private let cumulativeKm: [Double]
    private let minY: Double
    private let maxY: Double

    // Раскраска по уклону — см. GradeColor, те же сегменты, что у линии
    // маршрута на карте. lineGradient — полная насыщенность для контура,
    // areaGradient — приглушённая для заливки под кривой.
    private let lineGradient: Gradient
    private let areaGradient: Gradient

    init(stats: RouteStats) {
        self.stats = stats
        let elevations = stats.elevationSampled
        samples = elevations.enumerated().map { (index: $0.offset, elevation: $0.element) }
        scrubCoordinates = stats.coordinatesSampled
        cumulativeKm = ProfileScrub.cumulativeKm(scrubCoordinates)
        minY = floor(((elevations.min() ?? stats.minEle) - 80) / 100) * 100
        maxY = ceil(((elevations.max() ?? stats.maxEle) + 80) / 100) * 100
        lineGradient = GradeColor.gradient(coordinates: scrubCoordinates, elevations: elevations,
                                            fallback: DS.accent)
        areaGradient = GradeColor.gradient(coordinates: scrubCoordinates, elevations: elevations,
                                            opacity: 0.4, fallback: DS.accent)
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

    // MARK: - Header
    private var headerRow: some View {
        HStack {
            Label("\(Int(stats.maxEle)) м", systemImage: "mountain.2.fill")
                .font(.caption)
                .foregroundColor(DS.accent)
            Spacer()
            if let idx = scrubIndex, idx < samples.count {
                Text("\(Int(samples[idx].elevation)) м")
                    .font(.system(size: 12, weight: .semibold).monospacedDigit())
                    .foregroundColor(.white)
                    .padding(.horizontal, 8).padding(.vertical, 3)
                    .background(DS.accent.opacity(0.25))
                    .clipShape(Capsule())
                    .animation(.none, value: idx)
            } else {
                Text("Мин \(Int(stats.minEle)) м")
                    .font(.caption)
                    .foregroundColor(DS.textSecondary)
            }
        }
    }

    // MARK: - Chart
    private var chartBody: some View {
        Chart {
            if let sel = selectedRange {
                RectangleMark(
                    xStart: .value("selStart", sel.lowerBound),
                    xEnd:   .value("selEnd", sel.upperBound)
                )
                .foregroundStyle(Color.white.opacity(0.12))
            }

            ForEach(samples, id: \.index) { pt in
                AreaMark(
                    x: .value("i", pt.index),
                    yStart: .value("base", minY),
                    yEnd:   .value("ele",  pt.elevation)
                )
                .foregroundStyle(LinearGradient(gradient: areaGradient, startPoint: .leading, endPoint: .trailing))
                .interpolationMethod(.catmullRom)

                LineMark(
                    x: .value("i", pt.index),
                    y: .value("ele", pt.elevation)
                )
                .foregroundStyle(LinearGradient(gradient: lineGradient, startPoint: .leading, endPoint: .trailing))
                .lineStyle(StrokeStyle(lineWidth: 2.4, lineCap: .round, lineJoin: .round))
                .interpolationMethod(.catmullRom)
            }

            if let sel = selectedRange {
                RuleMark(x: .value("selStart", sel.lowerBound))
                    .foregroundStyle(Color.white.opacity(0.5))
                    .lineStyle(StrokeStyle(lineWidth: 1))
                RuleMark(x: .value("selEnd", sel.upperBound))
                    .foregroundStyle(Color.white.opacity(0.5))
                    .lineStyle(StrokeStyle(lineWidth: 1))
            }

            if let idx = scrubIndex, idx < samples.count {
                RuleMark(x: .value("scrub", idx))
                    .foregroundStyle(Color.white.opacity(0.55))
                    .lineStyle(StrokeStyle(lineWidth: 1, dash: [3, 3]))

                PointMark(
                    x: .value("scrub", idx),
                    y: .value("ele", samples[idx].elevation)
                )
                .foregroundStyle(Color.white)
                .symbolSize(55)
                .annotation(position: annotationPosition(for: idx), spacing: 2) {
                    // invisible — elevation shown in header row instead
                    EmptyView()
                }
            }
        }
        .chartXAxis(.hidden)
        .chartXScale(domain: effectiveRange)
        .chartYScale(domain: minY...maxY)
        .chartYAxis {
            AxisMarks(values: .stride(by: yStride)) { val in
                AxisGridLine(stroke: StrokeStyle(lineWidth: 0.5, dash: [4, 4]))
                    .foregroundStyle(Color.white.opacity(0.12))
                AxisValueLabel {
                    if let v = val.as(Double.self) {
                        Text("\(Int(v))м")
                            .font(.system(size: 9))
                            .foregroundColor(DS.textSecondary)
                    }
                }
            }
        }
        .chartOverlay { proxy in
            GeometryReader { geo in
                Rectangle().fill(.clear).contentShape(Rectangle())
                    .gesture(scrubGesture(proxy: proxy, geo: geo))
                    .highPriorityGesture(rangeSelectGesture(proxy: proxy, geo: geo))
                    .simultaneousGesture(zoomGesture())
            }
        }
        .frame(height: 120)
    }

    private func annotationPosition(for idx: Int) -> AnnotationPosition {
        idx > samples.count / 2 ? .leading : .trailing
    }

    // MARK: - Жесты

    /// Экранная точка → индекс в `samples`, с поправкой на плот-фрейм графика
    private func chartIndex(at location: CGPoint, proxy: ChartProxy, geo: GeometryProxy) -> Int? {
        guard let anchor = proxy.plotFrame else { return nil }
        let plotFrame = geo[anchor]
        let x = location.x - plotFrame.origin.x
        guard let rawIdx: Int = proxy.value(atX: x), rawIdx >= 0, rawIdx < samples.count else { return nil }
        return rawIdx
    }

    /// Ведение пальцем — как раньше: точка на графике, синхронно с картой
    private func scrubGesture(proxy: ChartProxy, geo: GeometryProxy) -> some Gesture {
        DragGesture(minimumDistance: 0)
            .onChanged { drag in
                guard !isRangeSelecting else { return }
                if let rawIdx = chartIndex(at: drag.location, proxy: proxy, geo: geo) {
                    scrubIndex = rawIdx
                    ProfileScrub.publish(index: rawIdx,
                                         elevation: samples[rawIdx].elevation,
                                         coordinates: scrubCoordinates,
                                         cumulativeKm: cumulativeKm,
                                         totalKm: stats.distance,
                                         to: appState)
                }
            }
            .onEnded { _ in
                guard !isRangeSelecting else { return }
                scrubIndex = nil
                appState.endProfileScrub()
            }
    }

    /// Двойной тап и сразу протяжка на втором тапе — выделяет участок графика.
    /// Выделение остаётся и после отпускания пальца; карта облетает к нему.
    private func rangeSelectGesture(proxy: ChartProxy, geo: GeometryProxy) -> some Gesture {
        TapGesture(count: 2)
            .sequenced(before: DragGesture(minimumDistance: 2))
            .onChanged { value in
                guard case .second(_, let drag?) = value else { return }
                isRangeSelecting = true
                guard let start = chartIndex(at: drag.startLocation, proxy: proxy, geo: geo),
                      let current = chartIndex(at: drag.location, proxy: proxy, geo: geo)
                else { return }
                selectedRange = min(start, current)...max(start, current)
            }
            .onEnded { _ in
                isRangeSelecting = false
                if let range = selectedRange, range.upperBound > range.lowerBound {
                    UIImpactFeedbackGenerator(style: .light).impactOccurred()
                    ProfileScrub.focusSegment(coordinates: scrubCoordinates, range: range, to: appState)
                }
            }
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

// MARK: - Общее для обоих профилей

/// Скраб по профилю: где точка на карте, сколько до неё километров и
/// прячется ли интерфейс. Общий код для профилей обычных и своих маршрутов.
enum ProfileScrub {
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
                        cumulativeKm: [Double],
                        totalKm: Double,
                        to appState: AppState) {
        if index < coordinates.count { appState.scrubberCoordinate = coordinates[index] }
        // Полную длину берём из статистики маршрута: прореженная ломаная
        // срезает повороты и всегда чуть короче настоящей
        let walked = index < cumulativeKm.count ? cumulativeKm[index] : 0
        let measured = cumulativeKm.last ?? 0
        let scale = measured > 0 ? totalKm / measured : 1
        appState.scrubberReadout = ScrubberReadout(elevationM: elevation,
                                                   distanceKm: walked * scale,
                                                   totalKm: totalKm)
        if !appState.isScrubbingProfile {
            // Кадр карты карта подберёт сама — ей нужна геометрия маршрута
            appState.scrubRouteCoordinates = coordinates
            appState.isScrubbingProfile = true
        }
    }

    /// Выделили участок графика (двойной тап + протяжка) — просим карту
    /// облететь к его bounding box. `range` — индексы в прореженных
    /// координатах графика, те же, что публикует `publish`.
    static func focusSegment(coordinates: [CLLocationCoordinate2D],
                             range: ClosedRange<Int>,
                             to appState: AppState) {
        let lower = max(0, range.lowerBound)
        let upper = min(coordinates.count - 1, range.upperBound)
        guard lower < upper else { return }
        let slice = coordinates[lower...upper]
        guard let first = slice.first else { return }
        var minLat = first.latitude, maxLat = first.latitude
        var minLon = first.longitude, maxLon = first.longitude
        for c in slice {
            minLat = min(minLat, c.latitude); maxLat = max(maxLat, c.latitude)
            minLon = min(minLon, c.longitude); maxLon = max(maxLon, c.longitude)
        }
        appState.flyBoundsRequest.send((
            sw: CLLocationCoordinate2D(latitude: minLat, longitude: minLon),
            ne: CLLocationCoordinate2D(latitude: maxLat, longitude: maxLon)
        ))
    }
}
