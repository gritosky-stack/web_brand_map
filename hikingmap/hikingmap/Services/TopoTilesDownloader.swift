import Foundation
import Compression
import SQLite3
import UIKit

/// Скачивание и распаковка собственных тайлов Сербии.
///
/// В R2 лежит один файл MBTiles — это обычная база SQLite, где тайлы хранятся
/// gzip-сжатыми. Приложение качает его, раскладывает в дерево `{z}/{x}/{y}.pbf`
/// и удаляет исходник. Раскладка нужна потому, что карту мы кормим схемой
/// `file://`: отдать тайл из своей базы напрямую в Mapbox SDK нельзя —
/// у `HttpResponse` нет публичного конструктора, а поднимать локальный
/// HTTP-сервер ради чтения с диска незачем.
///
/// Скачивание идёт через фоновую сессию: файл на сотни мегабайт качается
/// минутами, и пользователь неизбежно свернёт приложение или погасит экран.
/// Обычную сессию система в этот момент прибивает, фоновую — доводит до конца
/// сама и будит приложение по готовности.
///
/// Распаковка, наоборот, требует активного приложения: сто тысяч файлов
/// в фоновом окне не успеть. Поэтому если загрузка завершилась, пока приложение
/// свёрнуто, распаковка ждёт возвращения на экран.
final class TopoTilesDownloader: NSObject, ObservableObject {

    static let shared = TopoTilesDownloader()

    enum Stage: Equatable {
        case idle
        case downloading(progress: Double, bytes: Int64, total: Int64)
        /// Файл скачан, но приложение свёрнуто — распакуем, когда вернётся
        case readyToUnpack
        case unpacking(progress: Double)
        case done
        case failed(String)
    }

    @Published private(set) var stage: Stage = .idle
    /// Тайлы на устройстве. Наблюдаемое свойство, а не проверка файла на месте:
    /// после распаковки нужно перезагрузить стиль карты и обновить панель слоёв,
    /// иначе до перезапуска приложение продолжит работать на запасной основе.
    @Published private(set) var isReady: Bool = TopoTiles.isAvailable

    /// Версия набора. Меняется вместе с данными — так на устройстве видно,
    /// что лежит старое, и можно предложить обновление.
    static let version = "v6"
    private static let base = "https://pub-46dba1bca6754d2499a2a5aa9d5c879f.r2.dev"
    private var remoteURL: URL { URL(string: "\(Self.base)/maps/serbia-topo-\(Self.version).mbtiles")! }

    /// Сколько места держать свободным: сам файл плюс распакованное дерево,
    /// плюс запас, чтобы не упереться в ноль на телефоне.
    private static let requiredFreeBytes: Int64 = 2_000_000_000

    /// Вызывается системой, когда фоновая сессия доложила о завершении.
    /// Пробрасывается из AppDelegate.
    var backgroundCompletionHandler: (() -> Void)?

    private lazy var session: URLSession = {
        let config = URLSessionConfiguration.background(withIdentifier: "wild.totskii.topo-tiles")
        config.sessionSendsLaunchEvents = true
        config.isDiscretionary = false
        config.timeoutIntervalForResource = 6 * 3600
        return URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }()

    private var pendingArchive: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("serbia-topo-\(Self.version).mbtiles")
    }

    private override init() {
        super.init()
        // Подхватываем задачу, если приложение перезапустили посреди загрузки
        session.getAllTasks { [weak self] tasks in
            guard let self, let task = tasks.first else { return }
            DispatchQueue.main.async {
                let total = task.countOfBytesExpectedToReceive
                let done = task.countOfBytesReceived
                self.stage = .downloading(progress: total > 0 ? Double(done) / Double(total) : 0,
                                          bytes: done, total: total)
                self.keepScreenAwake(true)
            }
        }
        NotificationCenter.default.addObserver(
            self, selector: #selector(appBecameActive),
            name: UIApplication.didBecomeActiveNotification, object: nil)
    }

    // MARK: - Управление

    func start() {
        switch stage {
        case .idle, .failed: break
        default: return
        }

        guard freeDiskBytes() > Self.requiredFreeBytes else {
            let need = ByteCountFormatter.string(fromByteCount: Self.requiredFreeBytes, countStyle: .file)
            stage = .failed("Нужно \(need) свободного места — освободите и попробуйте снова")
            return
        }

        // Файл мог остаться от прерванной попытки — тогда качать заново незачем
        if FileManager.default.fileExists(atPath: pendingArchive.path) {
            stage = .readyToUnpack
            startUnpackIfActive()
            return
        }

        // Недораспакованное дерево оставлять нельзя: без метки набор считается
        // неготовым, но место занимает
        if !TopoTiles.isAvailable {
            try? FileManager.default.removeItem(at: TopoTiles.rootURL)
        }

        stage = .downloading(progress: 0, bytes: 0, total: 0)
        keepScreenAwake(true)
        session.downloadTask(with: remoteURL).resume()
    }

    func cancel() {
        session.getAllTasks { tasks in tasks.forEach { $0.cancel() } }
        try? FileManager.default.removeItem(at: pendingArchive)
        DispatchQueue.main.async {
            self.stage = .idle
            self.keepScreenAwake(false)
        }
    }

    func delete() {
        cancel()
        isReady = false
        stage = .idle
        // Сто тысяч файлов удаляются секунд двадцать — на главном потоке это
        // выглядело как зависшее приложение. Переименовываем мгновенно, чтобы
        // карта сразу перестала их видеть, а чистим уже в фоне.
        let root = TopoTiles.rootURL
        let trash = root.deletingLastPathComponent()
            .appendingPathComponent("topo-tiles-trash-\(UUID().uuidString)")
        try? FileManager.default.moveItem(at: root, to: trash)
        DispatchQueue.global(qos: .utility).async {
            try? FileManager.default.removeItem(at: trash)
        }
    }

    // MARK: - Вспомогательное

    private func freeDiskBytes() -> Int64 {
        let url = URL(fileURLWithPath: NSHomeDirectory())
        let values = try? url.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey])
        return values?.volumeAvailableCapacityForImportantUsage ?? 0
    }

    /// Экран не должен гаснуть: во сне распаковка встанет на середине,
    /// а состояние останется битым.
    private func keepScreenAwake(_ on: Bool) {
        DispatchQueue.main.async { UIApplication.shared.isIdleTimerDisabled = on }
    }

    @objc private func appBecameActive() {
        if case .readyToUnpack = stage { startUnpackIfActive() }
    }

    private func startUnpackIfActive() {
        guard FileManager.default.fileExists(atPath: pendingArchive.path) else { return }
        guard UIApplication.shared.applicationState == .active else {
            DispatchQueue.main.async { self.stage = .readyToUnpack }
            return
        }
        DispatchQueue.main.async {
            self.stage = .unpacking(progress: 0)
            self.keepScreenAwake(true)
        }
        let archive = pendingArchive
        DispatchQueue.global(qos: .utility).async { self.unpack(archive) }
    }

    // MARK: - Распаковка

    private func unpack(_ mbtiles: URL) {
        let root = TopoTiles.rootURL
        try? FileManager.default.removeItem(at: root)
        try? FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)

        var db: OpaquePointer?
        guard sqlite3_open_v2(mbtiles.path, &db, SQLITE_OPEN_READONLY, nil) == SQLITE_OK else {
            fail("Не удалось открыть скачанный файл")
            return
        }
        defer { sqlite3_close(db) }

        var countStmt: OpaquePointer?
        var total = 0
        if sqlite3_prepare_v2(db, "select count(*) from tiles", -1, &countStmt, nil) == SQLITE_OK,
           sqlite3_step(countStmt) == SQLITE_ROW {
            total = Int(sqlite3_column_int(countStmt, 0))
        }
        sqlite3_finalize(countStmt)
        guard total > 0 else { fail("В файле нет тайлов"); return }

        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(
            db, "select zoom_level, tile_column, tile_row, tile_data from tiles", -1, &stmt, nil
        ) == SQLITE_OK else {
            fail("Не удалось прочитать файл")
            return
        }
        defer { sqlite3_finalize(stmt) }

        let fm = FileManager.default
        var written = 0
        var bytesWritten = 0
        var lastReported = 0.0
        // Каталоги создаём по одному разу на связку z/x — иначе сто тысяч
        // лишних обращений к файловой системе
        var createdDirs = Set<String>()

        while sqlite3_step(stmt) == SQLITE_ROW {
            let z = Int(sqlite3_column_int(stmt, 0))
            let x = Int(sqlite3_column_int(stmt, 1))
            let tmsY = Int(sqlite3_column_int(stmt, 2))
            guard let blob = sqlite3_column_blob(stmt, 3) else { continue }
            let length = Int(sqlite3_column_bytes(stmt, 3))
            let raw = Data(bytes: blob, count: length)

            // MBTiles хранит y снизу вверх (TMS), шаблон тайлов ждёт XYZ
            let y = (1 << z) - 1 - tmsY
            let dirKey = "\(z)/\(x)"
            if !createdDirs.contains(dirKey) {
                let dir = root.appendingPathComponent(dirKey, isDirectory: true)
                try? fm.createDirectory(at: dir, withIntermediateDirectories: true)
                createdDirs.insert(dirKey)
            }

            // По file:// заголовков нет, сообщить о gzip нечем — распаковываем сами
            let data = Self.gunzip(raw) ?? raw
            let file = root.appendingPathComponent("\(dirKey)/\(y).pbf")
            try? data.write(to: file, options: .atomic)

            written += 1
            bytesWritten += data.count
            let progress = Double(written) / Double(total)
            if progress - lastReported >= 0.01 {
                lastReported = progress
                DispatchQueue.main.async { self.stage = .unpacking(progress: progress) }
            }
        }

        try? fm.removeItem(at: mbtiles)

        // Метка вместо пересчёта: обойти сто тысяч файлов ради размера дорого
        let manifest: [String: Any] = ["version": Self.version, "tiles": written, "bytes": bytesWritten]
        if let data = try? JSONSerialization.data(withJSONObject: manifest) {
            try? data.write(to: root.appendingPathComponent("manifest.json"))
        }
        // Тайлы восстановимы из сети — в резервную копию iCloud им незачем
        var root2 = root
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try? root2.setResourceValues(values)

        DispatchQueue.main.async {
            self.stage = .done
            self.isReady = true
            self.keepScreenAwake(false)
        }
    }

    private func fail(_ message: String) {
        DispatchQueue.main.async {
            self.stage = .failed(message)
            self.keepScreenAwake(false)
        }
    }

    // MARK: - gzip

    /// Распаковка gzip через системный Compression: он умеет только «сырой»
    /// deflate, поэтому заголовок и хвост gzip снимаем руками.
    static func gunzip(_ data: Data) -> Data? {
        guard data.count > 18, data[0] == 0x1f, data[1] == 0x8b, data[2] == 0x08 else { return nil }

        let flags = data[3]
        var offset = 10
        if flags & 0x04 != 0 {                       // FEXTRA
            guard data.count > offset + 1 else { return nil }
            let extra = Int(data[offset]) | Int(data[offset + 1]) << 8
            offset += 2 + extra
        }
        if flags & 0x08 != 0 {                       // FNAME
            while offset < data.count, data[offset] != 0 { offset += 1 }
            offset += 1
        }
        if flags & 0x10 != 0 {                       // FCOMMENT
            while offset < data.count, data[offset] != 0 { offset += 1 }
            offset += 1
        }
        if flags & 0x02 != 0 { offset += 2 }         // FHCRC
        guard offset < data.count - 8 else { return nil }

        // Последние четыре байта gzip — размер распакованных данных
        let tail = data.suffix(4)
        let expected = tail.withUnsafeBytes { $0.loadUnaligned(as: UInt32.self) }
        let capacity = max(Int(UInt32(littleEndian: expected)), data.count * 4)

        let payload = data.subdata(in: offset..<(data.count - 8))
        var result: Data?
        payload.withUnsafeBytes { (src: UnsafeRawBufferPointer) in
            guard let srcBase = src.bindMemory(to: UInt8.self).baseAddress else { return }
            let dst = UnsafeMutablePointer<UInt8>.allocate(capacity: capacity)
            defer { dst.deallocate() }
            let size = compression_decode_buffer(dst, capacity, srcBase, payload.count,
                                                 nil, COMPRESSION_ZLIB)
            if size > 0 { result = Data(bytes: dst, count: size) }
        }
        return result
    }
}

// MARK: - Ход загрузки

extension TopoTilesDownloader: URLSessionDownloadDelegate {

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask,
                    didWriteData bytesWritten: Int64,
                    totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
        let total = totalBytesExpectedToWrite
        let progress = total > 0 ? Double(totalBytesWritten) / Double(total) : 0
        DispatchQueue.main.async {
            self.stage = .downloading(progress: progress, bytes: totalBytesWritten, total: total)
        }
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask,
                    didFinishDownloadingTo location: URL) {
        // Временный файл живёт до выхода из метода — переносим сразу, и не в
        // tmp, а в Application Support: распаковка может начаться намного позже,
        // а систему ничто не обязывает беречь tmp между запусками.
        let dest = pendingArchive
        try? FileManager.default.removeItem(at: dest)
        do {
            try FileManager.default.moveItem(at: location, to: dest)
        } catch {
            fail("Не удалось сохранить файл: \(error.localizedDescription)")
            return
        }
        startUnpackIfActive()
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let error else { return }
        if (error as NSError).code == NSURLErrorCancelled { return }
        fail(error.localizedDescription)
    }

    func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        DispatchQueue.main.async {
            self.backgroundCompletionHandler?()
            self.backgroundCompletionHandler = nil
        }
    }
}
