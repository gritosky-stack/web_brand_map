import SwiftUI
import AuthenticationServices

/// Экран аккаунта: форма входа, пока не вошли, и профиль после.
struct AccountSheet: View {
    @Environment(\.dismiss) private var dismiss
    @ObservedObject private var account = AccountService.shared
    @ObservedObject private var sync    = RouteSync.shared
    @ObservedObject private var store   = CustomRouteStore.shared

    var body: some View {
        ZStack {
            DS.bg.ignoresSafeArea()

            VStack(spacing: 0) {
                grabber

                ScrollView {
                    VStack(spacing: 22) {
                        switch account.state {
                        case .notConfigured: notConfiguredBlock
                        case .signedIn:      profileBlock
                        default:             loginBlock
                        }
                    }
                    .padding(.horizontal, 22)
                    .padding(.top, 18)
                    .padding(.bottom, 40)
                }
            }
        }
        .alert("Не получилось войти",
               isPresented: Binding(get: { account.errorMessage != nil },
                                    set: { if !$0 { account.errorMessage = nil } })) {
            Button("Понятно", role: .cancel) {}
        } message: {
            Text(account.errorMessage ?? "")
        }
    }

    private var grabber: some View {
        Capsule()
            .fill(Color.white.opacity(0.18))
            .frame(width: 38, height: 4)
            .padding(.top, 10)
    }

    // MARK: - Вход

    private var loginBlock: some View {
        VStack(spacing: 20) {
            header(icon: "person.crop.circle",
                   title: "Аккаунт",
                   subtitle: "Маршруты и записанные треки уедут в облако и вернутся на любом вашем устройстве. Больше ничего не собираем.")

            VStack(spacing: 10) {
                SignInWithAppleButton(.signIn) { request in
                    account.prepareAppleRequest(request)
                } onCompletion: { result in
                    Task { await account.completeAppleSignIn(result) }
                }
                .signInWithAppleButtonStyle(.white)
                .frame(height: 50)
                .clipShape(RoundedRectangle(cornerRadius: DS.radiusS, style: .continuous))

                Button {
                    Task { await account.signInWithGoogle() }
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "globe")
                            .font(.system(size: 16, weight: .semibold))
                        Text("Продолжить с Google")
                            .font(.system(size: 16, weight: .semibold))
                    }
                    .foregroundColor(DS.textPrimary)
                    .frame(maxWidth: .infinity)
                    .frame(height: 50)
                    .background(DS.surfaceRaised)
                    .clipShape(RoundedRectangle(cornerRadius: DS.radiusS, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: DS.radiusS, style: .continuous)
                        .stroke(DS.border, lineWidth: 1))
                }
                .buttonStyle(.plain)
            }
            .disabled(account.state == .working)
            .opacity(account.state == .working ? 0.5 : 1)
            .overlay {
                if account.state == .working { ProgressView().tint(DS.accent) }
            }

            Button("Пока без аккаунта") { dismiss() }
                .font(.system(size: 13))
                .foregroundColor(DS.textSecondary)

            Text("Маршруты работают и без входа — они просто останутся на этом устройстве.")
                .font(.system(size: 11))
                .foregroundColor(DS.textTertiary)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    // MARK: - Профиль

    private var profileBlock: some View {
        VStack(spacing: 20) {
            header(icon: "person.crop.circle.fill",
                   title: account.account?.title ?? "Профиль",
                   subtitle: account.account?.email)

            VStack(spacing: 0) {
                row(label: "Маршрутов", value: "\(store.routes.count)")
                Divider().background(DS.border)
                row(label: "Синхронизация",
                    value: sync.isSyncing
                        ? "идёт…"
                        : sync.lastSyncedAt.map(Self.timeText) ?? "ещё не было")
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 4)
            .background(DS.surface)
            .clipShape(RoundedRectangle(cornerRadius: DS.radiusM, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: DS.radiusM, style: .continuous)
                .stroke(DS.border, lineWidth: 1))

            Button {
                Task { await sync.sync() }
            } label: {
                Text(sync.isSyncing ? "Синхронизирую…" : "Синхронизировать сейчас")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundColor(.white)
                    .frame(maxWidth: .infinity)
                    .frame(height: 48)
                    .background(DS.accent)
                    .clipShape(RoundedRectangle(cornerRadius: DS.radiusS, style: .continuous))
            }
            .buttonStyle(.plain)
            .disabled(sync.isSyncing)

            Button {
                Task { await account.signOut() }
            } label: {
                Text("Выйти")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundColor(DS.diffHard)
                    .frame(maxWidth: .infinity)
                    .frame(height: 44)
                    .background(DS.surface)
                    .clipShape(RoundedRectangle(cornerRadius: DS.radiusS, style: .continuous))
            }
            .buttonStyle(.plain)

            Text("Маршруты останутся на устройстве и после выхода.")
                .font(.system(size: 11))
                .foregroundColor(DS.textTertiary)
        }
    }

    // MARK: - Бэкенд не задан

    private var notConfiguredBlock: some View {
        VStack(spacing: 20) {
            header(icon: "icloud.slash",
                   title: "Облако не подключено",
                   subtitle: "Маршруты сохраняются на устройстве. Чтобы включить аккаунты, заполните Supabase.plist — адрес проекта и anon-ключ.")

            VStack(alignment: .leading, spacing: 10) {
                step(1, "Создайте проект на supabase.com")
                step(2, "Settings → API: скопируйте Project URL и anon-ключ в Supabase.plist")
                step(3, "SQL Editor: выполните supabase/schema.sql из репозитория")
                step(4, "Authentication → Providers: включите Google")
            }
            .padding(16)
            .background(DS.surface)
            .clipShape(RoundedRectangle(cornerRadius: DS.radiusM, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: DS.radiusM, style: .continuous)
                .stroke(DS.border, lineWidth: 1))

            Button("Закрыть") { dismiss() }
                .font(.system(size: 13))
                .foregroundColor(DS.textSecondary)
        }
    }

    // MARK: - Кирпичики

    private func header(icon: String, title: String, subtitle: String?) -> some View {
        VStack(spacing: 10) {
            Image(systemName: icon)
                .font(.system(size: 42, weight: .light))
                .foregroundColor(DS.accent)
                .padding(.top, 12)

            Text(title)
                .font(.system(size: 22, weight: .bold))
                .foregroundColor(DS.textPrimary)

            if let subtitle {
                Text(subtitle)
                    .font(.system(size: 13))
                    .foregroundColor(DS.textSecondary)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private func row(label: String, value: String) -> some View {
        HStack {
            Text(label)
                .font(.system(size: 13))
                .foregroundColor(DS.textSecondary)
            Spacer()
            Text(value)
                .font(.system(size: 13, weight: .medium))
                .foregroundColor(DS.textPrimary)
        }
        .padding(.vertical, 12)
    }

    private func step(_ n: Int, _ text: String) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Text("\(n)")
                .font(.system(size: 11, weight: .bold))
                .foregroundColor(.white)
                .frame(width: 20, height: 20)
                .background(Circle().fill(DS.accent))
            Text(text)
                .font(.system(size: 12))
                .foregroundColor(DS.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private static func timeText(_ date: Date) -> String {
        let f = DateFormatter()
        f.dateFormat = "HH:mm"
        return f.string(from: date)
    }
}
