# hikingmap — iOS-приложение (SwiftUI)

Нативное приложение с картой пеших маршрутов. ~79 Swift-файлов.

## Архитектура
- `hikingmapApp.swift` — точка входа. `ContentView.swift` — корневой экран.
- `AppState.swift` — центральный `ObservableObject` (выбранный маршрут, фильтры,
  режимы: конструктор, OSM/PSS-слои, запись трека). Большинство экранов читают его.
- `Models/` — доменные типы: `Route`, `CustomRoute`, `PSSRoute`, `GPXParser`,
  `RouteMatcher` (подбор маршрута под запрос), `TrackRecording`, `CavePoint`.
- `Views/` — SwiftUI-экраны (детали маршрута, графики высот, AI-ассистент, карта Mapbox).
- `Services/` — `ElevationService`, `TrackRecorder`, `TrailSnapService`.
- `DesignTokens.swift` — цвета/отступы/типографика. Используй токены, не хардкодь значения.

## Сборка и запуск (симулятор)
```
xcodebuild -scheme hikingmap -sdk iphonesimulator \
  -destination 'platform=iOS Simulator,name=iPhone 16' -configuration Debug build
```
Запуск/установку на симулятор делать через `xcrun simctl`.

## Конвенции
- Состояние — через `@Published` в `AppState`, не плодить параллельные источники истины.
- GPX-парсинг — только через `GPXParser`, не писать ад-хок разбор XML.
- Новые цвета/размеры — добавлять в `DesignTokens`, ссылаться оттуда.
- Комментарии на русском допустимы и приветствуются — следуй окружающему стилю.
