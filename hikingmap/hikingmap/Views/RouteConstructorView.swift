import SwiftUI
import CoreLocation

struct RouteConstructorView: View {
    @EnvironmentObject var appState: AppState

    @State private var showSaveSheet = false
    @State private var routeName    = ""

    private var waypointCount: Int { appState.constructorWaypoints.count }

    /// Считаем по проложенной линии, а не по опорным точкам: маршрут идёт
    /// по тропам, и напрямую между точками он заметно короче настоящего.
    private var estimatedDistanceKm: Double { appState.constructorDistanceKm }

    private var autoName: String {
        let f = DateFormatter()
        f.dateFormat = "d MMM yyyy"
        f.locale = Locale(identifier: "ru_RU")
        return "Маршрут \(f.string(from: Date()))"
    }

    var body: some View {
        ZStack {
            // Прицел и «резинка» — под интерфейсом и без перехвата касаний
            ConstructorAimLayer()

            VStack(spacing: 0) {
                modeBar
                    .padding(.horizontal, 16)
                    // Ниже шкалы масштаба карты: она рисуется у самого верха
                    .padding(.top, 92)

                Spacer()

                VStack(spacing: 12) {
                    if waypointCount >= 1 {
                        statsCard
                            .transition(.scale(scale: 0.85).combined(with: .opacity))
                    }
                    if let status = routingStatus {
                        statusLabel(status.text, icon: status.icon, warning: status.warning)
                            .transition(.opacity)
                    }
                    if waypointCount == 0 {
                        hintLabel
                            .transition(.opacity)
                    }
                    bottomControls
                        .padding(.horizontal, 16)
                        // Ниже нельзя: там логотип Mapbox и кнопка «i»,
                        // перекрывать их не разрешает лицензия
                        .padding(.bottom, 74)
                }
            }
        }
        .animation(.spring(response: 0.35), value: waypointCount)
        .animation(.spring(response: 0.3), value: appState.canRedoConstructor)
        .animation(.easeInOut(duration: 0.2), value: appState.constructorIsRouting)
        .animation(.easeInOut(duration: 0.2), value: appState.constructorHasStraightLegs)
        .allowsHitTesting(true)
        .sheet(isPresented: $showSaveSheet) {
            SaveRouteSheet(
                routeName:     $routeName,
                distanceKm:    estimatedDistanceKm,
                waypointCount: waypointCount,
                onSave:        { commitSave() },
                onCancel:      { showSaveSheet = false }
            )
            .presentationDetents([.height(310)])
            .presentationBackground(Color(red: 0.08, green: 0.08, blue: 0.08))
            .presentationDragIndicator(.hidden)
        }
    }

    // MARK: - Mode bar
    private var modeBar: some View {
        HStack(spacing: 10) {
            HStack(spacing: 6) {
                Circle().fill(DS.accent).frame(width: 7, height: 7)
                Text("РИСУЮ МАРШРУТ")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundColor(DS.accent)
                    .kerning(0.5)
            }
            Spacer()
            snapToggleButton
            Button {
                withAnimation(.spring(response: 0.3)) {
                    appState.isConstructorMode = false
                    appState.resetConstructor()
                }
            } label: {
                HStack(spacing: 5) {
                    Image(systemName: "xmark").font(.system(size: 11, weight: .semibold))
                    Text("Стоп").font(.system(size: 12, weight: .medium))
                }
                .foregroundColor(DS.textSecondary)
                .padding(.horizontal, 12).padding(.vertical, 6)
                .background(DS.glass)
                .clipShape(Capsule())
                .overlay(Capsule().stroke(DS.border, lineWidth: 1))
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 14).padding(.vertical, 10)
        .background(.ultraThinMaterial)
        .background(Color(red: 0.04, green: 0.04, blue: 0.04).opacity(0.7))
        .clipShape(Capsule())
        .overlay(Capsule().stroke(DS.accent.opacity(0.4), lineWidth: 1))
    }

    private var snapToggleButton: some View {
        Button {
            withAnimation(.easeInOut(duration: 0.18)) {
                appState.isSnapEnabled.toggle()
            }
        } label: {
            HStack(spacing: 4) {
                Image(systemName: "bolt.fill")
                    .font(.system(size: 11, weight: .semibold))
                Text("По тропам")
                    .font(.system(size: 11, weight: .medium))
            }
            .foregroundColor(appState.isSnapEnabled ? DS.accent : DS.textTertiary)
            .padding(.horizontal, 10).padding(.vertical, 6)
            .background(appState.isSnapEnabled ? DS.accent.opacity(0.15) : DS.glass)
            .clipShape(Capsule())
            .overlay(Capsule().stroke(
                appState.isSnapEnabled ? DS.accent.opacity(0.45) : DS.border,
                lineWidth: 1
            ))
        }
        .buttonStyle(.plain)
        .animation(.easeInOut(duration: 0.18), value: appState.isSnapEnabled)
    }

    // MARK: - Сводка маршрута
    private var statsCard: some View {
        VStack(spacing: 10) {
            HStack(spacing: 14) {
                statItem("↔", String(format: "%.1f", estimatedDistanceKm), "км")
                statDivider
                statItem("📍", "\(waypointCount)", RouteConstructorView.pointsWord(waypointCount))
                statDivider
                statItem("↑", climbValue(appState.constructorAscentM), "м")
                statDivider
                statItem("↓", climbValue(appState.constructorDescentM), "м")
            }
            if waypointCount >= 2 {
                doneButton
            }
        }
        .padding(.horizontal, 18).padding(.vertical, 12)
        .background(.ultraThinMaterial)
        .background(Color(red: 0.07, green: 0.07, blue: 0.07).opacity(0.85))
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(DS.border, lineWidth: 1))
        .shadow(color: .black.opacity(0.4), radius: 8)
        .padding(.horizontal, 16)
    }

    /// «1 точка», «2 точки», «5 точек» — иначе счётчик читается как машинный
    static func pointsWord(_ count: Int) -> String {
        let tail = count % 100
        if (11...14).contains(tail) { return "точек" }
        switch count % 10 {
        case 1:      return "точка"
        case 2...4:  return "точки"
        default:     return "точек"
        }
    }

    private var statDivider: some View {
        Divider().background(DS.border).frame(height: 22)
    }

    /// Пока высот нет (роутер их не дал, а рельеф ещё не прогрузился) — прочерк,
    /// а не ноль: ноль читался бы как «ровная дорога».
    private func climbValue(_ meters: Double?) -> String {
        guard let meters else { return "—" }
        return String(Int(meters.rounded()))
    }

    private var doneButton: some View {
        Button {
            routeName = autoName
            showSaveSheet = true
        } label: {
            let canSave = waypointCount >= 2 && !appState.constructorIsRouting
            HStack(spacing: 6) {
                Image(systemName: "checkmark").font(.system(size: 12, weight: .bold))
                Text("Готово").font(.system(size: 13, weight: .semibold))
            }
            .foregroundColor(canSave ? .black : DS.textTertiary)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 9)
            .background(canSave ? DS.accent : DS.glass)
            .clipShape(RoundedRectangle(cornerRadius: 11, style: .continuous))
        }
        .buttonStyle(.plain)
        .disabled(waypointCount < 2 || appState.constructorIsRouting)
    }

    private func statItem(_ icon: String, _ value: String, _ unit: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 3) {
            Text(icon).font(.system(size: 11)).foregroundColor(DS.textSecondary)
            Text(value)
                .font(.system(size: 15, weight: .bold, design: .monospaced))
                .foregroundColor(DS.textPrimary)
            Text(unit).font(.system(size: 10)).foregroundColor(DS.textSecondary)
        }
    }

    // MARK: - Статус прокладки
    /// Что сейчас происходит с линией: ждём роутер или часть пути легла
    /// напрямик, потому что троп там нет.
    private var routingStatus: (text: String, icon: String, warning: Bool)? {
        if appState.constructorIsRouting {
            return ("Прокладываю по тропам…", "point.topleft.down.curvedto.point.bottomright.up", false)
        }
        if appState.constructorHasStraightLegs {
            return (appState.isSnapEnabled ? "Часть пути — напрямик: троп рядом нет"
                                           : "Прокладка по тропам выключена",
                    "exclamationmark.triangle", true)
        }
        return nil
    }

    private func statusLabel(_ text: String, icon: String, warning: Bool) -> some View {
        HStack(spacing: 6) {
            Image(systemName: icon).font(.system(size: 11, weight: .semibold))
            Text(text).font(.system(size: 12))
        }
        .foregroundColor(warning ? DS.textSecondary : DS.accent)
        .padding(.horizontal, 14).padding(.vertical, 8)
        .background(.ultraThinMaterial)
        .background(Color(red: 0.04, green: 0.04, blue: 0.04).opacity(0.6))
        .clipShape(Capsule())
        .overlay(Capsule().stroke(warning ? DS.border : DS.accent.opacity(0.35), lineWidth: 1))
    }

    // MARK: - Hint
    private var hintLabel: some View {
        Text("Наведи прицел и нажми «Старт» — или тапни по карте")
            .font(.system(size: 13))
            .foregroundColor(DS.textSecondary)
            .padding(.horizontal, 18).padding(.vertical, 10)
            .background(.ultraThinMaterial)
            .background(Color(red: 0.04, green: 0.04, blue: 0.04).opacity(0.6))
            .clipShape(Capsule())
            .overlay(Capsule().stroke(DS.border, lineWidth: 1))
    }

    // MARK: - Bottom controls
    /// Слева история: одна кнопка «отменить», а когда есть что вернуть —
    /// рядом появляется вторая. Справа — «Шаг»: ставит точку под прицелом.
    private var bottomControls: some View {
        HStack(spacing: 10) {
            historyButton(icon: "arrow.uturn.backward",
                          enabled: appState.canUndoConstructor) {
                appState.undoConstructor()
            }
            if appState.canRedoConstructor {
                historyButton(icon: "arrow.uturn.forward", enabled: true) {
                    appState.redoConstructor()
                }
                .transition(.scale(scale: 0.6).combined(with: .opacity))
            }
            stepButton
        }
    }

    private func historyButton(icon: String, enabled: Bool, action: @escaping () -> Void) -> some View {
        Button {
            guard enabled else { return }
            withAnimation(.spring(response: 0.3)) { action() }
        } label: {
            Image(systemName: icon)
                .font(.system(size: 16, weight: .semibold))
                .foregroundColor(enabled ? DS.textPrimary : DS.textSecondary)
                .frame(width: 52, height: 48)
                .background(.ultraThinMaterial)
                .background(Color(red: 0.07, green: 0.07, blue: 0.07).opacity(0.85))
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .stroke(DS.border, lineWidth: 1))
                .shadow(color: .black.opacity(0.35), radius: 6, y: 2)
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
    }

    private var stepButton: some View {
        Button {
            appState.constructorStepRequest.send()
        } label: {
            HStack(spacing: 7) {
                Image(systemName: waypointCount == 0 ? "mappin.and.ellipse" : "plus")
                    .font(.system(size: 14, weight: .bold))
                Text(waypointCount == 0 ? "Старт" : "Шаг")
                    .font(.system(size: 15, weight: .semibold))
            }
            .foregroundColor(.black)
            .frame(maxWidth: .infinity)
            .frame(height: 48)
            .background(DS.accent)
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .shadow(color: DS.accent.opacity(0.35), radius: 8, y: 2)
        }
        .buttonStyle(.plain)
    }

    // MARK: - Save logic
    private func commitSave() {
        showSaveSheet = false
        let name = routeName.trimmingCharacters(in: .whitespacesAndNewlines)
        let path = appState.constructorPath
        var route = CustomRoute(
            name: name.isEmpty ? autoName : name,
            waypoints: path,
            distanceKm: estimatedDistanceKm
        )
        // Высоты уже собраны, пока рисовали (BRouter или рельеф карты) — те же,
        // по которым в панели показан набор. В сеть за ними идём только если их нет.
        let profile = appState.constructorElevationProfile
        if let profile, profile.count == path.count { route.elevations = profile }
        appState.customRouteStore.add(route)

        withAnimation(.spring(response: 0.3)) {
            appState.resetConstructor()
            appState.isConstructorMode    = false
            appState.filter               = .mine
            appState.selectCustomRoute(route)
        }

        guard route.elevations == nil else { return }

        // Fetch elevation asynchronously and update stored route
        let savedId    = route.id
        let waypoints  = route.coordinates
        Task {
            if let elevs = await ElevationService.fetch(for: waypoints) {
                await MainActor.run {
                    route.elevations = elevs
                    appState.customRouteStore.update(route)
                    // Refresh selected route if still active
                    if appState.selectedCustomRoute?.id == savedId {
                        appState.selectedCustomRoute = route
                    }
                }
            }
        }
    }
}
