import SwiftUI

/// Правила прокладки маршрута по тропам («Нарисовать»). Дружелюбная версия
/// панели «Customize profile» с brouter.de — те же ручки BRouter-профиля
/// (`RoutingPreferences.brouterQueryItems`), но без сырых чекбоксов и
/// значений SAC_scale_limit/preferred по отдельности.
///
/// Действует на новые отрезки, которые прокладывает роутер начиная с этого
/// момента — уже нарисованные легли по прежним правилам, их закон обратной
/// силы не имеет.
struct RoutingPreferencesView: View {
    @EnvironmentObject var appState: AppState
    @Environment(\.dismiss) private var dismiss

    private var prefs: Binding<RoutingPreferences> { $appState.routingPreferences }

    var body: some View {
        ZStack {
            DS.bg.ignoresSafeArea()

            VStack(spacing: 0) {
                header
                Divider().background(DS.border)

                ScrollView(showsIndicators: false) {
                    VStack(alignment: .leading, spacing: 16) {
                        difficultyCard
                        trailPreferenceCard
                        avoidCard
                        passableCard
                    }
                    .padding(16)
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationBackground(.ultraThinMaterial)
        .presentationDragIndicator(.visible)
    }

    // MARK: - Шапка

    private var header: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text("Правила маршрута")
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundColor(DS.textPrimary)
                Text("Как прокладывать путь по тропам")
                    .font(.system(size: 11))
                    .foregroundColor(DS.textSecondary)
            }
            Spacer()
            if prefs.wrappedValue != .default {
                Button {
                    withAnimation(.easeInOut(duration: 0.2)) { appState.routingPreferences = .default }
                } label: {
                    Text("Сбросить")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundColor(DS.accent)
                        .padding(.horizontal, 10).padding(.vertical, 6)
                        .background(DS.glass)
                        .clipShape(Capsule())
                }
                .buttonStyle(.plain)
                .padding(.trailing, 6)
            }
            Button { dismiss() } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(DS.textSecondary)
                    .frame(width: 30, height: 30)
                    .background(DS.glass)
                    .clipShape(Circle())
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
    }

    // MARK: - Сложность (SAC)

    private var difficultyCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            cardTitle("🥾", "Сложность троп",
                     "Маршруты сложнее выбранного уровня роутер не предложит вовсе")

            VStack(spacing: 6) {
                ForEach(RoutingPreferences.SACLevel.allCases) { level in
                    let isOn = prefs.wrappedValue.maxDifficulty == level
                    Button {
                        withAnimation(.easeInOut(duration: 0.15)) { prefs.wrappedValue.maxDifficulty = level }
                    } label: {
                        HStack(spacing: 8) {
                            Circle()
                                .strokeBorder(isOn ? Color.black.opacity(0.3) : DS.border, lineWidth: 1.5)
                                .background(Circle().fill(isOn ? Color.black.opacity(0.15) : Color.clear))
                                .frame(width: 16, height: 16)
                                .overlay {
                                    if isOn {
                                        Circle().fill(Color.black).frame(width: 7, height: 7)
                                    }
                                }
                            VStack(alignment: .leading, spacing: 1) {
                                Text(level.label)
                                    .font(.system(size: 13, weight: .medium))
                                Text(level.hint)
                                    .font(.system(size: 10))
                                    .opacity(0.75)
                            }
                            Spacer(minLength: 0)
                        }
                        .foregroundColor(isOn ? .black : DS.textSecondary)
                        .padding(.horizontal, 12).padding(.vertical, 9)
                        .background(isOn ? DS.accent : DS.glass)
                        .clipShape(RoundedRectangle(cornerRadius: 11, style: .continuous))
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .padding(14)
        .background(DS.surface)
        .clipShape(RoundedRectangle(cornerRadius: DS.radiusM, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: DS.radiusM, style: .continuous).stroke(DS.border, lineWidth: 1))
    }

    // MARK: - Держаться троп

    private var trailPreferenceCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            cardTitle("🧭", "Держаться троп",
                     "Насколько неохотно роутер срезает по обычным дорогам вместо размеченных троп")

            HStack(spacing: 6) {
                trailPreferenceOption(value: 0.1, label: "Можно срезать")
                trailPreferenceOption(value: 0.2, label: "Обычно")
                trailPreferenceOption(value: 1.0, label: "Только тропы")
            }
        }
        .padding(14)
        .background(DS.surface)
        .clipShape(RoundedRectangle(cornerRadius: DS.radiusM, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: DS.radiusM, style: .continuous).stroke(DS.border, lineWidth: 1))
    }

    private func trailPreferenceOption(value: Double, label: String) -> some View {
        // Сравниваем с запасом: 0.2 из UserDefaults и 0.2 литералом не всегда
        // бит-в-бит равны после JSON-кодирования Double
        let isOn = abs(prefs.wrappedValue.trailPreference - value) < 0.01
        return Button {
            withAnimation(.easeInOut(duration: 0.15)) { prefs.wrappedValue.trailPreference = value }
        } label: {
            Text(label)
                .font(.system(size: 12, weight: .medium))
                .foregroundColor(isOn ? .black : DS.textSecondary)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 9)
                .background(isOn ? DS.accent : DS.glass)
                .clipShape(Capsule())
        }
        .buttonStyle(.plain)
    }

    // MARK: - Что предпочитать / чего избегать

    private var avoidCard: some View {
        VStack(alignment: .leading, spacing: 4) {
            cardTitle("🌲", "Предпочтения", "Не жёсткие запреты — роутер просто выбирает такой путь охотнее")

            toggleRow("Через лес", "Тень и укрытие от ветра", isOn: Binding(
                get: { prefs.wrappedValue.preferForest }, set: { prefs.wrappedValue.preferForest = $0 }))
            toggleRow("Вдоль воды", "Реки, озёра — там, где они есть по дороге", isOn: Binding(
                get: { prefs.wrappedValue.preferWater }, set: { prefs.wrappedValue.preferWater = $0 }))
            toggleRow("В обход городов", "Меньше асфальта и застройки", isOn: Binding(
                get: { prefs.wrappedValue.avoidTowns }, set: { prefs.wrappedValue.avoidTowns = $0 }))
            toggleRow("Потише", "В обход шумных дорог", isOn: Binding(
                get: { prefs.wrappedValue.avoidNoise }, set: { prefs.wrappedValue.avoidNoise = $0 }))
            toggleRow("Меньше набора высоты", "Роутер поищет более пологий путь", isOn: Binding(
                get: { prefs.wrappedValue.minimizeElevation }, set: { prefs.wrappedValue.minimizeElevation = $0 }))
            toggleRow("Избегать грязи", "В обход заболоченных и мокрых участков", isOn: Binding(
                get: { prefs.wrappedValue.avoidMud }, set: { prefs.wrappedValue.avoidMud = $0 }), isLast: true)
        }
        .padding(14)
        .background(DS.surface)
        .clipShape(RoundedRectangle(cornerRadius: DS.radiusM, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: DS.radiusM, style: .continuous).stroke(DS.border, lineWidth: 1))
    }

    // MARK: - Что можно проходить

    private var passableCard: some View {
        VStack(alignment: .leading, spacing: 4) {
            cardTitle("🪜", "Можно проходить", "Выключи, если хочешь путь без этого совсем")

            toggleRow("Лестницы и ступени", "Крутые участки, оборудованные ступенями", isOn: Binding(
                get: { prefs.wrappedValue.allowSteps }, set: { prefs.wrappedValue.allowSteps = $0 }))
            toggleRow("Паромы", "Переправы, где пешей тропы нет вовсе", isOn: Binding(
                get: { prefs.wrappedValue.allowFerries }, set: { prefs.wrappedValue.allowFerries = $0 }), isLast: true)
        }
        .padding(14)
        .background(DS.surface)
        .clipShape(RoundedRectangle(cornerRadius: DS.radiusM, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: DS.radiusM, style: .continuous).stroke(DS.border, lineWidth: 1))
    }

    // MARK: - Общие кусочки

    private func cardTitle(_ icon: String, _ title: String, _ subtitle: String) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Text(icon).font(.system(size: 20))
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(DS.textPrimary)
                Text(subtitle)
                    .font(.system(size: 11))
                    .foregroundColor(DS.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.bottom, 4)
    }

    private func toggleRow(_ title: String, _ subtitle: String, isOn: Binding<Bool>, isLast: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Toggle(isOn: isOn) {
                VStack(alignment: .leading, spacing: 1) {
                    Text(title)
                        .font(.system(size: 13, weight: .medium))
                        .foregroundColor(DS.textPrimary)
                    Text(subtitle)
                        .font(.system(size: 10))
                        .foregroundColor(DS.textSecondary)
                }
            }
            .toggleStyle(SwitchToggleStyle(tint: DS.accent))
            .padding(.vertical, 8)

            if !isLast {
                Divider().background(DS.border)
            }
        }
    }
}
