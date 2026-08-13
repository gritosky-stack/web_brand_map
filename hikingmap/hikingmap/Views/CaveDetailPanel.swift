import SwiftUI

struct CaveDetailPanel: View {
    let cave: CavePoint
    let onClose: () -> Void
    let onCollapse: () -> Void
    let onShowOnMap: () -> Void

    @State private var selectedTab: Tab = .info
    @State private var descExpanded = false
    @GestureState private var dragOffset: CGFloat = 0

    enum Tab { case info, photos }

    var body: some View {
        VStack(spacing: 0) {
            dragHandle
            header
            tabBar
            Divider().background(DS.border)
            ScrollView(showsIndicators: false) {
                switch selectedTab {
                case .info:   infoContent.padding(.bottom, 32)
                case .photos: emptyPhotos.padding(.bottom, 32)
                }
            }
        }
        .background(
            ZStack {
                Color(red: 0.078, green: 0.078, blue: 0.078)
                Color.white.opacity(0.03)
            }
        )
        .clipShape(UnevenRoundedRectangle(topLeadingRadius: DS.radiusL, bottomLeadingRadius: 0,
                                          bottomTrailingRadius: 0, topTrailingRadius: DS.radiusL))
        .overlay(UnevenRoundedRectangle(topLeadingRadius: DS.radiusL, bottomLeadingRadius: 0,
                                         bottomTrailingRadius: 0, topTrailingRadius: DS.radiusL)
            .stroke(DS.border, lineWidth: 1))
        .offset(y: max(0, dragOffset))
        .gesture(DragGesture()
            .updating($dragOffset) { v, state, _ in state = max(0, v.translation.height) }
            .onEnded { v in if v.translation.height > 80 { onCollapse() } })
    }

    // MARK: - Handle

    private var dragHandle: some View {
        Capsule()
            .fill(Color.white.opacity(0.22))
            .frame(width: 36, height: 4)
            .padding(.top, 10).padding(.bottom, 4)
    }

    // MARK: - Header

    private var header: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 8) {
                    Text("🕳️").font(.system(size: 22))
                    caveBadge
                }
                Text(cave.name)
                    .font(.system(size: 20, weight: .bold))
                    .foregroundColor(.white)
                    .lineLimit(2)
                if let sr = cave.nameSr, sr != cave.name {
                    Text(sr)
                        .font(.system(size: 12))
                        .foregroundColor(DS.textSecondary)
                }
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
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 18)
        .padding(.top, 6)
        .padding(.bottom, 12)
    }

    private var caveBadge: some View {
        HStack(spacing: 4) {
            Text("ПЕЩЕРА")
                .font(.system(size: 10, weight: .bold))
                .foregroundColor(Color(hex: "#5B9CF6"))
                .kerning(0.5)
        }
        .padding(.horizontal, 10).padding(.vertical, 3)
        .background(Color(hex: "#5B9CF6").opacity(0.15))
        .clipShape(Capsule())
        .overlay(Capsule().stroke(Color(hex: "#5B9CF6").opacity(0.4), lineWidth: 1))
    }

    // MARK: - Tab bar

    private var tabBar: some View {
        HStack(spacing: 0) {
            tabButton("Инфо", tab: .info)
            tabButton("Фото", tab: .photos)
        }
    }

    private func tabButton(_ title: String, tab: Tab) -> some View {
        Button { withAnimation(.easeInOut(duration: 0.18)) { selectedTab = tab } } label: {
            VStack(spacing: 0) {
                Text(title)
                    .font(.system(size: 13, weight: selectedTab == tab ? .semibold : .regular))
                    .foregroundColor(selectedTab == tab ? DS.textPrimary : DS.textSecondary)
                    .padding(.vertical, 12)
                    .frame(maxWidth: .infinity)
                Rectangle()
                    .fill(selectedTab == tab ? DS.accent : Color.clear)
                    .frame(height: 2)
            }
        }
        .buttonStyle(.plain)
    }

    // MARK: - Info content

    private var infoContent: some View {
        VStack(alignment: .leading, spacing: 16) {
            statsGrid.padding(.horizontal, 16).padding(.top, 16)
            descentChart.padding(.horizontal, 16)
            if let desc = caveDescription {
                descSection(desc).padding(.horizontal, 16)
            }
            ctaButton.padding(.horizontal, 16)
        }
    }

    private var statsGrid: some View {
        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
            if let d = cave.depth {
                statCell(icon: "↓", label: "Глубина", value: "\(Int(d))", unit: "м")
            }
            statCell(icon: "▣", label: "Категория",
                     value: cave.difficulty ?? "—", unit: "кат.")
            statCell(icon: "💧", label: "Вода",
                     value: cave.hasWater ? "Есть" : "Нет", unit: "",
                     dotColor: cave.hasWater ? Color(hex: "#5B9CF6") : nil)
            if let l = cave.length {
                statCell(icon: "↔", label: "Длина", value: String(format: "%.1f", l / 1000), unit: "км")
            } else if let ele = cave.ele {
                statCell(icon: "⛰", label: "Высота", value: "\(Int(ele))", unit: "м")
            }
        }
    }

    private func statCell(icon: String, label: String, value: String, unit: String,
                           dotColor: Color? = nil) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(label)
                .font(.system(size: 10))
                .foregroundColor(.white.opacity(0.35))
                .textCase(.uppercase)
                .kerning(0.5)
            HStack(alignment: .firstTextBaseline, spacing: 5) {
                if let c = dotColor {
                    Circle().fill(c).frame(width: 7, height: 7)
                }
                Text(value)
                    .font(.system(size: 16, weight: .bold))
                    .foregroundColor(.white)
                if !unit.isEmpty {
                    Text(unit)
                        .font(.system(size: 10))
                        .foregroundColor(.white.opacity(0.4))
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 12).padding(.vertical, 10)
        .background(Color.white.opacity(0.04))
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(DS.border, lineWidth: 1))
    }

    // MARK: - Size interpretation card (replaces synthetic depth chart)

    private var descentChart: some View {
        CaveSizeCard(depth: cave.depth, length: cave.length)
    }

    // MARK: - Description

    private var caveDescription: String? {
        guard cave.depth != nil || cave.length != nil else { return nil }
        var parts: [String] = []
        if let d = cave.depth { parts.append("максимальная глубина \(Int(d)) м") }
        if let l = cave.length { parts.append(l >= 1000
            ? String(format: "длина %.1f км", l / 1000)
            : "длина \(Int(l)) м") }
        let body = parts.isEmpty ? "" : " (\(parts.joined(separator: ", ")))."
        return "Пещера \(cave.name) — природный объект на территории Сербии\(body) " +
               (cave.hasWater ? "В нижних ярусах обнаружен подземный водоток. " : "") +
               "Для посещения может потребоваться специальное снаряжение."
    }

    private func descSection(_ text: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("ОПИСАНИЕ")
                .font(.system(size: 11, weight: .semibold))
                .foregroundColor(DS.textSecondary)
                .kerning(0.7)
            Text(text)
                .font(.system(size: 14))
                .foregroundColor(DS.textSecondary)
                .lineSpacing(3)
                .lineLimit(descExpanded ? nil : 4)
            Button { descExpanded.toggle() } label: {
                Text(descExpanded ? "Свернуть" : "Читать дальше")
                    .font(.system(size: 13))
                    .foregroundColor(DS.accent)
            }
            .buttonStyle(.plain)
            .padding(.top, 2)
        }
    }

    // MARK: - CTA

    private var ctaButton: some View {
        Button {
            onCollapse()
            onShowOnMap()
        } label: {
            Text("Показать на карте")
                .font(.system(size: 15, weight: .bold))
                .foregroundColor(.white)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 14)
                .background(DS.accent)
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                .shadow(color: DS.accent.opacity(0.4), radius: 16, y: 4)
        }
        .buttonStyle(.plain)
    }

    // MARK: - Photos placeholder

    private var emptyPhotos: some View {
        Text("Фотографии пещеры скоро появятся")
            .font(.system(size: 13))
            .foregroundColor(DS.textTertiary)
            .frame(maxWidth: .infinity)
            .padding(.top, 60)
    }
}

// MARK: - Cave size interpretation card

private struct CaveSizeCard: View {
    let depth: Double?
    let length: Double?

    private struct Interp {
        let measureText: String
        let label: String
        let comparison: String
        let icon: String
    }

    private var interp: Interp {
        if let d = depth {
            let floors = max(1, Int((d / 3).rounded()))
            switch d {
            case ..<10:
                return Interp(measureText: "\(Int(d)) м", label: "Глубина",
                    comparison: "— как \(floors)-этажный дом", icon: "🏠")
            case 10..<50:
                return Interp(measureText: "\(Int(d)) м", label: "Глубина",
                    comparison: "— как \(floors)-этажное здание", icon: "🏢")
            case 50..<150:
                return Interp(measureText: "\(Int(d)) м", label: "Глубина",
                    comparison: "— глубже олимпийского трамплина", icon: "🏙️")
            case 150..<325:
                return Interp(measureText: "\(Int(d)) м", label: "Глубина",
                    comparison: "— как половина Эйфелевой башни", icon: "🗼")
            default:
                return Interp(measureText: "\(Int(d)) м", label: "Глубина",
                    comparison: "— глубже Эйфелевой башни", icon: "⛰️")
            }
        } else if let l = length {
            switch l {
            case ..<100:
                return Interp(measureText: "\(Int(l)) м", label: "Длина",
                    comparison: "— короткая, но атмосферная", icon: "🔦")
            case 100..<500:
                return Interp(measureText: "\(Int(l)) м", label: "Длина",
                    comparison: "— \(max(1, Int((l / 70).rounded()))) мин ходьбы в глубину", icon: "🧗")
            case 500..<3000:
                return Interp(measureText: String(format: "%.1f км", l / 1000), label: "Длина",
                    comparison: "— как \(Int((l / 100).rounded())) кварталов Белграда", icon: "🗺️")
            default:
                return Interp(measureText: String(format: "%.0f км", l / 1000), label: "Длина",
                    comparison: "— крупная пещерная система", icon: "🌐")
            }
        } else {
            return Interp(measureText: "—", label: "Размеры не внесены",
                comparison: "Помогите науке — добавьте данные на OpenStreetMap",
                icon: "❓")
        }
    }

    var body: some View {
        HStack(spacing: 16) {
            Text(interp.icon)
                .font(.system(size: 44))
                .frame(width: 56, alignment: .center)

            VStack(alignment: .leading, spacing: 4) {
                Text(interp.label.uppercased())
                    .font(.system(size: 9, weight: .semibold))
                    .foregroundColor(DS.textSecondary)
                    .kerning(0.8)
                Text(interp.measureText)
                    .font(.system(size: 30, weight: .bold, design: .rounded))
                    .foregroundColor(DS.accent)
                Text(interp.comparison)
                    .font(.system(size: 12))
                    .foregroundColor(DS.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .padding(16)
        .frame(maxWidth: .infinity)
        .background(Color.white.opacity(0.04))
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(DS.border, lineWidth: 1))
    }
}
