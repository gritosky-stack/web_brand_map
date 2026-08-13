import SwiftUI
import WebKit

/// Логин в Strava ради подписи CloudFront для тайлов хитмапа.
///
/// Никаких токенов приложения и OAuth: открываем страницу глобального хитмапа,
/// пользователь входит своим аккаунтом, Strava кладёт в cookie
/// `CloudFront-Key-Pair-Id/Policy/Signature` — их и забираем. Пароль живёт
/// только внутри WKWebView, приложение его не видит.
struct StravaLoginView: View {
    @Environment(\.dismiss) private var dismiss
    var onSaved: () -> Void

    @State private var captured = false

    var body: some View {
        NavigationStack {
            StravaWebView(onCredentials: { creds in
                guard !captured else { return }
                captured = true
                StravaHeatmap.credentials = creds
                onSaved()
                dismiss()
            })
            .ignoresSafeArea(edges: .bottom)
            .navigationTitle("Strava")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Закрыть") { dismiss() }
                }
            }
            .safeAreaInset(edge: .top) {
                Text("Войди в Strava — приложение заберёт из cookie только подпись для тайлов хитмапа и закроет окно.")
                    .font(.system(size: 11))
                    .foregroundColor(DS.textSecondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 8)
                    .background(Color(red: 0.05, green: 0.05, blue: 0.05))
            }
        }
    }
}

private struct StravaWebView: UIViewRepresentable {
    var onCredentials: (StravaHeatmap.Credentials) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(onCredentials: onCredentials) }

    func makeUIView(context: Context) -> WKWebView {
        let web = WKWebView(frame: .zero)
        web.navigationDelegate = context.coordinator
        context.coordinator.webView = web
        web.load(URLRequest(url: URL(string: "https://www.strava.com/maps/global-heatmap")!))
        context.coordinator.startPolling()
        return web
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    static func dismantleUIView(_ uiView: WKWebView, coordinator: Coordinator) {
        coordinator.stopPolling()
    }

    final class Coordinator: NSObject, WKNavigationDelegate {
        weak var webView: WKWebView?
        private let onCredentials: (StravaHeatmap.Credentials) -> Void
        private var timer: Timer?
        private var done = false

        init(onCredentials: @escaping (StravaHeatmap.Credentials) -> Void) {
            self.onCredentials = onCredentials
        }

        // Cookie ставятся не только основной навигацией (тайлы на странице
        // хитмапа тоже дёргают /auth), поэтому просто опрашиваем джар.
        func startPolling() {
            timer = Timer.scheduledTimer(withTimeInterval: 1.2, repeats: true) { [weak self] _ in
                self?.checkCookies()
            }
        }

        func stopPolling() {
            timer?.invalidate()
            timer = nil
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            checkCookies()
        }

        private func checkCookies() {
            guard !done, let store = webView?.configuration.websiteDataStore.httpCookieStore else { return }
            store.getAllCookies { [weak self] cookies in
                guard let self, !self.done,
                      let creds = StravaHeatmap.credentials(from: cookies) else { return }
                self.done = true
                self.stopPolling()
                self.onCredentials(creds)
            }
        }
    }
}
