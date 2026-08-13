import SwiftUI
import Charts

struct ElevationChartView: View {
    let stats: RouteStats
    @EnvironmentObject var appState: AppState

    @State private var scrubIndex: Int? = nil

    private var samples: [(index: Int, elevation: Double)] {
        stats.elevationSampled.enumerated().map { (index: $0.offset, elevation: $0.element) }
    }

    private var minY: Double {
        let lo = stats.elevationSampled.min() ?? stats.minEle
        return floor((lo - 80) / 100) * 100
    }
    private var maxY: Double {
        let hi = stats.elevationSampled.max() ?? stats.maxEle
        return ceil((hi + 80) / 100) * 100
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
                                    let coords = stats.coordinatesSampled
                                    if rawIdx < coords.count {
                                        appState.scrubberCoordinate = coords[rawIdx]
                                    }
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

    private func annotationPosition(for idx: Int) -> AnnotationPosition {
        idx > samples.count / 2 ? .leading : .trailing
    }
}
