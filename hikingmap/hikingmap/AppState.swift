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

/// Отрезок рисуемого маршрута: путь от предыдущей опорной точки к следующей.
/// По тропам, если роутер их нашёл, иначе по прямой.
struct ConstructorLeg: Identifiable, Equatable {
    enum Kind {
        /// Роутер ещё думает — на карте пока прямая
        case pending
        /// Легло на тропы
        case trail
        /// Троп рядом нет, идём напрямик
        case straight
    }

    let id = UUID()
    /// Включая обе опорные точки
    var path: [CLLocationCoordinate2D]
    var kind: Kind
    var distanceMeters: Double
    /// Высоты по точкам `path`. От BRouter приезжают вместе с геометрией,
    /// иначе снимаем с рельефа карты. nil — высот нет, набор не показываем.
    var elevations: [Double]?

    /// Геометрию сравниваем по длине: она меняется вместе с путём, а
    /// `CLLocationCoordinate2D` сам по себе не `Equatable`.
    static func == (lhs: ConstructorLeg, rhs: ConstructorLeg) -> Bool {
        lhs.id == rhs.id && lhs.kind == rhs.kind && lhs.distanceMeters == rhs.distanceMeters
    }
}

/// Что показывает верхняя шкала, пока ведут ползунок по профилю высот.
/// Участок (`segmentKm`/`segmentGrade`) — то же, что «Segment length» и
/// «Type» в подсказке brouter.de: длина куска постоянного уклона под пальцем
/// и сам этот уклон. nil — профиль вырожденный, участков не построить.
struct ScrubberReadout: Equatable {
    let elevationM: Double
    let distanceKm: Double
    let totalKm: Double
    let segmentKm: Double?
    let segmentGrade: Double?
}

/// Снимок конструктора для «отменить/вернуть». Храним состояние целиком:
/// отрезков немного, зато откат не зависит от того, какое действие его
/// породило, — а значит и новые действия не придётся учить откатываться.
struct ConstructorSnapshot {
    let waypoints: [CLLocationCoordinate2D]
    let legs: [ConstructorLeg]
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
    /// Ползунок по профилю высот ведут прямо сейчас. Пока ведут — интерфейс
    /// сверху прячется, а карточка становится почти прозрачной: иначе не
    /// видно, где эта точка на карте, а смотрят именно на неё.
    @Published var isScrubbingProfile = false
    @Published var scrubberReadout: ScrubberReadout?
    /// Где на экране блок профиля — карта не должна прятать бегунок под ним
    @Published var profileBlockFrame: CGRect = .zero
    /// Какой кусок экрана занимает нижняя карточка. По нему карта считает
    /// свободную часть кадра и держит в ней маршрут (`ensureRouteVisible`).
    @Published var bottomPanelFrame: CGRect = .zero
    /// Прореженная геометрия маршрута, по которому ведут: по ней карта
    /// подбирает кадр, когда бегунок уезжает из видимой части
    var scrubRouteCoordinates: [CLLocationCoordinate2D] = []
    /// Геометрия участка, выделенного на графике. Пока выделение живо, карта
    /// держит кадр по нему, а не по всему маршруту — иначе первое же ведение
    /// пальцем внутри выделения отбрасывало камеру на весь маршрут.
    var profileSelectionCoordinates: [CLLocationCoordinate2D] = []

    /// Конец скраба: снять и метку с карты, и режим прозрачности
    func endProfileScrub() {
        isScrubbingProfile = false
        scrubberReadout    = nil
        scrubberCoordinate = nil
    }
    @Published var showDetailPanel = false
    @Published var showAllTrails = false
    @Published var selectedPhotoInfo: SelectedPhotoInfo?
    @Published var showAIAssistant = false
    @Published var isConstructorMode = false
    /// Опорные точки — то, куда ткнули пальцем (с поправкой на притяжение)
    @Published var constructorWaypoints: [CLLocationCoordinate2D] = []
    /// Что между ними проложено. `constructorLegs[i]` ведёт из точки `i` в `i+1`.
    @Published var constructorLegs: [ConstructorLeg] = []
    /// История для «отменить» и, после отката, для «вернуть»
    @Published private(set) var constructorUndoStack: [ConstructorSnapshot] = []
    @Published private(set) var constructorRedoStack: [ConstructorSnapshot] = []
    /// Экранная точка последней опоры и центра карты — от них рисуется
    /// «резинка» до прицела. Обновляет карта на каждом кадре камеры.
    @Published var constructorAnchorScreen: CGPoint?
    @Published var mapCenterScreen: CGPoint?
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
    /// Правила прокладки по тропам («Нарисовать» → BRouter) — выбор
    /// пользователя переживает перезапуск, как и основа карты
    @Published var routingPreferences: RoutingPreferences = AppState.storedRoutingPreferences {
        didSet { AppState.storeRoutingPreferences(routingPreferences) }
    }
    @Published var showRoutingPreferences = false
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
    /// Стоит ли сейчас рельеф. Выше `Coordinator.terrainCutoffZoom` он
    /// снимается ради резкости — на устройстве это видно в отладочной плашке,
    /// иначе не отличить «сняли нарочно» от «рельеф отвалился».
    @Published var isTerrainOn = true
    #if DEBUG
    /// Чем задано преувеличение рельефа прямо сейчас: выражением по зуму,
    /// константой (запасной путь) или ничем
    @Published var debugTerrainKind = "—"
    #endif

    // Live track recording
    @Published var isRecording = false
    @Published var activeRecording: TrackRecording? = nil
    @Published var recordingEntryVisible = false   // fullscreen HUD visible
    @Published var liveSegments: [TrackSegment] = []
    @Published var selectedCave: CavePoint? = nil
    @Published var showCaveDetail: Bool = false
    @Published var showCaveLayer = false

    // MARK: - Объекты на карте
    /// Вода и укрытия — раздельно: воду ищут по ходу дня, крышу подбирают
    /// заранее, и включать их вместе почти никогда не нужно.
    /// Крутизна склонов — накладка поверх любой основы, а не своя основа:
    /// вопрос «тут можно срезать или там стенка» одинаково возникает и на
    /// спутнике, и на топооснове, и на гравюре.
    @Published var showSlope = false

    @Published var showWaterLayer = false
    @Published var showShelterLayer = false
    @Published var selectedMapPoint: MapPoint? = nil

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

    private static let routingPreferencesKey = "routingPreferences"
    private static var storedRoutingPreferences: RoutingPreferences {
        guard let data = UserDefaults.standard.data(forKey: routingPreferencesKey),
              let decoded = try? JSONDecoder().decode(RoutingPreferences.self, from: data)
        else { return .default }
        return decoded
    }
    private static func storeRoutingPreferences(_ value: RoutingPreferences) {
        guard let data = try? JSONEncoder().encode(value) else { return }
        UserDefaults.standard.set(data, forKey: routingPreferencesKey)
    }

    let customRouteStore  = CustomRouteStore.shared
    let cameraFlyRequest     = PassthroughSubject<CLLocationCoordinate2D, Never>()
    let caveFlyCameraRequest = PassthroughSubject<CLLocationCoordinate2D, Never>()
    /// Обзорный облёт к bbox — шлёт выбор PSS-маршрута. Кадр берётся с
    /// запасом и с наклоном: смотрят на маршрут целиком.
    let flyBoundsRequest     = PassthroughSubject<(sw: CLLocationCoordinate2D, ne: CLLocationCoordinate2D), Never>()
    /// Облёт вплотную к куску маршрута — выделение участка на графике высот
    /// (`ProfileScrub.focusSegment` → `MapboxMapView.flyToSegment`). Отдельно
    /// от обзорного: у него свой кадр, а на одном общем оба обработчика
    /// стартовали разом и камера дёргалась.
    let flySegmentRequest    = PassthroughSubject<(sw: CLLocationCoordinate2D, ne: CLLocationCoordinate2D), Never>()
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

    // MARK: - Конструктор маршрута

    /// Отрезки троп для офлайн-прокладки и притяжения точки: маршруты PSS из
    /// бандла плюс тропы из загруженных тайлов. Держит их карта, отдаёт
    /// замыканием вместе с «поколением» — копировать сотню тысяч пар
    /// в состояние на каждый тап незачем.
    var trailSegmentsProvider: (() -> ([TrailSnapService.Segment], Int))?

    /// Высота рельефа под точкой — отдаёт карта (DEM, тот же, что под `setTerrain`)
    var terrainElevationProvider: ((CLLocationCoordinate2D) -> Double?)?

    /// Нажали «Шаг»: точку ставит карта — по прицелу в центре кадра
    let constructorStepRequest = PassthroughSubject<Void, Never>()

    /// Вся нарисованная линия — склейка отрезков, а не опорные точки.
    var constructorPath: [CLLocationCoordinate2D] {
        guard !constructorLegs.isEmpty else { return constructorWaypoints }
        var path: [CLLocationCoordinate2D] = []
        for leg in constructorLegs {
            path.append(contentsOf: path.isEmpty ? leg.path : Array(leg.path.dropFirst()))
        }
        return path
    }

    var constructorDistanceKm: Double {
        constructorLegs.reduce(0) { $0 + $1.distanceMeters } / 1000
    }

    /// Хоть один отрезок ещё прокладывается
    var constructorIsRouting: Bool { constructorLegs.contains { $0.kind == .pending } }

    /// Хоть один отрезок лёг по прямой — троп там не нашлось
    var constructorHasStraightLegs: Bool { constructorLegs.contains { $0.kind == .straight } }

    /// Высоты вдоль всей нарисованной линии. nil, если хоть у одного отрезка
    /// их нет: показывать набор по половине маршрута — врать.
    var constructorElevationProfile: [Double]? {
        guard !constructorLegs.isEmpty else { return nil }
        var profile: [Double] = []
        for leg in constructorLegs {
            guard let elevations = leg.elevations, elevations.count == leg.path.count else { return nil }
            profile.append(contentsOf: profile.isEmpty ? elevations : Array(elevations.dropFirst()))
        }
        return profile.count >= 2 ? profile : nil
    }

    var constructorAscentM: Double? { AppState.climb(constructorElevationProfile)?.ascent }
    var constructorDescentM: Double? { AppState.climb(constructorElevationProfile)?.descent }

    /// Набор и сброс по профилю. Сглаживаем скользящим средним и режем мелочь,
    /// как `GPXParser`: и рельеф карты, и высоты роутера шумят на пару метров,
    /// а из этого шума за десять километров набирается лишняя сотня.
    static func climb(_ profile: [Double]?) -> (ascent: Double, descent: Double)? {
        guard let profile, profile.count >= 2 else { return nil }
        let half = 4
        let smoothed = profile.indices.map { i -> Double in
            let lo = max(0, i - half), hi = min(profile.count - 1, i + half)
            return profile[lo...hi].reduce(0, +) / Double(hi - lo + 1)
        }
        var ascent = 0.0, descent = 0.0
        for i in 1..<smoothed.count {
            let d = smoothed[i] - smoothed[i - 1]
            if d > 0.3 { ascent += d } else if d < -0.3 { descent -= d }
        }
        return (ascent, descent)
    }

    // MARK: Действия конструктора

    var canUndoConstructor: Bool { !constructorUndoStack.isEmpty }
    var canRedoConstructor: Bool { !constructorRedoStack.isEmpty }

    /// Ставит точку и сразу прокладывает к ней путь от предыдущей. Пока роутер
    /// думает, отрезок показывается прямой — ждать ответа с пустой картой хуже.
    func addConstructorWaypoint(_ point: CLLocationCoordinate2D) {
        recordConstructorHistory()
        let previous = constructorWaypoints.last
        constructorWaypoints.append(point)
        guard let previous else { return }

        let straight = [previous, point]
        let leg = ConstructorLeg(path: straight,
                                 kind: isSnapEnabled ? .pending : .straight,
                                 distanceMeters: TrailRouter.length(of: straight))
        constructorLegs.append(leg)
        guard isSnapEnabled else {
            fillLegElevations(at: constructorLegs.count - 1)
            return
        }
        routeLeg(leg.id, from: previous, to: point)
    }

    private func routeLeg(_ id: UUID, from: CLLocationCoordinate2D, to: CLLocationCoordinate2D) {
        let (segments, token) = trailSegmentsProvider?() ?? ([], 0)
        let online = isOnline
        let preferences = routingPreferences
        Task { [weak self] in
            let outcome = await TrailRouter.route(from: from, to: to,
                                                  segments: segments, segmentsToken: token,
                                                  allowNetwork: online, preferences: preferences)
            guard let self else { return }
            await MainActor.run { self.applyLegOutcome(id, outcome, from: from, to: to) }
        }
    }

    /// Откат последнего действия. Текущее состояние уезжает в «вернуть».
    func undoConstructor() {
        guard let previous = constructorUndoStack.popLast() else { return }
        constructorRedoStack.append(currentConstructorSnapshot())
        apply(previous)
    }

    func redoConstructor() {
        guard let next = constructorRedoStack.popLast() else { return }
        constructorUndoStack.append(currentConstructorSnapshot())
        apply(next)
    }

    func resetConstructor() {
        constructorWaypoints  = []
        constructorLegs       = []
        constructorUndoStack  = []
        constructorRedoStack  = []
        constructorAnchorScreen = nil
    }

    /// Глубину истории ограничиваем: маршрут на сотню точек с геометрией
    /// каждого отрезка — уже мегабайты, а дальше десятого шага никто не откатывает.
    private static let maxConstructorHistory = 60

    private func currentConstructorSnapshot() -> ConstructorSnapshot {
        ConstructorSnapshot(waypoints: constructorWaypoints, legs: constructorLegs)
    }

    /// Запоминает состояние перед изменением. Любое новое действие обрубает
    /// «вперёд» — как в любом редакторе.
    private func recordConstructorHistory() {
        constructorUndoStack.append(currentConstructorSnapshot())
        if constructorUndoStack.count > AppState.maxConstructorHistory {
            constructorUndoStack.removeFirst()
        }
        constructorRedoStack.removeAll()
    }

    private func apply(_ snapshot: ConstructorSnapshot) {
        constructorWaypoints = snapshot.waypoints
        constructorLegs      = snapshot.legs
        // В снимок мог попасть отрезок, который тогда ещё прокладывался.
        // Задача, считавшая его, давно завершилась и в это состояние уже
        // не вернётся — просим маршрут заново.
        for leg in constructorLegs where leg.kind == .pending {
            guard let from = leg.path.first, let to = leg.path.last else { continue }
            routeLeg(leg.id, from: from, to: to)
        }
    }

    private func applyLegOutcome(_ id: UUID, _ outcome: TrailRouteOutcome,
                                 from: CLLocationCoordinate2D, to: CLLocationCoordinate2D) {
        // Отрезок могли отменить или начать заново, пока роутер думал
        guard let idx = constructorLegs.firstIndex(where: { $0.id == id }) else { return }

        switch outcome {
        case .straight:
            constructorLegs[idx].path = [from, to]
            constructorLegs[idx].kind = .straight
            constructorLegs[idx].elevations = nil

        case .trails(var geometry, var elevations):
            guard let head = geometry.first, let tail = geometry.last else {
                constructorLegs[idx].path = [from, to]
                constructorLegs[idx].kind = .straight
                constructorLegs[idx].elevations = nil
                return
            }
            if elevations?.count != geometry.count { elevations = nil }
            // Начало отрезка не двигаем: на нём уже висит предыдущий. Первую
            // точку маршрута — можно, к ней ничего не пришито.
            if idx == 0, TrailRouter.meters(head, from) <= TrailRouter.anchorSnapMeters {
                constructorWaypoints[0] = head
            } else if TrailRouter.meters(head, from) > 1 {
                geometry.insert(from, at: 0)
                // У «подводки» своей высоты нет — берём соседнюю: это метры
                // до тропы, на набор они не влияют.
                if let first = elevations?.first { elevations?.insert(first, at: 0) }
            }
            // Конец: роутер сел на тропу рядом — принимаем притяжение, это оно
            // и есть. Далеко или отрезок уже не последний — дотягиваем прямой.
            let endIndex = idx + 1
            let isLastLeg = idx == constructorLegs.count - 1
                && endIndex == constructorWaypoints.count - 1
            if isLastLeg, TrailRouter.meters(tail, to) <= TrailRouter.anchorSnapMeters {
                constructorWaypoints[endIndex] = tail
            } else if TrailRouter.meters(tail, to) > 1 {
                geometry.append(to)
                if let last = elevations?.last { elevations?.append(last) }
            }
            constructorLegs[idx].path = geometry
            constructorLegs[idx].kind = .trail
            constructorLegs[idx].elevations = elevations
        }
        constructorLegs[idx].distanceMeters = TrailRouter.length(of: constructorLegs[idx].path)
        fillLegElevations(at: idx)
    }

    /// Высоты, которых не дал роутер, снимаем с рельефа карты — того же DEM,
    /// на котором стоит `setTerrain`. Если хоть одна точка не прогружена,
    /// оставляем nil: набор по кускам всё равно врёт.
    private func fillLegElevations(at index: Int) {
        guard constructorLegs.indices.contains(index),
              constructorLegs[index].elevations == nil,
              let sample = terrainElevationProvider
        else { return }
        var elevations: [Double] = []
        elevations.reserveCapacity(constructorLegs[index].path.count)
        for coordinate in constructorLegs[index].path {
            guard let value = sample(coordinate) else { return }
            elevations.append(value)
        }
        constructorLegs[index].elevations = elevations
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
