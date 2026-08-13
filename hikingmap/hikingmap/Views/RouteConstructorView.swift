import SwiftUI
import CoreLocation

struct RouteConstructorView: View {
    @EnvironmentObject var appState: AppState

    @State private var showSaveSheet = false
    @State private var routeName    = ""

    private var waypointCount: Int { appState.constructorWaypoints.count }

    private var estimatedDistanceKm: Double {
        let pts = appState.constructorWaypoints
        guard pts.count >= 2 else { return 0 }
        var total = 0.0
        for i in 1..<pts.count {
            let a = CLLocation(latitude: pts[i-1].latitude, longitude: pts[i-1].longitude)
            let b = CLLocation(latitude: pts[i].latitude,   longitude: pts[i].longitude)
            total += a.distance(from: b)
        }
        return total / 1000.0
    }

    private var autoName: String {
        let f = DateFormatter()
        f.dateFormat = "d MMM yyyy"
        f.locale = Locale(identifier: "ru_RU")
        return "Маршрут \(f.string(from: Date()))"
    }

    var body: some View {
        VStack(spacing: 0) {
            modeBar
                .padding(.horizontal, 16)
                .padding(.top, 56)

            Spacer()

            VStack(spacing: 12) {
                if waypointCount >= 2 {
                    statsCloud
                        .transition(.scale(scale: 0.85).combined(with: .opacity))
                }
                if waypointCount == 0 {
                    hintLabel
                        .transition(.opacity)
                }
                bottomControls
                    .padding(.horizontal, 16)
                    .padding(.bottom, 32)
            }
        }
        .animation(.spring(response: 0.35), value: waypointCount)
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
                    appState.constructorWaypoints = []
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
                Text("Притяжение")
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

    // MARK: - Stats cloud
    private var statsCloud: some View {
        HStack(spacing: 20) {
            statItem("↔", String(format: "%.1f", estimatedDistanceKm), "км")
            Divider().background(DS.border).frame(height: 24)
            statItem("📍", "\(waypointCount)", "точек")
        }
        .padding(.horizontal, 20).padding(.vertical, 12)
        .background(.ultraThinMaterial)
        .background(Color(red: 0.07, green: 0.07, blue: 0.07).opacity(0.85))
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(DS.border, lineWidth: 1))
        .shadow(color: .black.opacity(0.4), radius: 8)
        .frame(maxWidth: .infinity, alignment: .center)
    }

    private func statItem(_ icon: String, _ value: String, _ unit: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 4) {
            Text(icon).font(.system(size: 12)).foregroundColor(DS.textSecondary)
            Text(value)
                .font(.system(size: 16, weight: .bold, design: .monospaced))
                .foregroundColor(DS.textPrimary)
                .contentTransition(.numericText(value: Double(value) ?? 0))
            Text(unit).font(.system(size: 11)).foregroundColor(DS.textSecondary)
        }
    }

    // MARK: - Hint
    private var hintLabel: some View {
        Text("Нажимай на карту чтобы добавить точку")
            .font(.system(size: 13))
            .foregroundColor(DS.textSecondary)
            .padding(.horizontal, 18).padding(.vertical, 10)
            .background(.ultraThinMaterial)
            .background(Color(red: 0.04, green: 0.04, blue: 0.04).opacity(0.6))
            .clipShape(Capsule())
            .overlay(Capsule().stroke(DS.border, lineWidth: 1))
    }

    // MARK: - Bottom controls
    private var bottomControls: some View {
        HStack(spacing: 12) {
            Button {
                guard !appState.constructorWaypoints.isEmpty else { return }
                withAnimation { appState.constructorWaypoints.removeLast() }
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: "arrow.uturn.backward")
                        .font(.system(size: 13, weight: .semibold))
                    Text("Отменить")
                        .font(.system(size: 13, weight: .medium))
                }
                .foregroundColor(appState.constructorWaypoints.isEmpty ? DS.textTertiary : DS.textSecondary)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 13)
                .background(DS.glass)
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(DS.border, lineWidth: 1))
            }
            .buttonStyle(.plain)
            .disabled(appState.constructorWaypoints.isEmpty)

            Button {
                routeName = autoName
                showSaveSheet = true
            } label: {
                let canSave = waypointCount >= 2
                HStack(spacing: 6) {
                    Image(systemName: "checkmark").font(.system(size: 13, weight: .bold))
                    Text("Готово").font(.system(size: 13, weight: .semibold))
                }
                .foregroundColor(canSave ? .black : DS.textTertiary)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 13)
                .background(canSave ? DS.accent : DS.glass)
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .stroke(canSave ? DS.accent : DS.border, lineWidth: 1))
            }
            .buttonStyle(.plain)
            .disabled(waypointCount < 2)
        }
    }

    // MARK: - Save logic
    private func commitSave() {
        showSaveSheet = false
        let name = routeName.trimmingCharacters(in: .whitespacesAndNewlines)
        var route = CustomRoute(
            name: name.isEmpty ? autoName : name,
            waypoints: appState.constructorWaypoints,
            distanceKm: estimatedDistanceKm
        )
        appState.customRouteStore.add(route)

        withAnimation(.spring(response: 0.3)) {
            appState.constructorWaypoints = []
            appState.isConstructorMode    = false
            appState.filter               = .mine
            appState.selectCustomRoute(route)
        }

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
