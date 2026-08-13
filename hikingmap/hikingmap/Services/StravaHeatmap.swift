import Foundation
import Security

/// Глобальный хитмап Strava как raster-слой карты.
///
/// CloudFront отдаёт тайлы публично только до z12 — дальше 403, нужны
/// подписанные параметры (Key-Pair-Id / Policy / Signature). Их выдаёт
/// strava.com в cookie после логина (см. `StravaLoginView`). Mapbox тянет
/// тайлы своей URLSession, cookie туда не подсунуть, поэтому подпись
/// уезжает в query-строку — CloudFront принимает оба варианта.
enum StravaHeatmap {

    /// all | ride | run | water | winter — пеших треков больше всего в `all`.
    static let sport = "all"
    /// hot | blue | bluered | purple | gray | mobileblue
    static let color = "hot"

    /// Докуда CloudFront пускает без подписи.
    static let publicMaxZoom = 12
    /// Нативный максимум хитмапа; выше Mapbox растягивает тайлы сам.
    static let signedMaxZoom = 15

    // MARK: - Credentials

    struct Credentials: Codable {
        let keyPairId: String
        let policy: String
        let signature: String
        let savedAt: Date

        /// Подпись живёт недолго (обычно недели). Точный срок зашит в Policy,
        /// но разбирать его ради UI незачем — считаем протухшей через 25 дней
        /// и предлагаем перелогиниться.
        var isStale: Bool { Date().timeIntervalSince(savedAt) > 25 * 24 * 3600 }
    }

    private static let keychainAccount = "strava-heatmap-cloudfront"

    static var credentials: Credentials? {
        get {
            guard let data = Keychain.load(keychainAccount) else { return nil }
            return try? JSONDecoder().decode(Credentials.self, from: data)
        }
        set {
            guard let newValue, let data = try? JSONEncoder().encode(newValue) else {
                Keychain.delete(keychainAccount)
                return
            }
            Keychain.save(keychainAccount, data)
        }
    }

    static var isAuthorized: Bool { credentials != nil }

    /// Вытаскивает подпись CloudFront из cookie-джара WKWebView.
    static func credentials(from cookies: [HTTPCookie]) -> Credentials? {
        var keyPairId: String?, policy: String?, signature: String?
        for c in cookies where c.domain.contains("strava.com") {
            switch c.name {
            case "CloudFront-Key-Pair-Id": keyPairId = c.value
            case "CloudFront-Policy":      policy    = c.value
            case "CloudFront-Signature":   signature = c.value
            default: break
            }
        }
        guard let keyPairId, let policy, let signature else { return nil }
        return Credentials(keyPairId: keyPairId, policy: policy,
                           signature: signature, savedAt: Date())
    }

    // MARK: - Tiles

    /// Шаблоны тайлов для RasterSource (a/b/c — шардинг CloudFront).
    static func tileTemplates() -> [String] {
        let creds = credentials
        let path  = creds == nil ? "tiles" : "tiles-auth"
        var query = "px=256"
        if let c = creds {
            query += "&Key-Pair-Id=\(esc(c.keyPairId))&Policy=\(esc(c.policy))&Signature=\(esc(c.signature))"
        }
        return ["a", "b", "c"].map {
            "https://heatmap-external-\($0).strava.com/\(path)/\(sport)/\(color)/{z}/{x}/{y}.png?\(query)"
        }
    }

    static var maxZoom: Double {
        Double(isAuthorized ? signedMaxZoom : publicMaxZoom)
    }

    private static func esc(_ s: String) -> String {
        var allowed = CharacterSet.urlQueryAllowed
        allowed.remove(charactersIn: "&=+?#")
        return s.addingPercentEncoding(withAllowedCharacters: allowed) ?? s
    }
}

// MARK: - Keychain

private enum Keychain {
    private static let service = "com.totskii.hikingmap"

    private static func query(_ account: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: service,
         kSecAttrAccount as String: account]
    }

    static func save(_ account: String, _ data: Data) {
        SecItemDelete(query(account) as CFDictionary)
        var item = query(account)
        item[kSecValueData as String] = data
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        SecItemAdd(item as CFDictionary, nil)
    }

    static func load(_ account: String) -> Data? {
        var item = query(account)
        item[kSecReturnData as String] = true
        item[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        guard SecItemCopyMatching(item as CFDictionary, &out) == errSecSuccess else { return nil }
        return out as? Data
    }

    static func delete(_ account: String) {
        SecItemDelete(query(account) as CFDictionary)
    }
}
