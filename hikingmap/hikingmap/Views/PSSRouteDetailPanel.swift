import SwiftUI
import CoreLocation

struct PSSRouteDetailPanel: View {
    let route: PSSRoute
    let onClose: () -> Void
    let onCollapse: () -> Void

    @EnvironmentObject var appState: AppState
    @GestureState private var dragOffset: CGFloat = 0

    private let pssOrange = Color(hex: "#FF8C1A")

    private var stats: RouteStats { route.makeStats() }
    private var difficulty: Difficulty { route.difficulty }

    var body: some View {
        VStack(spacing: 0) {
            dragHandle
            header
            Divider().background(DS.border)
            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 18) {
                    statsRow
                        .padding(.horizontal, 16)
                    difficultyRow
                        .padding(.horizontal, 16)
                    if !route.elevations.isEmpty {
                        elevationSection
                            .padding(.horizontal, 16)
                    }
                    smartTimeSection
                        .padding(.horizontal, 16)
                    if let urlStr = route.url, let url = URL(string: urlStr) {
                        urlButton(url: url)
                            .padding(.horizontal, 16)
                    }
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
            .stroke(pssOrange.opacity(0.4), lineWidth: 1)
        )
        .offset(y: max(0, dragOffset))
        .gesture(
            DragGesture()
                .updating($dragOffset) { v, state, _ in state = max(0, v.translation.height) }
                .onEnded { v in if v.translation.height > 90 { onCollapse() } }
        )
    }

    // MARK: - Handle

    private var dragHandle: some View {
        Capsule()
            .fill(Color.white.opacity(0.22))
            .frame(width: 36, height: 4)
            .padding(.top, 10)
            .padding(.bottom, 4)
    }

    // MARK: - Header

    private var header: some View {
        HStack(alignment: .top, spacing: 10) {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 5) {
                    Image(systemName: "figure.hiking")
                        .font(.system(size: 9, weight: .bold))
                        .foregroundColor(pssOrange)
                    Text("PSS КЛУБ")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundColor(pssOrange)
                        .kerning(0.5)
                }
                .padding(.horizontal, 8).padding(.vertical, 3)
                .background(pssOrange.opacity(0.12))
                .clipShape(Capsule())
                .overlay(Capsule().stroke(pssOrange.opacity(0.33), lineWidth: 1))

                Text(route.name)
                    .font(.title3).fontWeight(.bold)
                    .foregroundColor(DS.textPrimary)
                    .lineLimit(3)
                    .fixedSize(horizontal: false, vertical: true)
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

    // MARK: - Stats

    private var statsRow: some View {
        let dist = route.distanceKm
        let asc  = route.ascent
        let desc = route.descent
        let maxE = route.maxElevation
        let minE = route.minElevation

        let items: [(String, String, String, String)] = [
            ("📏", "ДИСТАНЦИЯ", String(format: "%.1f", dist), "км"),
            ("↑",  "НАБОР",     asc  > 0 ? "\(Int(asc))"  : "—", "м"),
            ("↓",  "СБРОС",     desc > 0 ? "\(Int(desc))" : "—", "м"),
            ("⛰", "МАКС",      maxE > 0 ? "\(Int(maxE))" : "—", "м"),
            ("▼",  "МИН",       minE > 0 ? "\(Int(minE))" : "—", "м"),
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
                    Text(unit)
                        .font(.system(size: 10))
                        .foregroundColor(DS.textSecondary)
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

    // MARK: - Difficulty

    private var difficultyRow: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Text("СЛОЖНОСТЬ")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundColor(DS.textSecondary)
                    .kerning(0.6)
                Text(difficulty.rawValue.uppercased())
                    .font(.system(size: 10, weight: .bold))
                    .foregroundColor(difficulty.dsColor)
                Spacer()
            }
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(Color.white.opacity(0.1)).frame(height: 5)
                    Capsule().fill(difficulty.dsColor)
                        .frame(width: geo.size.width * difficulty.fraction, height: 5)
                }
            }
            .frame(height: 5)
            Text(difficulty.hint)
                .font(.system(size: 11))
                .foregroundColor(DS.textTertiary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    // MARK: - Elevation

    private var elevationSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("ПРОФИЛЬ ВЫСОТ")
                .font(.system(size: 11, weight: .semibold))
                .foregroundColor(DS.textSecondary)
                .kerning(0.7)

            ElevationChartView(stats: stats)
                .padding(12)
                .background(DS.glass)
                .clipShape(RoundedRectangle(cornerRadius: DS.radiusM, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: DS.radiusM, style: .continuous).stroke(DS.border, lineWidth: 1))

            Text("Проведите пальцем — высота, километр и уклон участка. Двойной тап с протяжкой — выделить участок")
                .font(.system(size: 10))
                .foregroundColor(DS.textTertiary)
        }
    }

    // MARK: - Smart time

    private var smartTimeSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("ВРЕМЯ В ПУТИ")
                .font(.system(size: 11, weight: .semibold))
                .foregroundColor(DS.textSecondary)
                .kerning(0.7)
            SmartTimeView(stats: stats)
        }
    }

    // MARK: - URL

    private func urlButton(url: URL) -> some View {
        Link(destination: url) {
            HStack(spacing: 8) {
                Image(systemName: "safari").font(.system(size: 14))
                Text("Подробнее на сайте PSS").font(.system(size: 14, weight: .medium))
                Spacer()
                Image(systemName: "arrow.up.right").font(.system(size: 12))
            }
            .foregroundColor(.white)
            .padding(14)
            .background(pssOrange)
            .clipShape(RoundedRectangle(cornerRadius: DS.radiusM, style: .continuous))
            .shadow(color: pssOrange.opacity(0.4), radius: 14, y: 4)
        }
    }
}
