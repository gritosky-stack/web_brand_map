import SwiftUI

struct CustomRouteCarousel: View {
    @ObservedObject var store: CustomRouteStore
    let selectedId: String?
    let onSelect: (CustomRoute) -> Void
    let onDelete: (String) -> Void

    var body: some View {
        VStack(spacing: 0) {
            Capsule()
                .fill(Color.white.opacity(0.18))
                .frame(width: 36, height: 4)
                .padding(.top, 10)
                .padding(.bottom, 10)

            if store.routes.isEmpty {
                emptyState
            } else {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 12) {
                        ForEach(store.routes) { route in
                            CustomRouteCard(
                                route: route,
                                isSelected: route.id == selectedId,
                                onSelect: { onSelect(route) },
                                onDelete: { onDelete(route.id) }
                            )
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.bottom, 20)
                }
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
            .stroke(DS.border, lineWidth: 1)
        )
    }

    private var emptyState: some View {
        VStack(spacing: 10) {
            Image(systemName: "pencil.and.ruler")
                .font(.system(size: 28))
                .foregroundColor(DS.textTertiary)
            Text("Нарисуй свой маршрут")
                .font(.system(size: 14, weight: .medium))
                .foregroundColor(DS.textSecondary)
            Text("Нажми «Нарисовать» и добавляй точки на карте")
                .font(.system(size: 12))
                .foregroundColor(DS.textTertiary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 28)
        .padding(.horizontal, 24)
    }
}

// MARK: - Card

private struct CustomRouteCard: View {
    let route: CustomRoute
    let isSelected: Bool
    let onSelect: () -> Void
    let onDelete: () -> Void

    private let purple = Color(hex: "#7B5EA7")

    var body: some View {
        Button(action: onSelect) {
            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 3) {
                        HStack(spacing: 5) {
                            Image(systemName: "pencil")
                                .font(.system(size: 9, weight: .bold))
                                .foregroundColor(purple)
                            Text("МОЙ МАРШРУТ")
                                .font(.system(size: 9, weight: .bold))
                                .foregroundColor(purple)
                                .kerning(0.4)
                        }
                        Text(route.name)
                            .font(.system(size: 14, weight: .bold))
                            .foregroundColor(DS.textPrimary)
                            .lineLimit(2)
                    }
                    Spacer()
                    Button(action: onDelete) {
                        Image(systemName: "trash")
                            .font(.system(size: 12))
                            .foregroundColor(DS.textTertiary)
                            .frame(width: 28, height: 28)
                            .background(DS.glass)
                            .clipShape(Circle())
                            .overlay(Circle().stroke(DS.border, lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                }

                HStack(spacing: 14) {
                    miniStat("↔", String(format: "%.1f", route.distanceKm), "км")
                    miniStat("📍", "\(route.waypointLats.count)", "точек")
                    miniStat("📅", shortDate(route.date), "")
                }

                if isSelected {
                    HStack(spacing: 4) {
                        Circle().fill(purple).frame(width: 5, height: 5)
                        Text("Показан на карте")
                            .font(.system(size: 10))
                            .foregroundColor(purple)
                    }
                }
            }
            .padding(14)
            .frame(width: 230)
            .background(isSelected ? purple.opacity(0.10) : DS.glass)
            .clipShape(RoundedRectangle(cornerRadius: DS.radiusM, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: DS.radiusM, style: .continuous)
                    .stroke(isSelected ? purple.opacity(0.6) : DS.border, lineWidth: isSelected ? 1.5 : 1)
            )
        }
        .buttonStyle(.plain)
        .animation(.easeInOut(duration: 0.18), value: isSelected)
    }

    private func miniStat(_ icon: String, _ value: String, _ unit: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 2) {
            Text(icon).font(.system(size: 9)).foregroundColor(DS.textTertiary)
            Text(value).font(.system(size: 12, weight: .bold, design: .monospaced)).foregroundColor(DS.textPrimary)
            if !unit.isEmpty {
                Text(unit).font(.system(size: 9)).foregroundColor(DS.textTertiary)
            }
        }
    }

    private func shortDate(_ date: Date) -> String {
        let f = DateFormatter()
        f.dateFormat = "d MMM"
        f.locale = Locale(identifier: "ru_RU")
        return f.string(from: date)
    }
}
