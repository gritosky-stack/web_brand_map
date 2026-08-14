import Foundation
import Combine
import CoreLocation
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
    /// Хитмап троп — публичные GPS-треки OpenStreetMap (тоггл в «Слоях»)
    @Published var showTrailsHeatmap = false
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

    func preloadAllStats() {
        for route in RouteStore.all {
            let routeId = route.id
            if routeStats[routeId] != nil { continue }
            Task.detached(priority: .background) { [weak self] in
                let stats = GPXLoader.loadStats(for: route)
                await MainActor.run { [weak self] in
                    if let stats { self?.routeStats[routeId] = stats }
                }
            }
        }
    }

    // MARK: - Recording

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
