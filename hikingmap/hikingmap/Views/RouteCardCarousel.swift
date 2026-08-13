import SwiftUI

struct RouteCardCarousel: View {
    let routes: [Route]
    let statsCache: [String: RouteStats]
    let onSelect: (Route) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 10) {
                    ForEach(routes) { route in
                        RouteCard(route: route, stats: statsCache[route.id])
                            .onTapGesture { onSelect(route) }
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 14)
            }
        }
        .background(
            ZStack {
                Color(red: 0.06, green: 0.06, blue: 0.06)
                Color.white.opacity(0.02)
            }
        )
        .overlay(
            Rectangle()
                .fill(DS.border)
                .frame(height: 1),
            alignment: .top
        )
    }
}

private struct RouteCard: View {
    let route: Route
    let stats: RouteStats?

    private var typeColor: Color { route.isPlanned ? DS.planned : DS.completed }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            // Header: badge + date
            HStack(spacing: 6) {
                HStack(spacing: 3) {
                    Circle()
                        .fill(typeColor)
                        .frame(width: 5, height: 5)
                    Text(route.typeBadgeText)
                        .font(.system(size: 9, weight: .bold))
                        .foregroundColor(typeColor)
                }
                .padding(.horizontal, 7).padding(.vertical, 2)
                .background(typeColor.opacity(0.12))
                .clipShape(Capsule())
                .overlay(Capsule().stroke(typeColor.opacity(0.33), lineWidth: 1))

                if let date = route.formattedDate {
                    Text(date)
                        .font(.system(size: 9))
                        .foregroundColor(DS.textTertiary)
                        .lineLimit(1)
                }
                Spacer(minLength: 0)
            }

            // Route name
            Text(route.name)
                .font(.system(size: 13, weight: .semibold))
                .foregroundColor(DS.textPrimary)
                .lineLimit(2)
                .frame(height: 38, alignment: .topLeading)

            Divider().background(DS.border)

            // Stats rows
            if let stats {
                VStack(alignment: .leading, spacing: 3) {
                    miniStat(icon: "↔", value: String(format: "%.1f", stats.distance), unit: "км")
                    miniStat(icon: "↑", value: "\(Int(stats.ascent))", unit: "м")
                    if let dur = stats.duration {
                        miniStat(icon: "⏱", value: dur, unit: "")
                    }
                }
            } else {
                HStack(spacing: 6) {
                    ProgressView().scaleEffect(0.65).tint(DS.accent)
                    Text("Загрузка…")
                        .font(.system(size: 10))
                        .foregroundColor(DS.textTertiary)
                }
                .frame(height: 20)
            }

            // Difficulty badge (if loaded)
            if let stats {
                let d = stats.difficulty
                HStack(spacing: 4) {
                    Circle()
                        .fill(d.dsColor)
                        .frame(width: 5, height: 5)
                    Text(d.rawValue)
                        .font(.system(size: 9, weight: .medium))
                        .foregroundColor(d.dsColor)
                }
            }
        }
        .padding(13)
        .frame(width: 185)
        .background(DS.glass)
        .clipShape(RoundedRectangle(cornerRadius: DS.radiusM, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: DS.radiusM, style: .continuous)
                .stroke(typeColor.opacity(0.22), lineWidth: 1)
        )
    }

    private func miniStat(icon: String, value: String, unit: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 4) {
            Text(icon)
                .font(.system(size: 12))
                .foregroundColor(DS.textTertiary)
                .frame(width: 14, alignment: .leading)
            Text(value)
                .font(.system(size: 12, weight: .bold))
                .foregroundColor(DS.textPrimary)
                .lineLimit(1)
            if !unit.isEmpty {
                Text(unit)
                    .font(.system(size: 10))
                    .foregroundColor(DS.textSecondary)
            }
        }
    }
}
