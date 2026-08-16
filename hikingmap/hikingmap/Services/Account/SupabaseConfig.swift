import Foundation

/// Адрес проекта Supabase и его анонимный ключ — лежат в `Supabase.plist`.
///
/// Ключ публичный по замыслу: он и должен ехать внутри клиента, а доступ к
/// данным ограничивают политики RLS на стороне базы, а не секретность ключа.
/// Пока plist пустой, приложение работает ровно как раньше — маршруты живут
/// только на устройстве, экран аккаунта честно говорит, что бэкенд не задан.
enum SupabaseConfig {
    static let url: URL? = {
        guard let raw = value(for: "SUPABASE_URL"), let url = URL(string: raw) else { return nil }
        return url
    }()

    static let anonKey: String? = value(for: "SUPABASE_ANON_KEY")

    static var isConfigured: Bool { url != nil && anonKey != nil }

    /// Куда Supabase возвращает браузер после OAuth. Схему перехватывает сама
    /// `ASWebAuthenticationSession`, поэтому в Info.plist её регистрировать не
    /// нужно — но в панели Supabase этот адрес обязан быть в списке Redirect URLs.
    static let redirectURL = URL(string: "hikingmap://auth-callback")!

    private static func value(for key: String) -> String? {
        guard let path = Bundle.main.path(forResource: "Supabase", ofType: "plist"),
              let dict = NSDictionary(contentsOfFile: path),
              let raw = dict[key] as? String
        else { return nil }
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
