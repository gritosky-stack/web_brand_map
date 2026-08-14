import Foundation

/// Своя топооснова: векторные тайлы Сербии и Косова, лежащие на устройстве.
///
/// Данные собраны из OpenStreetMap (экстракты Geofabrik → planetiler, схема
/// OpenMapTiles) и Copernicus DEM 30 м (горизонтали с шагом 20 м). Конвейер
/// сборки — в `tools/tiles/`.
///
/// Почему тайлы лежат отдельными файлами, а не одним MBTiles: отдать тайл из
/// своего хранилища в Mapbox SDK можно только двумя способами — подменив ответ
/// в перехватчике HTTP или подняв локальный сервер. Первое невозможно
/// (у `HttpResponse` нет публичного конструктора), второе — лишний сокет ради
/// чтения с диска. Зато в SDK есть `LocalFileSource`, который понимает схему
/// `file://` прямо в шаблоне тайлов, поэтому дерево `{z}/{x}/{y}.pbf` читается
/// напрямую. Тайлы распакованы заранее: заголовков у файлового запроса нет,
/// и сообщить о gzip было бы нечем.
enum TopoTiles {

    /// Каталог с тайлами внутри Application Support.
    static var rootURL: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory,
                                            in: .userDomainMask)[0]
        return base.appendingPathComponent("topo-tiles", isDirectory: true)
    }

    /// Тайлы на месте и распакованы целиком?
    ///
    /// Проверяем по метке, а не по наличию тайлов: распаковку может оборвать
    /// что угодно — перезапуск, нехватка места, переустановка приложения, —
    /// а метка пишется последней. По одному обзорному тайлу набор выглядел бы
    /// готовым, и карта тянула бы недостающие зумы растягиванием: хитмап
    /// расплывался в полосы, горизонтали пропадали.
    static var isAvailable: Bool {
        FileManager.default.fileExists(atPath: rootURL
            .appendingPathComponent("manifest.json").path)
    }

    /// Что лежит на устройстве. Берём из метки, оставленной распаковщиком:
    /// обходить сто тысяч файлов ради размера слишком дорого.
    struct Manifest {
        let version: String
        let tiles: Int
        let bytes: Int64
    }

    static var manifest: Manifest? {
        guard let data = try? Data(contentsOf: rootURL.appendingPathComponent("manifest.json")),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return nil }
        return Manifest(version: json["version"] as? String ?? "?",
                        tiles: json["tiles"] as? Int ?? 0,
                        bytes: Int64(json["bytes"] as? Int ?? 0))
    }

    /// Стиль с подставленным путём к тайлам, готовый для `loadStyle(_ JSON:)`.
    static func styleJSON() -> String? {
        guard isAvailable,
              let url = Bundle.main.url(forResource: "topo_style", withExtension: "json"),
              let template = try? String(contentsOf: url, encoding: .utf8)
        else { return nil }

        // Путь к контейнеру приложения меняется между запусками, поэтому
        // подставляем его каждый раз заново.
        //
        // Собираем строку руками: URL.absoluteString закодировал бы фигурные
        // скобки в %7B/%7D, и шаблон перестал бы быть шаблоном. При этом путь
        // экранировать всё равно нужно — в «Application Support» есть пробел.
        let path = rootURL.path
        let encoded = path.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? path
        return template.replacingOccurrences(of: "{{TILES_URL}}",
                                             with: "file://" + encoded + "/{z}/{x}/{y}.pbf")
    }
}
