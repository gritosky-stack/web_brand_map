import Foundation
import Supabase

/// Где SDK Supabase держит сессию и PKCE-верификатор.
///
/// По умолчанию это Keychain — так и надо. Но сборка для симулятора идёт
/// **без подписи** (`CODE_SIGNING_ALLOWED=NO`, см. CLAUDE.md: иначе сборка
/// падает на отсутствии профиля), а неподписанному приложению система на
/// любой запрос к Keychain отвечает `errSecMissingEntitlement` (-34018).
///
/// SDK такие ошибки только пишет в лог: код-верификатор не сохраняется, а
/// на обмене кода Supabase отвечает «invalid request: both auth code and code
/// verifier should be non-empty» — вход через Google в симуляторе не
/// работал никогда именно поэтому.
///
/// Поэтому: пробуем Keychain, и только если он недоступен **и** мы в
/// симуляторе — откатываемся на `UserDefaults`. На устройстве подмены нет:
/// молча складывать туда токены refresh-сессии нельзя.
struct AccountAuthStorage: AuthLocalStorage {
    private let keychain = KeychainLocalStorage()
    private let defaults = UserDefaults.standard
    private let useKeychain: Bool

    private static let prefix = "supabase.auth.fallback."
    private static let probeKey = "hikingmap.keychain.probe"

    init() {
        useKeychain = AccountAuthStorage.keychainWorks || !AccountAuthStorage.fallbackAllowed
    }

    /// Работает ли Keychain в этой сборке — проверяем пробной записью один раз.
    private static let keychainWorks: Bool = {
        let probe = KeychainLocalStorage()
        do {
            try probe.store(key: probeKey, value: Data("probe".utf8))
            try? probe.remove(key: probeKey)
            return true
        } catch {
            return false
        }
    }()

    private static var fallbackAllowed: Bool {
        #if targetEnvironment(simulator)
        return true
        #else
        return false
        #endif
    }

    func store(key: String, value: Data) throws {
        if useKeychain {
            try keychain.store(key: key, value: value)
        } else {
            defaults.set(value, forKey: AccountAuthStorage.prefix + key)
        }
    }

    func retrieve(key: String) throws -> Data? {
        if useKeychain {
            return try keychain.retrieve(key: key)
        }
        return defaults.data(forKey: AccountAuthStorage.prefix + key)
    }

    func remove(key: String) throws {
        if useKeychain {
            try keychain.remove(key: key)
        } else {
            defaults.removeObject(forKey: AccountAuthStorage.prefix + key)
        }
    }
}
