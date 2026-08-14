import SwiftUI
import CoreLocation
import UniformTypeIdentifiers

struct ContentView: View {
    @EnvironmentObject var appState: AppState
    @ObservedObject private var offlineManager = OfflineMapManager.shared

    @State private var showGPXImporter   = false
    @State private var showMapTools      = false
    @State private var showKmTooltip     = false
    @State private var showMountainBurst = false

    // Floating AI button position
    @State private var aiPos: CGPoint = CGPoint(
        x: UIScreen.main.bounds.width - 58,
        y: UIScreen.main.bounds.height - 220
    )
    @GestureState private var aiDrag: CGSize = .zero

    var body: some View {
        ZStack(alignment: .bottom) {
            MapboxMapView()
                .ignoresSafeArea()

            // Live Track HUD — full screen, slides up from bottom
            if appState.recordingEntryVisible {
                LiveTrackHUD(recorder: appState.trackRecorder)
                    .environmentObject(appState)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .ignoresSafeArea()
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                    .zIndex(100)
            }

            if appState.isConstructorMode {
                RouteConstructorView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .ignoresSafeArea()
                    .transition(.opacity)
            } else if !appState.recordingEntryVisible {
                // Top bar
                VStack(alignment: .leading, spacing: 8) {
                    HStack(spacing: 10) {
                        filterPill
                        Spacer()
                        kmBadge
                    }
                    mapToolsRow
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.top, 56)
                .padding(.horizontal, 14)
                .frame(maxHeight: .infinity, alignment: .top)

                // Bottom panel
                bottomPanel

                // Zoom Out button — appears when zoomed in, panel collapsed
                if showZoomOut {
                    VStack {
                        Spacer()
                        HStack {
                            zoomOutButton
                                .padding(.leading, 16)
                                .padding(.bottom, 84)
                            Spacer()
                        }
                    }
                    .ignoresSafeArea(edges: .bottom)
                    .allowsHitTesting(true)
                    .transition(.scale(scale: 0.85, anchor: .bottomLeading).combined(with: .opacity))
                }

                // Floating AI button — always on top, draggable
                floatingAIButton
            }

            // Mountain burst overlay
            if showMountainBurst {
                MountainBurstView(isShowing: $showMountainBurst)
                    .ignoresSafeArea()
                    .allowsHitTesting(false)
            }
        }
        .animation(.easeInOut(duration: 0.22), value: appState.isConstructorMode)
        .animation(.spring(response: 0.32, dampingFraction: 0.78), value: showZoomOut)
        #if DEBUG
        .overlay(alignment: .top) { DebugHUD().environmentObject(appState) }
        #endif
        .onAppear { appState.preloadAllStats() }
        .sheet(isPresented: $appState.showAIAssistant) {
            AIAssistantView().environmentObject(appState)
        }
        .sheet(isPresented: $appState.showOfflineMaps) {
            OfflineMapsView().environmentObject(appState)
        }
        .fileImporter(
            isPresented: $showGPXImporter,
            allowedContentTypes: [.xml, .data],
            allowsMultipleSelection: false
        ) { handleGPXImport($0) }
        .fullScreenCover(item: $appState.selectedPhotoInfo) { info in
            if let route = RouteStore.all.first(where: { $0.id == info.routeId }) {
                PhotoFullscreenView(
                    photos:         route.photos,
                    initialIndex:   info.index,
                    photoGPSCoords: gpsArray(route: route, stats: appState.routeStats[info.routeId])
                ) { coord in
                    appState.selectedPhotoInfo = nil
                    appState.collapsePanel()
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) {
                        appState.flyCamera(to: coord)
                    }
                }
            }
        }
    }

    // MARK: - Bottom panel state machine

    @ViewBuilder
    private var bottomPanel: some View {
        VStack(spacing: 0) {
            Spacer()
            if let route = appState.selectedRoute, appState.showDetailPanel {
                RouteDetailPanel(
                    route:      route,
                    stats:      appState.routeStats[route.id],
                    onClose:    { appState.deselect() },
                    onCollapse: { appState.collapsePanel() }
                )
                .transition(.move(edge: .bottom).combined(with: .opacity))
                .frame(maxHeight: UIScreen.main.bounds.height * 0.65)

            } else if let route = appState.selectedRoute {
                CollapsedRouteBar(
                    route:    route,
                    stats:    appState.routeStats[route.id],
                    onExpand: { appState.expandPanel() },
                    onClose:  { appState.deselect() }
                )
                .transition(.move(edge: .bottom).combined(with: .opacity))

            } else if let custom = appState.selectedCustomRoute, appState.showCustomRouteDetail {
                CustomRouteDetailPanel(
                    route:      custom,
                    onClose:    { appState.deselectCustomRoute() },
                    onCollapse: { appState.showCustomRouteDetail = false }
                )
                .transition(.move(edge: .bottom).combined(with: .opacity))
                .frame(maxHeight: UIScreen.main.bounds.height * 0.65)

            } else if let custom = appState.selectedCustomRoute {
                CollapsedCustomRouteBar(
                    route:    custom,
                    onExpand: { appState.showCustomRouteDetail = true },
                    onClose:  { appState.deselectCustomRoute() }
                )
                .transition(.move(edge: .bottom).combined(with: .opacity))

            } else if let cave = appState.selectedCave, appState.showCaveDetail {
                CaveDetailPanel(
                    cave: cave,
                    onClose: { appState.selectedCave = nil; appState.showCaveDetail = false },
                    onCollapse: { appState.showCaveDetail = false },
                    onShowOnMap: { appState.caveFlyCameraRequest.send(cave.clCoordinate) }
                )
                .transition(.move(edge: .bottom).combined(with: .opacity))
                .frame(maxHeight: UIScreen.main.bounds.height * 0.75)

            } else if let cave = appState.selectedCave {
                CollapsedCaveBar(
                    cave: cave,
                    onExpand: { appState.showCaveDetail = true },
                    onClose: { appState.selectedCave = nil }
                )
                .transition(.move(edge: .bottom).combined(with: .opacity))

            } else if let pss = appState.selectedPSSRoute, appState.showPSSRouteDetail {
                PSSRouteDetailPanel(
                    route:      pss,
                    onClose:    { appState.deselectPSSRoute() },
                    onCollapse: { appState.showPSSRouteDetail = false }
                )
                .transition(.move(edge: .bottom).combined(with: .opacity))
                .frame(maxHeight: UIScreen.main.bounds.height * 0.65)

            } else if let pss = appState.selectedPSSRoute {
                CollapsedPSSRouteBar(
                    route:    pss,
                    onExpand: { appState.showPSSRouteDetail = true },
                    onClose:  { appState.deselectPSSRoute() }
                )
                .transition(.move(edge: .bottom).combined(with: .opacity))

            } else {
                RouteListSheet(expanded: $appState.routeListExpanded)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .animation(.spring(response: 0.38, dampingFraction: 0.85), value: appState.selectedRoute?.id)
        .animation(.spring(response: 0.38, dampingFraction: 0.85), value: appState.selectedCustomRoute?.id)
        .animation(.spring(response: 0.38, dampingFraction: 0.85), value: appState.showDetailPanel)
        .animation(.spring(response: 0.38, dampingFraction: 0.85), value: appState.selectedCave?.id)
        .animation(.spring(response: 0.38, dampingFraction: 0.85), value: appState.showCaveDetail)
        .animation(.spring(response: 0.38, dampingFraction: 0.85), value: appState.selectedPSSRoute?.id)
        .animation(.spring(response: 0.38, dampingFraction: 0.85), value: appState.showPSSRouteDetail)
        .ignoresSafeArea(edges: .bottom)
    }

    // MARK: - Floating AI button

    private var floatingAIButton: some View {
        ZStack(alignment: .topLeading) {
            Color.clear
            ZStack {
                Circle()
                    .fill(LinearGradient(colors: [DS.accent, DS.diffMedium],
                                         startPoint: .topLeading, endPoint: .bottomTrailing))
                    .frame(width: 50, height: 50)
                    .shadow(color: DS.accent.opacity(0.5), radius: 10, y: 4)
                Text("✦")
                    .font(.system(size: 20))
                    .foregroundColor(.white)
            }
            .position(
                x: aiPos.x + aiDrag.width,
                y: aiPos.y + aiDrag.height
            )
            .gesture(
                DragGesture(minimumDistance: 0)
                    .updating($aiDrag) { value, state, _ in state = value.translation }
                    .onEnded { value in
                        let dist = hypot(value.translation.width, value.translation.height)
                        if dist < 8 {
                            appState.showAIAssistant = true
                            return
                        }
                        let screen = UIScreen.main.bounds
                        aiPos.x = min(max(aiPos.x + value.translation.width, 30), screen.width  - 30)
                        aiPos.y = min(max(aiPos.y + value.translation.height, 80), screen.height - 80)
                    }
            )
        }
        .ignoresSafeArea()
        .allowsHitTesting(true)
    }

    // MARK: - Zoom Out button

    private var showZoomOut: Bool {
        appState.mapZoom > 11.5 && !appState.showDetailPanel
            && !appState.routeListExpanded && !appState.recordingEntryVisible
    }

    private var zoomOutButton: some View {
        Button {
            appState.zoomOutRequest.send()
        } label: {
            HStack(spacing: 5) {
                Image(systemName: "minus.magnifyingglass")
                    .font(.system(size: 13, weight: .medium))
                Text("Zoom Out")
                    .font(.system(size: 12, weight: .medium))
            }
            .foregroundColor(DS.textPrimary)
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            .background(.ultraThinMaterial)
            .background(Color(red: 0.04, green: 0.04, blue: 0.04).opacity(0.7))
            .clipShape(Capsule())
            .overlay(Capsule().stroke(DS.border, lineWidth: 1))
            .shadow(color: .black.opacity(0.3), radius: 8, y: 3)
        }
        .buttonStyle(.plain)
    }

    // MARK: - Top bar

    private var filterPill: some View {
        HStack(spacing: 0) {
            ForEach(RouteFilter.allCases, id: \.self) { filter in
                Button(action: { appState.filter = filter }) {
                    Text(filter.rawValue)
                        .font(.system(size: 12, weight: .medium))
                        .lineLimit(1)
                        .foregroundColor(appState.filter == filter ? .black : DS.textSecondary)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 7)
                        .background(appState.filter == filter ? Color.white : Color.clear)
                        .clipShape(Capsule())
                }
                .buttonStyle(.plain)
                .animation(.easeInOut(duration: 0.18), value: appState.filter)
            }
        }
        .padding(3)
        .background(.ultraThinMaterial)
        .background(Color(red: 0.04, green: 0.04, blue: 0.04).opacity(0.55))
        .clipShape(Capsule())
        .overlay(Capsule().stroke(DS.border, lineWidth: 1))
    }

    private var kmBadge: some View {
        ZStack(alignment: .topTrailing) {
            Button {
                withAnimation(.spring(response: 0.28, dampingFraction: 0.78)) {
                    showKmTooltip.toggle()
                }
            } label: {
                HStack(spacing: 5) {
                    Text("🥾")
                        .font(.system(size: 14))
                    Text(String(format: "%.0f км", totalCompletedKm))
                        .font(.system(size: 12, weight: .bold))
                        .foregroundColor(.white)
                        .contentTransition(.numericText(value: totalCompletedKm))
                        .animation(.spring, value: totalCompletedKm)
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 7)
                .background(.ultraThinMaterial)
                .background(Color(red: 0.04, green: 0.04, blue: 0.04).opacity(0.55))
                .clipShape(Capsule())
                .overlay(Capsule().stroke(DS.border, lineWidth: 1))
            }
            .buttonStyle(.plain)

            if showKmTooltip {
                kmTooltip
                    .offset(y: -118)
                    .transition(.scale(scale: 0.85, anchor: .bottomTrailing)
                                    .combined(with: .opacity))
            }
        }
    }

    private var kmTooltip: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Привет, я Гриша и я прошел уже \(Int(totalCompletedKm)) км на хайкингах с начала 2026, присоединяйся ко мне! 🏔️")
                .font(.system(size: 13))
                .foregroundColor(DS.textPrimary)
                .fixedSize(horizontal: false, vertical: true)

            Button {
                showKmTooltip    = false
                showMountainBurst = true
            } label: {
                HStack(spacing: 4) {
                    Text("Го")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundColor(.white)
                    Text("🏔️")
                        .font(.system(size: 13))
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 7)
                .background(DS.accent)
                .clipShape(Capsule())
            }
            .buttonStyle(.plain)
            .frame(maxWidth: .infinity, alignment: .trailing)
        }
        .padding(14)
        .frame(width: 240)
        .background(.ultraThinMaterial)
        .background(Color(red: 0.07, green: 0.07, blue: 0.07).opacity(0.92))
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(DS.border, lineWidth: 1))
        .shadow(color: .black.opacity(0.4), radius: 12, y: 4)
    }

    // MARK: - Map tools row

    private var anyToolActive: Bool {
        appState.showAllTrails || appState.showOSMTrails || appState.showPSSTrails || appState.topoAlpha > 0.01
    }

    private var anyLayerActive: Bool {
        appState.topoAlpha > 0.01 || appState.showTrailsHeatmap
    }

    private var mapToolsRow: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                // Карта button
                Button {
                    withAnimation(.spring(response: 0.28, dampingFraction: 0.78)) {
                        showMapTools.toggle()
                        if showMapTools { appState.showLayersPanel = false }
                    }
                } label: {
                    HStack(spacing: 5) {
                        Image(systemName: showMapTools ? "xmark" : "slider.horizontal.3")
                            .font(.system(size: 12, weight: .medium))
                            .frame(width: 14, height: 14)
                        Text(showMapTools ? "Скрыть" : "Карта")
                            .font(.system(size: 12, weight: .medium))
                    }
                    .foregroundColor(anyToolActive ? DS.accent : DS.textSecondary)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 7)
                    .background(.ultraThinMaterial)
                    .background(Color(red: 0.04, green: 0.04, blue: 0.04).opacity(0.55))
                    .clipShape(Capsule())
                    .overlay(Capsule().stroke(
                        anyToolActive ? DS.accent.opacity(0.45) : DS.border,
                        lineWidth: 1
                    ))
                }
                .buttonStyle(.plain)

                // Слои button
                Button {
                    withAnimation(.spring(response: 0.28, dampingFraction: 0.78)) {
                        appState.showLayersPanel.toggle()
                        if appState.showLayersPanel { showMapTools = false }
                    }
                } label: {
                    HStack(spacing: 5) {
                        Image(systemName: appState.showLayersPanel ? "xmark" : "square.3.layers.3d")
                            .font(.system(size: 12, weight: .medium))
                            .frame(width: 14, height: 14)
                        Text(appState.showLayersPanel ? "Скрыть" : "Слои")
                            .font(.system(size: 12, weight: .medium))
                    }
                    .foregroundColor(anyLayerActive ? DS.accent : DS.textSecondary)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 7)
                    .background(.ultraThinMaterial)
                    .background(Color(red: 0.04, green: 0.04, blue: 0.04).opacity(0.55))
                    .clipShape(Capsule())
                    .overlay(Capsule().stroke(
                        anyLayerActive ? DS.accent.opacity(0.45) : DS.border,
                        lineWidth: 1
                    ))
                }
                .buttonStyle(.plain)
            }

            if showMapTools {
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 6) {
                        allTrailsButton
                        osmTrailsButton
                        pssTrailsButton
                        caveLayerButton
                    }
                    HStack(spacing: 6) {
                        importGPXButton
                        constructorButton
                    }
                }
                .transition(.opacity.combined(with: .move(edge: .top)))
            }

            if appState.showLayersPanel {
                layersSlider
                    .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
    }

    private var layersSlider: some View {
        VStack(alignment: .leading, spacing: 6) {
            baseStylePicker

            // Подложка OpenTopoMap имеет смысл только поверх спутника — на топооснове
            // горизонтали и отмывка уже нарисованы, а её тайлы ещё и требуют сети.
            if appState.baseStyle == .satellite {
                Divider().background(DS.border).padding(.vertical, 2)

                HStack {
                    Text("🗺️ OpenTopoMap")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundColor(DS.textSecondary)
                    Spacer()
                    Text("🛰️ Спутник")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundColor(DS.textSecondary)
                }

                Slider(value: Binding(
                    get: { 1.0 - appState.topoAlpha },
                    set: { appState.topoAlpha = 1.0 - $0 }
                ), in: 0...1)
                .tint(DS.accent)
            }

            Divider().background(DS.border).padding(.vertical, 2)

            heatmapRow

            Divider().background(DS.border).padding(.vertical, 2)

            offlineRow
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(.ultraThinMaterial)
        .background(Color(red: 0.04, green: 0.04, blue: 0.04).opacity(0.55))
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(DS.border, lineWidth: 1))
        .frame(width: 250)
    }

    /// Основа карты. Топооснова — единственная, что умеет работать без сети.
    private var baseStylePicker: some View {
        HStack(spacing: 6) {
            ForEach(BaseMapStyle.allCases) { style in
                let isOn = appState.baseStyle == style
                Button {
                    guard !isOn else { return }
                    // На топооснове растровая подложка не нужна — гасим, чтобы
                    // не тянуть тайлы OpenTopoMap впустую
                    if style == .topo { appState.topoAlpha = 0 }
                    withAnimation(.easeInOut(duration: 0.2)) { appState.baseStyle = style }
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: style.icon)
                            .font(.system(size: 10, weight: .medium))
                        Text(style.title)
                            .font(.system(size: 11, weight: .medium))
                        if style.supportsOffline && offlineReady {
                            Image(systemName: "arrow.down.circle.fill")
                                .font(.system(size: 9))
                                .foregroundColor(DS.pinStart)
                        }
                    }
                    .foregroundColor(isOn ? .black : DS.textSecondary)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 7)
                    .background(isOn ? DS.accent : DS.glass)
                    .clipShape(Capsule())
                }
                .buttonStyle(.plain)
            }
        }
    }

    private var offlineReady: Bool { offlineManager.state.isReady }

    /// Вход в экран офлайн-карты.
    private var offlineRow: some View {
        Button {
            appState.showOfflineMaps = true
        } label: {
            HStack(spacing: 6) {
                Image(systemName: offlineReady ? "arrow.down.circle.fill" : "arrow.down.circle")
                    .font(.system(size: 12))
                    .foregroundColor(offlineReady ? DS.pinStart : DS.textSecondary)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Офлайн-карта")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundColor(DS.textSecondary)
                    Text(offlineReady ? "Сербия на устройстве" : "Скачать Сербию на устройство")
                        .font(.system(size: 10))
                        .foregroundColor(DS.textSecondary.opacity(0.75))
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundColor(DS.textTertiary)
            }
        }
        .buttonStyle(.plain)
    }

    /// Тоггл хитмапа троп — публичные GPS-треки OpenStreetMap.
    private var heatmapRow: some View {
        VStack(alignment: .leading, spacing: 5) {
            Toggle(isOn: $appState.showTrailsHeatmap) {
                Text("🔥 Хитмап троп")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(appState.showTrailsHeatmap ? DS.accent : DS.textSecondary)
            }
            .toggleStyle(SwitchToggleStyle(tint: DS.accent))

            Text("GPS-треки OpenStreetMap — где реально ходят")
                .font(.system(size: 10))
                .foregroundColor(DS.textSecondary.opacity(0.75))
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    // MARK: - Map tool buttons

    private var importGPXButton: some View {
        Button { showGPXImporter = true } label: {
            HStack(spacing: 5) {
                Image(systemName: "square.and.arrow.down")
                    .font(.system(size: 11, weight: .medium))
                Text("GPX")
                    .font(.system(size: 12, weight: .medium))
                    .lineLimit(1)
            }
            .foregroundColor(DS.textSecondary)
            .padding(.horizontal, 10)
            .padding(.vertical, 7)
            .background(.ultraThinMaterial)
            .background(Color(red: 0.04, green: 0.04, blue: 0.04).opacity(0.55))
            .clipShape(Capsule())
            .overlay(Capsule().stroke(DS.border, lineWidth: 1))
        }
        .buttonStyle(.plain)
    }

    private var constructorButton: some View {
        Button {
            withAnimation(.spring(response: 0.3)) {
                appState.isConstructorMode = true
                appState.deselect()
            }
        } label: {
            HStack(spacing: 6) {
                Image(systemName: "pencil")
                    .font(.system(size: 12, weight: .medium))
                Text("Нарисовать")
                    .font(.system(size: 12, weight: .medium))
                    .lineLimit(1)
            }
            .foregroundColor(DS.textSecondary)
            .padding(.horizontal, 12)
            .padding(.vertical, 7)
            .background(.ultraThinMaterial)
            .background(Color(red: 0.04, green: 0.04, blue: 0.04).opacity(0.55))
            .clipShape(Capsule())
            .overlay(Capsule().stroke(DS.border, lineWidth: 1))
        }
        .buttonStyle(.plain)
    }

    private var caveLayerButton: some View {
        trailLayerButton(label: "Пещеры",
                         icon: appState.showCaveLayer ? "circle.hexagonpath.fill" : "circle.hexagonpath",
                         active: appState.showCaveLayer,
                         action: { appState.showCaveLayer.toggle() })
    }

    private var osmTrailsButton: some View {
        trailLayerButton(label: "OSM",
                         icon: appState.showOSMTrails ? "map.fill" : "map",
                         active: appState.showOSMTrails,
                         action: { appState.showOSMTrails.toggle() })
    }

    private var pssTrailsButton: some View {
        trailLayerButton(label: "PSS",
                         icon: appState.showPSSTrails ? "figure.hiking" : "figure.walk",
                         active: appState.showPSSTrails,
                         action: { appState.showPSSTrails.toggle() })
    }

    private func trailLayerButton(label: String, icon: String, active: Bool,
                                   action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 5) {
                Image(systemName: icon)
                    .font(.system(size: 11, weight: .medium))
                    .frame(width: 14, height: 14)
                Text(label).font(.system(size: 12, weight: .medium)).lineLimit(1).fixedSize()
            }
            .foregroundColor(active ? DS.accent : DS.textSecondary)
            .padding(.horizontal, 10)
            .padding(.vertical, 7)
            .background(.ultraThinMaterial)
            .background(Color(red: 0.04, green: 0.04, blue: 0.04).opacity(0.55))
            .clipShape(Capsule())
            .overlay(Capsule().stroke(active ? DS.accent.opacity(0.45) : DS.border, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .animation(.easeInOut(duration: 0.18), value: active)
    }

    private var allTrailsButton: some View {
        Button(action: { appState.showAllTrails.toggle() }) {
            HStack(spacing: 6) {
                Image(systemName: appState.showAllTrails ? "map.fill" : "map")
                    .font(.system(size: 12, weight: .medium))
                    .frame(width: 14, height: 14)
                ZStack {
                    Text("Скрыть тропы")
                        .font(.system(size: 12, weight: .medium))
                        .lineLimit(1)
                        .fixedSize()
                        .hidden()
                    Text(appState.showAllTrails ? "Скрыть тропы" : "Все тропы")
                        .font(.system(size: 12, weight: .medium))
                        .lineLimit(1)
                        .fixedSize()
                }
            }
            .foregroundColor(appState.showAllTrails ? DS.accent : DS.textSecondary)
            .padding(.horizontal, 12)
            .padding(.vertical, 7)
            .background(.ultraThinMaterial)
            .background(Color(red: 0.04, green: 0.04, blue: 0.04).opacity(0.55))
            .clipShape(Capsule())
            .overlay(Capsule().stroke(
                appState.showAllTrails ? DS.accent.opacity(0.45) : DS.border, lineWidth: 1
            ))
        }
        .buttonStyle(.plain)
        .animation(.easeInOut(duration: 0.18), value: appState.showAllTrails)
    }

    // MARK: - Helpers

    private func gpsArray(route: Route, stats: RouteStats?) -> [CLLocationCoordinate2D?] {
        var result: [CLLocationCoordinate2D?] = Array(repeating: nil, count: route.photos.count)
        stats?.photoCoordinates.forEach { idx, coord in
            if idx < result.count { result[idx] = coord }
        }
        return result
    }

    private func handleGPXImport(_ result: Result<[URL], Error>) {
        guard case .success(let urls) = result, let url = urls.first else { return }
        let accessed = url.startAccessingSecurityScopedResource()
        defer { if accessed { url.stopAccessingSecurityScopedResource() } }
        guard let data = try? Data(contentsOf: url) else { return }

        let routeName = url.deletingPathExtension().lastPathComponent
            .replacingOccurrences(of: "_", with: " ")
            .replacingOccurrences(of: "-", with: " ")

        guard let route = CustomRoute.from(gpxData: data, name: routeName) else { return }

        DispatchQueue.main.async {
            appState.customRouteStore.add(route)
            withAnimation(.spring(response: 0.3)) {
                appState.filter = .mine
                appState.selectCustomRoute(route)
            }
            if route.elevations == nil {
                let savedId  = route.id
                var mutable  = route
                Task {
                    if let elevs = await ElevationService.fetch(for: mutable.coordinates) {
                        await MainActor.run {
                            mutable.elevations = elevs
                            appState.customRouteStore.update(mutable)
                            if appState.selectedCustomRoute?.id == savedId {
                                appState.selectedCustomRoute = mutable
                            }
                        }
                    }
                }
            }
        }
    }

    private var totalCompletedKm: Double {
        RouteStore.completedRoutes.compactMap { appState.routeStats[$0.id]?.distance }.reduce(0, +)
    }
}

// MARK: - Mountain burst animation

struct MountainBurstView: View {
    @Binding var isShowing: Bool

    struct Particle: Identifiable {
        let id = UUID()
        let emoji: String
        let startX: CGFloat
        let targetY: CGFloat
        let finalX: CGFloat
        let size: CGFloat
        let delay: Double
    }

    private let particles: [Particle] = (0..<18).map { i in
        let emojis = ["⛰️", "🏔️", "🗻", "⛰️", "🏕️"]
        return Particle(
            emoji:   emojis[i % emojis.count],
            startX:  CGFloat.random(in: 60...UIScreen.main.bounds.width - 60),
            targetY: CGFloat.random(in: 100...380),
            finalX:  CGFloat.random(in: 40...UIScreen.main.bounds.width - 40),
            size:    CGFloat.random(in: 24...44),
            delay:   Double(i) * 0.055
        )
    }

    @State private var triggered = false

    var body: some View {
        ZStack {
            ForEach(particles) { p in
                Text(p.emoji)
                    .font(.system(size: p.size))
                    .position(
                        x: triggered ? p.finalX : p.startX,
                        y: triggered
                            ? p.targetY
                            : UIScreen.main.bounds.height + 40
                    )
                    .opacity(triggered ? 0 : 1)
                    .animation(
                        .spring(response: 0.7, dampingFraction: 0.65)
                            .delay(p.delay)
                            .speed(0.85),
                        value: triggered
                    )
            }
        }
        .onAppear {
            withAnimation { triggered = true }
            DispatchQueue.main.asyncAfter(deadline: .now() + 2.2) {
                isShowing = false
            }
        }
    }
}

// MARK: - Collapsed bars (unchanged logic, extracted here)

private struct CollapsedRouteBar: View {
    let route: Route
    let stats: RouteStats?
    let onExpand: () -> Void
    let onClose: () -> Void

    private var typeColor: Color { route.isPlanned ? DS.planned : DS.completed }

    var body: some View {
        VStack(spacing: 0) {
            Capsule()
                .fill(Color.white.opacity(0.22))
                .frame(width: 36, height: 4)
                .padding(.top, 10)
                .padding(.bottom, 8)

            HStack(spacing: 10) {
                Circle().fill(typeColor).frame(width: 8, height: 8)

                Text(route.name)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(DS.textPrimary)
                    .lineLimit(1)

                if let stats {
                    Text("·").foregroundColor(DS.textTertiary).font(.system(size: 12))
                    Text(String(format: "%.1f км", stats.distance))
                        .font(.system(size: 12)).foregroundColor(DS.textSecondary)
                    Text("↑\(Int(stats.ascent))м")
                        .font(.system(size: 12)).foregroundColor(DS.textSecondary)
                }
                Spacer()

                Button(action: onClose) {
                    Image(systemName: "xmark")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundColor(DS.textSecondary)
                        .frame(width: 24, height: 24)
                        .background(DS.glass)
                        .clipShape(Circle())
                        .overlay(Circle().stroke(DS.border, lineWidth: 1))
                }
                Image(systemName: "chevron.up")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(DS.textSecondary)
            }
            .padding(.horizontal, 18)
            .padding(.bottom, 14)
        }
        .contentShape(Rectangle())
        .gesture(
            DragGesture(minimumDistance: 10)
                .onEnded { v in if v.translation.height < -30 { onExpand() } }
        )
        .onTapGesture { onExpand() }
        .background(ZStack {
            Color(red: 0.07, green: 0.07, blue: 0.07)
            Color.white.opacity(0.03)
        })
        .clipShape(UnevenRoundedRectangle(topLeadingRadius: DS.radiusL, bottomLeadingRadius: 0,
                                          bottomTrailingRadius: 0, topTrailingRadius: DS.radiusL))
        .overlay(UnevenRoundedRectangle(topLeadingRadius: DS.radiusL, bottomLeadingRadius: 0,
                                         bottomTrailingRadius: 0, topTrailingRadius: DS.radiusL)
            .stroke(DS.border, lineWidth: 1))
    }
}

private struct CollapsedCaveBar: View {
    let cave: CavePoint
    let onExpand: () -> Void
    let onClose: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            Capsule()
                .fill(Color.white.opacity(0.22))
                .frame(width: 36, height: 4)
                .padding(.top, 10).padding(.bottom, 8)

            HStack(spacing: 10) {
                Text("🕳️").font(.system(size: 15))

                Text(cave.name)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(DS.textPrimary)
                    .lineLimit(1)

                Text("·").foregroundColor(DS.textTertiary)
                Text("ПЕЩЕРА")
                    .font(.system(size: 10, weight: .bold))
                    .foregroundColor(Color(hex: "#5B9CF6"))

                Spacer()

                Button(action: onClose) {
                    Image(systemName: "xmark")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundColor(DS.textSecondary)
                        .frame(width: 24, height: 24)
                        .background(DS.glass)
                        .clipShape(Circle())
                        .overlay(Circle().stroke(DS.border, lineWidth: 1))
                }
                Image(systemName: "chevron.up")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(DS.textSecondary)
            }
            .padding(.horizontal, 18)
            .padding(.bottom, 14)
        }
        .contentShape(Rectangle())
        .gesture(
            DragGesture(minimumDistance: 10)
                .onEnded { v in if v.translation.height < -30 { onExpand() } }
        )
        .onTapGesture { onExpand() }
        .background(ZStack {
            Color(red: 0.07, green: 0.07, blue: 0.07)
            Color.white.opacity(0.03)
        })
        .clipShape(UnevenRoundedRectangle(topLeadingRadius: DS.radiusL, bottomLeadingRadius: 0,
                                          bottomTrailingRadius: 0, topTrailingRadius: DS.radiusL))
        .overlay(UnevenRoundedRectangle(topLeadingRadius: DS.radiusL, bottomLeadingRadius: 0,
                                         bottomTrailingRadius: 0, topTrailingRadius: DS.radiusL)
            .stroke(Color(hex: "#5B9CF6").opacity(0.4), lineWidth: 1))
    }
}

private struct CollapsedCustomRouteBar: View {
    let route: CustomRoute
    let onExpand: () -> Void
    let onClose: () -> Void

    private let purple = Color(hex: "#7B5EA7")

    var body: some View {
        VStack(spacing: 0) {
            Capsule()
                .fill(Color.white.opacity(0.22))
                .frame(width: 36, height: 4)
                .padding(.top, 10)
                .padding(.bottom, 8)

            HStack(spacing: 10) {
                Image(systemName: "pencil")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundColor(purple)

                Text(route.name)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(DS.textPrimary)
                    .lineLimit(1)

                Text("·").foregroundColor(DS.textTertiary)
                Text(String(format: "%.1f км", route.distanceKm))
                    .font(.system(size: 12)).foregroundColor(DS.textSecondary)

                Spacer()

                Button(action: onClose) {
                    Image(systemName: "xmark")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundColor(DS.textSecondary)
                        .frame(width: 24, height: 24)
                        .background(DS.glass)
                        .clipShape(Circle())
                        .overlay(Circle().stroke(DS.border, lineWidth: 1))
                }
                Image(systemName: "chevron.up")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(DS.textSecondary)
            }
            .padding(.horizontal, 18)
            .padding(.bottom, 14)
        }
        .contentShape(Rectangle())
        .gesture(
            DragGesture(minimumDistance: 10)
                .onEnded { v in if v.translation.height < -30 { onExpand() } }
        )
        .onTapGesture { onExpand() }
        .background(ZStack {
            Color(red: 0.07, green: 0.07, blue: 0.07)
            Color.white.opacity(0.03)
        })
        .clipShape(UnevenRoundedRectangle(topLeadingRadius: DS.radiusL, bottomLeadingRadius: 0,
                                          bottomTrailingRadius: 0, topTrailingRadius: DS.radiusL))
        .overlay(UnevenRoundedRectangle(topLeadingRadius: DS.radiusL, bottomLeadingRadius: 0,
                                         bottomTrailingRadius: 0, topTrailingRadius: DS.radiusL)
            .stroke(purple.opacity(0.4), lineWidth: 1))
    }
}

// MARK: - Collapsed PSS Route bar

private struct CollapsedPSSRouteBar: View {
    let route: PSSRoute
    let onExpand: () -> Void
    let onClose: () -> Void

    private let pssOrange = Color(hex: "#FF8C1A")

    var body: some View {
        VStack(spacing: 0) {
            Capsule()
                .fill(Color.white.opacity(0.22))
                .frame(width: 36, height: 4)
                .padding(.top, 10)
                .padding(.bottom, 8)

            HStack(spacing: 10) {
                Image(systemName: "figure.hiking")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(pssOrange)

                Text(route.name)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(DS.textPrimary)
                    .lineLimit(1)

                Text("·").foregroundColor(DS.textTertiary)
                Text(String(format: "%.1f км", route.distanceKm))
                    .font(.system(size: 12)).foregroundColor(DS.textSecondary)
                if route.ascent > 0 {
                    Text("↑\(Int(route.ascent))м")
                        .font(.system(size: 12)).foregroundColor(DS.textSecondary)
                }

                Spacer()

                Button(action: onClose) {
                    Image(systemName: "xmark")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundColor(DS.textSecondary)
                        .frame(width: 24, height: 24)
                        .background(DS.glass)
                        .clipShape(Circle())
                        .overlay(Circle().stroke(DS.border, lineWidth: 1))
                }
                Image(systemName: "chevron.up")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(DS.textSecondary)
            }
            .padding(.horizontal, 18)
            .padding(.bottom, 14)
        }
        .contentShape(Rectangle())
        .gesture(
            DragGesture(minimumDistance: 10)
                .onEnded { v in if v.translation.height < -30 { onExpand() } }
        )
        .onTapGesture { onExpand() }
        .background(ZStack {
            Color(red: 0.07, green: 0.07, blue: 0.07)
            Color.white.opacity(0.03)
        })
        .clipShape(UnevenRoundedRectangle(topLeadingRadius: DS.radiusL, bottomLeadingRadius: 0,
                                          bottomTrailingRadius: 0, topTrailingRadius: DS.radiusL))
        .overlay(UnevenRoundedRectangle(topLeadingRadius: DS.radiusL, bottomLeadingRadius: 0,
                                         bottomTrailingRadius: 0, topTrailingRadius: DS.radiusL)
            .stroke(pssOrange.opacity(0.4), lineWidth: 1))
    }
}

#if DEBUG
// Дебаг-панелька: зум карты + резидентная память процесса.
// Обновляется раз в секунду, чтобы не мешать профилированию.
struct DebugHUD: View {
    @EnvironmentObject var appState: AppState
    @State private var memoryMB: Double = 0
    private let timer = Timer.publish(every: 1.0, on: .main, in: .common).autoconnect()

    var body: some View {
        HStack(spacing: 8) {
            Text(String(format: "z %.2f", appState.mapZoom))
            Text("·").opacity(0.5)
            Text(String(format: "%.0f MB", memoryMB))
        }
        .font(.system(size: 11, weight: .medium, design: .monospaced))
        .foregroundColor(.white)
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(Color.black.opacity(0.7))
        .clipShape(Capsule())
        .overlay(Capsule().stroke(Color.white.opacity(0.25), lineWidth: 0.5))
        .padding(.top, 8)      // прямо под status bar
        .allowsHitTesting(false)
        .onReceive(timer) { _ in memoryMB = Self.residentMemoryMB() }
        .onAppear { memoryMB = Self.residentMemoryMB() }
    }

    private static func residentMemoryMB() -> Double {
        var info = mach_task_basic_info()
        var count = mach_msg_type_number_t(MemoryLayout<mach_task_basic_info>.size / MemoryLayout<natural_t>.size)
        let kr = withUnsafeMutablePointer(to: &info) {
            $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
                task_info(mach_task_self_, task_flavor_t(MACH_TASK_BASIC_INFO), $0, &count)
            }
        }
        return kr == KERN_SUCCESS ? Double(info.resident_size) / 1_048_576.0 : 0
    }
}
#endif
