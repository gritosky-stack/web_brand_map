import Foundation
import Combine
import AuthenticationServices
import CryptoKit
import Supabase

/// Профиль в том объёме, в каком он нужен приложению. Всё остальное, что
/// присылает провайдер, нам не нужно и мы этого не храним.
struct Account: Equatable {
    let id: UUID
    var email: String?
    var displayName: String?

    var title: String { displayName ?? email ?? "Профиль" }
}

/// Аккаунты поверх Supabase Auth.
///
/// Два входа устроены по-разному, и это не прихоть:
///
/// - **Apple** — нативный `ASAuthorizationController`, потому что системный
///   лист выглядит и работает лучше веб-редиректа. Требует capability
///   «Sign in with Apple» в App ID, а её даёт только платный Apple Developer
///   Program. Без него кнопка вернёт ошибку от системы — код тут ни при чём.
/// - **Google** — веб-поток через `ASWebAuthenticationSession`, который умеет
///   сам SDK Supabase. Так мы не тащим ещё один SDK и обходимся без
///   iOS client ID и возни с URL-схемой в Info.plist.
@MainActor
final class AccountService: ObservableObject {
    static let shared = AccountService()

    enum State: Equatable {
        /// `Supabase.plist` не заполнен — облака нет, приложение локальное
        case notConfigured
        case signedOut
        case working
        case signedIn
    }

    @Published private(set) var state: State
    @Published private(set) var account: Account?
    @Published var errorMessage: String?

    let client: SupabaseClient?

    /// Исходный nonce для Apple: в запрос уходит его хеш, а в Supabase —
    /// сама строка. Сопоставить одно с другим может только тот, кто знает оба.
    private var appleNonce: String?

    private init() {
        if let url = SupabaseConfig.url, let key = SupabaseConfig.anonKey {
            client = SupabaseClient(supabaseURL: url, supabaseKey: key)
            state  = .signedOut
        } else {
            client = nil
            state  = .notConfigured
        }
        observeAuthState()
    }

    // MARK: - Сессия

    private func observeAuthState() {
        guard let client else { return }
        Task { [weak self] in
            for await (event, session) in client.auth.authStateChanges {
                guard let self else { return }
                switch event {
                case .initialSession, .signedIn, .tokenRefreshed, .userUpdated:
                    self.apply(session)
                case .signedOut:
                    self.account = nil
                    self.state   = .signedOut
                default:
                    break
                }
            }
        }
    }

    private func apply(_ session: Session?) {
        guard let user = session?.user else {
            account = nil
            if state != .notConfigured { state = .signedOut }
            return
        }

        let name = user.userMetadata["full_name"]?.stringValue
            ?? user.userMetadata["name"]?.stringValue
        account = Account(id: user.id, email: user.email, displayName: name)
        state   = .signedIn

        Task {
            await saveProfile()
            await RouteSync.shared.sync()
        }
    }

    // MARK: - Apple

    /// Готовит запрос Apple: скоупы и хеш nonce. Вызывать в `onRequest`
    /// у `SignInWithAppleButton`.
    func prepareAppleRequest(_ request: ASAuthorizationAppleIDRequest) {
        let nonce = Self.randomNonce()
        appleNonce = nonce
        request.requestedScopes = [.fullName, .email]
        request.nonce = Self.sha256(nonce)
    }

    func completeAppleSignIn(_ result: Result<ASAuthorization, Error>) async {
        guard let client else { return }

        switch result {
        case .failure(let error):
            // Отмену пользователем за ошибку не считаем
            if (error as? ASAuthorizationError)?.code != .canceled {
                errorMessage = appleErrorText(error)
            }
        case .success(let authorization):
            guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
                  let tokenData = credential.identityToken,
                  let idToken = String(data: tokenData, encoding: .utf8),
                  let nonce = appleNonce
            else {
                errorMessage = "Apple не вернул токен входа"
                return
            }

            state = .working
            do {
                try await client.auth.signInWithIdToken(
                    credentials: OpenIDConnectCredentials(provider: .apple, idToken: idToken, nonce: nonce)
                )
                // Имя Apple отдаёт ровно один раз — в самый первый вход.
                // Не подхватим сейчас — больше взять его будет неоткуда.
                if let name = credential.fullName?.formatted(), !name.isEmpty {
                    await saveProfile(displayName: name)
                }
            } catch {
                state = .signedOut
                errorMessage = error.localizedDescription
            }
        }
        appleNonce = nil
    }

    private func appleErrorText(_ error: Error) -> String {
        guard let authError = error as? ASAuthorizationError else { return error.localizedDescription }
        switch authError.code {
        case .invalidResponse, .notHandled, .failed:
            return "Вход через Apple недоступен: у App ID не включена capability «Sign in with Apple». Она требует платного Apple Developer Program."
        default:
            return error.localizedDescription
        }
    }

    // MARK: - Google

    func signInWithGoogle() async {
        guard let client else { return }
        state = .working
        do {
            try await client.auth.signInWithOAuth(
                provider: .google,
                redirectTo: SupabaseConfig.redirectURL
            )
        } catch {
            state = .signedOut
            // Закрытое окно браузера — не ошибка, а передумал
            if (error as? ASWebAuthenticationSessionError)?.code != .canceledLogin {
                errorMessage = error.localizedDescription
            }
        }
    }

    // MARK: - Выход

    func signOut() async {
        guard let client else { return }
        do {
            try await client.auth.signOut()
        } catch {
            errorMessage = error.localizedDescription
        }
        account = nil
        state   = .signedOut
    }

    // MARK: - Профиль

    private struct ProfileRow: Encodable {
        let id: UUID
        let display_name: String?
    }

    /// Кладёт «минимальные данные» в таблицу `profiles`. Почта и айди и так
    /// живут в `auth.users`, но к ней из клиента не обратиться — а имя нужно
    /// показывать в интерфейсе.
    func saveProfile(displayName: String? = nil) async {
        guard let client, let account else { return }
        let name = displayName ?? account.displayName
        do {
            try await client
                .from("profiles")
                .upsert(ProfileRow(id: account.id, display_name: name))
                .execute()
            if let displayName { self.account?.displayName = displayName }
        } catch {
            // Профиль — не то, ради чего стоит показывать ошибку поверх карты
            NSLog("[account] profile upsert failed: %@", error.localizedDescription)
        }
    }

    // MARK: - Nonce

    private static func randomNonce(length: Int = 32) -> String {
        let charset = Array("0123456789ABCDEFGHIJKLMNOPQRSTUVXYZabcdefghijklmnopqrstuvwxyz-._")
        var result = ""
        for _ in 0..<length {
            result.append(charset[Int.random(in: 0..<charset.count)])
        }
        return result
    }

    private static func sha256(_ input: String) -> String {
        SHA256.hash(data: Data(input.utf8)).map { String(format: "%02x", $0) }.joined()
    }
}

private extension PersonNameComponents {
    func formatted() -> String {
        [givenName, familyName].compactMap { $0 }.joined(separator: " ")
    }
}
