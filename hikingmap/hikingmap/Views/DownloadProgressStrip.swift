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

    /// Первая активная загрузка. Их две, но одновременно качать оба набора
    /// на мобильном интернете — плохая идея, так что показываем одну.
    private var active: (title: String, stage: TileSetDownloader.Stage)? {
        for downloader in [topo, histmap] {
            switch downloader.stage {
            case .downloading, .unpacking, .readyToUnpack:
                return (Self.title(for: downloader.spec.id), downloader.stage)
            default:
                continue
            }
        }
        return nil
    }

    private static func title(for id: String) -> String {
        switch id {
        case "topo":    return "Топооснова"
        case "histmap": return "Историческая карта"
        default:        return "Карта"
        }
    }

    var body: some View {
        if let active {
            Button {
                appState.showOfflineMaps = true
            } label: {
                VStack(spacing: 5) {
                    HStack(spacing: 6) {
                        Text(active.title)
                            .font(.system(size: 11, weight: .medium))
                            .foregroundColor(DS.textPrimary)
                            .lineLimit(1)

                        Spacer(minLength: 0)

                        Text(Self.statusText(active.stage))
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundColor(DS.accent)
                            .monospacedDigit()
                    }

                    ProgressView(value: Self.fraction(active.stage))
                        .progressViewStyle(.linear)
                        .tint(DS.accent)
                        .scaleEffect(x: 1, y: 0.6, anchor: .center)
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
