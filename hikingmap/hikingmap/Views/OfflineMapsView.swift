import SwiftUI

/// Экран скачивания офлайн-карты Сербии и Косова.
struct OfflineMapsView: View {
    @EnvironmentObject var appState: AppState
    @ObservedObject private var manager = OfflineMapManager.shared
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ZStack {
            DS.bg.ignoresSafeArea()

            VStack(spacing: 0) {
                header
                Divider().background(DS.border)

                ScrollView(showsIndicators: false) {
                    VStack(alignment: .leading, spacing: 16) {
                        regionCard
                        satelliteNote
                        diskRow
                    }
                    .padding(16)
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationBackground(.ultraThinMaterial)
        .presentationDragIndicator(.visible)
        .onAppear {
            manager.refresh()
            if manager.estimatedBytes == nil, !manager.state.isReady { manager.estimate() }
        }
    }

    // MARK: - Шапка

    private var header: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text("Офлайн-карта")
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundColor(DS.textPrimary)
                Text("Чтобы карта работала без связи")
                    .font(.system(size: 11))
                    .foregroundColor(DS.textSecondary)
            }
            Spacer()
            Button { dismiss() } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(DS.textSecondary)
                    .frame(width: 30, height: 30)
                    .background(DS.glass)
                    .clipShape(Circle())
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
    }

    // MARK: - Карточка региона

    private var regionCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 10) {
                Text("🇷🇸")
                    .font(.system(size: 26))
                VStack(alignment: .leading, spacing: 3) {
                    Text("Србија + Косово")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundColor(DS.textPrimary)
                    Text("Топооснова: тропы, дороги, подписи и отмывка рельефа до 14-го зума")
                        .font(.system(size: 11))
                        .foregroundColor(DS.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
            }

            statusRow
            actionRow
        }
        .padding(14)
        .background(DS.surface)
        .clipShape(RoundedRectangle(cornerRadius: DS.radiusM, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: DS.radiusM, style: .continuous)
                .stroke(manager.state.isReady ? DS.accent.opacity(0.4) : DS.border, lineWidth: 1)
        )
    }

    @ViewBuilder
    private var statusRow: some View {
        switch manager.state {
        case .unknown, .notDownloaded:
            label(sizeHint, color: DS.textSecondary)

        case .downloading(let progress, let bytes):
            VStack(alignment: .leading, spacing: 6) {
                ProgressView(value: progress)
                    .tint(DS.accent)
                HStack {
                    Text("\(Int(progress * 100)) %")
                    Spacer()
                    Text(OfflineMapManager.format(bytes: bytes))
                }
                .font(.system(size: 11))
                .foregroundColor(DS.textSecondary)
            }

        case .ready(let bytes):
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 12))
                        .foregroundColor(DS.pinStart)
                    Text("Скачано · \(OfflineMapManager.format(bytes: bytes))")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundColor(DS.textPrimary)
                }
                if let packs = manager.requiredPacks {
                    label(packsLine(packs), color: DS.textTertiary)
                }
            }

        case .failed(let message):
            label(message, color: DS.diffHard)
        }
    }

    /// Оценка размера — подсказка, а не условие: пока она считается, скачивать
    /// уже можно.
    private var sizeHint: String {
        var line: String
        if let bytes = manager.estimatedBytes {
            let prefix = manager.isEstimating ? "Не скачано · уже насчитали" : "Не скачано · примерно"
            line = "\(prefix) \(OfflineMapManager.format(bytes: bytes))"
        } else {
            line = manager.isEstimating ? "Не скачано · считаем размер…" : "Не скачано"
        }
        if let packs = manager.requiredPacks { line += "\n" + packsLine(packs) }
        return line
    }

    /// Лимит пачек — узкое место офлайна у Mapbox, поэтому показываем его явно.
    private func packsLine(_ packs: UInt64) -> String {
        "\(packs) из \(OfflineMapManager.packLimit) пачек тайлов"
    }

    @ViewBuilder
    private var actionRow: some View {
        switch manager.state {
        case .downloading:
            button("Отменить", filled: false) { manager.cancel() }

        case .ready:
            HStack(spacing: 8) {
                if appState.baseStyle != .topo {
                    button("Включить топооснову", filled: true) {
                        appState.topoAlpha = 0
                        appState.baseStyle = .topo
                    }
                }
                button("Удалить", filled: false) { manager.delete() }
            }

        case .unknown, .notDownloaded, .failed:
            button("Скачать", filled: true) { manager.download() }
        }
    }

    // MARK: - Пояснения

    private var satelliteNote: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Image(systemName: "info.circle")
                    .font(.system(size: 11))
                Text("Про спутник")
                    .font(.system(size: 12, weight: .medium))
            }
            .foregroundColor(DS.textSecondary)

            Text("Спутниковые снимки офлайн не сохраняются: на Сербию это несколько гигабайт и весь лимит офлайн-тайлов Mapbox. Без связи переключайтесь на топооснову — она уже на устройстве.")
                .font(.system(size: 11))
                .foregroundColor(DS.textSecondary.opacity(0.8))
                .fixedSize(horizontal: false, vertical: true)

            Text("Линий горизонталей офлайн тоже не будет — они в отдельном тайлсете, а он удваивает расход лимита. Вместо них рельеф показывает отмывка.")
                .font(.system(size: 11))
                .foregroundColor(DS.textSecondary.opacity(0.8))
                .fixedSize(horizontal: false, vertical: true)

            Text("Маршруты, тропы ПСС, пещеры и фото и так лежат внутри приложения — им сеть не нужна.")
                .font(.system(size: 11))
                .foregroundColor(DS.textSecondary.opacity(0.8))
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(DS.glass)
        .clipShape(RoundedRectangle(cornerRadius: DS.radiusS, style: .continuous))
    }

    private var diskRow: some View {
        HStack {
            Text("Свободно на устройстве")
            Spacer()
            Text(OfflineMapManager.format(bytes: manager.freeDiskBytes))
        }
        .font(.system(size: 11))
        .foregroundColor(DS.textTertiary)
    }

    // MARK: - Мелочи

    private func label(_ text: String, color: Color) -> some View {
        Text(text)
            .font(.system(size: 12))
            .foregroundColor(color)
            .fixedSize(horizontal: false, vertical: true)
    }

    private func button(_ title: String, filled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 13, weight: .semibold))
                .foregroundColor(filled ? .black : DS.textSecondary)
                .padding(.horizontal, 16)
                .padding(.vertical, 9)
                .background(filled ? DS.accent : DS.glass)
                .clipShape(Capsule())
        }
        .buttonStyle(.plain)
    }
}
