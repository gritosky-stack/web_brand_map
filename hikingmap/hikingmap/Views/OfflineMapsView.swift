import SwiftUI

/// Экран скачивания офлайн-карты Сербии и Косова.
struct OfflineMapsView: View {
    @EnvironmentObject var appState: AppState
    @ObservedObject private var manager = OfflineMapManager.shared
    @ObservedObject private var downloader = TopoTilesDownloader.shared
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ZStack {
            DS.bg.ignoresSafeArea()

            VStack(spacing: 0) {
                header
                Divider().background(DS.border)

                ScrollView(showsIndicators: false) {
                    VStack(alignment: .leading, spacing: 16) {
                        topoCard
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

    // MARK: - Своя топокарта

    /// Основной набор: наши векторные тайлы Сербии с горизонталями,
    /// тропами и железными дорогами. Без него офлайн-карта пустая.
    private var topoCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 10) {
                Text("🗺️").font(.system(size: 26))
                VStack(alignment: .leading, spacing: 3) {
                    Text("Топокарта Сербии")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundColor(DS.textPrimary)
                    Text("Горизонтали, тропы, железные дороги и станции, вершины с высотами — до 14-го зума")
                        .font(.system(size: 11))
                        .foregroundColor(DS.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
            }

            topoStatus
            topoActions
        }
        .padding(14)
        .background(DS.surface)
        .clipShape(RoundedRectangle(cornerRadius: DS.radiusM, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: DS.radiusM, style: .continuous)
                .stroke(downloader.isReady ? DS.accent.opacity(0.4) : DS.border, lineWidth: 1)
        )
    }

    @ViewBuilder
    private var topoStatus: some View {
        switch downloader.stage {
        case .downloading(let progress, let bytes, let total):
            VStack(alignment: .leading, spacing: 6) {
                ProgressView(value: progress).tint(DS.accent)
                HStack {
                    Text("Скачивание · \(Int(progress * 100)) %")
                    Spacer()
                    Text("\(OfflineMapManager.format(bytes: bytes)) из \(OfflineMapManager.format(bytes: total))")
                }
                .font(.system(size: 11))
                .foregroundColor(DS.textSecondary)
            }

        case .unpacking(let progress):
            VStack(alignment: .leading, spacing: 6) {
                ProgressView(value: progress).tint(DS.accent)
                Text("Распаковка · \(Int(progress * 100)) % · не закрывайте приложение")
                    .font(.system(size: 11))
                    .foregroundColor(DS.textSecondary)
            }

        case .readyToUnpack:
            label("Загрузка завершена, начинаю распаковку…", color: DS.textSecondary)

        case .failed(let message):
            label(message, color: DS.diffHard)

        case .done, .idle:
            if let m = TopoTiles.manifest {
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 6) {
                        Image(systemName: "checkmark.circle.fill")
                            .font(.system(size: 12))
                            .foregroundColor(DS.pinStart)
                        Text("Скачано · \(OfflineMapManager.format(bytes: m.bytes)) · \(m.tiles) тайлов")
                            .font(.system(size: 12, weight: .medium))
                            .foregroundColor(DS.textPrimary)
                    }
                    if TopoTiles.isStale {
                        HStack(spacing: 6) {
                            Image(systemName: "arrow.down.circle.fill")
                                .font(.system(size: 12))
                                .foregroundColor(DS.accent)
                            Text("Данные устарели (\(m.version) → \(TopoTilesDownloader.version)). "
                                 + "Удалите и скачайте заново")
                                .font(.system(size: 12, weight: .medium))
                                .foregroundColor(DS.accent)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }
            } else {
                label("Не скачано · около 565 МБ, на устройстве займёт ~650 МБ",
                      color: DS.textSecondary)
            }
        }
    }

    @ViewBuilder
    private var topoActions: some View {
        switch downloader.stage {
        case .downloading:
            button("Отменить", filled: false) { downloader.cancel() }
        case .unpacking, .readyToUnpack:
            EmptyView()
        default:
            HStack(spacing: 8) {
                if downloader.isReady {
                    if appState.baseStyle != .topo {
                        button("Включить топооснову", filled: true) {
                            appState.topoAlpha = 0
                            appState.baseStyle = .topo
                        }
                    }
                    button("Удалить", filled: false) { downloader.delete() }
                } else {
                    button("Скачать", filled: true) { downloader.start() }
                }
            }
        }
    }

    // MARK: - Карточка региона

    private var regionCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 10) {
                Text("⛰️")
                    .font(.system(size: 26))
                VStack(alignment: .leading, spacing: 3) {
                    Text("Рельеф Сербии")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundColor(DS.textPrimary)
                    Text("Данные высот Mapbox: отмывка и объёмный рельеф. Нужны отдельно — своих высот у нас нет")
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
        return line
    }

    @ViewBuilder
    private var actionRow: some View {
        switch manager.state {
        case .downloading:
            button("Отменить", filled: false) { manager.cancel() }

        case .ready:
            button("Удалить", filled: false) { manager.delete() }

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

            Text("Спутниковые снимки офлайн не сохраняются: на Сербию это несколько гигабайт и весь лимит офлайн-тайлов Mapbox. Без связи переключайтесь на топооснову.")
                .font(.system(size: 11))
                .foregroundColor(DS.textSecondary.opacity(0.8))
                .fixedSize(horizontal: false, vertical: true)

            Text("Горизонтали, тропы и станции лежат в топокарте выше — она собрана из OpenStreetMap и данных высот Copernicus, лимитов Mapbox не касается.")
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
