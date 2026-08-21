import SwiftUI
import MapboxMaps
import CoreLocation

// MARK: - Моя локация
//
// Кнопка `MyLocationButton` шлёт `appState.locateRequest` — дальше всё здесь.
// Режимы гоняются по кругу: idle → follow → heading → follow. Из слежения
// выводит только жест по карте: `ViewportOptions.transitionsToIdleUponUserInteraction`
// роняет viewport в idle, а мы по этому событию гасим подсветку кнопки.
//
// Слежение делает не наш код, а `FollowPuckViewportState` из SDK: он сам
// доводит камеру за паком и за компасом. Наше — только первый облёт и наклон.

extension Coordinator: ViewportStatusObserver {

    /// Зум, на котором показываем пользователя: видно и тропу под ногами,
    /// и куда она уходит дальше.
    private static var userZoom: CGFloat { 15.3 }

    /// Радиус, на котором щупаем рельеф вокруг пользователя
    private static var reliefProbeRadius: CLLocationDistance { 900 }

    // MARK: - Настройка

    func setupMyLocation(on mapView: MapView) {
        // Пак включаем только с уже выданным разрешением — иначе Mapbox
        // покажет системный диалог сразу на старте.
        if LocationPermission.shared.isAuthorized { enablePuck(on: mapView) }

        mapView.viewport.addStatusObserver(self)

        appState.locateRequest
            .receive(on: DispatchQueue.main)
            .sink { [weak self] in self?.handleLocateRequest() }
            .store(in: &cancellables)

        // Согласие в системном диалоге равносильно нажатию кнопки: юзер
        // ответил «да» именно затем, чтобы его показали на карте.
        LocationPermission.shared.didGrant
            .receive(on: DispatchQueue.main)
            .sink { [weak self] in self?.handleLocateRequest() }
            .store(in: &cancellables)
    }

    private func enablePuck(on mapView: MapView) {
        guard !isPuckEnabled else { return }
        isPuckEnabled = true
        mapView.location.options.puckType = .puck2D(Puck2DConfiguration(
            pulsing: .init(color: DS.accentUI.withAlphaComponent(0.40), radius: .accuracy),
            showsAccuracyRing: true
        ))
        mapView.location.options.puckBearing = .heading
    }

    // MARK: - Нажатие кнопки

    func handleLocateRequest() {
        guard let mapView else { return }
        enablePuck(on: mapView)

        let pitch = CGFloat(mapView.mapboxMap.cameraState.pitch)
        switch appState.locationFollowMode {
        case .idle:
            // Первое нажатие — облёт к пользователю и включение слежения
            withUserLocation { [weak self] coord in self?.flyToUser(coord) }
        case .follow:
            // Второе — доворачиваем карту по компасу, лететь уже никуда не надо
            engageFollow(heading: true, pitch: pitch, animated: true)
        case .heading:
            engageFollow(heading: false, pitch: pitch, animated: true)
        }
    }

    /// Отдаёт координату пользователя: сразу, если засечка уже есть, иначе
    /// ждёт первую — после выдачи разрешения GPS молчит ещё пару секунд,
    /// и всё это время кнопка крутит дугу поиска.
    private func withUserLocation(_ body: @escaping (CLLocationCoordinate2D) -> Void) {
        guard let mapView else { return }

        if let coord = mapView.location.latestLocation?.coordinate {
            body(coord)
            return
        }

        appState.isAwaitingLocationFix = true
        locationFixSubscription = mapView.location.onLocationChange.observeNext { [weak self] locations in
            guard let self, let coord = locations.last?.coordinate else { return }
            self.locationFixSubscription = nil
            self.appState.isAwaitingLocationFix = false
            body(coord)
        }

        // Под крышей или с выключенным GPS засечки можно не дождаться вовсе —
        // через десять секунд перестаём крутить кнопку.
        DispatchQueue.main.asyncAfter(deadline: .now() + 10) { [weak self] in
            guard let self, self.appState.isAwaitingLocationFix else { return }
            self.locationFixSubscription = nil
            self.appState.isAwaitingLocationFix = false
        }
    }

    // MARK: - Облёт

    /// Облёт к пользователю в две стадии: сначала дуга `fly` (Mapbox отводит
    /// камеру вверх и опускает у цели), потом наклон под местный рельеф.
    ///
    /// Разделены нарочно. На старте облёта DEM-тайлы вокруг цели ещё не
    /// загружены, `elevation(at:)` вернул бы nil, и наклон пришлось бы брать
    /// с потолка. К концу первой стадии высоты уже есть.
    private func flyToUser(_ coord: CLLocationCoordinate2D) {
        guard let mapView else { return }

        // Карта покрывает только Сербию с окрестностями. Лететь к точке вне
        // рамки бессмысленно: Mapbox прижмёт камеру к её углу — в море под
        // Албанией, — и это выглядит как случайный телепорт. Честнее сказать.
        let box = Coordinator.regionBounds
        let insideRegion = coord.latitude  >= box.southwest.latitude
            && coord.latitude  <= box.northeast.latitude
            && coord.longitude >= box.southwest.longitude
            && coord.longitude <= box.northeast.longitude
        guard insideRegion else {
            appState.showLocationOutOfRegionAlert = true
            appState.locationFollowMode = .idle
            return
        }

        mapView.viewport.idle()
        appState.locationFollowMode = .follow

        lastProgrammaticFly = Date()
        mapView.camera.fly(
            to: CameraOptions(center: coord, padding: followPadding,
                              zoom: Self.userZoom, bearing: 0, pitch: 0),
            duration: 1.5
        ) { [weak self] _ in
            guard let self, let mapView = self.mapView else { return }
            let pitch = self.reliefPitch(around: coord)
            mapView.camera.ease(to: CameraOptions(pitch: pitch),
                                duration: 0.75, curve: .easeInOut) { _ in
                self.engageFollow(heading: false, pitch: pitch, animated: false)
            }
        }
    }

    /// Наклон камеры по местному рельефу. На равнине смотрим сверху — так
    /// карта читается лучше; в горах заваливаем камеру, чтобы был виден объём
    /// склонов. Высоты берём из того же DEM, на котором стоит `setTerrain`.
    private func reliefPitch(around coord: CLLocationCoordinate2D) -> CGFloat {
        guard let mapView else { return 0 }

        let dLat = Self.reliefProbeRadius / 111_320.0
        let dLon = Self.reliefProbeRadius / (111_320.0 * max(0.2, cos(coord.latitude * .pi / 180)))

        var probes: [CLLocationCoordinate2D] = [coord]
        for i in 0..<8 {
            let a = Double(i) / 8 * 2 * .pi
            probes.append(CLLocationCoordinate2D(latitude:  coord.latitude  + sin(a) * dLat,
                                                 longitude: coord.longitude + cos(a) * dLon))
        }

        let elevations = probes.compactMap { mapView.mapboxMap.elevation(at: $0) }
        // Тайлов DEM может не быть вовсе — офлайн или непрогретый кэш.
        // Тогда берём умеренный наклон: он уместен и на равнине, и в горах.
        guard elevations.count >= 4,
              let lo = elevations.min(), let hi = elevations.max() else { return 35 }

        // Перепад на круге 1.8 км: до 30 м — равнина, от 300 м — горы
        let t = min(1, max(0, (hi - lo - 30) / 270))
        return CGFloat(t * 55)
    }

    // MARK: - Слежение

    private func engageFollow(heading: Bool, pitch: CGFloat, animated: Bool) {
        guard let mapView else { return }
        mapView.location.options.puckBearingEnabled = heading

        let state = mapView.viewport.makeFollowPuckViewportState(
            options: FollowPuckViewportStateOptions(
                padding: followPadding,
                zoom: CGFloat(mapView.mapboxMap.cameraState.zoom),
                bearing: heading ? .heading : .constant(0),
                pitch: pitch
            )
        )
        followState = state

        let transition: ViewportTransition = animated
            ? mapView.viewport.makeDefaultViewportTransition(options: .init(maxDuration: 0.9))
            : mapView.viewport.makeImmediateViewportTransition()
        mapView.viewport.transition(to: state, transition: transition, completion: nil)

        appState.locationFollowMode = heading ? .heading : .follow
    }

    /// Пак держим выше центра экрана: снизу карту закрывает панель маршрутов,
    /// а смотреть по ходу движения интереснее вперёд, чем себе под ноги.
    private var followPadding: UIEdgeInsets {
        UIEdgeInsets(top: 0, left: 0, bottom: UIScreen.main.bounds.height * 0.16, right: 0)
    }

    /// Снимает слежение перед любым другим облётом камеры: пока активен
    /// viewport-стейт, он перебивает наши `camera.ease` — камера дёргается
    /// обратно к паку на каждом кадре.
    func stopFollowing() {
        guard appState.locationFollowMode != .idle else { return }
        mapView?.location.options.puckBearingEnabled = false
        mapView?.viewport.idle()
        followState = nil
        appState.locationFollowMode = .idle
    }

    // MARK: - ViewportStatusObserver

    func viewportStatusDidChange(from fromStatus: ViewportStatus,
                                 to toStatus: ViewportStatus,
                                 reason: ViewportStatusChangeReason) {
        // Только жест пользователя. На собственный `viewport.idle()` не
        // реагируем: его мы зовём и в начале облёта, когда режим как раз
        // должен зажечься, а не погаснуть.
        guard case .idle = toStatus, reason == .userInteraction else { return }
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.mapView?.location.options.puckBearingEnabled = false
            self.followState = nil
            self.appState.locationFollowMode = .idle
        }
    }
}
