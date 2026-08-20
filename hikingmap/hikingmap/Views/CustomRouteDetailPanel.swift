import SwiftUI
import Charts
import UIKit
import CoreLocation

struct CustomRouteDetailPanel: View {
    let route: CustomRoute
    let onClose: () -> Void
    let onCollapse: () -> Void

    @EnvironmentObject var appState: AppState
    @GestureState private var dragOffset: CGFloat = 0
    @State private var showDeleteAlert = false
    /// Всё, что стоит O(n) по точкам маршрута. Тело панели пересобирается на
    /// каждом кадре перетаскивания, а нарисованный по тропам маршрут — это
    /// тысячи точек: считать их заново каждый кадр панель не переживала.
    @State private var derived: DerivedRouteData?

    /// Меняется, когда приехали высоты или поменялась геометрия
    private var derivedKey: String {
        "\(route.id)-\(route.waypointLats.count)-\(route.elevations?.count ?? 0)"
    }

    /// Пока ведут ползунок по профилю — прячем всё, кроме самого профиля,
    /// и почти растворяем карточку: смотрят в этот момент на карту.
    /// Именно прячем прозрачностью, а не убираем: иначе график уехал бы
    /// из-под пальца.
    private var scrubbing: Bool { appState.isScrubbingProfile }

    var body: some View {
        VStack(spacing: 0) {
            dragHandle
                .opacity(scrubbing ? 0 : 1)
            header
                .opacity(scrubbing ? 0 : 1)
            Divider().background(DS.border)
                .opacity(scrubbing ? 0 : 1)
            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 18) {
                    statsGrid
                        .padding(.horizontal, 16)
                        .opacity(scrubbing ? 0 : 1)
                    elevationSection
                        .padding(.horizontal, 16)
                    timeSection
                        .padding(.horizontal, 16)
                        .opacity(scrubbing ? 0 : 1)
                    gpxExportButton
                        .padding(.horizontal, 16)
                        .opacity(scrubbing ? 0 : 1)
                    deleteButton
                        .padding(.horizontal, 16)
                        .opacity(scrubbing ? 0 : 1)
                }
                .padding(.top, 16)
                .padding(.bottom, 32)
            }
            .scrollDisabled(scrubbing)
        }
        .background(
            ZStack {
                Color(red: 0.07, green: 0.07, blue: 0.07)
                Color.white.opacity(0.03)
            }
            .opacity(scrubbing ? 0 : 1)
        )
        .clipShape(
            UnevenRoundedRectangle(
                topLeadingRadius: DS.radiusL,
                bottomLeadingRadius: 0,
                bottomTrailingRadius: 0,
                topTrailingRadius: DS.radiusL
            )
        )
        .overlay(
            UnevenRoundedRectangle(
                topLeadingRadius: DS.radiusL,
                bottomLeadingRadius: 0,
                bottomTrailingRadius: 0,
                topTrailingRadius: DS.radiusL
            )
            .stroke(Color(hex: "#7B5EA7").opacity(scrubbing ? 0 : 0.5), lineWidth: 1)
        )
        .animation(.easeInOut(duration: 0.18), value: scrubbing)
        .task(id: derivedKey) { derived = DerivedRouteData(route: route) }
        .offset(y: max(0, dragOffset))
        .gesture(
            DragGesture()
                .updating($dragOffset) { v, state, _ in state = max(0, v.translation.height) }
                .onEnded { v in if v.translation.height > 90 { onCollapse() } }
        )
    }

    // MARK: - Subviews

    private var dragHandle: some View {
        Capsule()
            .fill(Color.white.opacity(0.22))
            .frame(width: 36, height: 4)
            .padding(.top, 10)
            .padding(.bottom, 4)
    }

    private var header: some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 5) {
                HStack(spacing: 5) {
                    Image(systemName: "pencil")
                        .font(.system(size: 9, weight: .bold))
                        .foregroundColor(Color(hex: "#7B5EA7"))
                    Text("МОЙ МАРШРУТ · \(shortDate(route.date))")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundColor(Color(hex: "#7B5EA7"))
                        .kerning(0.4)
                }
                Text(route.name)
                    .font(.title3).fontWeight(.bold)
                    .foregroundColor(DS.textPrimary)
                    .lineLimit(2)
            }
            Spacer()
            Button(action: onClose) {
                Image(systemName: "xmark")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(DS.textSecondary)
                    .frame(width: 28, height: 28)
                    .background(DS.glass)
                    .clipShape(Circle())
                    .overlay(Circle().stroke(DS.border, lineWidth: 1))
            }
        }
        .padding(.horizontal, 18)
        .padding(.top, 6)
        .padding(.bottom, 12)
    }

    // MARK: - Stats grid

    private var statsGrid: some View {
        // Цифры берём из кэша: каждая из них — проход по всем высотам маршрута
        let climb = derived?.climb
        let items: [(String, String, String, String)] = [
            ("📏", "ДИСТАНЦИЯ",  String(format: "%.1f", route.distanceKm), "км"),
            ("↑",  "НАБОР",      climb?.ascent.map  { "\(Int($0))" } ?? "—", "м"),
            ("↓",  "СБРОС",      climb?.descent.map { "\(Int($0))" } ?? "—", "м"),
            ("⛰", "МАКС",       climb?.max.map { "\(Int($0))" } ?? "—", "м"),
            ("▼",  "МИН",        climb?.min.map { "\(Int($0))" } ?? "—", "м"),
            ("📍", "ТОЧЕК",      "\(route.waypointLats.count)", ""),
        ]
        return LazyVGrid(
            columns: [GridItem(.flexible()), GridItem(.flexible()), GridItem(.flexible())],
            spacing: 8
        ) {
            ForEach(items, id: \.1) { icon, label, value, unit in
                statCell(icon: icon, label: label, value: value, unit: unit)
            }
        }
    }

    private func statCell(icon: String, label: String, value: String, unit: String) -> some View {
        VStack(spacing: 3) {
            Text(icon).font(.system(size: 16))
            HStack(alignment: .firstTextBaseline, spacing: 1) {
                Text(value)
                    .font(.system(size: 14, weight: .bold))
                    .foregroundColor(DS.textPrimary)
                    .lineLimit(1)
                if !unit.isEmpty {
                    Text(unit).font(.system(size: 10)).foregroundColor(DS.textSecondary)
                }
            }
            Text(label)
                .font(.system(size: 9))
                .foregroundColor(DS.textSecondary)
                .kerning(0.5)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 10)
        .background(DS.glass)
        .clipShape(RoundedRectangle(cornerRadius: DS.radiusS, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: DS.radiusS, style: .continuous).stroke(DS.border, lineWidth: 1))
    }

    // MARK: - Elevation section

    private var elevationSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("ПРОФИЛЬ ВЫСОТ")
                .font(.system(size: 11, weight: .semibold))
                .foregroundColor(DS.textSecondary)
                .kerning(0.7)
                .opacity(scrubbing ? 0 : 1)

            if let data = derived, !data.chartElevations.isEmpty {
                CustomElevationChart(
                    elevations:  data.chartElevations,
                    coordinates: data.chartCoordinates,
                    totalKm:     route.distanceKm
                )
                .padding(12)
                .background(profileBackdrop)
                .background(GeometryReader { geo in
                    // Карте нужно знать, какой кусок экрана занят профилем:
                    // туда она не должна прятать бегунок
                    Color.clear
                        .onAppear { appState.profileBlockFrame = geo.frame(in: .global) }
                        .onChange(of: geo.frame(in: .global)) { _, frame in
                            appState.profileBlockFrame = frame
                        }
                })
                .clipShape(RoundedRectangle(cornerRadius: DS.radiusM, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: DS.radiusM, style: .continuous).stroke(DS.border, lineWidth: 1))
            } else {
                HStack(spacing: 8) {
                    ProgressView().tint(DS.accent).scaleEffect(0.8)
                    Text("Загружаю профиль высот…")
                        .font(.system(size: 12))
                        .foregroundColor(DS.textSecondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(14)
                .background(DS.glass)
                .clipShape(RoundedRectangle(cornerRadius: DS.radiusM, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: DS.radiusM, style: .continuous).stroke(DS.border, lineWidth: 1))
            }
        }
    }

    /// Пока карточка растворена, у профиля своя подложка — иначе график
    /// читался бы поверх карты как пятно.
    @ViewBuilder private var profileBackdrop: some View {
        if scrubbing {
            ZStack {
                Rectangle().fill(.ultraThinMaterial)
                Color(red: 0.07, green: 0.07, blue: 0.07).opacity(0.82)
            }
        } else {
            DS.glass
        }
    }

    // MARK: - Time estimation

    private var mockStats: RouteStats { derived?.stats ?? DerivedRouteData.empty }

    private var timeSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("ВРЕМЯ В ПУТИ")
                .font(.system(size: 11, weight: .semibold))
                .foregroundColor(DS.textSecondary)
                .kerning(0.7)
            SmartTimeView(stats: mockStats)
        }
    }

    // MARK: - GPX Export

    private var gpxExportButton: some View {
        Button(action: exportGPX) {
            HStack(spacing: 8) {
                Image(systemName: "square.and.arrow.up")
                    .font(.system(size: 14, weight: .medium))
                Text("Экспорт GPX")
                    .font(.system(size: 14, weight: .medium))
                Spacer()
                Text("GPX")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundColor(DS.textTertiary)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(DS.glass)
                    .clipShape(Capsule())
                    .overlay(Capsule().stroke(DS.border, lineWidth: 1))
            }
            .foregroundColor(DS.textPrimary)
            .padding(14)
            .background(DS.glass)
            .clipShape(RoundedRectangle(cornerRadius: DS.radiusM, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: DS.radiusM, style: .continuous).stroke(DS.border, lineWidth: 1))
        }
        .buttonStyle(.plain)
    }

    private func exportGPX() {
        let gpx = route.gpxString()
        let fileName = "\(route.name.replacingOccurrences(of: " ", with: "_")).gpx"
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(fileName)
        try? gpx.write(to: url, atomically: true, encoding: .utf8)

        let vc = UIActivityViewController(activityItems: [url], applicationActivities: nil)
        UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .first?.windows.first?.rootViewController?
            .present(vc, animated: true)
    }

    // MARK: - Delete

    private var deleteButton: some View {
        Button {
            showDeleteAlert = true
        } label: {
            HStack(spacing: 8) {
                Image(systemName: "trash")
                    .font(.system(size: 14, weight: .medium))
                Text("Удалить маршрут")
                    .font(.system(size: 14, weight: .medium))
                Spacer()
            }
            .foregroundColor(Color(hex: "#F44336"))
            .padding(14)
            .background(Color(hex: "#F44336").opacity(0.10))
            .clipShape(RoundedRectangle(cornerRadius: DS.radiusM, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: DS.radiusM, style: .continuous)
                .stroke(Color(hex: "#F44336").opacity(0.30), lineWidth: 1))
        }
        .buttonStyle(.plain)
        .alert("Удалить маршрут?", isPresented: $showDeleteAlert) {
            Button("Удалить", role: .destructive) {
                onClose()
                appState.customRouteStore.remove(id: route.id)
            }
            Button("Отмена", role: .cancel) {}
        } message: {
            Text("«\(route.name)» будет удалён без возможности восстановления.")
        }
    }

    private func shortDate(_ date: Date) -> String {
        let f = DateFormatter()
        f.dateFormat = "d MMM yyyy"
        f.locale = Locale(identifier: "ru_RU")
        return f.string(from: date)
    }
}

// MARK: - Производные данные маршрута

/// То, что считается по всем точкам маршрута: прореженный профиль для графика
/// и `RouteStats` для оценки времени. Считаем один раз при открытии панели.
private struct DerivedRouteData {
    /// Столько точек рисует график. На 120 pt высоты больше не видно, а
    /// Charts на тысячах марок встаёт колом — так же прорежен профиль
    /// обычных маршрутов (`RouteStats.elevationSampled`).
    static let chartSamples = 200

    let chartElevations: [Double]
    let chartCoordinates: [CLLocationCoordinate2D]
    let stats: RouteStats
    /// Готовые цифры для плашек — каждая иначе снова шла бы по всем высотам
    let climb: (ascent: Double?, descent: Double?, min: Double?, max: Double?)

    init(route: CustomRoute) {
        let coordinates = route.coordinates
        let elevations  = route.elevations ?? []
        chartElevations  = DerivedRouteData.thin(elevations)
        chartCoordinates = DerivedRouteData.thin(coordinates)

        climb = (route.ascentM, route.descentM, route.minElevationM, route.maxElevationM)

        let dummy  = CLLocationCoordinate2D(latitude: 44.0, longitude: 20.9)
        let center = coordinates.isEmpty ? dummy : coordinates[coordinates.count / 2]
        stats = RouteStats(
            distance: route.distanceKm,
            ascent:   route.ascentM   ?? 0,
            descent:  route.descentM  ?? 0,
            minEle:   route.minElevationM ?? 0,
            maxEle:   route.maxElevationM ?? 0,
            duration: nil,
            coordinates: coordinates,
            elevations: elevations,
            center:   center,
            boundsNE: center,
            boundsSW: center,
            photoCoordinates: []
        )
    }

    private static func thin<T>(_ values: [T]) -> [T] {
        guard values.count > chartSamples else { return values }
        let step = Double(values.count) / Double(chartSamples)
        return (0..<chartSamples).map { values[Int(Double($0) * step)] }
    }

    static let empty: RouteStats = {
        let center = CLLocationCoordinate2D(latitude: 44.0, longitude: 20.9)
        return RouteStats(distance: 0, ascent: 0, descent: 0, minEle: 0, maxEle: 0,
                          duration: nil, coordinates: [], elevations: [],
                          center: center, boundsNE: center, boundsSW: center,
                          photoCoordinates: [])
    }()
}

// MARK: - Elevation chart with axis labels and scrubbing

private struct CustomElevationChart: View {
    let coordinates: [CLLocationCoordinate2D]

    @EnvironmentObject var appState: AppState
    @State private var scrubIndex: Int? = nil
    /// Выделенный жестом «двойной тап + протяжка» участок — держится, пока
    /// не сделают новое выделение
    @State private var selectedRange: ClosedRange<Int>? = nil
    @State private var isRangeSelecting = false
    /// Видимый по X участок после «щипка». nil — весь маршрут
    @State private var visibleRange: ClosedRange<Int>? = nil
    @State private var pinchBaseRange: ClosedRange<Int>? = nil

    private let purple = Color(hex: "#7B5EA7")

    // Считаем при создании: тело перерисовывается на каждом кадре скраба
    private let samples: [(index: Int, elevation: Double)]
    private let minY: Double
    private let maxY: Double
    private let peak: Double
    private let bottom: Double

    private let cumulativeKm: [Double]
    private let totalKm: Double

    // Раскраска по уклону — см. GradeColor, те же сегменты, что у линии
    // своего маршрута на карте.
    private let lineGradient: Gradient
    private let areaGradient: Gradient

    init(elevations: [Double], coordinates: [CLLocationCoordinate2D], totalKm: Double) {
        self.coordinates = coordinates
        self.totalKm = totalKm
        cumulativeKm = ProfileScrub.cumulativeKm(coordinates)
        samples = elevations.enumerated().map { (index: $0.offset, elevation: $0.element) }
        peak    = elevations.max() ?? 0
        bottom  = elevations.min() ?? 0
        minY    = floor(((elevations.min() ?? 0) - 60) / 100) * 100
        maxY    = ceil(((elevations.max() ?? 1000) + 60) / 100) * 100
        let purpleColor = Color(hex: "#7B5EA7")
        lineGradient = GradeColor.gradient(coordinates: coordinates, elevations: elevations,
                                            fallback: purpleColor)
        areaGradient = GradeColor.gradient(coordinates: coordinates, elevations: elevations,
                                            opacity: 0.4, fallback: purpleColor)
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

    private var headerRow: some View {
        HStack {
            Label("\(Int(peak)) м", systemImage: "mountain.2.fill")
                .font(.caption)
                .foregroundColor(purple)
            Spacer()
            if let idx = scrubIndex, idx < samples.count {
                Text("\(Int(samples[idx].elevation)) м")
                    .font(.system(size: 12, weight: .semibold).monospacedDigit())
                    .foregroundColor(.white)
                    .padding(.horizontal, 8).padding(.vertical, 3)
                    .background(purple.opacity(0.25))
                    .clipShape(Capsule())
                    .animation(.none, value: idx)
            } else {
                Text("Мин \(Int(bottom)) м")
                    .font(.caption)
                    .foregroundColor(DS.textSecondary)
            }
        }
    }

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

    // MARK: - Жесты (см. ElevationChartView — тот же приём для обычных маршрутов)

    private func chartIndex(at location: CGPoint, proxy: ChartProxy, geo: GeometryProxy) -> Int? {
        guard let anchor = proxy.plotFrame else { return nil }
        let plotFrame = geo[anchor]
        let x = location.x - plotFrame.origin.x
        guard let rawIdx: Int = proxy.value(atX: x), rawIdx >= 0, rawIdx < samples.count else { return nil }
        return rawIdx
    }

    private func scrubGesture(proxy: ChartProxy, geo: GeometryProxy) -> some Gesture {
        DragGesture(minimumDistance: 0)
            .onChanged { drag in
                guard !isRangeSelecting else { return }
                if let rawIdx = chartIndex(at: drag.location, proxy: proxy, geo: geo) {
                    scrubIndex = rawIdx
                    ProfileScrub.publish(index: rawIdx,
                                         elevation: samples[rawIdx].elevation,
                                         coordinates: coordinates,
                                         cumulativeKm: cumulativeKm,
                                         totalKm: totalKm,
                                         to: appState)
                }
            }
            .onEnded { _ in
                guard !isRangeSelecting else { return }
                scrubIndex = nil
                appState.endProfileScrub()
            }
    }

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
                    ProfileScrub.focusSegment(coordinates: coordinates, range: range, to: appState)
                }
            }
    }

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
        if lower <= full.lowerBound, upper >= full.upperBound { return nil }
        return lower...upper
    }
}
