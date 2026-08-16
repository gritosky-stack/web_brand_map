import Foundation
import Combine
import CoreLocation
import Network
import UIKit
import SwiftUI

enum RouteFilter: String, CaseIterable {
    case all       = "Все"
    case completed = "Пройденные"
    case planned   = "Планы"
    case mine      = "Мои"
}

struct SelectedPhotoInfo: Identifiable {
    let id = UUID()
    let routeId: String
    let index: Int
}

/// Железнодорожная станция на экране: точка привязки на карте плюс уже
/// пересчитанная позиция в пикселях — интерфейсу остаётся только нарисовать.
struct StationMarker: Identifiable, Equatable {
    let id: String
    let name: String
    /// Вокзал (`station`) против остановки или полустанка — рисуются по-разному
    let isMajor: Bool
    let coordinate: CLLocationCoordinate2D
    var screen: CGPoint

    static func == (a: StationMarker, b: StationMarker) -> Bool {
        a.id == b.id && a.screen == b.screen
    }
}

/// Основа карты. Спутник красивее, но его тайлы живут только онлайн:
/// офлайн-пакет собирается на топооснове Mapbox Outdoors.
enum BaseMapStyle: String, CaseIterable, Identifiable {
    case satellite
    case topo

    var id: String { rawValue }

    var title: String {
        switch self {
        case .satellite: return "Спутник"
        case .topo:      return "Топо"
        }
    }

    var icon: String {
        switch self {
        case .satellite: return "globe.europe.africa.fill"
        case .topo:      return "map.fill"
        }
    }

    /// Работает ли основа без интернета (при скачанном офлайн-пакете).
    var supportsOffline: Bool { self == .topo }
}

/// Режим слежения за геопозицией. Кнопка «моя локация» гоняет его по кругу
/// idle → follow → heading → follow; жест по карте роняет обратно в idle.
enum LocationFollowMode {
    /// Не следим — камера свободна
    case idle
    /// Камера идёт за паком, север сверху
    case follow
    /// То же плюс доворот карты по компасу
    case heading
}

final class AppState: ObservableObject {
    @Published var selectedRoute: Route?
    @Published var routeStats: [String: RouteStats] = [:]
    @Published var filter: RouteFilter = .all
    @Published var isLoadingRoute = false
    @Published var scrubberCoordinate: CLLocationCoordinate2D?
    @Published var showDetailPanel = false
    @Published var showAllTrails = false
    @Published var selectedPhotoInfo: SelectedPhotoInfo?
    @Published var showAIAssistant = false
    @Published var isConstructorMode = false
    @Published var constructorWaypoints: [CLLocationCoordinate2D] = []
    @Published var selectedCustomRoute: CustomRoute?
    @Published var showCustomRouteDetail = false
    @Published var showOSMTrails = false
    @Published var showPSSTrails = false
    @Published var isSnapEnabled = true
    @Published var pssRoutes: [PSSRoute] = []
    @Published var selectedPSSRoute: PSSRoute?
    @Published var showPSSRouteDetail = false
    @Published var topoAlpha: Double = 0.0
    @Published var showLayersPanel = false
    /// Основа карты — выбор пользователя переживает перезапуск
    @Published var baseStyle: BaseMapStyle = AppState.storedBaseStyle {
        didSet { UserDefaults.standard.set(baseStyle.rawValue, forKey: AppState.baseStyleKey) }
    }
    @Published var showOfflineMaps = false
    @Published var showAccount = false
    /// Железные дороги и станции — свой слой в топооснове (тоггл в «Слоях»)
    @Published var showRailways = true
    /// Станции, попавшие в кадр. Их рисует интерфейс, а не стиль карты:
    /// так у флажков есть анимация появления, а считаем мы только видимое.
    @Published var stationMarkers: [StationMarker] = []
    /// Хитмап троп — публичные GPS-треки OpenStreetMap (тоггл в «Слоях»)
    @Published var showTrailsHeatmap = false

    /// Историческая карта 1:75 000 (австро-венгерская «Спецкарта», 1900-е–1910-е).
    /// Растровый слой поверх основы — тоггл в «Слоях».
    @Published var showHistMap = false
    /// Плотность гравюры — ползунок в «Слоях». По умолчанию почти непрозрачна,
    /// но сквозь неё читаются современные подписи и горизонтали.
    @Published var histMapAlpha: Double = 0.92
    /// Где показывать ползунок плотности: на карте или в панели «Слои».
    /// Крестик на самом ползунке переключает это же поле.
    @Published var histMapSliderOnMap = false
    /// Есть ли сеть. Нужно хитмапу: его тайлы чужие и офлайн не сохраняются,
    /// а без них Mapbox растягивает старые с мелкого зума — получается мыло.
    @Published private(set) var isOnline = true
    /// Отладочный «режим без сети». Держим здесь, а не в отдельном @State,
    /// чтобы он влиял на isOnline: сама ОС при этом остаётся онлайн, и
    /// NWPathMonitor о выключении сетевого стека Mapbox ничего не знает.
    @Published var forcedOffline = false {
        didSet { updateOnlineState() }
    }
    private var networkAvailable = true
    @Published var routeListExpanded = false
    @Published var mapZoom: Double = 6.5

    // Live track recording
    @Published var isRecording = false
    @Published var activeRecording: TrackRecording? = nil
    @Published var recordingEntryVisible = false   // fullscreen HUD visible
    @Published var liveSegments: [TrackSegment] = []
    @Published var selectedCave: CavePoint? = nil
    @Published var showCaveDetail: Bool = false
    @Published var showCaveLayer = false
    lazy var trackRecorder: TrackRecorder = TrackRecorder()

    // MARK: - Моя локация
    @Published var locationFollowMode: LocationFollowMode = .idle
    /// Ждём первую засечку GPS — кнопка в это время крутит дугу
    @Published var isAwaitingLocationFix = false
    /// Геолокация запрещена в настройках — предлагаем их открыть
    @Published var showLocationDeniedAlert = false
    /// Пользователь вне рамки карты — облёт к нему невозможен
    @Published var showLocationOutOfRegionAlert = false

    private static let baseStyleKey = "baseMapStyle"
    private static var storedBaseStyle: BaseMapStyle {
        BaseMapStyle(rawValue: UserDefaults.standard.string(forKey: baseStyleKey) ?? "") ?? .satellite
    }

    let customRouteStore  = CustomRouteStore.shared
    let cameraFlyRequest     = PassthroughSubject<CLLocationCoordinate2D, Never>()
    let caveFlyCameraRequest = PassthroughSubject<CLLocationCoordinate2D, Never>()
    let flyBoundsRequest     = PassthroughSubject<(sw: CLLocationCoordinate2D, ne: CLLocationCoordinate2D), Never>()
    let zoomOutRequest       = PassthroughSubject<Void, Never>()
    let trackCoordUpdate     = PassthroughSubject<CLLocationCoordinate2D, Never>()
    let sightingDropped      = PassthroughSubject<Sighting, Never>()
    let locateRequest        = PassthroughSubject<Void, Never>()

    var filteredRoutes: [Route] {
        switch filter {
        case .all:       return RouteStore.all
        case .completed: return RouteStore.completedRoutes
        case .planned:   return RouteStore.plannedRoutes
        case .mine:      return []
        }
    }

    var totalKm: Double {
        routeStats.values.reduce(0) { $0 + $1.distance }
    }

    func select(_ route: Route) {
        selectedCustomRoute = nil
        if selectedRoute?.id == route.id {
            showDetailPanel = true
            return
        }
        selectedRoute = route
        showDetailPanel = true
        loadStatsIfNeeded(for: route)
    }

    func selectCustomRoute(_ route: CustomRoute) {
        deselect()
        selectedCustomRoute  = route
        showCustomRouteDetail = false
    }

    func deselectCustomRoute() {
        selectedCustomRoute   = nil
        showCustomRouteDetail = false
    }

    func collapsePanel() {
        showDetailPanel = false
    }

    func expandPanel() {
        showDetailPanel = true
    }

    func deselect() {
        selectedRoute = nil
        showDetailPanel = false
    }

    /// Нажатие на кнопку «моя локация». Разрешение спрашиваем здесь, а не на
    /// старте приложения: так у вопроса есть понятный повод. Сам облёт и
    /// слежение делает карта — см. `MapboxMapView+MyLocation`.
    func requestMyLocation() {
        let permission = LocationPermission.shared
        if permission.isDenied {
            showLocationDeniedAlert = true
        } else if permission.status == .notDetermined {
            permission.request()   // карта долетит по `didGrant`
        } else {
            locateRequest.send()
        }
    }

    func flyCamera(to coordinate: CLLocationCoordinate2D) {
        cameraFlyRequest.send(coordinate)
    }

    func selectPSSRoute(_ route: PSSRoute) {
        selectedPSSRoute = route
        showPSSRouteDetail = true
        if let b = route.bounds { flyBoundsRequest.send(b) }
    }

    func deselectPSSRoute() {
        selectedPSSRoute   = nil
        showPSSRouteDetail = false
    }

    private var statsLoadTask: Task<Void, Never>?

    func loadStatsIfNeeded(for route: Route) {
        guard routeStats[route.id] == nil else { return }
        statsLoadTask?.cancel()
        isLoadingRoute = true
        let routeId = route.id
        statsLoadTask = Task.detached(priority: .userInitiated) { [weak self] in
            let stats = GPXLoader.loadStats(for: route)
            guard !Task.isCancelled else { return }
            await MainActor.run { [weak self] in
                guard self?.selectedRoute?.id == routeId else { return }
                if let stats { self?.routeStats[routeId] = stats }
                self?.isLoadingRoute = false
            }
        }
    }

    /// Разбор всех GPX при старте.
    ///
    /// Раньше на каждый маршрут заводилась своя `Task.detached(priority: .background)`.
    /// Два изъяна: `.background` — самый низкий QoS, система вправе отложить
    /// его надолго, и под нагрузкой (карта тянет тайлы, идёт докачка набора)
    /// разбор растягивался на минуты; а 27 задач разом забивали пул, поэтому
    /// не было и первых результатов — список пустовал до самого конца.
    ///
    /// Теперь одна очередь на `.utility` с ограничением в 4 параллельных
    /// разбора, в порядке списка: верхние строки заполняются сразу, а фон
    /// не конкурирует сам с собой.
    func preloadAllStats() {
        guard !preloadStarted else { return }
        preloadStarted = true

        let pending = RouteStore.all.filter { routeStats[$0.id] == nil }
        guard !pending.isEmpty else { return }

        Task.detached(priority: .utility) { [weak self] in
            await withTaskGroup(of: (String, RouteStats?).self) { group in
                var next  = 0
                let limit = min(4, ProcessInfo.processInfo.activeProcessorCount)

                func enqueueNext() {
                    guard next < pending.count else { return }
                    let route = pending[next]
                    next += 1
                    group.addTask { (route.id, GPXLoader.loadStats(for: route)) }
                }

                for _ in 0..<limit { enqueueNext() }

                while let (routeId, stats) = await group.next() {
                    if let stats {
                        await MainActor.run { [weak self] in
                            self?.routeStats[routeId] = stats
                        }
                    }
                    enqueueNext()
                }
            }
        }
    }

    // MARK: - Recording

    /// `onAppear` у корневого экрана срабатывает не единожды — разбор
    /// запускаем только с первого раза.
    private var preloadStarted = false

    private var cancellables = Set<AnyCancellable>()
    private var recordingCancellables = Set<AnyCancellable>()

    init() {
        // Deselect a custom route when it's removed from the store
        customRouteStore.$routes
            .receive(on: DispatchQueue.main)
            .sink { [weak self] routes in
                guard let self, let sel = self.selectedCustomRoute else { return }
                if !routes.contains(where: { $0.id == sel.id }) {
                    self.deselectCustomRoute()
                }
            }
            .store(in: &cancellables)

        // Auto-expand cave panel when a cave is selected
        $selectedCave
            .receive(on: DispatchQueue.main)
            .sink { [weak self] cave in
                if cave != nil { self?.showCaveDetail = true }
            }
            .store(in: &cancellables)

        startNetworkMonitor()
    }

    private let networkMonitor = NWPathMonitor()

    /// Следим за связью и гасим хитмап, когда её нет: его тайлы приходят
    /// из сети, и без неё слой превращается в размытые пятна поверх карты.
    private func startNetworkMonitor() {
        networkMonitor.pathUpdateHandler = { [weak self] path in
            let available = path.status == .satisfied
            DispatchQueue.main.async {
                guard let self else { return }
                self.networkAvailable = available
                self.updateOnlineState()
            }
        }
        networkMonitor.start(queue: DispatchQueue(label: "network-monitor"))
    }

    private func updateOnlineState() {
        let online = networkAvailable && !forcedOffline
        guard online != isOnline else { return }
        isOnline = online
        if !online { showTrailsHeatmap = false }
    }

    func startRecording(linkedRouteId: String? = nil) {
        trackRecorder.requestPermission()
        trackRecorder.startRecording(linkedRouteId: linkedRouteId)
        activeRecording = trackRecorder.recording
        liveSegments = []
        isRecording = true

        // Forward live coordinates to map
        trackRecorder.$currentLocation
            .compactMap { $0 }
            .receive(on: DispatchQueue.main)
            .sink { [weak self] coord in self?.trackCoordUpdate.send(coord) }
            .store(in: &recordingCancellables)

        withAnimation(.spring(response: 0.55, dampingFraction: 0.78)) {
            recordingEntryVisible = true
        }
    }

    func stopRecording() {
        let finished = trackRecorder.stopRecording()
        recordingCancellables.removeAll()
        isRecording = false
        activeRecording = nil
        liveSegments = []
        withAnimation(.spring(response: 0.45, dampingFraction: 0.82)) {
            recordingEntryVisible = false
        }
        if finished.coordinates.count > 5 {
            saveRecordingAsCustomRoute(finished)
        }
    }

    func addSighting(_ type: SightingType) {
        trackRecorder.addSighting(type)
        if let s = trackRecorder.recording.sightings.last {
            sightingDropped.send(s)
        }
    }

    func addPhoto(_ image: UIImage) {
        guard let photo = trackRecorder.addPhoto(image) else { return }
        let sighting = Sighting(type: .waypoint, coordinate: photo.coordinate.clCoordinate)
        // reuse sightingDropped as photo pin signal — attach photo flag via description hack
        _ = photo
        sightingDropped.send(sighting)
    }

    func markSegment() {
        if let seg = trackRecorder.markSegment() {
            liveSegments.append(seg)
        }
    }

    private func saveRecordingAsCustomRoute(_ recording: TrackRecording) {
        let coords = recording.clCoordinates
        guard !coords.isEmpty else { return }
        let fmt = DateFormatter()
        fmt.dateStyle = .medium
        fmt.locale = Locale(identifier: "ru_RU")
        let name = "Трек \(fmt.string(from: recording.startDate))"
        if let route = CustomRoute.from(coordinates: coords, elevations: recording.elevations, name: name) {
            customRouteStore.add(route)
        }
    }
}
