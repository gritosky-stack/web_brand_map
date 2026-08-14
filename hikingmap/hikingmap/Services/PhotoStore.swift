import UIKit

/// Загрузка фотографий маршрутов.
///
/// В бандл приложения кладём только превью 400 px — все 168 снимков занимают
/// около 6 МБ вместо 400 МБ оригиналов. Версии 1280 px лежат в R2 и приезжают,
/// когда фото открывают на весь экран; скачанное остаётся на диске.
///
/// Порядок поиска: память → диск → сеть, и превью из бандла как немедленная
/// заглушка. Поэтому без связи галерея работает целиком, просто помягче.
enum PhotoStore {

    /// Публичный адрес бакета R2. Пустая строка — работаем только на превью.
    static let remoteBase = "https://pub-46dba1bca6754d2499a2a5aa9d5c879f.r2.dev"

    // MARK: - Кэши

    private static let memory: NSCache<NSString, UIImage> = {
        let c = NSCache<NSString, UIImage>()
        c.countLimit = 80
        c.totalCostLimit = 96 * 1024 * 1024
        return c
    }()

    private static let diskDir: URL = {
        let base = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        let dir = base.appendingPathComponent("photos-med", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }()

    // MARK: - Публичное API

    /// Превью из бандла: всегда на месте, грузится мгновенно.
    static func thumbnail(_ path: String) -> UIImage? {
        if let cached = memory.object(forKey: ("thumb:" + path) as NSString) { return cached }
        guard let url = bundleURL(path),
              let data = try? Data(contentsOf: url),
              let image = UIImage(data: data)
        else { return nil }
        memory.setObject(image, forKey: ("thumb:" + path) as NSString, cost: data.count)
        return image
    }

    /// Крупная версия. Отдаёт превью сразу, а когда подтянется 1280 px —
    /// вызывает обработчик второй раз. Без сети второго вызова просто не будет.
    static func large(_ path: String, completion: @escaping (UIImage?) -> Void) {
        let key = ("large:" + path) as NSString
        if let cached = memory.object(forKey: key) {
            completion(cached)
            return
        }

        // Пока грузится крупная — показываем то, что есть в бандле
        if let thumb = thumbnail(path) { completion(thumb) }

        let file = diskURL(path)
        if let data = try? Data(contentsOf: file), let image = UIImage(data: data) {
            memory.setObject(image, forKey: key, cost: data.count)
            completion(image)
            return
        }

        guard !remoteBase.isEmpty, let remote = remoteURL(path) else { return }
        URLSession.shared.dataTask(with: remote) { data, response, _ in
            guard let data,
                  let http = response as? HTTPURLResponse, http.statusCode == 200,
                  let image = UIImage(data: data)
            else { return }
            try? data.write(to: file, options: .atomic)
            memory.setObject(image, forKey: key, cost: data.count)
            DispatchQueue.main.async { completion(image) }
        }.resume()
    }

    /// Сколько занимают скачанные фотографии, байты.
    static func cacheSize() -> Int64 {
        guard let files = try? FileManager.default.contentsOfDirectory(
            at: diskDir, includingPropertiesForKeys: [.fileSizeKey]) else { return 0 }
        return files.reduce(0) { sum, url in
            sum + Int64((try? url.resourceValues(forKeys: [.fileSizeKey]))?.fileSize ?? 0)
        }
    }

    static func clearCache() {
        try? FileManager.default.removeItem(at: diskDir)
        try? FileManager.default.createDirectory(at: diskDir, withIntermediateDirectories: true)
        memory.removeAllObjects()
    }

    // MARK: - Адреса

    private static func bundleURL(_ path: String) -> URL? {
        Bundle.main.url(forResource: path, withExtension: nil)
            ?? Bundle.main.url(forResource: (path as NSString).lastPathComponent,
                               withExtension: nil,
                               subdirectory: (path as NSString).deletingLastPathComponent)
    }

    /// Имя на диске — путь с заменой разделителей: папки маршрутов содержат
    /// пробелы и кириллицу, плоское имя надёжнее вложенных каталогов.
    private static func diskURL(_ path: String) -> URL {
        let flat = path.replacingOccurrences(of: "/", with: "_")
        return diskDir.appendingPathComponent(flat)
    }

    /// `photos/<маршрут>/IMG.JPG` → `<база>/photos_med/<маршрут>/IMG.JPG`
    private static func remoteURL(_ path: String) -> URL? {
        let remotePath = path.hasPrefix("photos/")
            ? "photos_med/" + path.dropFirst("photos/".count)
            : path
        guard let encoded = remotePath.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed)
        else { return nil }
        return URL(string: remoteBase + "/" + encoded)
    }
}
