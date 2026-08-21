import XCTest

/// Не проверка, а глаза: открывает карточку маршрута и складывает снимки
/// экрана в `SNAPSHOT_DIR`, чтобы посмотреть на профиль высот (ось X,
/// полка максимума, выделение участка) на живом приложении, а не в голове.
/// Без переменной окружения тест ничего не делает — в общий прогон не лезет.
final class ProfileChartSnapshot: XCTestCase {

    private var directory: String? {
        ProcessInfo.processInfo.environment["SNAPSHOT_DIR"]
    }

    private func save(_ app: XCUIApplication, _ name: String) {
        guard let directory else { return }
        let png = app.screenshot().pngRepresentation
        try? png.write(to: URL(fileURLWithPath: "\(directory)/\(name).png"))
    }

    func testRouteCardProfile() throws {
        try XCTSkipIf(directory == nil, "нет SNAPSHOT_DIR — снимки не нужны")

        let app = XCUIApplication()
        app.launch()
        // Список маршрутов наливается разбором GPX — ждём, пока появится
        Thread.sleep(forTimeInterval: 6)
        save(app, "01-map")

        // Раскрываем список маршрутов «шевроном» в правом нижнем углу
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.93, dy: 0.955)).tap()
        Thread.sleep(forTimeInterval: 2)
        save(app, "01b-list")
        if let directory {
            try? app.debugDescription.write(toFile: "\(directory)/tree.txt",
                                            atomically: true, encoding: .utf8)
        }
        // Строка маршрута — это кнопка с длинной подписью «имя, км, набор…»
        let row = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Ovčar")).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 20), "маршрут не появился в списке")
        row.tap()
        Thread.sleep(forTimeInterval: 4)
        save(app, "02-card")

        // Небольшая прокрутка, чтобы блок профиля целиком попал на экран
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.62))
            .press(forDuration: 0.05,
                   thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.42)))
        Thread.sleep(forTimeInterval: 2)
        save(app, "03-profile")

        // Панель «Слои»: выезд из-под кнопки и уход обратно
        let layers = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Слои")).firstMatch
        if layers.waitForExistence(timeout: 5) {
            layers.tap()
            Thread.sleep(forTimeInterval: 1.5)
            save(app, "05-layers-open")
            app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Скрыть")).firstMatch.tap()
            Thread.sleep(forTimeInterval: 1.5)
            save(app, "06-layers-closed")
        }
    }
}
