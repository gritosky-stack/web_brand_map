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

    var body: some View {
        VStack(spacing: 0) {
            dragHandle
            header
            Divider().background(DS.border)
            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 18) {
                    statsGrid
                        .padding(.horizontal, 16)
                    elevationSection
                        .padding(.horizontal, 16)
                    timeSection
                        .padding(.horizontal, 16)
                    gpxExportButton
                        .padding(.horizontal, 16)
                    deleteButton
                        .padding(.horizontal, 16)
                }
                .padding(.top, 16)
                .padding(.bottom, 32)
            }
        }
        .background(
            ZStack {
                Color(red: 0.07, green: 0.07, blue: 0.07)
                Color.white.opacity(0.03)
            }
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
            .stroke(Color(hex: "#7B5EA7").opacity(0.5), lineWidth: 1)
        )
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
        let items: [(String, String, String, String)] = [
            ("📏", "ДИСТАНЦИЯ",  String(format: "%.1f", route.distanceKm), "км"),
            ("↑",  "НАБОР",      route.ascentM.map  { "\(Int($0))" } ?? "—", "м"),
            ("↓",  "СБРОС",      route.descentM.map { "\(Int($0))" } ?? "—", "м"),
            ("⛰", "МАКС",       route.maxElevationM.map { "\(Int($0))" } ?? "—", "м"),
            ("▼",  "МИН",        route.minElevationM.map { "\(Int($0))" } ?? "—", "м"),
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

            if let elevs = route.elevations, !elevs.isEmpty {
                CustomElevationChart(
                    elevations:  elevs,
                    coordinates: route.coordinates
                )
                .padding(12)
                .background(DS.glass)
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

    // MARK: - Time estimation

    private var mockStats: RouteStats {
        let coords = route.coordinates
        let dummy = CLLocationCoordinate2D(latitude: 44.0, longitude: 20.9)
        let center = coords.isEmpty ? dummy : coords[coords.count / 2]
        return RouteStats(
            distance: route.distanceKm,
            ascent:   route.ascentM   ?? 0,
            descent:  route.descentM  ?? 0,
            minEle:   route.minElevationM ?? 0,
            maxEle:   route.maxElevationM ?? 0,
            duration: nil,
            coordinates: coords,
            elevations: route.elevations ?? [],
            center:   center,
            boundsNE: center,
            boundsSW: center,
            photoCoordinates: []
        )
    }

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

// MARK: - Elevation chart with axis labels and scrubbing

private struct CustomElevationChart: View {
    let elevations: [Double]
    let coordinates: [CLLocationCoordinate2D]

    @EnvironmentObject var appState: AppState
    @State private var scrubIndex: Int? = nil

    private let purple = Color(hex: "#7B5EA7")

    private var samples: [(index: Int, elevation: Double)] {
        elevations.enumerated().map { (index: $0.offset, elevation: $0.element) }
    }

    private var minY: Double {
        let lo = elevations.min() ?? 0
        return floor((lo - 60) / 100) * 100
    }
    private var maxY: Double {
        let hi = elevations.max() ?? 1000
        return ceil((hi + 60) / 100) * 100
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

    private var headerRow: some View {
        HStack {
            Label("\(Int(elevations.max() ?? 0)) м", systemImage: "mountain.2.fill")
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
                Text("Мин \(Int(elevations.min() ?? 0)) м")
                    .font(.caption)
                    .foregroundColor(DS.textSecondary)
            }
        }
    }

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
                        colors: [purple.opacity(0.5), purple.opacity(0.05)],
                        startPoint: .top, endPoint: .bottom
                    )
                )
                .interpolationMethod(.catmullRom)

                LineMark(
                    x: .value("i", pt.index),
                    y: .value("ele", pt.elevation)
                )
                .foregroundStyle(purple)
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
                                let x = drag.location.x - geo[anchor].origin.x
                                if let rawIdx: Int = proxy.value(atX: x),
                                   rawIdx >= 0, rawIdx < samples.count {
                                    scrubIndex = rawIdx
                                    let t = Double(rawIdx) / Double(max(samples.count - 1, 1))
                                    let ci = Int(t * Double(max(coordinates.count - 1, 1)))
                                    appState.scrubberCoordinate = coordinates[ci]
                                }
                            }
                            .onEnded { _ in
                                scrubIndex = nil
                                appState.scrubberCoordinate = nil
                            }
                    )
            }
        }
        .frame(height: 120)
    }
}
