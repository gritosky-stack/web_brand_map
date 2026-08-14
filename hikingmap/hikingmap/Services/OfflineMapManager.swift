import Foundation
import Combine
import MapboxMaps

/// Офлайн-карта Сербии и Косова.
///
/// Как это устроено у Mapbox: тайлы качаются не поштучно, а «пачками» (tile pack).
/// Пачка — это один родительский тайл со всеми детьми в пределах зум-батча
/// (по умолчанию 0–5, 6–10, 11–14, 15–16; у DEM своя схема — см. ниже). Поэтому
/// промежуточные значения maxZoom смысла не имеют: 13 и 14 дают одну и ту же
/// закачку. Лимит Mapbox — **750 пачек на устройство**, и это здесь главное
/// ограничение.
///
/// Ключевой факт: **пачка заводится на каждый тайлсет отдельно**. У стиля Outdoors
/// в `composite` их три (streets-v8 + terrain-v2 + bathymetry-v2), а Сербия с Косовом
/// — это 517 тайлов z11. Вся страна на z11–14 стоила бы 517 × 3 = 1551 пачку, то есть
/// вдвое больше лимита. Не влезает и урезание по площади: даже тайлы, по которым
/// реально проходят тропы (наши треки + 289 маршрутов ПСС), — это 253 тайла, снова
/// 759 пачек.
///
/// Поэтому качаем не стиль целиком, а **один тайлсет** — `mapbox-streets-v8`
/// (тропы, дороги, подписи, лес и вода). Дескриптор с пустым styleURI как раз для
/// этого и предусмотрен. Бюджет получается такой:
///
///   • streets-v8, z0–14 — 517 + 3 + 1 = ~521 пачка;
///   • DEM для рельефа, z0–12 — ~150 пачек (схема батчей 0–5 / 6–9 / 10–12 / 13–14);
///   • границы стран для маски, z0–10 — ~4 пачки.
///
/// Итого ~675 из 750. Ценой этого офлайн остаётся без линий горизонталей: они лежат
/// в terrain-v2, а он удваивает счёт. Вместо них — отмывка рельефа из того же DEM.
/// Спутник офлайн не кладём вовсе: ещё ~520 пачек и несколько гигабайт.
///
/// Если Mapbox поднимет лимит, вернуть горизонтали — это заменить один дескриптор
/// на дескриптор всего стиля `.outdoors`.
final class OfflineMapManager: ObservableObject {

    static let shared = OfflineMapManager()

    // MARK: - Состояние

    enum State: Equatable {
        case unknown
        case notDownloaded
        case downloading(progress: Double, bytes: UInt64)
        case ready(bytes: UInt64)
        case failed(String)

        var isBusy: Bool {
            if case .downloading = self { return true }
            return false
        }

        var isReady: Bool {
            if case .ready = self { return true }
            return false
        }
    }

    @Published private(set) var state: State = .unknown
    /// Оценка размера закачки от Mapbox — считается по реальным тайлам, а не на глаз.
    @Published private(set) var estimatedBytes: UInt64?
    /// Оценка идёт в фоне и ничего не блокирует: скачивать можно, не дожидаясь её.
    @Published private(set) var isEstimating = false
    /// Свободно на устройстве, байты.
    @Published private(set) var freeDiskBytes: Int64 = 0
    /// Сколько пачек требует регион. Показываем рядом с лимитом: он тут узкое место,
    /// и при добавлении слоёв это первое, за чем нужно следить.
    @Published private(set) var requiredPacks: UInt64?

    // MARK: - Константы

    /// Лимит Mapbox по умолчанию.
    static let packLimit: UInt64 = 750

    /// Версия в идентификаторе: состав пачек менялся, и старый регион нужно
    /// удалить — иначе его тайлы продолжают занимать лимит.
    static let regionId = "serbia-kosovo-v2"
    private static let legacyRegionIds = ["serbia-kosovo-v1"]

    /// Пакеты стилей Mapbox мы больше не заводим — свой стиль лежит в бандле,
    /// а глифы растеризуются на устройстве. Прежние только занимают место.
    private static let legacyStyleURIs: [StyleURI] = [.outdoors, .satelliteStreets]

    private static let streetsTileset = "mapbox://mapbox.mapbox-streets-v8"
    private static let demTileset     = "mapbox://mapbox.mapbox-terrain-dem-v1"
    private static let bordersTileset = "mapbox://mapbox.country-boundaries-v1"

    private let tileStore      = TileStore.default
    private let offlineManager = OfflineManager()
    private var loadCancelable: Cancelable?
    private var estimateCancelable: Cancelable?
    private var stylePackCancelable: Cancelable?

    private init() {
        for id in Self.legacyRegionIds {
            tileStore.removeRegion(forId: id) { _ in }
        }
        // Стиль офлайна менялся — пакет от прежнего только занимает место
        for style in Self.legacyStyleURIs {
            offlineManager.removeStylePack(for: style)
        }
        refresh()
    }

    // MARK: - Публичное API

    /// Перечитывает состояние — оно переживает перезапуск приложения.
    func refresh() {
        updateFreeDisk()
        tileStore.tileRegion(forId: Self.regionId) { [weak self] result in
            DispatchQueue.main.async {
                guard let self else { return }
                if self.state.isBusy { return }
                // Недокачанный регион показываем как «не скачано»: повторный
                // download() докачает недостающее, а не начнёт с нуля.
                guard case .success(let region) = result,
                      region.requiredResourceCount > 0,
                      region.completedResourceCount >= region.requiredResourceCount
                else {
                    self.state = .notDownloaded
                    return
                }
                self.state = .ready(bytes: region.completedResourceSize)
            }
        }
    }

    /// Спрашивает у Mapbox, сколько весит регион. Оценка не бесплатная по времени:
    /// SDK качает выборку пачек и экстраполирует, а без таймаута будет уточнять
    /// её до нулевой погрешности сколь угодно долго. Поэтому ограничиваем
    /// и погрешность, и время — цифра нужна порядковая, а не до байта.
    func estimate() {
        guard !isEstimating, !state.isBusy, let options = loadOptions() else { return }
        isEstimating = true
        estimateCancelable?.cancel()

        let estimateOptions = TileRegionEstimateOptions(
            errorMargin: 0.15,
            preciseEstimationTimeout: 5,
            timeout: 25,
            extraOptions: nil
        )

        estimateCancelable = tileStore.estimateTileRegion(
            forId: Self.regionId,
            loadOptions: options,
            estimateOptions: estimateOptions,
            progress: { [weak self] progress in
                // Показываем промежуточную цифру, чтобы экран не выглядел зависшим
                let partial = progress.partialResult.storageSize
                let packs   = progress.requiredResourceCount
                DispatchQueue.main.async {
                    if partial > 0 { self?.estimatedBytes = partial }
                    if packs   > 0 { self?.requiredPacks  = packs }
                }
            }
        ) { [weak self] result in
            DispatchQueue.main.async {
                guard let self else { return }
                self.isEstimating = false
                self.estimateCancelable = nil
                // Не сложилось — не беда: качать это не мешает, просто без цифры
                if case .success(let estimate) = result {
                    self.estimatedBytes = estimate.storageSize
                }
            }
        }
    }

    func download() {
        guard !state.isBusy, let options = loadOptions() else { return }
        // Оценка больше не нужна — она только отнимает канал у самой закачки
        estimateCancelable?.cancel()
        estimateCancelable = nil
        isEstimating = false
        state = .downloading(progress: 0, bytes: 0)

        // Пакет стиля отсюда убран намеренно. Раньше он качался первым, и пока
        // канал занимала загрузка своих тайлов, его запрос не отвечал — вся
        // цепочка стояла на нуле. А нужен он только спутнику, который офлайн
        // всё равно не работает: свой стиль лежит в бандле, глифы растеризуются
        // на устройстве. Здесь остаются только высоты и границы.
        loadTiles(options)
    }

    private func loadTiles(_ options: TileRegionLoadOptions) {
        guard case .downloading = state else { return }
        loadCancelable = tileStore.loadTileRegion(
            forId: Self.regionId,
            loadOptions: options,
            progress: { [weak self] progress in
                let required = max(progress.requiredResourceCount, 1)
                let done     = Double(progress.completedResourceCount) / Double(required)
                DispatchQueue.main.async {
                    self?.requiredPacks = progress.requiredResourceCount
                    self?.state = .downloading(progress: min(done, 1), bytes: progress.completedResourceSize)
                }
            },
            completion: { [weak self] result in
                DispatchQueue.main.async {
                    guard let self else { return }
                    self.loadCancelable = nil
                    switch result {
                    case .success(let region):
                        self.state = .ready(bytes: region.completedResourceSize)
                        self.updateFreeDisk()
                    case .failure(let error):
                        // Отмена — не ошибка, просто возвращаемся в исходное состояние
                        if Self.isCanceled(error) {
                            self.state = .notDownloaded
                        } else {
                            self.state = .failed(Self.describe(error))
                        }
                    }
                }
            }
        )
    }

    func cancel() {
        loadCancelable?.cancel()
        loadCancelable = nil
        stylePackCancelable?.cancel()
        stylePackCancelable = nil
        estimateCancelable?.cancel()
        estimateCancelable = nil
        isEstimating = false
        // Недокачанные пачки на диске не нужны
        tileStore.removeRegion(forId: Self.regionId) { _ in }
        DispatchQueue.main.async { self.state = .notDownloaded }
    }

    func delete() {
        loadCancelable?.cancel()
        loadCancelable = nil
        stylePackCancelable?.cancel()
        stylePackCancelable = nil
        tileStore.removeRegion(forId: Self.regionId) { _ in }
        for style in Self.legacyStyleURIs { offlineManager.removeStylePack(for: style) }
        DispatchQueue.main.async {
            self.state = .notDownloaded
            self.estimatedBytes = nil
            self.updateFreeDisk()
        }
    }

    // MARK: - Сборка запроса

    private func loadOptions() -> TileRegionLoadOptions? {
        guard let geometry = Self.regionGeometry() else { return nil }

        // streets-v8 отсюда ушёл: тропы, дороги и подписи теперь дают свои
        // тайлы из R2 — они полнее и не тратят лимит пачек Mapbox. Здесь
        // остаётся только то, чего у нас своего нет.
        let descriptors = [
            // Рельеф: 3D-подложка и отмывка. Схема батчей у DEM своя, 10–12 —
            // последняя, которую мы можем себе позволить (~150 пачек)
            descriptor(tileset: Self.demTileset, maxZoom: 12),
            // Маска «всё, кроме Сербии». Источник в карте ограничен z8,
            // так что батча 6–10 хватает — это ~4 пачки
            descriptor(tileset: Self.bordersTileset, maxZoom: 10)
        ]

        return TileRegionLoadOptions(
            geometry: geometry,
            descriptors: descriptors,
            metadata: ["name": "Србија + Косово"],
            acceptExpired: true
        )
    }

    /// Дескриптор на один тайлсет. styleURI пустой — так документация и предлагает
    /// тянуть тайлсеты отдельно от стиля; иначе вместе с ним приедет весь composite,
    /// то есть втрое больше пачек. pixelRatio фиксируем в 1: по умолчанию SDK берёт
    /// масштаб экрана (на iPhone это 3) и тянет растр в @3x — кратно больше байт.
    private func descriptor(tileset: String, maxZoom: UInt8) -> TilesetDescriptor {
        let options = TilesetDescriptorOptions(
            styleURI: "",
            minZoom: 0,
            maxZoom: maxZoom,
            pixelRatio: 1,
            tilesets: [tileset],
            stylePack: nil,
            extraOptions: nil
        )
        return offlineManager.createTilesetDescriptor(for: options)
    }

    /// Контур Сербии вместе с Косовом. Лежит в бандле — сеть для этого не нужна.
    private static func regionGeometry() -> Geometry? {
        guard let url  = Bundle.main.url(forResource: "serbia_region", withExtension: "geojson"),
              let data = try? Data(contentsOf: url),
              let feature = try? JSONDecoder().decode(Feature.self, from: data)
        else { return nil }
        return feature.geometry
    }

    // MARK: - Утилиты

    private func updateFreeDisk() {
        let url = URL(fileURLWithPath: NSHomeDirectory())
        let values = try? url.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey])
        freeDiskBytes = values?.volumeAvailableCapacityForImportantUsage ?? 0
    }

    private static func isCanceled(_ error: Error) -> Bool {
        if let regionError = error as? TileRegionError, case .canceled = regionError { return true }
        return error.localizedDescription.lowercased().contains("cancel")
    }

    private static func describe(_ error: Error) -> String {
        guard let regionError = error as? TileRegionError else { return error.localizedDescription }
        switch regionError {
        case .canceled:
            return "Загрузка отменена"
        case .doesNotExist:
            return "Регион не найден"
        case .tilesetDescriptor:
            return "Не удалось прочитать описание тайлов"
        case .diskFull:
            return "На устройстве кончилось место"
        case .tileCountExceeded:
            // Лимит Mapbox — 750 пачек тайлов на устройство
            return "Превышен лимит офлайн-тайлов. Удалите старые офлайн-карты"
        case .other(let message):
            return message
        }
    }

    static func format(bytes: UInt64) -> String {
        format(bytes: Int64(bytes))
    }

    static func format(bytes: Int64) -> String {
        let formatter = ByteCountFormatter()
        formatter.allowedUnits = [.useMB, .useGB]
        formatter.countStyle   = .file
        return formatter.string(fromByteCount: bytes)
    }
}
