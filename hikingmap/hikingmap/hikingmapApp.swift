import SwiftUI
import MapboxMaps

/// Фоновая загрузка тайлов доживает до конца, даже если приложение свернули.
/// Система будит его этим методом — без него докачанный файл остался бы
/// незамеченным до следующего запуска вручную.
final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication,
                     handleEventsForBackgroundURLSession identifier: String,
                     completionHandler: @escaping () -> Void) {
        // Наборов два, у каждого своя фоновая сессия — иначе система не
        // разберёт, чью загрузку она возобновляет
        TileSetDownloader.all
            .first { $0.spec.sessionIdentifier == identifier }?
            .backgroundCompletionHandler = completionHandler
    }
}

@main
struct hikingmapApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var appState = AppState()

    init() {
        MapboxOptions.accessToken = "pk.eyJ1IjoidG9jemtpamciLCJhIjoiY21uYWE1dnY0MGdjMTJwcDYwMW9hN3IzbyJ9.z8vVKr9lNliGDfC5Kd8Ttg"
        // Карта читает скачанные офлайн-регионы из TileStore, но сама туда ничего
        // не пишет — иначе обычное листание карты незаметно копило бы гигабайты.
        // Ставим до создания любых объектов Mapbox, иначе настройка не применится.
        MapboxMapsOptions.tileStoreUsageMode = .readOnly
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(appState)
                .preferredColorScheme(.dark)
        }
    }
}
