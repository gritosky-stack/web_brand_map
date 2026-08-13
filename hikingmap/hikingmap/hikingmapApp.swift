import SwiftUI
import MapboxMaps

@main
struct hikingmapApp: App {
    @StateObject private var appState = AppState()

    init() {
        MapboxOptions.accessToken = "pk.eyJ1IjoidG9jemtpamciLCJhIjoiY21uYWE1dnY0MGdjMTJwcDYwMW9hN3IzbyJ9.z8vVKr9lNliGDfC5Kd8Ttg"
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(appState)
                .preferredColorScheme(.dark)
        }
    }
}
