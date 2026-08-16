import SwiftUI
import Charts
import CoreLocation

struct ElevationChartView: View {
    let stats: RouteStats
    @EnvironmentObject var appState: AppState

    @State private var scrubIndex: Int? = nil

    // Считаем при создании: тело перерисовывается на каждом кадре скраба,
    // а `elevationSampled`/`coordinatesSampled` — это проход по всему маршруту
    private let samples: [(index: Int, elevation: Double)]
    private let scrubCoordinates: [CLLocationCoordinate2D]
    private let cumulativeKm: [Double]
    private let minY: Double
    private let maxY: Double

    init(stats: RouteStats) {
        self.stats = stats
        let elevations = stats.elevationSampled
        samples = elevations.enumerated().map { (index: $0.offset, elevation: $0.element) }
        scrubCoordinates = stats.coordinatesSampled
        cumulativeKm = ProfileScrub.cumulativeKm(scrubCoordinates)
        minY = floor(((elevations.min() ?? stats.minEle) - 80) / 100) * 100
        maxY = ceil(((elevations.max() ?? stats.maxEle) + 80) / 100) * 100
    }
    private var yStride: Double {
        let range = maxY - minY
        if range < 300 { return 100 }
        if range < 700 { return 200 }
        return 300
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
            ForEach(samples, id: \.index) { pt in
                AreaMark(
                    x: .value("i", pt.index),
                    yStart: .value("base", minY),
                    yEnd:   .value("ele",  pt.elevation)
                )
                .foregroundStyle(
                    LinearGradient(
                        colors: [DS.accent.opacity(0.5), DS.accent.opacity(0.04)],
                        startPoint: .top, endPoint: .bottom
                    )
                )
                .interpolationMethod(.catmullRom)

                LineMark(
                    x: .value("i", pt.index),
                    y: .value("ele", pt.elevation)
                )
                .foregroundStyle(DS.accent)
                .lineStyle(StrokeStyle(lineWidth: 2))
                .interpolationMethod(.catmullRom)
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
                    .gesture(
                        DragGesture(minimumDistance: 0)
                            .onChanged { drag in
                                guard let anchor = proxy.plotFrame else { return }
                                let plotFrame = geo[anchor]
                                let x = drag.location.x - plotFrame.origin.x
                                if let rawIdx: Int = proxy.value(atX: x),
                                   rawIdx >= 0, rawIdx < samples.count {
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
                                scrubIndex = nil
                                appState.endProfileScrub()
                            }
                    )
            }
        }
        .frame(height: 120)
    }

    private func annotationPosition(for idx: Int) -> AnnotationPosition {
        idx > samples.count / 2 ? .leading : .trailing
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
}
