import SwiftUI

/// Полоска идущей загрузки набора тайлов — крепится над нижней карточкой.
///
/// Загрузки живут в фоновой `URLSession` и продолжаются, когда экран
/// «Офлайн-карта» закрыт. Без этой полоски юзер, свернувший экран, терял
/// всякий след процесса на сотни мегабайт и не понимал, идёт ли он вообще.
/// Тап возвращает на экран загрузок.
struct DownloadProgressStrip: View {
    @EnvironmentObject var appState: AppState

    @ObservedObject private var topo    = TileSetDownloader.topo
    @ObservedObject private var histmap = TileSetDownloader.histmap

    /// Все идущие загрузки, а не первая из них.
    ///
    /// Пока набор был один, вопроса не стояло. Теперь их несколько, и
    /// показывать только первый значило врать: вторая загрузка шла молча,
    /// ела трафик и место, а на экране её не было вовсе.
    private var active: [(id: String, title: String, stage: TileSetDownloader.Stage)] {
        TileSetDownloader.all.compactMap { d in
            switch d.stage {
            case .downloading, .unpacking, .readyToUnpack:
                return (d.spec.id, Self.title(for: d.spec.id), d.stage)
            default:
                return nil
            }
        }
    }

    private static func title(for id: String) -> String {
        switch id {
        case "topo":    return "Топооснова"
        case "histmap": return "Историческая карта"
        default:        return "Карта"
        }
    }

    var body: some View {
        let running = active
        if !running.isEmpty {
            Button {
                appState.showOfflineMaps = true
            } label: {
                VStack(spacing: 8) {
                    ForEach(running, id: \.id) { item in
                        VStack(spacing: 5) {
                            HStack(spacing: 6) {
                                Text(item.title)
                                    .font(.system(size: 11, weight: .medium))
                                    .foregroundColor(DS.textPrimary)
                                    .lineLimit(1)

                                Spacer(minLength: 0)

                                Text(Self.statusText(item.stage))
                                    .font(.system(size: 11, weight: .semibold))
                                    .foregroundColor(DS.accent)
                                    .monospacedDigit()
                            }

                            ProgressView(value: Self.fraction(item.stage))
                                .progressViewStyle(.linear)
                                .tint(DS.accent)
                                .scaleEffect(x: 1, y: 0.6, anchor: .center)
                        }
                    }
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
                .background(.ultraThinMaterial)
                .background(DS.surface.opacity(0.92))
                .clipShape(RoundedRectangle(cornerRadius: DS.radiusS, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: DS.radiusS, style: .continuous)
                    .stroke(DS.border, lineWidth: 1))
                .padding(.leading, 12)
                // Справа над полоской висит кнопка локации — не заезжаем под неё,
                // иначе проценты читать нечем.
                .padding(.trailing, 76)
                .padding(.bottom, 6)
            }
            .buttonStyle(.plain)
            .transition(.move(edge: .bottom).combined(with: .opacity))
        }
    }

    private static func fraction(_ stage: TileSetDownloader.Stage) -> Double {
        switch stage {
        case .downloading(let progress, _, _): return progress
        case .unpacking(let progress):         return progress
        case .readyToUnpack:                   return 1
        default:                               return 0
        }
    }

    private static func statusText(_ stage: TileSetDownloader.Stage) -> String {
        switch stage {
        case .downloading(let progress, _, _): return "\(Int(progress * 100))%"
        case .unpacking(let progress):         return "распаковка \(Int(progress * 100))%"
        case .readyToUnpack:                   return "ждёт распаковки"
        default:                               return ""
        }
    }
}
