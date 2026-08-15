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

    /// Версия набора. Меняется вместе с данными — так на устройстве видно,
    /// что лежит старое, и можно предложить обновление.
    static let version = "v7"

    /// Каталог с тайлами внутри Application Support.
    static var rootURL: URL { TileSetSpec.root("topo-tiles") }

    /// Тайлы на месте и распакованы целиком?
    ///
    /// Проверяем по метке, а не по наличию тайлов: распаковку может оборвать
    /// что угодно — перезапуск, нехватка места, переустановка приложения, —
    /// а метка пишется последней. По одному обзорному тайлу набор выглядел бы
    /// готовым, и карта тянула бы недостающие зумы растягиванием: хитмап
    /// расплывался в полосы, горизонтали пропадали.
    static var isAvailable: Bool { TileSet.isAvailable(.topo) }

    /// На устройстве лежит набор старее того, что ждёт приложение?
    ///
    /// Данные и приложение обновляются порознь, а каталог с тайлами один на все
    /// версии. Поэтому после нового билда распакованный старый набор выглядит
    /// совершенно исправным: метка на месте, тайлы читаются — и карта молча
    /// продолжает показывать позапрошлые данные.
    static var isStale: Bool { TileSet.isStale(.topo) }

    /// Что лежит на устройстве. Берём из метки, оставленной распаковщиком:
    /// обходить сто тысяч файлов ради размера слишком дорого.
    static var manifest: TileSet.Manifest? { TileSet.manifest(.topo) }

    /// Стиль с подставленным путём к тайлам, готовый для `loadStyle(_ JSON:)`.
    static func styleJSON() -> String? {
        guard isAvailable,
              let url = Bundle.main.url(forResource: "topo_style", withExtension: "json"),
              let template = try? String(contentsOf: url, encoding: .utf8)
        else { return nil }

        return template.replacingOccurrences(of: "{{TILES_URL}}",
                                             with: TileSet.fileTemplate(.topo))
    }
}


/// Общая часть про наборы тайлов на устройстве: что лежит и не устарело ли.
enum TileSet {

    /// Что лежит на устройстве. Берём из метки, оставленной распаковщиком:
    /// обходить сто тысяч файлов ради размера слишком дорого.
    struct Manifest {
        let version: String
        let tiles: Int
        let bytes: Int64
    }

    /// Тайлы на месте и распакованы целиком?
    ///
    /// Проверяем по метке, а не по наличию тайлов: распаковку может оборвать
    /// что угодно — перезапуск, нехватка места, переустановка приложения, —
    /// а метка пишется последней. По одному обзорному тайлу набор выглядел бы
    /// готовым, и карта тянула бы недостающие зумы растягиванием.
    static func isAvailable(_ spec: TileSetSpec) -> Bool {
        FileManager.default.fileExists(
            atPath: spec.rootURL.appendingPathComponent("manifest.json").path)
    }

    static func manifest(_ spec: TileSetSpec) -> Manifest? {
        guard let data = try? Data(contentsOf: spec.rootURL.appendingPathComponent("manifest.json")),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return nil }
        return Manifest(version: json["version"] as? String ?? "?",
                        tiles: json["tiles"] as? Int ?? 0,
                        bytes: Int64(json["bytes"] as? Int ?? 0))
    }

    /// На устройстве набор старее того, что ждёт приложение?
    ///
    /// Данные и приложение обновляются порознь, а каталог с тайлами один на все
    /// версии. Поэтому после нового билда распакованный старый набор выглядит
    /// совершенно исправным: метка на месте, тайлы читаются — и карта молча
    /// продолжает показывать позапрошлые данные.
    static func isStale(_ spec: TileSetSpec) -> Bool {
        guard let m = manifest(spec) else { return false }
        return m.version != spec.version
    }

    /// Шаблон тайлов для стиля или растрового источника.
    ///
    /// Собираем строку руками: `URL.absoluteString` закодировал бы фигурные
    /// скобки в %7B/%7D, и шаблон перестал бы быть шаблоном. При этом путь
    /// экранировать всё равно нужно — в «Application Support» есть пробел.
    /// Путь к контейнеру меняется между запусками, поэтому строим каждый раз.
    static func fileTemplate(_ spec: TileSetSpec) -> String {
        let path = spec.rootURL.path
        let encoded = path.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? path
        return "file://" + encoded + "/{z}/{x}/{y}." + spec.ext
    }
}

/// Историческая карта Сербии — австро-венгерская «Спецкарта» 1:75 000,
/// снятая в 1900-х–1910-х (Library of Congress, public domain).
///
/// Растровые тайлы z8–z14, собираются конвейером `tools/tiles/`. Георефересовку
/// LoC мы там же правим: она систематически промахивается на сотни метров
/// (градусная сетка на эллипсоиде Бесселя посажена как WGS84), и поправка
/// меряется по рекам OSM и рельефу Copernicus DEM. Подробности — в
/// `tools/tiles/README.md`.
enum HistMapTiles {

    static let version = "v1"

    static var rootURL: URL { TileSetSpec.root("histmap-tiles") }

    /// Для карточки в офлайн-экране: набор собирается конвейером, и точный
    /// размер известен только после сборки — держим его рядом с версией.
    /// Гравюра высокочастотная, JPEG её почти не жмёт: 35 тысяч тайлов z8–z14.
    static let approxSize = "около 455 МБ"

    static var isAvailable: Bool { TileSet.isAvailable(.histmap) }
    static var isStale: Bool { TileSet.isStale(.histmap) }
    static var manifest: TileSet.Manifest? { TileSet.manifest(.histmap) }

    /// Откуда карте брать тайлы: скачанный набор, иначе — прямо из R2.
    static var tilesURL: String {
        isAvailable
            ? TileSet.fileTemplate(.histmap)
            : "\(TileSetSpec.base)/histmap/\(version)/{z}/{x}/{y}.jpg"
    }
}
