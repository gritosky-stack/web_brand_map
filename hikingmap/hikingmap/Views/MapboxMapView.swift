import SwiftUI
import MapboxMaps
import CoreLocation
import Combine

struct MapboxMapView: UIViewRepresentable {
    @EnvironmentObject var appState: AppState

    func makeCoordinator() -> Coordinator {
        Coordinator(appState: appState)
    }

    func makeUIView(context: Context) -> MapView {
        // Фиксируем pixelRatio — иначе при SwiftUI-анимациях layout'а
        // Mapbox пересчитывает contentScale и спамит
        // "MetalView content scale factor 3.0000000000000004".
        // Глифы растеризуем на устройстве: своя топооснова использует шрифты,
        // которых нет ни в одном стиле Mapbox, а значит скачать их было бы
        // неоткуда — и офлайн подписи просто не собрались бы.
        let mapOptions = MapOptions(
            pixelRatio: UIScreen.main.scale,
            glyphsRasterizationOptions: GlyphsRasterizationOptions(
                rasterizationMode: .allGlyphsRasterizedLocally
            )
        )
        let initOptions = MapInitOptions(mapOptions: mapOptions,
                                         styleURI: Coordinator.styleURI(for: appState.baseStyle))
        let mapView     = MapView(frame: .zero, mapInitOptions: initOptions)
        mapView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        mapView.contentScaleFactor = UIScreen.main.scale

        mapView.mapboxMap.setCamera(to: CameraOptions(
            center: CLLocationCoordinate2D(latitude: 44.2107, longitude: 20.9029),
            zoom: 6.5, pitch: 0
        ))

        try? mapView.mapboxMap.setCameraBounds(with: CameraBoundsOptions(
            bounds: Coordinator.regionBounds, maxZoom: 18, minZoom: 5
        ))

        context.coordinator.mapView = mapView
        context.coordinator.loadBaseStyle(appState.baseStyle, on: mapView)
        context.coordinator.setupMyLocation(on: mapView)

        // Именно observe, а не observeNext: событие приходит и при смене основы карты,
        // когда стиль перезагружается и все наши слои нужно ставить заново.
        mapView.mapboxMap.onStyleLoaded.observe { [weak c = context.coordinator] _ in
            c?.onStyleLoaded()
        }.store(in: &context.coordinator.cancellables)

        // observe, а не observeNext: observeNext срабатывает ровно один раз,
        // из-за чего зум в отладочной плашке навсегда застревал на стартовом
        mapView.mapboxMap.onCameraChanged.observe { [weak c = context.coordinator, weak mapView] _ in
            let zoom = Double(mapView?.mapboxMap.cameraState.zoom ?? 6.5)
            // Публикуем только заметное изменение — иначе @Published летит
            // на каждый кадр камеры и триггерит re-render всех подписчиков.
            guard let coord = c, abs(zoom - coord.lastPublishedZoom) >= 0.1 else { return }
            coord.lastPublishedZoom = zoom
            DispatchQueue.main.async { coord.appState.mapZoom = zoom }
        }.store(in: &context.coordinator.cancellables)

        // Позиции флажков станций пересчитываем на каждом кадре камеры — иначе
        // они будут отставать от карты. Сам список станций обновляется реже,
        // по окончании движения: запрос к тайлам куда дороже проекции точки.
        mapView.mapboxMap.onCameraChanged.observe { [weak c = context.coordinator] _ in
            c?.repositionStations()
            // «Резинка» до прицела тянется за камерой — считаем каждый кадр
            c?.updateConstructorAim()
        }.store(in: &context.coordinator.cancellables)

        mapView.mapboxMap.onMapIdle.observe { [weak c = context.coordinator] _ in
            c?.refreshStations()
            // Пока рисуют маршрут — подбираем тропы из тайлов под новым кадром
            c?.refreshTileTrailSegments()
        }.store(in: &context.coordinator.cancellables)

        let tap = UITapGestureRecognizer(target: context.coordinator,
                                         action: #selector(Coordinator.handleTap(_:)))
        tap.cancelsTouchesInView = false
        // Двойной тап и «щипок» зумом тоже кончаются касанием — без этого
        // приближение по двойному тапу ставило бы точку, да ещё и две
        tap.require(toFail: mapView.gestures.doubleTapToZoomInGestureRecognizer)
        tap.require(toFail: mapView.gestures.doubleTouchToZoomOutGestureRecognizer)
        tap.require(toFail: mapView.gestures.quickZoomGestureRecognizer)
        mapView.addGestureRecognizer(tap)
        // Остальные жесты (сдвиг, зум, поворот, наклон) отслеживаем сами:
        // после них система всё равно шлёт одиночный тап
        mapView.gestures.delegate = context.coordinator


        return mapView
    }

    func updateUIView(_ mapView: MapView, context: Context) {}
}

// MARK: - Coordinator
final class Coordinator: NSObject {
    let appState: AppState
    weak var mapView: MapView?
    var cancellables = Set<AnyCancellable>()
    var isStyleLoaded = false
    var drawnRouteId: String?
    /// Какой свой маршрут сейчас показан. Нужен, чтобы отличить смену выбора
    /// от обычного пересчёта слоя: подписка дёргается ещё и на смену фильтра
    /// и на правки в хранилище, а камерой при этом двигать нельзя.
    var shownCustomRouteId: String?
    var scrubberManager: PointAnnotationManager?
    var sightingManager: PointAnnotationManager?
    var pssSnapSegments: [TrailSnapService.Segment] = []
    /// Тропы из загруженных векторных тайлов. Их же используем и для
    /// притяжения точки, и как офлайн-граф для прокладки по тропам.
    var osmTrailSegments: [TrailSnapService.Segment] = []
    /// PSS и тайловые тропы вместе — то, что видит роутер
    var routingSegments: [TrailSnapService.Segment] = []
    /// Поколение набора: по нему кэшируется собранный граф
    var routingSegmentsToken = 0
    var lastTrailQueryCenter: CLLocationCoordinate2D?
    var lastTrailQueryZoom: Double = 0
    var lastTrailQueryTime = Date.distantPast
    /// Сколько жестов карты идёт прямо сейчас и когда закончился последний.
    /// Тап, прилетевший на их фоне, точку не ставит.
    var activeGestures = 0
    var lastGestureEnd = Date.distantPast
    /// Камера сейчас едет к бегунку — второй раз не дёргаем
    var isFramingScrub = false
    /// Сколько раз подряд тайлы ответили пусто
    var trailQueryRetries = 0
    static let maxTrailQueryRetries = 6
    var liveTrackCoords: [CLLocationCoordinate2D] = []
    var lastPublishedZoom: Double = 6.5
    /// Моя локация: пак включаем лениво, при первом запросе с разрешением
    var isPuckEnabled = false
    /// Ожидание первой засечки GPS после выдачи разрешения
    var locationFixSubscription: AnyCancelable?
    /// Активный стейт слежения — SDK держит его слабо, ссылка нужна нам
    var followState: FollowPuckViewportState?
    /// Первую загрузку стиля сопровождаем облётом, перезагрузку при смене
    /// основы карты — нет, иначе камера прыгает под руками.
    var isFirstStyleLoad = true

    /// У каждой основы свой стиль — это важно не только для вида.
    ///
    /// Раньше обе грузили `satellite-streets`, а топооснова была его перекраской.
    /// Mapbox на повторную загрузку того же стиля не делает ничего: `onStyleLoaded`
    /// не срабатывал, слои не пересобирались, а сброшенный флаг `isStyleLoaded`
    /// глушил заодно тропы, ПСС и пещеры. Переключение просто зависало.
    ///
    /// Перекраска была нужна ради офлайна: у satellite-streets `composite` состоит
    /// из одного тайлсета, и скачанные пачки к нему подходили. Сейчас офлайн живёт
    /// на своих тайлах, так что запасной основе можно быть обычным Outdoors.
    /// Рамка, за которую камеру не пускает `setCameraBounds`. Держим её здесь,
    /// а не по месту вызова: облёту к пользователю нужно знать ту же рамку,
    /// иначе он честно летит к точке вне её, Mapbox прижимает камеру к углу
    /// рамки — и человек оказывается в Адриатическом море, ничего не поняв.
    static let regionBounds = CoordinateBounds(
        southwest: CLLocationCoordinate2D(latitude: 41.0, longitude: 17.2),
        northeast: CLLocationCoordinate2D(latitude: 47.4, longitude: 24.4)
    )

    static func styleURI(for base: BaseMapStyle) -> StyleURI {
        switch base {
        case .satellite: return .satelliteStreets
        case .topo:      return .outdoors
        }
    }

    /// Грузит основу карты. На топооснове предпочитаем свои тайлы, если они
    /// скачаны: там есть горизонтали и куда больше троп, чем в streets-v8.
    /// Если своих тайлов нет — откатываемся на перекрашенный satellite-streets.
    var usesOwnTopoTiles: Bool {
        appState.baseStyle == .topo && TopoTiles.isAvailable
    }

    func loadBaseStyle(_ base: BaseMapStyle, on mapView: MapView) {
        if base == .topo, let json = TopoTiles.styleJSON() {
            mapView.mapboxMap.loadStyle(json)
        } else {
            mapView.mapboxMap.loadStyle(Coordinator.styleURI(for: base))
        }
    }

    init(appState: AppState) {
        self.appState = appState
        super.init()

        // Тропы для прокладки живут здесь, у карты: PSS из бандла плюс то,
        // что нашлось в загруженных тайлах
        appState.trailSegmentsProvider = { [weak self] in
            guard let self else { return ([], 0) }
            return (self.routingSegments, self.routingSegmentsToken)
        }

        // Высоты для набора/сброса в конструкторе — с того же DEM, что под рельефом
        appState.terrainElevationProvider = { [weak self] coordinate in
            self?.mapView?.mapboxMap.elevation(at: coordinate)
        }

        appState.$scrubberCoordinate
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in self?.keepScrubberVisible() }
            .store(in: &cancellables)

        appState.constructorStepRequest
            .receive(on: DispatchQueue.main)
            .sink { [weak self] in self?.placeWaypointAtAim() }
            .store(in: &cancellables)

        // Выделение участка на графике высот (см. ProfileScrub.focusSegment)
        appState.flyBoundsRequest
            .receive(on: DispatchQueue.main)
            .sink { [weak self] bounds in self?.flyToBounds(sw: bounds.sw, ne: bounds.ne) }
            .store(in: &cancellables)

        appState.$selectedRoute
            .removeDuplicates()
            .receive(on: DispatchQueue.main)
            .sink { [weak self] route in self?.onSelectedRouteChanged(route) }
            .store(in: &cancellables)

        appState.$routeStats
            .receive(on: DispatchQueue.main)
            .sink { [weak self] stats in self?.onStatsUpdated(stats) }
            .store(in: &cancellables)

        appState.$filter
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in self?.refreshMarkers() }
            .store(in: &cancellables)

        appState.$routeStats
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in self?.refreshMarkers() }
            .store(in: &cancellables)

        appState.$scrubberCoordinate
            .receive(on: DispatchQueue.main)
            .sink { [weak self] coord in self?.updateScrubberAnnotation(coord) }
            .store(in: &cancellables)

        Publishers.CombineLatest(appState.$showAllTrails, appState.$routeStats)
            .receive(on: DispatchQueue.main)
            .sink { [weak self] showAll, stats in self?.updateAllTrails(showAll: showAll, stats: stats) }
            .store(in: &cancellables)

        appState.cameraFlyRequest
            .receive(on: DispatchQueue.main)
            .sink { [weak self] coord in
                guard let self, let mapView = self.mapView else { return }
                self.stopFollowing()
                mapView.camera.ease(to: CameraOptions(center: coord, zoom: 15, pitch: 35),
                                    duration: 1.2, curve: .easeInOut, completion: nil)
            }
            .store(in: &cancellables)

        appState.caveFlyCameraRequest
            .receive(on: DispatchQueue.main)
            .sink { [weak self] coord in
                guard let self, let mapView = self.mapView else { return }
                self.stopFollowing()
                mapView.camera.ease(to: CameraOptions(center: coord, zoom: 15, bearing: 20, pitch: 45),
                                    duration: 1.4, curve: .easeInOut, completion: nil)
            }
            .store(in: &cancellables)

        appState.flyBoundsRequest
            .receive(on: DispatchQueue.main)
            .sink { [weak self] bounds in
                guard let self, let mapView = self.mapView else { return }
                self.stopFollowing()
                let corners = [
                    bounds.sw,
                    CLLocationCoordinate2D(latitude: bounds.sw.latitude, longitude: bounds.ne.longitude),
                    bounds.ne,
                    CLLocationCoordinate2D(latitude: bounds.ne.latitude, longitude: bounds.sw.longitude)
                ]
                let padding = UIEdgeInsets(top: 80, left: 40, bottom: UIScreen.main.bounds.height * 0.25, right: 40)
                if let cam = try? mapView.mapboxMap.camera(
                    for: corners,
                    camera: CameraOptions(bearing: 0, pitch: 20),
                    coordinatesPadding: padding, maxZoom: 13, offset: nil
                ) {
                    mapView.camera.ease(to: cam, duration: 1.2, curve: .easeInOut, completion: nil)
                }
            }
            .store(in: &cancellables)

        appState.$topoAlpha
            .receive(on: DispatchQueue.main)
            .sink { [weak self] alpha in self?.updateTopoOpacity(alpha) }
            .store(in: &cancellables)

        appState.$showTrailsHeatmap
            .receive(on: DispatchQueue.main)
            .sink { [weak self] show in self?.updateTrailsHeatmap(show) }
            .store(in: &cancellables)

        appState.$showHistMap
            .receive(on: DispatchQueue.main)
            .sink { [weak self] show in self?.updateHistMap(show) }
            .store(in: &cancellables)

        appState.$histMapAlpha
            .receive(on: DispatchQueue.main)
            .sink { [weak self] alpha in self?.setHistMapOpacity(alpha) }
            .store(in: &cancellables)

        appState.$isOnline
            .removeDuplicates()
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in
                guard let self, appState.showHistMap else { return }
                updateHistMap(true)
            }
            .store(in: &cancellables)

        appState.$isRecording
            .receive(on: DispatchQueue.main)
            .sink { [weak self] recording in
                guard let self else { return }
                if !recording {
                    self.liveTrackCoords = []
                    self.clearLiveTrack()
                }
            }
            .store(in: &cancellables)

        appState.trackCoordUpdate
            .receive(on: DispatchQueue.main)
            .sink { [weak self] coord in self?.appendLiveTrackCoord(coord) }
            .store(in: &cancellables)

        appState.sightingDropped
            .receive(on: DispatchQueue.main)
            .sink { [weak self] sighting in self?.addSightingPin(sighting) }
            .store(in: &cancellables)

        appState.$showCaveLayer
            .receive(on: DispatchQueue.main)
            .sink { [weak self] show in
                guard let self, let mapView, isStyleLoaded else { return }
                self.toggleCaveLayer(show, on: mapView)
            }
            .store(in: &cancellables)

        appState.$showSlope
            .receive(on: DispatchQueue.main)
            .sink { [weak self] show in self?.updateSlopeLayer(show) }
            .store(in: &cancellables)

        appState.$showWaterLayer.combineLatest(appState.$showShelterLayer)
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in
                guard let self, let mapView, isStyleLoaded else { return }
                self.refreshMapPoints(on: mapView)
            }
            .store(in: &cancellables)

        appState.zoomOutRequest
            .receive(on: DispatchQueue.main)
            .sink { [weak self] in
                guard let self, let mapView = self.mapView else { return }
                self.stopFollowing()
                mapView.camera.ease(to: CameraOptions(zoom: 8.0),
                                    duration: 1.0, curve: .easeInOut, completion: nil)
            }
            .store(in: &cancellables)

        appState.$constructorWaypoints
            .combineLatest(appState.$constructorLegs)
            .receive(on: DispatchQueue.main)
            .sink { [weak self] waypoints, legs in
                self?.updateConstructorPolyline(waypoints: waypoints, legs: legs)
                self?.updateConstructorAim()
            }
            .store(in: &cancellables)

        appState.$isConstructorMode
            .receive(on: DispatchQueue.main)
            .sink { [weak self] active in
                guard let self else { return }
                if active {
                    // Ровный кадр и нулевые отступы: наклон ломает перевод
                    // экранной точки в координату, а отступы уводят «центр
                    // камеры» от середины экрана. Отступы остаются от показа
                    // маршрута (там низ кадра отдан карточке), и без сброса
                    // прицел смотрел бы в одну точку, а шаг вставал в другую.
                    mapView?.camera.ease(to: CameraOptions(padding: .zero, pitch: 0),
                                         duration: 0.35, curve: .easeInOut, completion: nil)
                    // Тропы под камерой нужны сразу: по ним пойдёт и притяжение,
                    // и прокладка, если сети не окажется
                    refreshTileTrailSegments(force: true)
                    updateConstructorAim()
                } else {
                    updateConstructorPolyline(waypoints: [], legs: [])
                    appState.constructorAnchorScreen = nil
                }
            }
            .store(in: &cancellables)

        Publishers.CombineLatest3(
            appState.$filter,
            appState.$selectedCustomRoute,
            appState.customRouteStore.$routes
        )
        .receive(on: DispatchQueue.main)
        .sink { [weak self] filter, selected, routes in
            self?.refreshCustomRoutesOnMap(filter: filter, selected: selected, allRoutes: routes)
        }
        .store(in: &cancellables)

        appState.$showOSMTrails
            .receive(on: DispatchQueue.main)
            .sink { [weak self] show in
                guard let self, let mapView, isStyleLoaded else { return }
                toggleLayer(id: "osm-hiking-trails", visible: show, on: mapView)
            }
            .store(in: &cancellables)

        appState.$showPSSTrails
            .receive(on: DispatchQueue.main)
            .sink { [weak self] show in
                guard let self, let mapView, isStyleLoaded else { return }
                togglePSSTrailsLayer(visible: show, on: mapView)
            }
            .store(in: &cancellables)

        appState.$selectedPSSRoute
            .receive(on: DispatchQueue.main)
            .sink { [weak self] route in self?.onSelectedPSSRouteChanged(route) }
            .store(in: &cancellables)

        appState.$showRailways
            .receive(on: DispatchQueue.main)
            .sink { [weak self] show in
                guard let self, let mapView, isStyleLoaded else { return }
                toggleRailways(show, on: mapView)
                refreshStations()
            }
            .store(in: &cancellables)

        // Тайлы докачались или их удалили — стиль надо перезагрузить: до этого
        // карта работала на запасной основе и ни горизонталей, ни железных дорог
        // в ней не было
        TileSetDownloader.topo.$isReady
            .removeDuplicates()
            .dropFirst()
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in
                guard let self, let mapView, appState.baseStyle == .topo else { return }
                isStyleLoaded = false
                loadBaseStyle(appState.baseStyle, on: mapView)
            }
            .store(in: &cancellables)

        // Набор мог докачаться при включённом слое: тогда источник всё ещё
        // смотрит в сеть, хотя тайлы уже лежат на диске. Пересобираем слой,
        // чтобы он переключился на file:// (и наоборот — после удаления).
        TileSetDownloader.histmap.$isReady
            .removeDuplicates()
            .dropFirst()
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in
                guard let self, appState.showHistMap else { return }
                updateHistMap(true)
            }
            .store(in: &cancellables)

        appState.$baseStyle
            .removeDuplicates()
            .dropFirst()                       // стартовый стиль уже задан в makeUIView
            .receive(on: DispatchQueue.main)
            .sink { [weak self] base in
                guard let self, let mapView else { return }
                // Стиль сносит все наши слои и источники — onStyleLoaded соберёт их заново
                isStyleLoaded = false
                loadBaseStyle(base, on: mapView)
            }
            .store(in: &cancellables)
    }

    func onStyleLoaded() {
        isStyleLoaded = true
        guard let mapView else { return }
        // Слои прошлого стиля уничтожены вместе с ним — считаем, что на карте пусто
        drawnRouteId = nil
        setupMapLayers(mapView)
        addTopoOverlay(mapView)
        addOSMTrailsLayer(mapView)
        addPSSTrailsLayer(mapView)
        addRouteMarkers(mapView)
        scrubberManager = mapView.annotations.makePointAnnotationManager(id: "scrubber")
        sightingManager = mapView.annotations.makePointAnnotationManager(id: "sightings")

        if isFirstStyleLoad {
            isFirstStyleLoad = false
            onSelectedRouteChanged(appState.selectedRoute)
        } else if let route = appState.selectedRoute,
                  let stats = appState.routeStats[route.id] {
            // Перерисовка после смены основы: маршрут возвращаем, камеру не трогаем
            showRoute(route, stats: stats, on: mapView, fly: false)
        }

        updateAllTrails(showAll: appState.showAllTrails, stats: appState.routeStats)
        updateTrailsHeatmap(appState.showTrailsHeatmap)
        updateHistMap(appState.showHistMap)
        loadCaveLayer(mapView)

        // Возвращаем состояние тумблеров: подписки срабатывают только на изменение,
        // а стиль мы могли перезагрузить с уже включёнными слоями.
        addRailwayLayers(mapView)
        toggleLayer(id: "osm-hiking-trails", visible: appState.showOSMTrails, on: mapView)
        toggleCaveLayer(appState.showCaveLayer, on: mapView)
        refreshMapPoints(on: mapView)
        updateSlopeLayer(appState.showSlope)
        toggleRailways(appState.showRailways, on: mapView)
        refreshStations()
        updateTopoOpacity(appState.topoAlpha)
        restoreLiveTrack()
        // Нарисованный маршрут переживает смену основы карты. Тропы для
        // притяжения тоже перезапрашиваем: источник у новой основы другой.
        updateConstructorPolyline(waypoints: appState.constructorWaypoints,
                                  legs: appState.constructorLegs)
        refreshTileTrailSegments(force: true)
    }

    /// После смены стиля живой трек нужно нарисовать заново.
    private func restoreLiveTrack() {
        guard appState.isRecording, liveTrackCoords.count >= 2 else { return }
        drawLiveTrack()
    }

    // MARK: - Live track

    private func appendLiveTrackCoord(_ coord: CLLocationCoordinate2D) {
        guard isStyleLoaded, mapView != nil else { return }
        liveTrackCoords.append(coord)
        drawLiveTrack()
    }

    private func drawLiveTrack() {
        guard isStyleLoaded, let mapView else { return }
        guard liveTrackCoords.count >= 2 else { return }

        let line = LineString(liveTrackCoords)
        if mapView.mapboxMap.sourceExists(withId: "live-track-src") {
            mapView.mapboxMap.updateGeoJSONSource(
                withId: "live-track-src",
                geoJSON: .geometry(.lineString(line))
            )
        } else {
            var src = GeoJSONSource(id: "live-track-src")
            src.data = .geometry(.lineString(line))
            try? mapView.mapboxMap.addSource(src)

            var glow = LineLayer(id: "live-track-glow", source: "live-track-src")
            glow.lineColor   = .constant(StyleColor(UIColor(red: 1, green: 0.34, blue: 0.13, alpha: 1)))
            glow.lineWidth   = .constant(12)
            glow.lineOpacity = .constant(0.15)
            glow.lineCap     = .constant(.round)
            glow.lineJoin    = .constant(.round)
            try? mapView.mapboxMap.addLayer(glow, layerPosition: .above("route-hitboxes"))

            var line2 = LineLayer(id: "live-track-line", source: "live-track-src")
            line2.lineColor   = .constant(StyleColor(UIColor(red: 1, green: 0.34, blue: 0.13, alpha: 1)))
            line2.lineWidth   = .constant(3.5)
            line2.lineOpacity = .constant(0.95)
            line2.lineCap     = .constant(.round)
            line2.lineJoin    = .constant(.round)
            try? mapView.mapboxMap.addLayer(line2, layerPosition: .above("live-track-glow"))
        }
    }

    private func clearLiveTrack() {
        guard let mapView else { return }
        try? mapView.mapboxMap.removeLayer(withId: "live-track-line")
        try? mapView.mapboxMap.removeLayer(withId: "live-track-glow")
        try? mapView.mapboxMap.removeSource(withId: "live-track-src")
        sightingManager?.annotations = []
    }

    // MARK: - Sighting pins

    private func addSightingPin(_ sighting: Sighting) {
        guard isStyleLoaded, let mapView else { return }
        if sightingManager == nil {
            sightingManager = mapView.annotations.makePointAnnotationManager(id: "sightings")
        }
        let emoji = sighting.type.rawValue
        let imageName = "sighting-\(emoji)"
        if let img = makeEmojiPin(emoji: emoji) {
            try? mapView.mapboxMap.addImage(img, id: imageName)
        }
        var ann = PointAnnotation(coordinate: sighting.coordinate.clCoordinate)
        ann.image = .init(image: makeEmojiPin(emoji: emoji) ?? UIImage(), name: imageName)
        ann.iconAnchor = .bottom
        sightingManager?.annotations.append(ann)
    }

    private func makeEmojiPin(emoji: String, size: CGFloat = 44) -> UIImage? {
        UIGraphicsImageRenderer(size: CGSize(width: size, height: size)).image { ctx in
            let c = size / 2
            let r = size * 0.30

            ctx.cgContext.setShadow(offset: CGSize(width: 0, height: 2), blur: 8,
                                    color: UIColor.black.withAlphaComponent(0.5).cgColor)
            UIColor(red: 0.1, green: 0.1, blue: 0.1, alpha: 0.85).setFill()
            UIBezierPath(ovalIn: CGRect(x: c-r, y: c-r, width: r*2, height: r*2)).fill()

            ctx.cgContext.setShadow(offset: .zero, blur: 0, color: nil)
            let font = UIFont.systemFont(ofSize: size * 0.38)
            let attrs: [NSAttributedString.Key: Any] = [.font: font]
            let str = NSAttributedString(string: emoji, attributes: attrs)
            let sz = str.size()
            str.draw(at: CGPoint(x: c - sz.width / 2, y: c - sz.height / 2))
        }
    }

    // MARK: - Cave layer (native clustering)

    private func loadCaveLayer(_ mapView: MapView) {
        let caves = CaveStore.shared.caves
        guard !caves.isEmpty else { return }

        if let img = makeCaveIcon() {
            try? mapView.mapboxMap.addImage(img, id: "cave-icon")
        }

        let features: [Feature] = caves.map { cave in
            var f = Feature(geometry: .point(Point(cave.clCoordinate)))
            f.properties = ["caveId": .string(cave.id), "name": .string(cave.name)]
            return f
        }

        var src = GeoJSONSource(id: "cave-src")
        src.data = .featureCollection(FeatureCollection(features: features))
        src.cluster = true
        src.clusterRadius = 55
        src.clusterMaxZoom = 11
        try? mapView.mapboxMap.addSource(src)

        // 1. Cluster circle background
        var clusterBg = CircleLayer(id: "cave-cluster-bg", source: "cave-src")
        clusterBg.filter = Exp(.has) { "point_count" }
        clusterBg.circleRadius = .expression(
            Exp(.step) {
                Exp(.get) { "point_count" }
                18.0
                10; 24.0
                50; 30.0
                150; 36.0
            }
        )
        clusterBg.circleColor = .constant(StyleColor(UIColor(red: 0.22, green: 0.44, blue: 0.85, alpha: 0.70)))
        clusterBg.circleStrokeWidth = .constant(1.5)
        clusterBg.circleStrokeColor = .constant(StyleColor(UIColor.white.withAlphaComponent(0.55)))
        clusterBg.visibility = .constant(.none)
        try? mapView.mapboxMap.addLayer(clusterBg)

        // 2. Cluster count label
        var clusterLabel = SymbolLayer(id: "cave-cluster-count", source: "cave-src")
        clusterLabel.filter = Exp(.has) { "point_count" }
        clusterLabel.textField = .expression(Exp(.get) { "point_count_abbreviated" })
        clusterLabel.textSize = .constant(12)
        clusterLabel.textColor = .constant(StyleColor(.white))
        clusterLabel.textFont = .constant(["DIN Pro Bold", "Arial Unicode MS Bold"])
        clusterLabel.textAllowOverlap = .constant(true)
        clusterLabel.visibility = .constant(.none)
        try? mapView.mapboxMap.addLayer(clusterLabel)

        // 3. Individual cave symbols (unclustered)
        var sym = SymbolLayer(id: "cave-layer", source: "cave-src")
        sym.filter = Exp(.not) { Exp(.has) { "point_count" } }
        sym.iconImage    = .constant(.name("cave-icon"))
        sym.iconSize     = .constant(1.0)
        sym.iconAnchor   = .constant(.center)
        sym.iconAllowOverlap = .constant(false)
        sym.textField    = .expression(Exp(.get) { "name" })
        // Шрифт обязательно из тех, что использует сам стиль. Иначе глифы для него
        // никто не скачает (style pack тянет только шрифты слоёв стиля), и офлайн
        // подпись не соберётся — а вместе с ней не отрисуется и вся точка.
        sym.textFont     = .constant(["DIN Pro Medium", "Arial Unicode MS Regular"])
        sym.textSize     = .constant(10)
        sym.textColor    = .constant(StyleColor(.white))
        sym.textHaloColor = .constant(StyleColor(.black))
        sym.textHaloWidth = .constant(1.2)
        sym.textOffset   = .constant([0, 1.3])
        sym.textAnchor   = .constant(.top)
        sym.textOptional = .constant(true)
        sym.visibility   = .constant(.none)
        try? mapView.mapboxMap.addLayer(sym)
    }

    // MARK: - Крутизна склонов

    /// Полупрозрачная накладка поверх основы. Как и остальные растры —
    /// **лениво**: при выключенном тумблере слоя на карте нет вовсе.
    ///
    /// Место в стопке выбрано так, чтобы работать с любой основой: выше
    /// гравюры (иначе она бы её закрыла), но ниже маски, троп и маршрутов —
    /// линии маршрута должны читаться поверх заливки.
    private func updateSlopeLayer(_ show: Bool) {
        guard isStyleLoaded, let mapView else { return }
        try? mapView.mapboxMap.removeLayer(withId: "slope-layer")
        try? mapView.mapboxMap.removeSource(withId: "slope-src")
        guard show, let template = SlopeTiles.tilesURL else { return }

        var src = RasterSource(id: "slope-src")
        src.tiles = [template]
        src.tileSize = 512
        src.minzoom = SlopeTiles.minZoom
        src.maxzoom = SlopeTiles.maxZoom
        src.attribution = "Copernicus GLO-30 DEM"
        try? mapView.mapboxMap.addSource(src)

        var layer = RasterLayer(id: "slope-layer", source: "slope-src")
        // Прозрачность заложена в сами тайлы (альфа 115 из 255); здесь ещё
        // немного приглушаем, иначе поверх спутника заливка спорит с рельефом
        layer.rasterOpacity = .constant(0.85)
        layer.rasterFadeDuration = .constant(0)
        layer.rasterResampling = .constant(.linear)
        // Ниже z8 растр всё равно растягивается из самого мелкого тайла и
        // выглядит на обзоре страны фиолетовыми кляксами — там он бесполезен
        layer.minZoom = SlopeTiles.minZoom
        try? mapView.mapboxMap.addLayer(layer, layerPosition: .below("world-mask"))
    }

    // MARK: - Объекты на карте: вода и укрытия

    /// Наборы точечных объектов. Каждый живёт своим источником и своими слоями,
    /// потому что включаются они раздельно.
    enum MapPointSet: String, CaseIterable {
        case water, shelter

        var points: [MapPoint] {
            self == .water ? MapPointStore.shared.water : MapPointStore.shared.shelters
        }
        var clusterColor: UIColor {
            self == .water ? UIColor(red: 0.16, green: 0.55, blue: 0.85, alpha: 0.72)
                           : UIColor(red: 0.62, green: 0.40, blue: 0.16, alpha: 0.72)
        }
        var resource: String { self == .water ? "water" : "shelters" }
        var src: String { "\(rawValue)-poi-src" }
        var layers: [String] { ["\(rawValue)-poi-cluster-bg", "\(rawValue)-poi-cluster-count",
                                "\(rawValue)-poi-layer"] }
    }

    /// Слои заводятся один раз при загрузке стиля и переключаются видимостью —
    /// ровно как у пещер.
    ///
    /// ⚠️ Ленивое добавление (по тумблеру) здесь не работает: стиль
    /// перезагружается не только при смене основы, и слои, заведённые между
    /// перезагрузками, молча исчезают вместе с источником. Проверено дампом
    /// стиля: через три секунды после добавления в нём не оставалось ни
    /// одного нашего слоя. Растровым слоям это не мешает — их пересоздаёт
    /// подписка на `onStyleLoaded`, — а вот источник на восемь тысяч точек
    /// пересобирать на каждый чих дорого, поэтому он заводится единожды.
    private func loadMapPointLayers(_ mapView: MapView) {
        for set in MapPointSet.allCases {
            guard !mapView.mapboxMap.sourceExists(withId: set.src),
                  let url = Bundle.main.url(forResource: set.resource, withExtension: "geojson"),
                  let text = try? String(contentsOf: url, encoding: .utf8)
            else { continue }

            for kind in MapPoint.Kind.allCases where kind.isWater == (set == .water) {
                let id = "poi-\(kind.rawValue)"
                if !mapView.mapboxMap.imageExists(withId: id),
                   let img = makeEmojiPin(emoji: kind.emoji, size: 34) {
                    try? mapView.mapboxMap.addImage(img, id: id)
                }
            }

            var src = GeoJSONSource(id: set.src)
            src.data = .string(text)
            src.cluster = true
            src.clusterRadius = 55
            // Колонки в городах стоят плотно, и без кластеров до крупного зума
            // карта превращалась бы в кашу из значков
            src.clusterMaxZoom = 13
            try? mapView.mapboxMap.addSource(src)

            var bg = CircleLayer(id: set.layers[0], source: set.src)
            bg.filter = Exp(.has) { "point_count" }
            bg.circleRadius = .expression(
                Exp(.step) { Exp(.get) { "point_count" }; 16.0; 10; 21.0; 50; 27.0; 200; 33.0 })
            bg.circleColor = .constant(StyleColor(set.clusterColor))
            bg.circleStrokeWidth = .constant(1.5)
            bg.circleStrokeColor = .constant(StyleColor(UIColor.white.withAlphaComponent(0.55)))
            bg.visibility = .constant(.none)
            try? mapView.mapboxMap.addLayer(bg)

            var count = SymbolLayer(id: set.layers[1], source: set.src)
            count.filter = Exp(.has) { "point_count" }
            count.textField = .expression(Exp(.get) { "point_count_abbreviated" })
            count.textSize = .constant(12)
            count.textColor = .constant(StyleColor(.white))
            count.textFont = .constant(["DIN Pro Bold", "Arial Unicode MS Bold"])
            count.textAllowOverlap = .constant(true)
            count.visibility = .constant(.none)
            try? mapView.mapboxMap.addLayer(count)

            var sym = SymbolLayer(id: set.layers[2], source: set.src)
            sym.filter = Exp(.not) { Exp(.has) { "point_count" } }
            sym.iconImage = .constant(.name(set == .water ? "poi-spring" : "poi-hut"))
            sym.iconAllowOverlap = .constant(false)
            // Подпись — только вблизи, значок — всегда. `minZoom` на весь слой
            // прятал бы и значки: в сельской местности точки редкие, в кластер
            // не собираются, и до z13 не было бы видно ничего.
            // Подпись — только вблизи, значок — всегда
            sym.textField = .expression(
                Exp(.step) { Exp(.zoom); Exp(.literal) { "" }; 13.0; Exp(.get) { "name" } })
            // Шрифт — из тех, что использует стиль: глифы для чужого никто не
            // скачает, и офлайн подпись не соберётся.
            sym.textFont = .constant(["DIN Pro Medium", "Arial Unicode MS Regular"])
            sym.textSize = .constant(10)
            sym.textColor = .constant(StyleColor(.white))
            sym.textHaloColor = .constant(StyleColor(.black))
            sym.textHaloWidth = .constant(1.2)
            sym.textOffset = .constant([0, 1.2])
            sym.textAnchor = .constant(.top)
            sym.textOptional = .constant(true)
            sym.visibility = .constant(.none)
            try? mapView.mapboxMap.addLayer(sym)

        }
    }

    private func refreshMapPoints(on mapView: MapView) {
        loadMapPointLayers(mapView)
        for set in MapPointSet.allCases {
            let on = set == .water ? appState.showWaterLayer : appState.showShelterLayer
            let v: Value<MapboxMaps.Visibility> = .constant(on ? .visible : .none)
            try? mapView.mapboxMap.updateLayer(withId: set.layers[0], type: CircleLayer.self) { $0.visibility = v }
            try? mapView.mapboxMap.updateLayer(withId: set.layers[1], type: SymbolLayer.self) { $0.visibility = v }
            try? mapView.mapboxMap.updateLayer(withId: set.layers[2], type: SymbolLayer.self) { $0.visibility = v }
        }
    }

    // MARK: - Железные дороги

    /// Пути из бандла — одинаково на спутнике и на топооснове, и до того,
    /// как пользователь скачает тайлы.
    private func addRailwayLayers(_ mapView: MapView) {
        guard let geoJSON = RailwayStore.geoJSONString else { return }
        let map: MapboxMap = mapView.mapboxMap
        guard !map.sourceExists(withId: "railways-src") else { return }

        var src = GeoJSONSource(id: "railways-src")
        src.data = .string(geoJSON)
        try? map.addSource(src)

        let onlyLines = Exp(.eq) { Exp(.get) { "kind" }; "rail" }
        let visible = appState.showRailways

        // Тёмное полотно
        var line = LineLayer(id: "railway-line", source: "railways-src")
        line.filter    = onlyLines
        line.lineColor = .constant(StyleColor(DS.railInkUI))
        line.lineJoin  = .constant(.round)
        line.lineWidth = .expression(
            Exp(.interpolate) {
                Exp(.linear); Exp(.zoom)
                6.0;  1.6
                10.0; 3.0
                14.0; 5.5
                17.0; 9.0
            }
        )
        line.lineOpacity = .constant(visible ? 1 : 0)
        // Под маркерами маршрутов: наши треки важнее железной дороги
        if map.layerExists(withId: "route-hitboxes") {
            try? map.addLayer(line, layerPosition: .below("route-hitboxes"))
        } else {
            try? map.addLayer(line)
        }

        // Белые засечки поверх — та самая «лесенка», по которой ж/д и узнают
        var hatch = LineLayer(id: "railway-hatch", source: "railways-src")
        hatch.filter    = onlyLines
        hatch.minZoom   = 8
        hatch.lineColor = .constant(StyleColor(UIColor.white))
        hatch.lineDasharray = .constant([0.55, 1.4])
        hatch.lineWidth = .expression(
            Exp(.interpolate) {
                Exp(.linear); Exp(.zoom)
                8.0;  1.0
                14.0; 3.4
                17.0; 5.6
            }
        )
        hatch.lineOpacity = .constant(visible ? 1 : 0)
        try? map.addLayer(hatch, layerPosition: .above("railway-line"))

        // Невидимый «резерв» места под флажки станций.
        //
        // Сами флажки — SwiftUI поверх карты, и о них движок ничего не знает:
        // подписи вершин и посёлков спокойно рисуются ровно под табличкой.
        // Поэтому кладём на те же точки настоящий символьный слой с тем же
        // текстом, но полностью прозрачный. Прозрачность — это paint-свойство,
        // на раскладку оно не влияет, поэтому символ продолжает участвовать в
        // разрешении коллизий и вытесняет чужие подписи, ничего не рисуя сам.
        // Слой кладём последним: при конфликте выигрывает тот, что выше.
        var reserve = SymbolLayer(id: "station-reserve", source: "railways-src")
        reserve.filter        = Exp(.eq) { Exp(.get) { "kind" }; "station" }
        reserve.minZoom       = Self.stationsMinZoom
        reserve.textField     = .expression(Exp(.get) { "name" })
        reserve.textFont      = .constant(["DIN Pro Medium", "Arial Unicode MS Regular"])
        reserve.textSize      = .constant(12)
        // Табличка висит над точкой привязки, смещение — в кеглях
        reserve.textOffset    = .constant([0, -3])
        reserve.textPadding   = .constant(6)
        reserve.textAllowOverlap = .constant(false)
        reserve.textOpacity   = .constant(0)
        reserve.visibility    = .constant(visible ? .visible : .none)
        try? map.addLayer(reserve)
    }

    // MARK: - Станции

    /// С какого зума показываем станции
    private static let stationsMinZoom = 8.5
    /// Предохранитель от совсем уж плотных мест — рисуем всё, что попало в кадр
    private static let stationsLimit = 150

    /// Ширина таблички зависит от текста, а мерить шрифт на каждом кадре дорого.
    /// Названий всего тысяча, и они не меняются — считаем один раз.
    private static var plateWidths: [String: CGFloat] = [:]

    private static func plateWidth(_ name: String, isMajor: Bool) -> CGFloat {
        let key = (isMajor ? "M|" : "m|") + name
        if let w = plateWidths[key] { return w }
        // Те же параметры, что у таблички в `StationFlagsLayer`
        let font = UIFont.systemFont(ofSize: isMajor ? 12 : 10.5,
                                     weight: isMajor ? .semibold : .medium)
        let w = ceil((name as NSString).size(withAttributes: [.font: font]).width) + 14
        plateWidths[key] = w
        return w
    }

    /// Габариты флажка на экране: якорь — кружок на путях, всё остальное растёт
    /// вверх от него (табличка, древко, кружок — как во вьюхе).
    private static func flagBox(at point: CGPoint, name: String, isMajor: Bool) -> CGRect {
        let dot: CGFloat = isMajor ? 13 : 9
        let pole: CGFloat = isMajor ? 20 : 15
        let plate: CGFloat = isMajor ? 20 : 17
        let width = plateWidth(name, isMajor: isMajor)
        return CGRect(x: point.x - width / 2,
                      y: point.y - plate - pole - dot / 2,
                      width: width,
                      height: plate + pole + dot)
            .insetBy(dx: -2, dy: -2)      // немного воздуха между соседями
    }

    /// Пересобирает список станций в кадре. Данные лежат в памяти (1023 точки
    /// из бандла), поэтому это просто фильтр по экрану — никаких запросов к тайлам.
    func refreshStations() {
        guard let mapView, isStyleLoaded, appState.showRailways,
              mapView.mapboxMap.cameraState.zoom >= Self.stationsMinZoom
        else {
            if !appState.stationMarkers.isEmpty { appState.stationMarkers = [] }
            return
        }

        let map: MapboxMap = mapView.mapboxMap

        // Отбираем по географии, а не по экранным координатам. Проекция точки,
        // лежащей далеко за кадром, возвращает что угодно, и проверка «попал ли
        // в bounds» пропускала станции со всей страны — список упирался в лимит,
        // а на экран попадали случайные. Границы кадра SDK считает сам, с учётом
        // наклона камеры.
        let view = mapView.bounds.isEmpty ? UIScreen.main.bounds : mapView.bounds
        let box = map.coordinateBounds(for: view)
        // Запас в четверть кадра: флажок рисуется выше точки привязки, да и при
        // лёгком сдвиге камеры метки не должны мигать на краях
        let padLat = (box.north - box.south) * 0.25
        let padLon = (box.east - box.west) * 0.25
        let south = box.south - padLat, north = box.north + padLat
        let west = box.west - padLon, east = box.east + padLon

        // Вокзалы вперёд: у одной станции в OSM нередко два узла с одним именем
        // (`station` и `stop` в паре десятков метров), и оставить нужно главный
        let candidates = RailwayStore.stations
            .filter { s in
                s.coordinate.latitude >= south && s.coordinate.latitude <= north &&
                s.coordinate.longitude >= west && s.coordinate.longitude <= east
            }
            .sorted { ($0.isMajor ? 0 : 1, $0.name) < ($1.isMajor ? 0 : 1, $1.name) }

        var markers: [StationMarker] = []
        var placed: [String: [CGPoint]] = [:]
        var usedIDs = Set<String>()
        var boxes: [CGRect] = []

        for station in candidates {
            let screen = map.point(for: station.coordinate)

            // Тёзка ближе 120 точек — тот же объект. Дальше — другая станция
            let twins = placed[station.name] ?? []
            if twins.contains(where: { hypot($0.x - screen.x, $0.y - screen.y) < 120 }) { continue }
            placed[station.name, default: []].append(screen)

            // Флажки не должны налезать друг на друга: раскладываем жадно, по
            // порядку важности, и пропускаем тот, чья табличка перекрывает уже
            // поставленную. Порядок (вокзалы, дальше по алфавиту) от кадра
            // не зависит, поэтому при движении камеры набор не мигает.
            let box = Self.flagBox(at: screen, name: station.name, isMajor: station.isMajor)
            if boxes.contains(where: { $0.intersects(box) }) { continue }
            boxes.append(box)

            // Идентификатор переживает движение камеры, иначе SwiftUI сочтёт метку
            // новой и заново проиграет анимацию. При совпадении разводим суффиксом:
            // два одинаковых id в списке — и часть меток не рисуется вовсе.
            var key = "\(station.name)|\(Int(station.coordinate.latitude * 200))|\(Int(station.coordinate.longitude * 200))"
            var suffix = 2
            while usedIDs.contains(key) {
                key = "\(key)#\(suffix)"
                suffix += 1
            }
            usedIDs.insert(key)

            markers.append(StationMarker(id: key, name: station.name, isMajor: station.isMajor,
                                         coordinate: station.coordinate, screen: screen))
            if markers.count >= Self.stationsLimit { break }
        }

        appState.stationMarkers = markers
    }

    /// Пересчёт экранных позиций — это только проекция координат, дёшево.
    func repositionStations() {
        guard let mapView, !appState.stationMarkers.isEmpty else { return }
        var markers = appState.stationMarkers
        for i in markers.indices {
            markers[i].screen = mapView.mapboxMap.point(for: markers[i].coordinate)
        }
        appState.stationMarkers = markers
    }

    /// Пути лежат в бандле и есть на любой основе, поэтому тумблер работает
    /// и на спутнике. Гасим прозрачностью, а не видимостью: так слой остаётся
    /// на своём месте в порядке отрисовки.
    private func toggleRailways(_ visible: Bool, on mapView: MapView) {
        let map: MapboxMap = mapView.mapboxMap
        for id in ["railway-line", "railway-hatch"] where map.layerExists(withId: id) {
            try? map.updateLayer(withId: id, type: LineLayer.self) { layer in
                layer.lineOpacity = .constant(visible ? 1 : 0)
            }
        }
        // Резерв гасим по-настоящему: он невидим, но место занимает, и с
        // выключенными дорогами продолжал бы выдавливать подписи карты
        if map.layerExists(withId: "station-reserve") {
            try? map.updateLayer(withId: "station-reserve", type: SymbolLayer.self) { layer in
                layer.visibility = .constant(visible ? .visible : .none)
            }
        }
    }

    private func toggleCaveLayer(_ visible: Bool, on mapView: MapView) {
        let v: Value<MapboxMaps.Visibility> = .constant(visible ? .visible : .none)
        if mapView.mapboxMap.layerExists(withId: "cave-cluster-bg") {
            try? mapView.mapboxMap.updateLayer(withId: "cave-cluster-bg", type: CircleLayer.self) { l in
                l.visibility = v
            }
        }
        if mapView.mapboxMap.layerExists(withId: "cave-cluster-count") {
            try? mapView.mapboxMap.updateLayer(withId: "cave-cluster-count", type: SymbolLayer.self) { l in
                l.visibility = v
            }
        }
        if mapView.mapboxMap.layerExists(withId: "cave-layer") {
            try? mapView.mapboxMap.updateLayer(withId: "cave-layer", type: SymbolLayer.self) { l in
                l.visibility = v
            }
        }
    }

    // Mountain silhouette with arch cave entrance
    private func makeCaveIcon(size: CGFloat = 36) -> UIImage? {
        let accent = UIColor(red: 0.28, green: 0.52, blue: 0.92, alpha: 1)
        return UIGraphicsImageRenderer(size: CGSize(width: size, height: size)).image { ctx in
            let g = ctx.cgContext
            let c = size / 2
            let r = size * 0.37

            // Glow halo
            g.setShadow(offset: .zero, blur: size * 0.28,
                        color: accent.withAlphaComponent(0.55).cgColor)
            accent.withAlphaComponent(0.16).setFill()
            UIBezierPath(ovalIn: CGRect(x: c-r*1.5, y: c-r*1.5, width: r*3, height: r*3)).fill()

            // Solid circle
            g.setShadow(offset: CGSize(width: 0, height: 1.5), blur: 4,
                        color: UIColor.black.withAlphaComponent(0.45).cgColor)
            accent.setFill()
            UIBezierPath(ovalIn: CGRect(x: c-r, y: c-r, width: r*2, height: r*2)).fill()
            g.setShadow(offset: .zero, blur: 0, color: nil)

            // Clip to circle
            let clip = UIBezierPath(ovalIn: CGRect(x: c-r+1.5, y: c-r+1.5,
                                                   width: (r-1.5)*2, height: (r-1.5)*2))
            g.addPath(clip.cgPath); g.clip()

            // White mountain triangle
            let mBaseY = c + r * 0.35
            let mPeakY = c - r * 0.65
            let mHalfW = r * 0.78
            let archR  = r * 0.30

            let tri = UIBezierPath()
            tri.move(to: CGPoint(x: c, y: mPeakY))
            tri.addLine(to: CGPoint(x: c - mHalfW, y: mBaseY))
            tri.addLine(to: CGPoint(x: c + mHalfW, y: mBaseY))
            tri.close()
            UIColor.white.withAlphaComponent(0.93).setFill()
            tri.fill()

            // Cave arch cutout (overdraw in accent color to "erase" entry)
            let archHole = UIBezierPath()
            archHole.move(to: CGPoint(x: c - archR, y: mBaseY + 2))
            archHole.addLine(to: CGPoint(x: c - archR, y: mBaseY))
            // counterclockwise in UIKit screen coords: π → 0 counterclockwise = arch going UP
            archHole.addArc(withCenter: CGPoint(x: c, y: mBaseY),
                            radius: archR, startAngle: .pi, endAngle: 0, clockwise: false)
            archHole.addLine(to: CGPoint(x: c + archR, y: mBaseY + 2))
            archHole.close()
            accent.setFill()
            archHole.fill()
        }
    }

    // MARK: - Route subscriptions
    private func onSelectedRouteChanged(_ route: Route?) {
        guard isStyleLoaded, let mapView else { return }
        clearActiveRoute(on: mapView)
        guard let route else {
            // Кнопка «Нарисовать» снимает выбор маршрута. Улетать при этом на
            // обзор нельзя: рисовать собираются ровно там, куда смотрят.
            if !appState.isConstructorMode { flyToOverview(on: mapView) }
            return
        }
        if let stats = appState.routeStats[route.id] {
            showRoute(route, stats: stats, on: mapView, fly: true)
        }
    }

    private func onStatsUpdated(_ stats: [String: RouteStats]) {
        guard isStyleLoaded, let mapView else { return }
        refreshMarkers()
        guard let route = appState.selectedRoute,
              drawnRouteId != route.id,
              let routeStats = stats[route.id]
        else { return }
        showRoute(route, stats: routeStats, on: mapView, fly: true)
    }

    // MARK: - Tap handler
    @objc func handleTap(_ gesture: UITapGestureRecognizer) {
        guard let mapView else { return }
        // Жест не должен ставить точку: сдвиг, зум и поворот заканчиваются
        // касанием, и карта в этот момент ещё едет по инерции
        guard activeGestures == 0,
              Date().timeIntervalSince(lastGestureEnd) > 0.35 else { return }
        let point = gesture.location(in: mapView)

        // Конструктор: ставим точку, притянув её к ближайшей тропе. Путь от
        // предыдущей точки прокладывает AppState — он уже по тропам, не по прямой.
        if appState.isConstructorMode {
            let tapped = mapView.mapboxMap.coordinate(for: point)
            var placed = tapped
            if appState.isSnapEnabled,
               let snapped = TrailSnapService.findSnapInMemory(near: tapped, segments: routingSegments) {
                UIImpactFeedbackGenerator(style: .light).impactOccurred()
                placed = snapped
            }
            DispatchQueue.main.async { self.appState.addConstructorWaypoint(placed) }
            return
        }

        let options = RenderedQueryOptions(
            layerIds: ["photo-marker-symbols", "route-hitboxes", "cave-cluster-bg", "cave-layer",
                       "water-poi-cluster-bg", "water-poi-layer",
                       "shelter-poi-cluster-bg", "shelter-poi-layer"],
            filter: nil
        )
        mapView.mapboxMap.queryRenderedFeatures(with: point, options: options) { [weak self] result in
            guard case .success(let features) = result, !features.isEmpty else { return }
            guard let self else { return }

            // Photo marker taps take priority
            for qf in features {
                guard let props = qf.queriedFeature.feature.properties else { continue }
                if case .string(let t) = props["type"], t == "photo",
                   case .string(let rid) = props["routeId"],
                   case .number(let idx) = props["photoIdx"] {
                    DispatchQueue.main.async {
                        self.appState.selectedPhotoInfo = SelectedPhotoInfo(routeId: rid, index: Int(idx))
                    }
                    return
                }
            }

            // Cluster taps → zoom in to expand
            for qf in features {
                guard let props = qf.queriedFeature.feature.properties else { continue }
                if case .number(_) = props["point_count"],
                   case .point(let pt) = qf.queriedFeature.feature.geometry {
                    let currentZoom = self.mapView?.mapboxMap.cameraState.zoom ?? 8
                    self.mapView?.camera.ease(to: CameraOptions(
                        center: pt.coordinates, zoom: currentZoom + 2.5
                    ), duration: 0.55, curve: .easeInOut, completion: nil)
                    return
                }
            }

            // Вода и укрытия
            for qf in features {
                guard let props = qf.queriedFeature.feature.properties else { continue }
                if case .string(let pid) = props["poiId"],
                   let p = (MapPointStore.shared.water + MapPointStore.shared.shelters)
                            .first(where: { $0.id == pid }) {
                    DispatchQueue.main.async { self.appState.selectedMapPoint = p }
                    return
                }
            }

            // Cave taps
            for qf in features {
                guard let props = qf.queriedFeature.feature.properties else { continue }
                if case .string(let cid) = props["caveId"],
                   let cave = CaveStore.shared.caves.first(where: { $0.id == cid }) {
                    DispatchQueue.main.async { self.appState.selectedCave = cave }
                    return
                }
            }

            // Route dot taps
            for qf in features {
                guard let props = qf.queriedFeature.feature.properties else { continue }
                if case .string(let cid) = props["customId"],
                   let route = self.appState.customRouteStore.routes.first(where: { $0.id == cid }) {
                    DispatchQueue.main.async { self.appState.selectCustomRoute(route) }
                    return
                }
                if case .string(let rid) = props["routeId"],
                   let route = RouteStore.all.first(where: { $0.id == rid }) {
                    DispatchQueue.main.async { self.appState.select(route) }
                    return
                }
            }
        }
    }

    // MARK: - Style setup
    private func setupMapLayers(_ mapView: MapView) {
        var dem = RasterDemSource(id: "mapbox-dem")
        dem.url      = "mapbox://mapbox.mapbox-terrain-dem-v1"
        dem.tileSize = 256
        dem.maxzoom  = 14.0
        try? mapView.mapboxMap.addSource(dem)
        var terrain = Terrain(sourceId: "mapbox-dem")
        terrain.exaggeration = .constant(1.1)
        try? mapView.mapboxMap.setTerrain(terrain)


        var countrySource = VectorSource(id: "country-boundaries")
        countrySource.url = "mapbox://mapbox.country-boundaries-v1"
        // Тайлсет живёт до z12, но нам хватает z8: дальше маска дорисовывается
        // растягиванием родительского тайла. Так офлайн-пакет остаётся крошечным
        // и маска не пропадает без сети на больших зумах.
        countrySource.maxzoom = 8
        try? mapView.mapboxMap.addSource(countrySource)

        var maskLayer = FillLayer(id: "world-mask", source: "country-boundaries")
        maskLayer.sourceLayer = "country_boundaries"
        maskLayer.fillColor   = .constant(StyleColor(.black))
        maskLayer.fillOpacity = .constant(0.75)
        // Render the Serbian ("RS") worldview, where Kosovo is part of Serbia.
        // The tileset stores overlapping polygons per worldview, so keep only the
        // "all" features plus those valid for the RS worldview, then darken
        // everything that is not Serbia (SRB). Serbia itself has no "all" polygon,
        // so the separate Kosovo ("XK") polygon is excluded and stays bright.
        maskLayer.filter = Exp(.all) {
            Exp(.any) {
                Exp(.eq) { Exp(.get) { "worldview" }; "all" }
                Exp(.inExpression) { "RS"; Exp(.get) { "worldview" } }
            }
            Exp(.not) {
                Exp(.eq) { Exp(.get) { "iso_3166_1_alpha_3" }; "SRB" }
            }
        }
        try? mapView.mapboxMap.addLayer(maskLayer)

        hideDisputedBoundaries(mapView)
    }

    /// Hide disputed admin boundary lines (e.g. Serbia–Kosovo) from the base
    /// style so Kosovo is drawn as part of Serbia, matching the RS worldview mask.
    private func hideDisputedBoundaries(_ mapView: MapView) {
        for info in mapView.mapboxMap.allLayerIdentifiers {
            guard info.type == .line else { continue }
            let id = info.id.lowercased()
            guard id.contains("disputed"),
                  id.contains("admin") || id.contains("boundary") else { continue }
            try? mapView.mapboxMap.updateLayer(withId: info.id, type: LineLayer.self) { layer in
                layer.visibility = .constant(.none)
            }
        }
    }

    // MARK: - OSM / PSS trail layers

    private func addOSMTrailsLayer(_ mapView: MapView) {
        let osmFilter = Exp(.any) {
            Exp(.eq) { Exp(.get) { "class" }; "path" }
            Exp(.eq) { Exp(.get) { "class" }; "track" }
        }

        // У Mapbox тропы лежат в composite/road, у своих тайлов — в topo/transportation.
        // Спрашиваем сам стиль: состояние приложения и загруженный стиль в момент
        // переключения расходятся, и слой уезжал к несуществующему источнику.
        let hasOwnTiles = mapView.mapboxMap.sourceExists(withId: "topo")
        let source      = hasOwnTiles ? "topo" : "composite"
        let sourceLayer = hasOwnTiles ? "transportation" : "road"

        var layer = LineLayer(id: "osm-hiking-trails", source: source)
        layer.sourceLayer = sourceLayer
        layer.filter    = osmFilter
        layer.lineColor = .constant(StyleColor(UIColor(red: 0.35, green: 0.85, blue: 0.42, alpha: 1)))
        layer.lineWidth = .constant(1.6)
        layer.lineOpacity = .constant(0.0)
        layer.lineCap   = .constant(.round)
        layer.lineJoin  = .constant(.round)
        layer.minZoom   = 8
        try? mapView.mapboxMap.addLayer(layer)

        // Shimmer overlay
        var shimmer = LineLayer(id: "osm-hiking-shimmer", source: source)
        shimmer.sourceLayer = sourceLayer
        shimmer.filter    = osmFilter
        shimmer.lineColor = .constant(StyleColor(UIColor.white.withAlphaComponent(0.18)))
        shimmer.lineWidth = .constant(2.0)
        shimmer.lineCap   = .constant(.round)
        shimmer.lineJoin  = .constant(.round)
        shimmer.minZoom   = 8
        shimmer.lineOpacity = .constant(0.0)
        try? mapView.mapboxMap.addLayer(shimmer, layerPosition: .above("osm-hiking-trails"))
    }

    // Топо-слой добавляем лениво — иначе Mapbox всё время тянет тайлы
    // OpenTopoMap (и валится 401/HTTP-2), даже когда opacity=0.
    private func addTopoOverlay(_ mapView: MapView) {}

    private func ensureTopoLayer(on mapView: MapView) {
        guard !mapView.mapboxMap.sourceExists(withId: "topo-overlay") else { return }
        var src = RasterSource(id: "topo-overlay")
        // Три зеркала, а не один хост. OpenTopoMap раздаёт тайлы с обычного
        // сервера и режет частые запросы с одного соединения: при зуме карта
        // остаётся мозаикой из тайлов чужих масштабов, пока не подвигаешь её
        // руками. SDK раскладывает запросы по адресам из списка, и очередь
        // на каждое зеркало становится втрое короче.
        src.tiles = ["https://a.tile.opentopomap.org/{z}/{x}/{y}.png",
                     "https://b.tile.opentopomap.org/{z}/{x}/{y}.png",
                     "https://c.tile.opentopomap.org/{z}/{x}/{y}.png"]
        src.tileSize = 256
        src.minzoom  = 5
        src.maxzoom  = 17
        src.attribution = "© OpenTopoMap (CC-BY-SA) · © OpenStreetMap contributors"
        // Держим в памяти больше плиток, чем помещается в кадр: иначе отъезд
        // и возврат камеры заново идут в сеть по каждому тайлу.
        src.tileCacheBudget = .megabytes(96)
        try? mapView.mapboxMap.addSource(src)

        var layer = RasterLayer(id: "topo-layer", source: "topo-overlay")
        layer.rasterOpacity = .constant(0.0)
        // Оба растра просились `.below("world-mask")`, и кто добавлен последним,
        // тот и оказывался сверху: включив OpenTopoMap поверх спутника, юзер
        // терял гравюру. Порядок задаём явно — историческая карта всегда выше,
        // она осознанный слой поверх основы, а OpenTopoMap саму основу заменяет.
        // Порядок задаём явно, а не полагаемся на очерёдность добавления.
        // Крутизна — накладка, она обязана быть выше основы, иначе включённый
        // на полную OpenTopoMap просто закрывал её собой.
        let below: LayerPosition
        if mapView.mapboxMap.layerExists(withId: "slope-layer") {
            below = .below("slope-layer")
        } else if mapView.mapboxMap.layerExists(withId: "histmap-backdrop") {
            below = .below("histmap-backdrop")
        } else {
            below = .below("world-mask")
        }
        try? mapView.mapboxMap.addLayer(layer, layerPosition: below)
    }

    private func removeTopoLayer(from mapView: MapView) {
        try? mapView.mapboxMap.removeLayer(withId: "topo-layer")
        try? mapView.mapboxMap.removeSource(withId: "topo-overlay")
    }

    private func updateTopoOpacity(_ alpha: Double) {
        guard isStyleLoaded, let mapView else { return }
        if alpha > 0.01 {
            ensureTopoLayer(on: mapView)
            try? mapView.mapboxMap.updateLayer(withId: "topo-layer", type: RasterLayer.self) { layer in
                layer.rasterOpacity = .constant(alpha)
            }
        } else {
            removeTopoLayer(from: mapView)
        }
        updateLabelLayers(hidden: alpha > 0.92, on: mapView)
        updateTrailColorsForTopo(alpha: alpha, on: mapView)
    }

    // MARK: - Хитмап троп

    /// Публичные GPS-треки OpenStreetMap: видно, где люди реально ходят, даже
    /// там, где тропа не нарисована. Слой кладём поверх маски, но под тропами и
    /// маршрутами — чтобы линии маршрутов не терялись. Как и топо, добавляем
    /// лениво: с opacity=0 Mapbox всё равно качал бы тайлы.
    private func updateTrailsHeatmap(_ show: Bool) {
        guard isStyleLoaded, let mapView else { return }

        // На своих тайлах хитмап уже внутри — это векторный слой `heat`,
        // собранный из публичных GPS-треков OSM. Он работает офлайн, не мылит
        // и не вылезает за Сербию, поэтому чужой растр здесь не нужен вовсе.
        if mapView.mapboxMap.layerExists(withId: "heat-core") {
            removeTrailsHeatmap(from: mapView)
            let v: Value<MapboxMaps.Visibility> = .constant(show ? .visible : .none)
            for id in ["heat-glow", "heat-core"] {
                try? mapView.mapboxMap.updateLayer(withId: id, type: LineLayer.self) { $0.visibility = v }
            }
            return
        }

        removeTrailsHeatmap(from: mapView)
        guard show else { return }

        var src = RasterSource(id: "trails-heat-source")
        src.tiles    = ["https://gps.tile.openstreetmap.org/lines/{z}/{x}/{y}.png"]
        src.tileSize = 256
        src.minzoom  = 3
        src.maxzoom  = 20
        src.attribution = "© OpenStreetMap contributors"
        try? mapView.mapboxMap.addSource(src)

        var layer = RasterLayer(id: "trails-heat-layer", source: "trails-heat-source")
        layer.rasterOpacity      = .constant(0.75)
        layer.rasterFadeDuration = .constant(0)
        // Строго под маску: тайлы хитмапа глобальные, и выше маски он заливал
        // разноцветной кашей всю Венгрию с Румынией. Слой троп добавляется
        // позже маски, поэтому «под тропами» означало «над маской».
        try? mapView.mapboxMap.addLayer(layer, layerPosition: .below("world-mask"))
        // Полупрозрачной маски мало — сквозь 75 % черноты яркие треки всё
        // равно читаются. На время хитмапа делаем её почти непрозрачной.
        setWorldMaskOpacity(0.96, on: mapView)
    }

    // MARK: - Историческая карта

    /// Австро-венгерская «Спецкарта» 1:75 000 (1900-е–1910-е) растром поверх основы.
    ///
    /// Тайлы свои: собраны из сканов Library of Congress (public domain), лежат
    /// в R2 и, если пользователь скачал набор, читаются с диска по `file://`.
    /// Поэтому источник заводится по `HistMapTiles.tilesURL`, а не по
    /// фиксированному адресу.
    ///
    /// Как и топо с хитмапом, слой добавляется **лениво**: при `opacity = 0`
    /// Mapbox всё равно качал бы тайлы.
    ///
    /// Кладём под маску мира: она гасит всё за границей Сербии, а тайлы у нас
    /// ровно по стране. Маршруты, тропы и станции добавляются позже, поэтому
    /// остаются поверх гравюры.
    private func updateHistMap(_ show: Bool) {
        guard isStyleLoaded, let mapView else { return }

        removeHistMap(from: mapView)
        // Без сети и без скачанного набора тайлы взять неоткуда. Раньше слой
        // в этом случае оставался на карте на подгруженных ранее тайлах, хотя
        // тумблер уже был выключен и погашен — выглядело как рассинхрон.
        guard show, appState.isOnline || HistMapTiles.isAvailable else { return }

        var src = RasterSource(id: "histmap-source")
        src.tiles = [HistMapTiles.tilesURL]
        // Плитка 512, а не 256. Разрешение то же самое — тайл z13 на 512 px
        // покрывает ту же землю с той же детальностью, что четыре тайла z14 на
        // 256 px, — но в кадре их вчетверо меньше. Растр под рельефом рисуется
        // через drape-проход, и его цена считается по числу текстур: на 256 px
        // включение гравюры заметно роняло кадры, и особенно это было видно по
        // анимациям SwiftUI (Mapbox рисует в главном потоке, так что карта
        // отъедает время прямо у них).
        src.tileSize = 512
        src.minzoom = HistMapTiles.minZoom
        src.maxzoom = HistMapTiles.maxZoom
        src.attribution = "Library of Congress · k.u.k. Militärgeographisches Institut"
        src.tileCacheBudget = .megabytes(128)
        try? mapView.mapboxMap.addSource(src)

        // Под гравюру кладём бумажную подложку. Тайлов «Спецкарты» хватает не
        // на всю Сербию, и без подложки покрытие обрывается прямо на
        // современную карту — выглядит как поломка. С ней край читается как
        // «сюда съёмка не дошла»: дальше просто чистый лист.
        //
        // Прозрачность у подложки общая с гравюрой, поэтому ползунок по-прежнему
        // проявляет современную карту — только теперь равномерно, а не пятнами.
        addHistMapBackdrop(on: mapView)

        var layer = RasterLayer(id: "histmap-layer", source: "histmap-source")
        layer.rasterOpacity = .constant(appState.histMapAlpha)
        layer.rasterFadeDuration = .constant(0)
        // Набор кончается на z14, дальше SDK растягивает родительский тайл.
        // Сглаженная интерполяция на гравюре выглядит как бумага под лупой,
        // а `.nearest` дал бы лестницы на штрихах.
        layer.rasterResampling = .constant(.linear)
        try? mapView.mapboxMap.addLayer(layer, layerPosition: .above("histmap-backdrop"))
        addHistMapEdge(on: mapView)
        // Современные подписи, горизонтали и железные дороги сознательно
        // оставляем поверх: на проверке в симуляторе они не спорят с гравюрой,
        // а работают ориентирами — по ним видно, где ты на старой карте.
    }

    /// Плотность гравюры меняем правкой слоя, а не пересборкой источника:
    /// иначе на каждом движении ползунка тайлы перезапрашивались бы заново.
    private func setHistMapOpacity(_ alpha: Double) {
        guard let mapView, mapView.mapboxMap.layerExists(withId: "histmap-layer") else { return }
        try? mapView.mapboxMap.updateLayer(withId: "histmap-layer", type: RasterLayer.self) { layer in
            layer.rasterOpacity = .constant(alpha)
        }
        try? mapView.mapboxMap.updateLayer(withId: "histmap-backdrop", type: FillLayer.self) { layer in
            layer.fillOpacity = .constant(alpha)
        }
        try? mapView.mapboxMap.updateLayer(withId: "histmap-edge", type: LineLayer.self) { layer in
            layer.lineOpacity = .constant(alpha)
        }
    }

    /// Подложка — заливка по полигону, а не `BackgroundLayer`.
    ///
    /// Первая версия была именно фоновым слоем, и на мелких зумах он работал,
    /// а стоило приблизиться — исчезал, обнажая современную карту. Причина в
    /// рельефе: при включённом `setTerrain` фоновый слой рисовать не на чем,
    /// у него нет геометрии, которую можно натянуть на DEM. Заливка полигоном
    /// на рельеф ложится нормально.
    private func addHistMapBackdrop(on mapView: MapView) {
        if !mapView.mapboxMap.imageExists(withId: "histmap-paper") {
            try? mapView.mapboxMap.addImage(Self.paperPattern(), id: "histmap-paper")
        }

        // С запасом вокруг рамки камеры: полигон должен перекрывать всё,
        // что вообще может попасть в кадр, включая наклон и поля по краям.
        let ring: [CLLocationCoordinate2D] = [
            CLLocationCoordinate2D(latitude: 37.0, longitude: 13.0),
            CLLocationCoordinate2D(latitude: 37.0, longitude: 29.0),
            CLLocationCoordinate2D(latitude: 51.0, longitude: 29.0),
            CLLocationCoordinate2D(latitude: 51.0, longitude: 13.0),
            CLLocationCoordinate2D(latitude: 37.0, longitude: 13.0)
        ]
        var src = GeoJSONSource(id: "histmap-backdrop-source")
        src.data = .feature(Feature(geometry: .polygon(Polygon([ring]))))
        try? mapView.mapboxMap.addSource(src)

        var backdrop = FillLayer(id: "histmap-backdrop", source: "histmap-backdrop-source")
        backdrop.fillPattern = .constant(.name("histmap-paper"))
        backdrop.fillOpacity = .constant(appState.histMapAlpha)
        try? mapView.mapboxMap.addLayer(backdrop, layerPosition: .below("world-mask"))
    }

    /// Клетка бумаги с еле заметной штриховкой. Диагональ идёт из угла в угол —
    /// только так плитка стыкуется сама с собой без швов.
    private static func paperPattern() -> UIImage {
        let side: CGFloat = 12
        return UIGraphicsImageRenderer(size: CGSize(width: side, height: side)).image { ctx in
            DS.topoPaperUI.setFill()
            ctx.fill(CGRect(x: 0, y: 0, width: side, height: side))

            DS.topoRoadCasingUI.withAlphaComponent(0.13).setStroke()
            let hatch = UIBezierPath()
            hatch.lineWidth = 1
            hatch.move(to: CGPoint(x: 0, y: side));        hatch.addLine(to: CGPoint(x: side, y: 0))
            hatch.move(to: CGPoint(x: 0, y: side / 2));    hatch.addLine(to: CGPoint(x: side / 2, y: 0))
            hatch.move(to: CGPoint(x: side / 2, y: side)); hatch.addLine(to: CGPoint(x: side, y: side / 2))
            hatch.stroke()
        }
    }

    /// Граница покрытия «Спецкарты» — тонкая рамка по краю отснятой площади.
    ///
    /// Одной бумажной подложки мало: пустая бумага рядом с гравюрой читается
    /// как «кусок не загрузился», а не как «сюда съёмка не дошла». Рамка
    /// снимает ровно эту двусмысленность — за ней ничего и не должно быть.
    /// Линия собрана из рамок листов (`tools/tiles`), поэтому совпадает с
    /// настоящим краем набора, а не приблизительно обводит страну.
    private func addHistMapEdge(on mapView: MapView) {
        guard !mapView.mapboxMap.sourceExists(withId: "histmap-edge-src"),
              let url = Bundle.main.url(forResource: "histmap_coverage", withExtension: "geojson"),
              let text = try? String(contentsOf: url, encoding: .utf8)
        else { return }

        var src = GeoJSONSource(id: "histmap-edge-src")
        src.data = .string(text)
        try? mapView.mapboxMap.addSource(src)

        var edge = LineLayer(id: "histmap-edge", source: "histmap-edge-src")
        edge.lineColor = .constant(StyleColor(UIColor(red: 0.36, green: 0.28, blue: 0.18, alpha: 0.85)))
        edge.lineWidth = .expression(
            Exp(.interpolate) { Exp(.linear); Exp(.zoom); 7.0; 1.0; 11.0; 1.8; 14.0; 2.6 })
        edge.lineDasharray = .constant([5, 3])
        edge.lineOpacity = .constant(appState.histMapAlpha)
        try? mapView.mapboxMap.addLayer(edge, layerPosition: .above("histmap-layer"))
    }

    private func removeHistMap(from mapView: MapView) {
        try? mapView.mapboxMap.removeLayer(withId: "histmap-edge")
        try? mapView.mapboxMap.removeSource(withId: "histmap-edge-src")
        try? mapView.mapboxMap.removeLayer(withId: "histmap-layer")
        try? mapView.mapboxMap.removeLayer(withId: "histmap-backdrop")
        try? mapView.mapboxMap.removeSource(withId: "histmap-backdrop-source")
        try? mapView.mapboxMap.removeSource(withId: "histmap-source")
    }

    private func setWorldMaskOpacity(_ value: Double, on mapView: MapView) {
        guard mapView.mapboxMap.layerExists(withId: "world-mask") else { return }
        try? mapView.mapboxMap.updateLayer(withId: "world-mask", type: FillLayer.self) { layer in
            layer.fillOpacity = .constant(value)
        }
    }

    private func removeTrailsHeatmap(from mapView: MapView) {
        try? mapView.mapboxMap.removeLayer(withId: "trails-heat-layer")
        try? mapView.mapboxMap.removeSource(withId: "trails-heat-source")
        setWorldMaskOpacity(0.75, on: mapView)
    }

    // Interpolate trail colors to contrast with topo map's orange/brown/yellow/green palette
    private func updateTrailColorsForTopo(alpha: Double, on mapView: MapView) {
        let t = max(0, min(1, alpha))
        guard t > 0.01 || t < 0.99 else { return }

        // PSS: orange → deep violet (topo has zero violet)
        let pssFrom = UIColor(red: 1.0,  green: 0.55, blue: 0.10, alpha: 1)
        let pssTo   = UIColor(red: 0.52, green: 0.15, blue: 0.82, alpha: 1)
        // OSM: green → cyan-blue
        let osmFrom = UIColor(red: 0.35, green: 0.85, blue: 0.42, alpha: 1)
        let osmTo   = UIColor(red: 0.14, green: 0.60, blue: 0.95, alpha: 1)
        // Completed routes: DS red → deep teal
        let cFrom   = DS.completedUI
        let cTo     = UIColor(red: 0.05, green: 0.62, blue: 0.72, alpha: 1)
        // Planned routes: DS yellow → indigo
        let pFrom   = DS.plannedUI
        let pTo     = UIColor(red: 0.40, green: 0.20, blue: 0.85, alpha: 1)

        let pssColor = lerp(pssFrom, pssTo, t)
        let osmColor = lerp(osmFrom, osmTo, t)
        let cColor   = lerp(cFrom,   cTo,   t)
        let pColor   = lerp(pFrom,   pTo,   t)

        for (id, color) in [("pss-trails-layer", pssColor), ("osm-hiking-trails", osmColor),
                            ("all-trails-c", cColor), ("all-trails-p", pColor)] {
            guard mapView.mapboxMap.layerExists(withId: id) else { continue }
            try? mapView.mapboxMap.updateLayer(withId: id, type: LineLayer.self) { l in
                l.lineColor = .constant(StyleColor(color))
            }
        }
        // Also update glow
        if mapView.mapboxMap.layerExists(withId: "pss-trails-glow") {
            try? mapView.mapboxMap.updateLayer(withId: "pss-trails-glow", type: LineLayer.self) { l in
                l.lineColor = .constant(StyleColor(pssColor.withAlphaComponent(0.30)))
            }
        }
    }

    private func lerp(_ a: UIColor, _ b: UIColor, _ t: Double) -> UIColor {
        var r1: CGFloat = 0, g1: CGFloat = 0, b1: CGFloat = 0, a1: CGFloat = 0
        var r2: CGFloat = 0, g2: CGFloat = 0, b2: CGFloat = 0, a2: CGFloat = 0
        a.getRed(&r1, green: &g1, blue: &b1, alpha: &a1)
        b.getRed(&r2, green: &g2, blue: &b2, alpha: &a2)
        let f = CGFloat(t)
        return UIColor(red: r1+(r2-r1)*f, green: g1+(g2-g1)*f, blue: b1+(b2-b1)*f, alpha: a1)
    }

    private func updateLabelLayers(hidden: Bool, on mapView: MapView) {
        let customIds: Set<String> = ["photo-marker-symbols"]
        // ⚠️ Список — «свои слои, которых это не касается». Добавляя новый
        // символьный слой, не забудь его сюда: иначе он будет молча гаснуть
        // вместе с подписями карты, стоит вывести OpenTopoMap на полную.
        // Именно так пропадали вода и укрытия — слой на карте есть, видимость
        // выставлена, а его тут же гасит эта функция.
        let customPrefixes = ["route-", "topo-", "osm-", "pss-", "world-",
                              "all-trails-", "custom-", "constructor-", "scrubber",
                              "start-finish", "cave-", "water-poi", "shelter-poi"]
        for info in mapView.mapboxMap.allLayerIdentifiers {
            guard info.type == .symbol else { continue }
            let id = info.id
            guard !customIds.contains(id) else { continue }
            guard !customPrefixes.contains(where: { id.hasPrefix($0) }) else { continue }
            try? mapView.mapboxMap.updateLayer(withId: id, type: SymbolLayer.self) { layer in
                layer.visibility = .constant(hidden ? .none : .visible)
            }
        }
    }

    private func addPSSTrailsLayer(_ mapView: MapView) {
        guard let url = Bundle.main.url(forResource: "pss_routes", withExtension: "geojson")
        else { return }

        // Load + parse off main thread — 4 MB file, avoid blocking style setup
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let data = try? Data(contentsOf: url) else { return }

            // JSONSerialization handles 2D and 3D coords, null properties — no Turf issues
            var segments: [TrailSnapService.Segment] = []
            if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let rawFeatures = json["features"] as? [[String: Any]] {
                segments = rawFeatures.flatMap { feat -> [TrailSnapService.Segment] in
                    guard let geom = feat["geometry"] as? [String: Any],
                          (geom["type"] as? String) == "LineString",
                          let rawCoords = geom["coordinates"] as? [[Any]]
                    else { return [] }
                    let coords: [CLLocationCoordinate2D] = rawCoords.compactMap {
                        guard $0.count >= 2,
                              let lon = $0[0] as? Double,
                              let lat = $0[1] as? Double
                        else { return nil }
                        return CLLocationCoordinate2D(latitude: lat, longitude: lon)
                    }
                    guard coords.count >= 2 else { return [] }
                    return zip(coords, coords.dropFirst()).map { ($0, $1) }
                }
            }

            // Pass raw GeoJSON string — Mapbox's native C++ parser handles 3D coords
            guard let geoJSONString = String(data: data, encoding: .utf8) else { return }

            // Parse named PSS routes for the list UI (also extract 3D elevations)
            var pssRoutes: [PSSRoute] = []
            if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let rawFeatures = json["features"] as? [[String: Any]] {
                pssRoutes = rawFeatures.compactMap { feat -> PSSRoute? in
                    guard let props = feat["properties"] as? [String: Any],
                          let name  = props["name"] as? String,
                          let slug  = props["slug"] as? String,
                          let geom  = feat["geometry"] as? [String: Any],
                          (geom["type"] as? String) == "LineString",
                          let rawC  = geom["coordinates"] as? [[Any]]
                    else { return nil }
                    var coords: [CLLocationCoordinate2D] = []
                    var elevs: [Double] = []
                    for c in rawC {
                        guard c.count >= 2,
                              let lon = c[0] as? Double,
                              let lat = c[1] as? Double
                        else { continue }
                        coords.append(CLLocationCoordinate2D(latitude: lat, longitude: lon))
                        if c.count >= 3, let ele = c[2] as? Double { elevs.append(ele) }
                    }
                    guard !coords.isEmpty else { return nil }
                    if elevs.count != coords.count { elevs = [] }
                    return PSSRoute(id: slug, name: name,
                                   url: props["url"] as? String,
                                   coordinates: coords,
                                   elevations: elevs)
                }
            }

            DispatchQueue.main.async { [weak self] in
                guard let self, let mapView = self.mapView else { return }
                self.pssSnapSegments = segments
                self.rebuildRoutingSegments()
                self.appState.pssRoutes = pssRoutes

                var src = GeoJSONSource(id: "pss-trails-source")
                src.data = .string(geoJSONString)
                try? mapView.mapboxMap.addSource(src)

                let pssOrange = UIColor(red: 1.0, green: 0.55, blue: 0.1, alpha: 1)
                let showPSS = self.appState.showPSSTrails

                // Dark casing (outline) — zoom-dependent, hidden at low zoom to avoid clutter
                var casing = LineLayer(id: "pss-trails-casing", source: "pss-trails-source")
                casing.lineColor = .constant(StyleColor(UIColor.black.withAlphaComponent(0.50)))
                casing.lineWidth = .expression(
                    Exp(.interpolate) {
                        Exp(.linear); Exp(.zoom)
                        9.0; 0.0
                        10.5; 3.5
                        14.0; 7.0
                    }
                )
                casing.lineOpacity = .constant(showPSS ? 0.65 : 0.0)
                casing.lineCap     = .constant(.round)
                casing.lineJoin    = .constant(.round)
                try? mapView.mapboxMap.addLayer(casing, layerPosition: .below("route-hitboxes"))

                // Glow (wider, blurred-looking underlay)
                var glow = LineLayer(id: "pss-trails-glow", source: "pss-trails-source")
                glow.lineColor   = .constant(StyleColor(pssOrange.withAlphaComponent(0.28)))
                glow.lineWidth   = .constant(8.0)
                glow.lineBlur    = .constant(3.5)
                glow.lineCap     = .constant(.round)
                glow.lineJoin    = .constant(.round)
                glow.lineOpacity = .constant(showPSS ? 0.9 : 0.0)
                try? mapView.mapboxMap.addLayer(glow, layerPosition: .above("pss-trails-casing"))

                var layer = LineLayer(id: "pss-trails-layer", source: "pss-trails-source")
                layer.lineColor   = .constant(StyleColor(pssOrange))
                layer.lineWidth   = .constant(2.2)
                layer.lineOpacity = .constant(showPSS ? 0.85 : 0.0)
                layer.lineCap     = .constant(.round)
                layer.lineJoin    = .constant(.round)
                try? mapView.mapboxMap.addLayer(layer, layerPosition: .above("pss-trails-glow"))
                // No general shimmer — shimmer only on selected route
            }
        }
    }

    private func toggleLayer(id: String, visible: Bool, on mapView: MapView) {
        guard mapView.mapboxMap.layerExists(withId: id) else { return }
        try? mapView.mapboxMap.updateLayer(withId: id, type: LineLayer.self) { layer in
            layer.lineOpacity = .constant(visible ? 0.85 : 0.0)
        }
        // Toggle companion glow
        let glowId = id.replacingOccurrences(of: "-layer", with: "-glow")
        if mapView.mapboxMap.layerExists(withId: glowId) {
            try? mapView.mapboxMap.updateLayer(withId: glowId, type: LineLayer.self) { l in
                l.lineOpacity = .constant(visible ? 0.9 : 0.0)
            }
        }
        // Toggle shimmer + manage animation timer
        let shimmerId: String
        if id.hasSuffix("-trails") {
            shimmerId = id + "-shimmer"
        } else {
            shimmerId = id.replacingOccurrences(of: "-layer", with: "-shimmer")
        }
        if mapView.mapboxMap.layerExists(withId: shimmerId) {
            try? mapView.mapboxMap.updateLayer(withId: shimmerId, type: LineLayer.self) { l in
                l.lineOpacity = .constant(visible ? 0.95 : 0.0)
            }
        }
    }

    // Shimmer-таймер удалён: 10 Hz updateLayer заставлял Mapbox перерисовывать
    // всю сцену 10 раз в секунду → +30–50% CPU. Пусть светятся статично.
    func startShimmerAnimation() {}
    func stopShimmerIfUnneeded() {}

    // MARK: - PSS trail layer toggle (no shimmer for the general layer)

    private func togglePSSTrailsLayer(visible: Bool, on mapView: MapView) {
        for (id, baseOp) in [("pss-trails-casing", 0.65), ("pss-trails-glow", 0.9), ("pss-trails-layer", 0.85)] {
            guard mapView.mapboxMap.layerExists(withId: id) else { continue }
            try? mapView.mapboxMap.updateLayer(withId: id, type: LineLayer.self) { l in
                l.lineOpacity = .constant(visible ? baseOp : 0.0)
            }
        }
        if !visible { stopShimmerIfUnneeded() }
    }

    // MARK: - Selected PSS route highlight

    private func onSelectedPSSRouteChanged(_ route: PSSRoute?) {
        guard isStyleLoaded, let mapView else { return }

        // Remove previous selection layers
        for id in ["pss-selected-shimmer", "pss-selected-line",
                   "pss-selected-glow",   "pss-selected-casing"] {
            try? mapView.mapboxMap.removeLayer(withId: id)
        }
        try? mapView.mapboxMap.removeSource(withId: "pss-selected-src")

        guard let route, !route.coordinates.isEmpty else {
            stopShimmerIfUnneeded()
            return
        }

        // Раскраска по уклону — та же палитра, что на графике высот
        // PSS-карточки; свечение ниже остаётся оранжевым (фирменный цвет
        // клуба), меняется только сама линия.
        let gradeGradient = GradeColor.mapGradient(coordinates: route.coordinates,
                                                    elevations: route.elevations)

        var src = GeoJSONSource(id: "pss-selected-src")
        src.data = .geometry(.lineString(LineString(route.coordinates)))
        src.lineMetrics = gradeGradient != nil
        try? mapView.mapboxMap.addSource(src)

        let pssColor = UIColor(red: 1.0, green: 0.55, blue: 0.1, alpha: 1)

        var casing = LineLayer(id: "pss-selected-casing", source: "pss-selected-src")
        casing.lineColor   = .constant(StyleColor(UIColor.white.withAlphaComponent(0.55)))
        casing.lineWidth   = .constant(8.0)
        casing.lineOpacity = .constant(0.65)
        casing.lineCap     = .constant(.round)
        casing.lineJoin    = .constant(.round)
        let casingBase = mapView.mapboxMap.layerExists(withId: "pss-trails-layer")
            ? "pss-trails-layer" : "world-mask"
        try? mapView.mapboxMap.addLayer(casing, layerPosition: .above(casingBase))

        var glow = LineLayer(id: "pss-selected-glow", source: "pss-selected-src")
        glow.lineColor   = .constant(StyleColor(pssColor.withAlphaComponent(0.38)))
        glow.lineWidth   = .constant(14.0)
        glow.lineBlur    = .constant(5.0)
        glow.lineCap     = .constant(.round)
        glow.lineJoin    = .constant(.round)
        try? mapView.mapboxMap.addLayer(glow, layerPosition: .above("pss-selected-casing"))

        var line = LineLayer(id: "pss-selected-line", source: "pss-selected-src")
        if let gradient = gradeGradient {
            line.lineGradient = .expression(gradient)
        } else {
            line.lineColor = .constant(StyleColor(pssColor))
        }
        line.lineWidth   = .constant(4.0)
        line.lineOpacity = .constant(1.0)
        line.lineCap     = .constant(.round)
        line.lineJoin    = .constant(.round)
        try? mapView.mapboxMap.addLayer(line, layerPosition: .above("pss-selected-glow"))

        var shimmer = LineLayer(id: "pss-selected-shimmer", source: "pss-selected-src")
        shimmer.lineColor   = .constant(StyleColor(UIColor.white.withAlphaComponent(0.22)))
        shimmer.lineWidth   = .constant(3.0)
        shimmer.lineCap     = .constant(.round)
        shimmer.lineJoin    = .constant(.round)
        shimmer.lineOpacity = .constant(0.20)
        try? mapView.mapboxMap.addLayer(shimmer, layerPosition: .above("pss-selected-line"))

        startShimmerAnimation()
    }

    // MARK: - Route dot markers
    private func addRouteMarkers(_ mapView: MapView) {
        var source = GeoJSONSource(id: "route-markers")
        source.data = .featureCollection(FeatureCollection(features: markerFeatures()))
        try? mapView.mapboxMap.addSource(source)

        var circles = CircleLayer(id: "route-hitboxes", source: "route-markers")
        circles.circleRadius = .expression(
            Exp(.interpolate) {
                Exp(.linear); Exp(.zoom)
                5.0; 4.0
                10.0; 5.5
                14.0; 6.5
                18.0; 5.5
            }
        )
        circles.circleColor = .expression(Exp(.switchCase) {
            Exp(.eq) { Exp(.get) { "type" }; "custom" }
            Exp(.rgba) { 122.0; 94.0; 166.0; 1.0 }
            Exp(.eq) { Exp(.get) { "type" }; "planned" }
            Exp(.rgba) { 255.0; 215.0; 0.0; 1.0 }
            Exp(.rgba) { 255.0; 77.0; 77.0; 1.0 }
        })
        circles.circleStrokeWidth    = .constant(2.0)
        circles.circleStrokeColor    = .constant(StyleColor(.white))
        circles.circleOpacity        = .constant(0.82)
        circles.circleStrokeOpacity  = .constant(0.70)
        circles.circlePitchAlignment = .constant(.map)
        try? mapView.mapboxMap.addLayer(circles)
    }

    private func markerFeatures() -> [Feature] {
        var features = appState.filteredRoutes.compactMap { route -> Feature? in
            guard let stats = appState.routeStats[route.id] else { return nil }
            var f = Feature(geometry: .point(Point(stats.midpointCoord)))
            f.properties = [
                "routeId": .string(route.id),
                "type":    .string(route.isPlanned ? "planned" : "completed")
            ]
            return f
        }

        // Свои маршруты — там же, где показывается их линия: в «Мои» и в «Все».
        // Середину берём прямо из сохранённых массивов: собирать ради точки
        // весь список координат (а это тысячи точек на маршрут) незачем.
        if appState.filter == .mine || appState.filter == .all {
            for route in appState.customRouteStore.routes {
                let mid = route.waypointLats.count / 2
                guard route.waypointLats.indices.contains(mid),
                      route.waypointLons.indices.contains(mid) else { continue }
                var f = Feature(geometry: .point(Point(CLLocationCoordinate2D(
                    latitude: route.waypointLats[mid], longitude: route.waypointLons[mid]))))
                f.properties = [
                    "customId": .string(route.id),
                    "type":     .string("custom")
                ]
                features.append(f)
            }
        }
        return features
    }

    private func refreshMarkers() {
        guard isStyleLoaded, let mapView,
              mapView.mapboxMap.sourceExists(withId: "route-markers") else { return }
        mapView.mapboxMap.updateGeoJSONSource(
            withId: "route-markers",
            geoJSON: .featureCollection(FeatureCollection(features: markerFeatures()))
        )
    }

    // MARK: - Show / clear selected route
    private func showRoute(_ route: Route, stats: RouteStats, on mapView: MapView, fly: Bool) {
        drawnRouteId = route.id
        drawLine(route, stats: stats, on: mapView)
        addStartFinish(stats: stats, on: mapView)
        drawPhotoMarkers(stats: stats, routeId: route.id, on: mapView)
        if fly {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.42) { [weak self, weak mapView] in
                guard let self, let mapView else { return }
                self.flyToRoute(stats: stats, on: mapView)
            }
        }
    }

    private func clearActiveRoute(on mapView: MapView) {
        try? mapView.mapboxMap.removeLayer(withId: "route-line-casing")
        try? mapView.mapboxMap.removeLayer(withId: "route-line-layer")
        try? mapView.mapboxMap.removeSource(withId: "route-line-source")
        clearPhotoMarkers(on: mapView)
        mapView.annotations.removeAnnotationManager(withId: "start-finish")
        drawnRouteId = nil
    }

    private func drawLine(_ route: Route, stats: RouteStats, on mapView: MapView) {
        try? mapView.mapboxMap.removeLayer(withId: "route-line-casing")
        try? mapView.mapboxMap.removeLayer(withId: "route-line-layer")
        try? mapView.mapboxMap.removeSource(withId: "route-line-source")

        // Раскраска по уклону (см. GradeColor) — та же палитра, что на
        // графике высот, градиентом вдоль линии. nil (высот нет, например
        // маршрут впервые открыт офлайн) — откат на сплошную линию цвета
        // типа маршрута, чтобы линия не пропала вовсе.
        let gradeGradient = GradeColor.mapGradient(coordinates: stats.coordinates,
                                                    elevations: stats.elevations)

        var src = GeoJSONSource(id: "route-line-source")
        src.data = .geometry(.lineString(LineString(stats.coordinates)))
        src.lineMetrics = gradeGradient != nil
        try? mapView.mapboxMap.addSource(src)

        // Dark casing for better contrast on satellite
        var casing = LineLayer(id: "route-line-casing", source: "route-line-source")
        casing.lineColor   = .constant(StyleColor(UIColor.black.withAlphaComponent(0.55)))
        casing.lineWidth   = .constant(7.5)
        casing.lineCap     = .constant(.round)
        casing.lineJoin    = .constant(.round)
        casing.lineOpacity = .constant(0.60)
        try? mapView.mapboxMap.addLayer(casing, layerPosition: .below("route-hitboxes"))

        var layer = LineLayer(id: "route-line-layer", source: "route-line-source")
        if let gradient = gradeGradient {
            layer.lineGradient = .expression(gradient)
        } else {
            layer.lineColor = .constant(StyleColor(route.lineColor))
        }
        layer.lineWidth   = .constant(4.5)
        layer.lineCap     = .constant(.round)
        layer.lineJoin    = .constant(.round)
        layer.lineOpacity = .constant(0.92)
        try? mapView.mapboxMap.addLayer(layer, layerPosition: .above("route-line-casing"))
    }

    private func addStartFinish(stats: RouteStats, on mapView: MapView) {
        guard let first = stats.coordinates.first, let last = stats.coordinates.last else { return }
        let isLoop = CLLocation(latitude: first.latitude, longitude: first.longitude)
            .distance(from: CLLocation(latitude: last.latitude, longitude: last.longitude)) < 500

        var anns: [PointAnnotation] = []
        if isLoop {
            var a = PointAnnotation(coordinate: first)
            a.image = .init(image: makePin(.loop), name: "pin-loop")
            anns.append(a)
        } else {
            var s = PointAnnotation(coordinate: first)
            s.image = .init(image: makePin(.start), name: "pin-start")
            var f = PointAnnotation(coordinate: last)
            f.image = .init(image: makePin(.finish), name: "pin-finish")
            anns += [s, f]
        }
        var peak = PointAnnotation(coordinate: stats.peakCoord)
        peak.image = .init(image: makePin(.peak), name: "pin-peak")
        anns.append(peak)

        let mgr = mapView.annotations.makePointAnnotationManager(id: "start-finish")
        mgr.iconPitchAlignment = .map
        mgr.annotations = anns
    }

    // MARK: - Photo markers
    private func drawPhotoMarkers(stats: RouteStats, routeId: String, on mapView: MapView) {
        clearPhotoMarkers(on: mapView)
        guard !stats.photoCoordinates.isEmpty else { return }

        try? mapView.mapboxMap.addImage(makePhotoPin(), id: "photo-pin")

        let features = stats.photoCoordinates.map { idx, coord -> Feature in
            var f = Feature(geometry: .point(Point(coord)))
            f.properties = [
                "type":     .string("photo"),
                "routeId":  .string(routeId),
                "photoIdx": .number(Double(idx))
            ]
            return f
        }

        var src = GeoJSONSource(id: "photo-marker-source")
        src.data = .featureCollection(FeatureCollection(features: features))
        try? mapView.mapboxMap.addSource(src)

        var sym = SymbolLayer(id: "photo-marker-symbols", source: "photo-marker-source")
        sym.iconImage        = .constant(.name("photo-pin"))
        sym.iconSize         = .constant(0.9)
        sym.iconAllowOverlap = .constant(true)
        sym.iconAnchor       = .constant(.bottom)
        try? mapView.mapboxMap.addLayer(sym)
    }

    private func clearPhotoMarkers(on mapView: MapView) {
        try? mapView.mapboxMap.removeLayer(withId: "photo-marker-symbols")
        try? mapView.mapboxMap.removeSource(withId: "photo-marker-source")
    }

    // MARK: - All trails toggle
    private func updateAllTrails(showAll: Bool, stats: [String: RouteStats]) {
        guard isStyleLoaded, let mapView else { return }

        try? mapView.mapboxMap.removeLayer(withId: "all-trails-c")
        try? mapView.mapboxMap.removeLayer(withId: "all-trails-p")
        try? mapView.mapboxMap.removeSource(withId: "all-trails-c-src")
        try? mapView.mapboxMap.removeSource(withId: "all-trails-p-src")

        guard showAll else { return }

        func addLayer(routes: [Route], srcId: String, layerId: String, color: UIColor) {
            let features = routes.compactMap { r -> Feature? in
                guard let s = stats[r.id] else { return nil }
                return Feature(geometry: .lineString(LineString(s.coordinates)))
            }
            guard !features.isEmpty else { return }
            var src = GeoJSONSource(id: srcId)
            src.data = .featureCollection(FeatureCollection(features: features))
            try? mapView.mapboxMap.addSource(src)
            var layer = LineLayer(id: layerId, source: srcId)
            layer.lineColor   = .constant(StyleColor(color))
            layer.lineWidth   = .constant(3.0)
            layer.lineCap     = .constant(.round)
            layer.lineJoin    = .constant(.round)
            layer.lineOpacity = .constant(0.75)
            try? mapView.mapboxMap.addLayer(layer, layerPosition: .below("route-hitboxes"))
        }

        addLayer(routes: RouteStore.completedRoutes, srcId: "all-trails-c-src",
                 layerId: "all-trails-c", color: DS.completedUI)
        addLayer(routes: RouteStore.plannedRoutes,   srcId: "all-trails-p-src",
                 layerId: "all-trails-p", color: DS.plannedUI)
    }

    // MARK: - Custom saved routes
    func refreshCustomRoutesOnMap(filter: RouteFilter, selected: CustomRoute?, allRoutes: [CustomRoute]) {
        guard isStyleLoaded, let mapView else { return }

        let selectionChanged = shownCustomRouteId != selected?.id
        // Закрыли карточку своего маршрута — камера отъезжает на обзор, как и
        // после обычного маршрута (`onSelectedRouteChanged(nil)`).
        if selectionChanged, selected == nil, shownCustomRouteId != nil,
           !appState.isConstructorMode {
            flyToOverview(on: mapView)
        }
        shownCustomRouteId = selected?.id
        refreshMarkers()

        // Clear previous layers
        try? mapView.mapboxMap.removeLayer(withId: "custom-all-lines")
        try? mapView.mapboxMap.removeSource(withId: "custom-all-src")
        try? mapView.mapboxMap.removeLayer(withId: "custom-sel-line")
        try? mapView.mapboxMap.removeLayer(withId: "custom-sel-casing")
        try? mapView.mapboxMap.removeSource(withId: "custom-sel-src")
        mapView.annotations.removeAnnotationManager(withId: "custom-route-pins")

        let purple = UIColor(red: 0.48, green: 0.37, blue: 0.65, alpha: 1)

        // Бледные линии всех своих маршрутов — в «Мои» и в «Все»: список в
        // этих вкладках их показывает, значит и на карте они должны быть.
        if (filter == .mine || filter == .all) && !allRoutes.isEmpty {
            let features: [Feature] = allRoutes.compactMap { r in
                guard r.coordinates.count >= 2 else { return nil }
                return Feature(geometry: .lineString(LineString(r.coordinates)))
            }
            if !features.isEmpty {
                var src = GeoJSONSource(id: "custom-all-src")
                src.data = .featureCollection(FeatureCollection(features: features))
                try? mapView.mapboxMap.addSource(src)
                var layer = LineLayer(id: "custom-all-lines", source: "custom-all-src")
                layer.lineColor   = .constant(StyleColor(purple))
                layer.lineWidth   = .constant(3.2)
                layer.lineOpacity = .constant(0.72)
                layer.lineCap     = .constant(.round)
                layer.lineJoin    = .constant(.round)
                try? mapView.mapboxMap.addLayer(layer, layerPosition: .below("route-hitboxes"))
            }
        }

        // Highlight selected route
        if let route = selected, route.coordinates.count >= 2 {
            let coords = route.coordinates
            // Раскраска по уклону — та же палитра, что на графике высот
            // карточки своего маршрута. Пока высоты не догрузились
            // (см. CustomRoute.elevations, асинхронно после сохранения) —
            // сплошная фиолетовая линия, как раньше.
            let gradeGradient = GradeColor.mapGradient(coordinates: coords,
                                                        elevations: route.elevations ?? [])

            var src = GeoJSONSource(id: "custom-sel-src")
            src.data = .geometry(.lineString(LineString(coords)))
            src.lineMetrics = gradeGradient != nil
            try? mapView.mapboxMap.addSource(src)

            var casing = LineLayer(id: "custom-sel-casing", source: "custom-sel-src")
            casing.lineColor   = .constant(StyleColor(UIColor.black.withAlphaComponent(0.55)))
            casing.lineWidth   = .constant(7.5)
            casing.lineCap     = .constant(.round)
            casing.lineJoin    = .constant(.round)
            casing.lineOpacity = .constant(0.60)
            try? mapView.mapboxMap.addLayer(casing, layerPosition: .below("route-hitboxes"))

            var layer = LineLayer(id: "custom-sel-line", source: "custom-sel-src")
            if let gradient = gradeGradient {
                layer.lineGradient = .expression(gradient)
            } else {
                layer.lineColor = .constant(StyleColor(purple))
            }
            layer.lineWidth   = .constant(4.5)
            layer.lineOpacity = .constant(0.95)
            layer.lineCap     = .constant(.round)
            layer.lineJoin    = .constant(.round)
            try? mapView.mapboxMap.addLayer(layer, layerPosition: .above("custom-sel-casing"))

            var startAnn = PointAnnotation(coordinate: coords.first!)
            startAnn.image = .init(image: makePin(.start), name: "pin-start")
            var endAnn = PointAnnotation(coordinate: coords.last!)
            endAnn.image = .init(image: makePin(.finish), name: "pin-finish")
            mapView.annotations.makePointAnnotationManager(id: "custom-route-pins").annotations = [startAnn, endAnn]

            // Облёт — только на смену выбора: иначе камера дёргалась бы каждый
            // раз, когда в маршрут дописываются высоты.
            guard selectionChanged else { return }
            let screenH = UIScreen.main.bounds.height
            let padding = UIEdgeInsets(top: 80, left: 40, bottom: screenH * 0.3, right: 40)
            if let cam = try? mapView.mapboxMap.camera(
                for: coords,
                camera: CameraOptions(bearing: 0, pitch: 20),
                coordinatesPadding: padding,
                maxZoom: 14,
                offset: nil
            ) {
                mapView.camera.ease(to: cam, duration: 1.2, curve: .easeInOut, completion: nil)
            }
        }
    }

    // MARK: - Тропы из тайлов

    /// Вытаскивает тропы из загруженных векторных тайлов. Нужны и для
    /// притяжения точки (в PSS лежат только именованные маршруты), и как
    /// граф для офлайн-прокладки. Запрос идёт по тайлам, которые уже есть
    /// у карты, — то есть по тому куску, на который сейчас смотрит рисующий.
    func refreshTileTrailSegments(force: Bool = false) {
        guard let mapView, isStyleLoaded, appState.isConstructorMode else { return }
        let camera = mapView.mapboxMap.cameraState
        // Ниже z11 троп в тайлах просто нет — незачем и спрашивать
        guard camera.zoom >= 11 else { return }
        let now = Date()
        if !force {
            guard now.timeIntervalSince(lastTrailQueryTime) >= 2 else { return }
            if let last = lastTrailQueryCenter,
               abs(camera.zoom - lastTrailQueryZoom) < 1,
               TrailRouter.meters(last, camera.center) < 1500 { return }
            trailQueryRetries = 0
        }
        lastTrailQueryTime = now
        let queriedCenter = camera.center
        let queriedZoom   = camera.zoom

        // У Mapbox тропы лежат в composite/road, у своих тайлов — в topo/transportation
        let hasOwnTiles = mapView.mapboxMap.sourceExists(withId: "topo")
        let sourceId    = hasOwnTiles ? "topo" : "composite"
        let sourceLayer = hasOwnTiles ? "transportation" : "road"
        let classes     = ["path", "track", "footway", "steps", "pedestrian"]
        let filter: [Any] = ["match", ["get", "class"], classes, true, false]

        _ = mapView.mapboxMap.querySourceFeatures(
            for: sourceId,
            options: SourceQueryOptions(sourceLayerIds: [sourceLayer], filter: filter)
        ) { [weak self] result in
            guard case .success(let features) = result, !features.isEmpty else {
                // Сразу после переезда камеры тайлы ещё едут, и ответ приходит
                // пустой. Событий карты на это не будет — она уже «в покое»,
                // — так что переспрашиваем сами.
                self?.retryTileTrailQuery()
                return
            }
            DispatchQueue.global(qos: .userInitiated).async {
                var segments: [TrailSnapService.Segment] = []
                for queried in features {
                    let feature = queried.queriedFeature.feature
                    // Класс проверяем и сами: фильтр уезжает в ядро сырым JSON
                    if case .string(let cls)? = feature.properties?["class"] ?? nil,
                       !classes.contains(cls) { continue }
                    let lines: [[CLLocationCoordinate2D]]
                    switch feature.geometry {
                    case .lineString(let ls):       lines = [ls.coordinates]
                    case .multiLineString(let mls): lines = mls.coordinates
                    default: continue
                    }
                    for coords in lines where coords.count >= 2 {
                        segments.append(contentsOf: zip(coords, coords.dropFirst()).map { ($0, $1) })
                    }
                }
                DispatchQueue.main.async {
                    guard let self else { return }
                    // Кадр запоминаем только когда тропы реально приехали
                    self.lastTrailQueryCenter = queriedCenter
                    self.lastTrailQueryZoom   = queriedZoom
                    self.trailQueryRetries    = 0
                    self.osmTrailSegments     = segments
                    self.rebuildRoutingSegments()
                }
            }
        }
    }

    private func retryTileTrailQuery() {
        guard appState.isConstructorMode,
              trailQueryRetries < Coordinator.maxTrailQueryRetries else { return }
        trailQueryRetries += 1
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in
            self?.refreshTileTrailSegments(force: true)
        }
    }

    /// Пересобирает общий набор отрезков и двигает поколение — по нему
    /// `TrailGraphCache` понимает, что собранный граф устарел.
    func rebuildRoutingSegments() {
        routingSegments = pssSnapSegments + osmTrailSegments
        routingSegmentsToken &+= 1
    }

    // MARK: - Бегунок по профилю

    /// Свободная часть экрана, пока ведут ползунок: сверху шкала, снизу блок
    /// профиля — под них прятать точку маршрута нельзя.
    private func scrubSafeRect(in bounds: CGRect) -> CGRect {
        let profile = appState.profileBlockFrame
        let bottomInset = profile.height > 0
            ? max(0, bounds.maxY - profile.minY) + 16
            : bounds.height * 0.38
        return bounds.inset(by: UIEdgeInsets(top: 130, left: 24, bottom: bottomInset, right: 24))
    }

    /// Уехал бегунок из видимой части — переносим камеру так, чтобы стало
    /// видно и его, и весь маршрут. Зум при этом подбирается под свободный
    /// кусок экрана, а не под весь кадр.
    func keepScrubberVisible() {
        guard let mapView, appState.isScrubbingProfile, !isFramingScrub,
              let marker = appState.scrubberCoordinate else { return }
        let bounds = mapView.bounds.isEmpty ? UIScreen.main.bounds : mapView.bounds
        let safe = scrubSafeRect(in: bounds)
        guard safe.width > 40, safe.height > 40 else { return }

        let viewCenter = CGPoint(x: bounds.midX, y: bounds.midY)
        let markerPoint = unclampedPoint(for: marker, on: mapView, viewCenter: viewCenter)
        guard !safe.contains(markerPoint) else { return }

        let map: MapboxMap = mapView.mapboxMap
        let bearing = map.cameraState.bearing
        let route = appState.scrubRouteCoordinates.isEmpty ? [marker] : appState.scrubRouteCoordinates

        // Зум под весь кадр, потом ужимаем под свободный прямоугольник
        let fitted = map.camera(for: route, padding: .zero, bearing: bearing, pitch: 0)
        guard let fittedCenter = fitted.center, let fittedZoom = fitted.zoom else { return }
        let shrink = min(safe.width / bounds.width, safe.height / bounds.height)
        let zoom = min(17.5, max(5.0, fittedZoom + log2(Double(shrink))))

        // Центр сдвигаем так, чтобы маршрут встал в середину свободной части,
        // а не кадра: иначе половина уедет под карточку
        let offset = CGPoint(x: viewCenter.x - safe.midX, y: viewCenter.y - safe.midY)
        let center = coordinate(from: fittedCenter, offsetPixels: offset, zoom: zoom, bearing: bearing)

        isFramingScrub = true
        stopFollowing()
        mapView.camera.ease(
            to: CameraOptions(center: center, padding: .zero, zoom: zoom, bearing: bearing, pitch: 0),
            duration: 0.45, curve: .easeInOut
        ) { [weak self] _ in self?.isFramingScrub = false }
    }

    /// Координата, сдвинутая от базовой на столько-то экранных точек.
    /// Обратная к `unclampedPoint`: та же меркаторова арифметика.
    private func coordinate(from base: CLLocationCoordinate2D,
                            offsetPixels: CGPoint,
                            zoom: Double,
                            bearing: Double) -> CLLocationCoordinate2D {
        let worldSize = 512.0 * pow(2.0, zoom)
        let b = bearing * .pi / 180
        let dx = Double(offsetPixels.x) * cos(b) - Double(offsetPixels.y) * sin(b)
        let dy = Double(offsetPixels.x) * sin(b) + Double(offsetPixels.y) * cos(b)

        let clamped = min(max(base.latitude, -85.051129), 85.051129)
        let sinLat = sin(clamped * .pi / 180)
        let x = (base.longitude + 180) / 360 + dx / worldSize
        let y = 0.5 - log((1 + sinLat) / (1 - sinLat)) / (4 * .pi) + dy / worldSize

        let lon = x * 360 - 180
        let lat = atan(sinh(.pi * (1 - 2 * y))) * 180 / .pi
        return CLLocationCoordinate2D(latitude: lat, longitude: lon)
    }

    // MARK: - Жесты карты

    /// Одиночный тап не считаем жестом: он и есть то, чем ставят точку.
    private func isMapGesture(_ type: GestureType) -> Bool { type != .singleTap }

    // MARK: - Прицел в центре кадра

    /// Ставит точку туда, куда смотрит прицел — в центр карты. Тем же путём,
    /// что и тап: с притяжением к тропе и прокладкой от предыдущей точки.
    private func placeWaypointAtAim() {
        guard let mapView, appState.isConstructorMode else { return }
        // Именно `coordinate(for:)` от середины экрана, а не `cameraState.center`:
        // при ненулевых отступах камеры её центр — это середина не экрана, а
        // области за вычетом отступов, и точка вставала выше прицела.
        let bounds = mapView.bounds.isEmpty ? UIScreen.main.bounds : mapView.bounds
        var placed = mapView.mapboxMap.coordinate(
            for: CGPoint(x: bounds.midX, y: bounds.midY))
        if appState.isSnapEnabled,
           let snapped = TrailSnapService.findSnapInMemory(near: placed, segments: routingSegments) {
            placed = snapped
        }
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        appState.addConstructorWaypoint(placed)
    }

    /// Экранные координаты последней опоры и центра карты: от первой ко второму
    /// интерфейс тянет пунктирную «резинку».
    func updateConstructorAim() {
        guard let mapView, appState.isConstructorMode else {
            if appState.constructorAnchorScreen != nil { appState.constructorAnchorScreen = nil }
            return
        }
        let bounds = mapView.bounds.isEmpty ? UIScreen.main.bounds : mapView.bounds
        let center = CGPoint(x: bounds.midX, y: bounds.midY)
        if appState.mapCenterScreen != center { appState.mapCenterScreen = center }

        guard let last = appState.constructorWaypoints.last else {
            if appState.constructorAnchorScreen != nil { appState.constructorAnchorScreen = nil }
            return
        }
        let projected = anchorPoint(for: last, on: mapView, bounds: bounds, viewCenter: center)
        if appState.constructorAnchorScreen != projected { appState.constructorAnchorScreen = projected }
    }

    /// Экранная точка опоры, годная и за пределами кадра.
    ///
    /// `point(for:)` снаружи вида прижимает результат к краю — «резинка»
    /// прыгала в угол экрана, стоило последней точке уехать за кадр. Пока
    /// точка в кадре, берём ответ SDK: он учитывает параллакс рельефа
    /// (пара пунктов разницы). Как только она вышла — считаем сами.
    private func anchorPoint(for coordinate: CLLocationCoordinate2D,
                             on mapView: MapView,
                             bounds: CGRect,
                             viewCenter: CGPoint) -> CGPoint {
        let flat = unclampedPoint(for: coordinate, on: mapView, viewCenter: viewCenter)
        return bounds.contains(flat) ? mapView.mapboxMap.point(for: coordinate) : flat
    }

    /// Проекция без оглядки на кадр: при нулевом наклоне это обычная
    /// Меркаторова арифметика, с наклоном (в конструкторе его нет) — SDK.
    private func unclampedPoint(for coordinate: CLLocationCoordinate2D,
                                on mapView: MapView,
                                viewCenter: CGPoint) -> CGPoint {
        let camera = mapView.mapboxMap.cameraState
        guard camera.pitch < 1 else { return mapView.mapboxMap.point(for: coordinate) }

        func mercator(_ c: CLLocationCoordinate2D) -> (x: Double, y: Double) {
            let clamped = min(max(c.latitude, -85.051129), 85.051129)
            let sinLat  = sin(clamped * .pi / 180)
            return ((c.longitude + 180) / 360,
                    0.5 - log((1 + sinLat) / (1 - sinLat)) / (4 * .pi))
        }

        // Мир при zoom = z шириной 512 · 2^z точек — это соглашение Mapbox
        let worldSize = 512.0 * pow(2.0, camera.zoom)
        let target = mercator(coordinate)
        // Отсчитываем от координаты под `viewCenter`, а не от центра камеры:
        // с ненулевыми отступами это разные точки, и «резинка» прыгала ровно
        // на их разницу, когда опора уходила за край кадра и расчёт
        // переключался с ответа SDK на этот.
        let origin = mercator(mapView.mapboxMap.coordinate(for: viewCenter))
        let dx = (target.x - origin.x) * worldSize
        let dy = (target.y - origin.y) * worldSize

        let bearing = camera.bearing * .pi / 180
        let cosB = cos(bearing), sinB = sin(bearing)
        return CGPoint(x: viewCenter.x + dx * cosB + dy * sinB,
                       y: viewCenter.y - dx * sinB + dy * cosB)
    }

    // MARK: - Constructor polyline
    func updateConstructorPolyline(waypoints: [CLLocationCoordinate2D], legs: [ConstructorLeg]) {
        guard isStyleLoaded, let mapView else { return }

        try? mapView.mapboxMap.removeLayer(withId: "constructor-line")
        try? mapView.mapboxMap.removeSource(withId: "constructor-src")
        try? mapView.mapboxMap.removeLayer(withId: "constructor-straight-line")
        try? mapView.mapboxMap.removeSource(withId: "constructor-straight-src")
        try? mapView.mapboxMap.removeLayer(withId: "constructor-dots-layer")
        try? mapView.mapboxMap.removeSource(withId: "constructor-dots-src")

        guard !waypoints.isEmpty else { return }

        // Тропы рисуем сплошной линией, прямые куски — пунктиром: сразу видно,
        // где маршрут лёг на тропу, а где пошёл напрямик
        var onTrail: [Feature] = []
        var direct:  [Feature] = []
        for leg in legs where leg.path.count >= 2 {
            let feature = Feature(geometry: .lineString(LineString(leg.path)))
            if leg.kind == .trail { onTrail.append(feature) } else { direct.append(feature) }
        }

        let accent = UIColor(red: 1.0, green: 0.55, blue: 0.1, alpha: 1)

        if !onTrail.isEmpty {
            var src = GeoJSONSource(id: "constructor-src")
            src.data = .featureCollection(FeatureCollection(features: onTrail))
            try? mapView.mapboxMap.addSource(src)

            var layer = LineLayer(id: "constructor-line", source: "constructor-src")
            layer.lineColor = .constant(StyleColor(accent))
            layer.lineWidth = .constant(4.0)
            layer.lineCap   = .constant(.round)
            layer.lineJoin  = .constant(.round)
            try? mapView.mapboxMap.addLayer(layer)
        }

        if !direct.isEmpty {
            var src = GeoJSONSource(id: "constructor-straight-src")
            src.data = .featureCollection(FeatureCollection(features: direct))
            try? mapView.mapboxMap.addSource(src)

            var layer = LineLayer(id: "constructor-straight-line", source: "constructor-straight-src")
            layer.lineColor     = .constant(StyleColor(accent.withAlphaComponent(0.75)))
            layer.lineWidth     = .constant(3.0)
            layer.lineCap       = .constant(.round)
            layer.lineJoin      = .constant(.round)
            layer.lineDasharray = .constant([4, 3])
            try? mapView.mapboxMap.addLayer(layer)
        }

        drawConstructorDots(waypoints, on: mapView)
    }

    private func drawConstructorDots(_ waypoints: [CLLocationCoordinate2D], on mapView: MapView) {
        let features: [Feature] = waypoints.enumerated().map { idx, coord in
            var f = Feature(geometry: .point(Point(coord)))
            f.properties = ["isFirst": .boolean(idx == 0)]
            return f
        }

        var src = GeoJSONSource(id: "constructor-dots-src")
        src.data = .featureCollection(FeatureCollection(features: features))
        try? mapView.mapboxMap.addSource(src)

        // CircleLayer needs no images — always visible regardless of style state
        var circles = CircleLayer(id: "constructor-dots-layer", source: "constructor-dots-src")
        circles.circleRadius = .expression(Exp(.switchCase) {
            Exp(.get) { "isFirst" }
            8.5
            5.5
        })
        circles.circleColor = .constant(StyleColor(UIColor(red: 1.0, green: 0.55, blue: 0.1, alpha: 1)))
        circles.circleStrokeWidth  = .constant(2.5)
        circles.circleStrokeColor  = .constant(StyleColor(.white))
        circles.circlePitchAlignment = .constant(.map)
        try? mapView.mapboxMap.addLayer(circles)
    }

    // MARK: - Camera
    private func flyToRoute(stats: RouteStats, on mapView: MapView) {
        stopFollowing()
        let corners: [CLLocationCoordinate2D] = [
            stats.boundsSW,
            CLLocationCoordinate2D(latitude: stats.boundsSW.latitude, longitude: stats.boundsNE.longitude),
            stats.boundsNE,
            CLLocationCoordinate2D(latitude: stats.boundsNE.latitude, longitude: stats.boundsSW.longitude)
        ]
        let screenH = UIScreen.main.bounds.height
        let padding = UIEdgeInsets(top: 100, left: 40, bottom: screenH * 0.62, right: 40)
        guard let cam = try? mapView.mapboxMap.camera(
            for: corners,
            camera: CameraOptions(bearing: 0, pitch: 35),
            coordinatesPadding: padding,
            maxZoom: 14,
            offset: nil
        ) else { return }
        mapView.camera.ease(to: cam, duration: 1.4, curve: .easeInOut, completion: nil)
    }

    /// Облёт к участку маршрута, выделенному на графике высот (двойной тап +
    /// протяжка в `ElevationChartView`/`CustomElevationChart`). Тот же приём
    /// с четырьмя углами bbox, что у `flyToRoute`, но без наклона — это
    /// разбор конкретного куска тропы, а не обзорный облёт.
    private func flyToBounds(sw: CLLocationCoordinate2D, ne: CLLocationCoordinate2D) {
        guard let mapView else { return }
        stopFollowing()
        let corners: [CLLocationCoordinate2D] = [
            sw,
            CLLocationCoordinate2D(latitude: sw.latitude, longitude: ne.longitude),
            ne,
            CLLocationCoordinate2D(latitude: ne.latitude, longitude: sw.longitude)
        ]
        let screenH = UIScreen.main.bounds.height
        let padding = UIEdgeInsets(top: 100, left: 40, bottom: screenH * 0.62, right: 40)
        guard let cam = try? mapView.mapboxMap.camera(
            for: corners,
            camera: CameraOptions(bearing: 0, pitch: 0),
            coordinatesPadding: padding,
            maxZoom: 17,
            offset: nil
        ) else { return }
        mapView.camera.ease(to: cam, duration: 0.9, curve: .easeInOut, completion: nil)
    }

    private func flyToOverview(on mapView: MapView) {
        stopFollowing()
        mapView.camera.ease(to: CameraOptions(
            center: CLLocationCoordinate2D(latitude: 44.2107, longitude: 20.9029),
            zoom: 6.5, pitch: 0
        ), duration: 1.2, curve: .easeInOut, completion: nil)
    }

    // MARK: - Scrubber annotation
    private func updateScrubberAnnotation(_ coord: CLLocationCoordinate2D?) {
        guard isStyleLoaded else { return }
        if scrubberManager == nil, let mapView {
            scrubberManager = mapView.annotations.makePointAnnotationManager(id: "scrubber")
        }
        guard let coord else { scrubberManager?.annotations = []; return }
        var ann = PointAnnotation(coordinate: coord)
        ann.image = .init(image: makeScrubberDot(), name: "scrubber-dot")
        scrubberManager?.annotations = [ann]
    }

    // MARK: - Pin type (Style C — Glow Minimal, no tail)
    private enum PinType { case start, finish, loop, peak }

    private func makePin(_ type: PinType, size: CGFloat = 44) -> UIImage {
        let (bg, label): (UIColor, String) = switch type {
        case .start:  (UIColor(red: 0.180, green: 0.800, blue: 0.443, alpha: 1), "S")
        case .finish: (UIColor(red: 0.906, green: 0.298, blue: 0.235, alpha: 1), "F")
        case .loop:   (UIColor(red: 1.000, green: 0.341, blue: 0.133, alpha: 1), "↻")
        case .peak:   (UIColor(red: 1.000, green: 0.757, blue: 0.027, alpha: 1), "▲")
        }

        return UIGraphicsImageRenderer(size: CGSize(width: size, height: size)).image { ctx in
            let c = size / 2
            let outerR = size * 0.46
            let innerR = size * 0.30

            // Glow halo
            ctx.cgContext.setShadow(offset: .zero, blur: size * 0.30,
                                    color: bg.withAlphaComponent(0.65).cgColor)
            bg.withAlphaComponent(0.18).setFill()
            UIBezierPath(ovalIn: CGRect(x: c - outerR, y: c - outerR,
                                        width: outerR * 2, height: outerR * 2)).fill()

            // Solid circle
            ctx.cgContext.setShadow(offset: CGSize(width: 0, height: 1.5), blur: 5,
                                    color: UIColor.black.withAlphaComponent(0.40).cgColor)
            bg.setFill()
            UIBezierPath(ovalIn: CGRect(x: c - innerR, y: c - innerR,
                                        width: innerR * 2, height: innerR * 2)).fill()

            // Inner white ring
            ctx.cgContext.setShadow(offset: .zero, blur: 0, color: nil)
            UIColor.white.withAlphaComponent(0.80).setStroke()
            let ring = UIBezierPath(ovalIn: CGRect(x: c - innerR + 1.5, y: c - innerR + 1.5,
                                                   width: (innerR - 1.5) * 2, height: (innerR - 1.5) * 2))
            ring.lineWidth = 1.5; ring.stroke()

            // Label
            let fontSize: CGFloat = type == .peak ? size * 0.24 : size * 0.30
            let font = UIFont.systemFont(ofSize: fontSize, weight: .black)
            let attrs: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: UIColor.white]
            let str = NSAttributedString(string: label, attributes: attrs)
            let sz  = str.size()
            str.draw(at: CGPoint(x: c - sz.width / 2, y: c - sz.height / 2 - 0.5))
        }
    }

    private func makePhotoPin(size: CGFloat = 36) -> UIImage {
        let tail: CGFloat = 8
        let totalH = size + tail
        let bg = UIColor(red: 0.20, green: 0.60, blue: 1.00, alpha: 1)  // #33AAFF
        return UIGraphicsImageRenderer(size: CGSize(width: size, height: totalH)).image { ctx in
            let r      = size / 2 - 2.5
            let center = CGPoint(x: size/2, y: size/2)

            ctx.cgContext.setShadow(offset: CGSize(width: 0, height: 2), blur: 5,
                                    color: UIColor.black.withAlphaComponent(0.40).cgColor)
            bg.setFill()
            UIBezierPath(ovalIn: CGRect(x: center.x-r, y: center.y-r, width: r*2, height: r*2)).fill()

            let tip = CGPoint(x: size/2, y: totalH-1)
            let tailPath = UIBezierPath()
            tailPath.move(to: CGPoint(x: size/2-5, y: size-2))
            tailPath.addLine(to: CGPoint(x: size/2+5, y: size-2))
            tailPath.addLine(to: tip)
            tailPath.close()
            bg.setFill(); tailPath.fill()

            ctx.cgContext.setShadow(offset: .zero, blur: 0, color: nil)
            UIColor.white.setStroke()
            let ring = UIBezierPath(ovalIn: CGRect(x: center.x-r, y: center.y-r, width: r*2, height: r*2))
            ring.lineWidth = 2; ring.stroke()

            let conf = UIImage.SymbolConfiguration(pointSize: size*0.34, weight: .bold)
            if let icon = UIImage(systemName: "camera.fill", withConfiguration: conf) {
                let sz   = icon.size
                let rect = CGRect(x: (size-sz.width)/2, y: (size-sz.height)/2 - 1,
                                  width: sz.width, height: sz.height)
                icon.withTintColor(.white).draw(in: rect)
            }
        }
    }

    private func makeDotImage(color: UIColor, size: CGFloat = 44) -> UIImage {
        UIGraphicsImageRenderer(size: CGSize(width: size, height: size)).image { ctx in
            let c = size / 2
            color.withAlphaComponent(0.30).setFill()
            UIBezierPath(ovalIn: CGRect(x: 4, y: 4, width: size-8, height: size-8)).fill()
            let wR = size * 0.23
            ctx.cgContext.setShadow(offset: CGSize(width: 0, height: 2), blur: 6,
                                    color: UIColor.black.withAlphaComponent(0.55).cgColor)
            UIColor.white.setFill()
            UIBezierPath(ovalIn: CGRect(x: c-wR, y: c-wR, width: wR*2, height: wR*2)).fill()
            ctx.cgContext.setShadow(offset: .zero, blur: 0, color: nil)
            let r = size * 0.16
            color.setFill()
            UIBezierPath(ovalIn: CGRect(x: c-r, y: c-r, width: r*2, height: r*2)).fill()
        }
    }

    private func makeScrubberDot(size: CGFloat = 28) -> UIImage {
        UIGraphicsImageRenderer(size: CGSize(width: size, height: size)).image { _ in
            let c = size / 2, r = size * 0.28
            UIColor.white.withAlphaComponent(0.3).setFill()
            UIBezierPath(ovalIn: CGRect(x: 1, y: 1, width: size-2, height: size-2)).fill()
            DS.accentUI.setFill()
            UIBezierPath(ovalIn: CGRect(x: c-r, y: c-r, width: r*2, height: r*2)).fill()
            UIColor.white.setStroke()
            let b = UIBezierPath(ovalIn: CGRect(x: c-r-1.5, y: c-r-1.5, width: (r+1.5)*2, height: (r+1.5)*2))
            b.lineWidth = 1.5; b.stroke()
        }
    }
}

// MARK: - GestureManagerDelegate

/// Пока карту двигают, тап по ней ничего не ставит: после сдвига, зума,
/// поворота и наклона система всё равно присылает одиночное касание.
extension Coordinator: GestureManagerDelegate {
    func gestureManager(_ gestureManager: GestureManager, didBegin gestureType: GestureType) {
        guard isMapGesture(gestureType) else { return }
        activeGestures += 1
    }

    func gestureManager(_ gestureManager: GestureManager, didEnd gestureType: GestureType, willAnimate: Bool) {
        guard isMapGesture(gestureType) else { return }
        activeGestures = max(0, activeGestures - 1)
        lastGestureEnd = Date()
    }

    func gestureManager(_ gestureManager: GestureManager, didEndAnimatingFor gestureType: GestureType) {
        guard isMapGesture(gestureType) else { return }
        lastGestureEnd = Date()
    }
}
