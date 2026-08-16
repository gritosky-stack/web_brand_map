import Foundation
import CoreLocation
import Combine

/// Разрешение на геолокацию для кнопки «моя локация».
///
/// Живёт отдельно от `TrackRecorder`: тот просит `always` ради фоновой записи
/// трека, а карте хватает `whenInUse`. Важнее другое — момент вопроса. Пока
/// разрешения нет, пак Mapbox мы не включаем: SDK сам поднимает системный
/// диалог при первой же отрисовке карты, и юзер получал бы его на старте,
/// не понимая, зачем. Спрашиваем по первому нажатию на кнопку.
final class LocationPermission: NSObject, ObservableObject, CLLocationManagerDelegate {
    static let shared = LocationPermission()

    @Published private(set) var status: CLAuthorizationStatus = .notDetermined

    /// Срабатывает, когда юзер согласился в системном диалоге. Карта на это
    /// подписана, чтобы долететь до пользователя сразу, без второго нажатия.
    let didGrant = PassthroughSubject<Void, Never>()

    private let manager = CLLocationManager()
    private var awaitingAnswer = false

    private override init() {
        super.init()
        manager.delegate = self
        status = manager.authorizationStatus
    }

    var isAuthorized: Bool {
        status == .authorizedWhenInUse || status == .authorizedAlways
    }

    var isDenied: Bool {
        status == .denied || status == .restricted
    }

    func request() {
        guard status == .notDetermined else { return }
        awaitingAnswer = true
        manager.requestWhenInUseAuthorization()
    }

    // MARK: - CLLocationManagerDelegate

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        status = manager.authorizationStatus
        guard awaitingAnswer, status != .notDetermined else { return }
        awaitingAnswer = false
        if isAuthorized { didGrant.send() }
    }
}
