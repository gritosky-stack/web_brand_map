import SwiftUI
import CoreLocation

struct RouteDetailPanel: View {
    let route: Route
    let stats: RouteStats?
    let onClose: () -> Void
    let onCollapse: () -> Void

    @EnvironmentObject var appState: AppState
    @State private var selectedTab: DetailTab = .info
    @GestureState private var dragOffset: CGFloat = 0
    @State private var showFarAlert = false

    enum DetailTab: String, CaseIterable {
        case info    = "Инфо"
        case photos  = "Фото"
    }

    private var typeColor: Color { route.isPlanned ? DS.planned : DS.completed }

    var body: some View {
        VStack(spacing: 0) {
            dragHandle
            header
            tabBar
            Divider().background(DS.border)

            ScrollView(showsIndicators: false) {
                Group {
                    switch selectedTab {
                    case .info:   infoTab
                    case .photos: photosTab
                    }
                }
                .padding(.bottom, 32)
            }
        }
        .background(
            ZStack {
                Color(red: 0.07, green: 0.07, blue: 0.07)
                Color.white.opacity(0.03)
            }
        )
        .clipShape(
            UnevenRoundedRectangle(
                topLeadingRadius: DS.radiusL,
                bottomLeadingRadius: 0,
                bottomTrailingRadius: 0,
                topTrailingRadius: DS.radiusL
            )
        )
        .overlay(
            UnevenRoundedRectangle(
                topLeadingRadius: DS.radiusL,
                bottomLeadingRadius: 0,
                bottomTrailingRadius: 0,
                topTrailingRadius: DS.radiusL
            )
            .stroke(DS.border, lineWidth: 1)
        )
        .offset(y: max(0, dragOffset))
        .gesture(
            DragGesture()
                .updating($dragOffset) { v, state, _ in state = max(0, v.translation.height) }
                .onEnded { v in if v.translation.height > 90 { onCollapse() } }
        )
    }

    // MARK: - Subviews
    private var dragHandle: some View {
        Capsule()
            .fill(Color.white.opacity(0.22))
            .frame(width: 36, height: 4)
            .padding(.top, 10)
            .padding(.bottom, 4)
    }

    private var header: some View {
        HStack(alignment: .top, spacing: 10) {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 6) {
                    HStack(spacing: 4) {
                        Circle()
                            .fill(typeColor)
                            .frame(width: 6, height: 6)
                        Text(route.typeBadgeText)
                            .font(.system(size: 10, weight: .bold))
                            .foregroundColor(typeColor)
                    }
                    .padding(.horizontal, 8).padding(.vertical, 3)
                    .background(typeColor.opacity(0.12))
                    .clipShape(Capsule())
                    .overlay(Capsule().stroke(typeColor.opacity(0.33), lineWidth: 1))

                    if let date = route.formattedDate {
                        Text(date)
                            .font(.system(size: 11))
                            .foregroundColor(DS.textSecondary)
                    }
                }
                Text(route.name)
                    .font(.title3).fontWeight(.bold)
                    .foregroundColor(DS.textPrimary)
                    .lineLimit(2)
            }
            Spacer()
            Button(action: onClose) {
                Image(systemName: "xmark")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(DS.textSecondary)
                    .frame(width: 28, height: 28)
                    .background(DS.glass)
                    .clipShape(Circle())
                    .overlay(Circle().stroke(DS.border, lineWidth: 1))
            }
        }
        .padding(.horizontal, 18)
        .padding(.top, 6)
        .padding(.bottom, 12)
    }

    private var tabBar: some View {
        HStack(spacing: 0) {
            ForEach(DetailTab.allCases, id: \.self) { tab in
                Button(action: { withAnimation(.easeInOut(duration: 0.2)) { selectedTab = tab } }) {
                    VStack(spacing: 0) {
                        Text(tab.rawValue)
                            .font(.system(size: 13, weight: selectedTab == tab ? .semibold : .regular))
                            .foregroundColor(selectedTab == tab ? DS.accent : DS.textSecondary)
                            .padding(.vertical, 12)
                            .frame(maxWidth: .infinity)

                        Rectangle()
                            .fill(selectedTab == tab ? DS.accent : Color.clear)
                            .frame(height: 2)
                    }
                }
                .buttonStyle(.plain)
            }
        }
    }

    // MARK: - Info tab
    private var infoTab: some View {
        VStack(alignment: .leading, spacing: 18) {
            if let stats {
                statsRow(stats)
                    .padding(.horizontal, 16)

                difficultyRow(stats.difficulty)
                    .padding(.horizontal, 16)

                elevationSection(stats)
                    .padding(.horizontal, 16)

                smartTimeSection(stats)
                    .padding(.horizontal, 16)

                fitnessSection(stats)
                    .padding(.horizontal, 16)
            } else {
                HStack {
                    ProgressView().tint(DS.accent)
                    Text("Загрузка маршрута…")
                        .font(.callout)
                        .foregroundColor(DS.textSecondary)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 40)
            }

            if let desc = route.description, !desc.isEmpty {
                descriptionSection(desc)
                    .padding(.horizontal, 16)
            }

            if let ig = route.instagramUrl, let url = URL(string: ig) {
                instagramButton(url: url)
                    .padding(.horizontal, 16)
            }

            goButton
                .padding(.horizontal, 16)
                .padding(.bottom, 8)
        }
        .padding(.top, 16)
    }

    private func smartTimeSection(_ stats: RouteStats) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("ВРЕМЯ В ПУТИ")
                .font(.system(size: 11, weight: .semibold))
                .foregroundColor(DS.textSecondary)
                .kerning(0.7)
            SmartTimeView(stats: stats)
        }
    }

    private func fitnessSection(_ stats: RouteStats) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("ФИЗИЧЕСКАЯ ГОТОВНОСТЬ")
                .font(.system(size: 11, weight: .semibold))
                .foregroundColor(DS.textSecondary)
                .kerning(0.7)
            FitnessMatchView(stats: stats)
        }
    }

    // MARK: - Stats row
    private func statsRow(_ stats: RouteStats) -> some View {
        let items: [(String, String, String, String)] = [
            ("📏", "ДИСТАНЦИЯ", String(format: "%.1f", stats.distance), "км"),
            ("↑",  "НАБОР",     "\(Int(stats.ascent))", "м"),
            ("↓",  "СБРОС",     "\(Int(stats.descent))", "м"),
            ("⛰", "МАКС",      "\(Int(stats.maxEle))", "м"),
            ("▼",  "МИН",       "\(Int(stats.minEle))", "м"),
            ("⏱", "ВРЕМЯ",     stats.duration ?? "—", ""),
        ]
        return LazyVGrid(
            columns: [GridItem(.flexible()), GridItem(.flexible()), GridItem(.flexible())],
            spacing: 8
        ) {
            ForEach(items, id: \.1) { icon, label, value, unit in
                statCell(icon: icon, label: label, value: value, unit: unit)
            }
        }
    }

    private func statCell(icon: String, label: String, value: String, unit: String) -> some View {
        VStack(spacing: 3) {
            Text(icon).font(.system(size: 16))
            HStack(alignment: .firstTextBaseline, spacing: 1) {
                Text(value)
                    .font(.system(size: 14, weight: .bold))
                    .foregroundColor(DS.textPrimary)
                    .lineLimit(1)
                if !unit.isEmpty {
                    Text(unit)
                        .font(.system(size: 10))
                        .foregroundColor(DS.textSecondary)
                }
            }
            Text(label)
                .font(.system(size: 9))
                .foregroundColor(DS.textSecondary)
                .kerning(0.5)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 10)
        .background(DS.glass)
        .clipShape(RoundedRectangle(cornerRadius: DS.radiusS, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: DS.radiusS, style: .continuous).stroke(DS.border, lineWidth: 1))
    }

    // MARK: - Difficulty
    private func difficultyRow(_ difficulty: Difficulty) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Text("СЛОЖНОСТЬ")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundColor(DS.textSecondary)
                    .kerning(0.6)
                Text(difficulty.rawValue.uppercased())
                    .font(.system(size: 10, weight: .bold))
                    .foregroundColor(difficulty.dsColor)
                Spacer()
            }
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(Color.white.opacity(0.1)).frame(height: 5)
                    Capsule().fill(difficulty.dsColor)
                        .frame(width: geo.size.width * difficulty.fraction, height: 5)
                }
            }
            .frame(height: 5)
            Text(difficulty.hint)
                .font(.system(size: 11))
                .foregroundColor(DS.textTertiary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    // MARK: - Elevation
    private func elevationSection(_ stats: RouteStats) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("ПРОФИЛЬ ВЫСОТ")
                .font(.system(size: 11, weight: .semibold))
                .foregroundColor(DS.textSecondary)
                .kerning(0.7)

            ElevationChartView(stats: stats)
                .padding(12)
                .background(DS.glass)
                .clipShape(RoundedRectangle(cornerRadius: DS.radiusM, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: DS.radiusM, style: .continuous).stroke(DS.border, lineWidth: 1))

            Text("Проведите пальцем по графику для навигации")
                .font(.system(size: 10))
                .foregroundColor(DS.textTertiary)
        }
    }

    // MARK: - Description
    @State private var descExpanded = false

    private func descriptionSection(_ text: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("ОПИСАНИЕ")
                .font(.system(size: 11, weight: .semibold))
                .foregroundColor(DS.textSecondary)
                .kerning(0.7)

            Text(text)
                .font(.callout)
                .foregroundColor(Color(white: 0.82))
                .lineLimit(descExpanded ? nil : 5)
                .animation(.easeInOut(duration: 0.22), value: descExpanded)

            if text.count > 200 {
                Button(action: { descExpanded.toggle() }) {
                    Text(descExpanded ? "Свернуть ↑" : "Развернуть ↓")
                        .font(.system(size: 12))
                        .foregroundColor(DS.accent)
                }
            }
        }
    }

    // MARK: - "В путь" button

    private var goButton: some View {
        Button {
            handleGoButton()
        } label: {
            HStack(spacing: 8) {
                Image(systemName: "figure.hiking")
                    .font(.system(size: 15, weight: .semibold))
                Text("В путь")
                    .font(.system(size: 15, weight: .bold))
                Spacer()
                Image(systemName: "arrow.right")
                    .font(.system(size: 13, weight: .semibold))
            }
            .foregroundColor(.white)
            .padding(16)
            .background(DS.accent)
            .clipShape(RoundedRectangle(cornerRadius: DS.radiusM, style: .continuous))
            .shadow(color: DS.accent.opacity(0.4), radius: 14, y: 4)
        }
        .buttonStyle(.plain)
        .alert("Вы слишком далеко", isPresented: $showFarAlert) {
            Button("Записать другой маршрут") {
                appState.deselect()
                appState.startRecording(linkedRouteId: nil)
                flyToCurrentLocation()
            }
            Button("Продолжить по плану") {
                appState.startRecording(linkedRouteId: route.id)
                flyToCurrentLocation()
            }
            Button("Отмена", role: .cancel) {}
        } message: {
            Text("Вы находитесь далеко от старта маршрута. Что делаем?")
        }
    }

    private func handleGoButton() {
        guard let userLoc = appState.trackRecorder.currentLocation,
              let stats
        else {
            // No GPS yet — start recording directly
            appState.startRecording(linkedRouteId: route.id)
            onClose()
            return
        }
        let startCoord = stats.coordinates.first ?? stats.center
        let userCL = CLLocation(latitude: userLoc.latitude, longitude: userLoc.longitude)
        let startCL = CLLocation(latitude: startCoord.latitude, longitude: startCoord.longitude)
        let distM = userCL.distance(from: startCL)

        if distM > 2000 {
            showFarAlert = true
        } else {
            appState.startRecording(linkedRouteId: route.id)
            flyToCurrentLocation()
            onClose()
        }
    }

    private func flyToCurrentLocation() {
        if let loc = appState.trackRecorder.currentLocation {
            appState.flyCamera(to: loc)
        }
    }

    // MARK: - Instagram
    private func instagramButton(url: URL) -> some View {
        Link(destination: url) {
            HStack(spacing: 8) {
                Image(systemName: "play.rectangle.fill").font(.system(size: 14))
                Text("Смотреть в Instagram").font(.system(size: 14, weight: .medium))
                Spacer()
                Image(systemName: "arrow.up.right").font(.system(size: 12))
            }
            .foregroundColor(.white)
            .padding(14)
            .background(
                LinearGradient(
                    stops: [
                        .init(color: Color(hex: "#833AB4"), location: 0),
                        .init(color: Color(hex: "#fd1d1d"), location: 0.5),
                        .init(color: Color(hex: "#fcb045"), location: 1),
                    ],
                    startPoint: .leading, endPoint: .trailing
                )
            )
            .clipShape(RoundedRectangle(cornerRadius: DS.radiusM, style: .continuous))
        }
    }

    // MARK: - Photos tab
    private var photosTab: some View {
        Group {
            if route.photos.isEmpty {
                VStack(spacing: 14) {
                    Image(systemName: "photo.stack")
                        .font(.system(size: 36))
                        .foregroundColor(DS.textTertiary)
                    Text("Фотографии недоступны")
                        .foregroundColor(DS.textSecondary)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 50)
            } else {
                LazyVGrid(
                    columns: [GridItem(.flexible()), GridItem(.flexible()), GridItem(.flexible())],
                    spacing: 3
                ) {
                    ForEach(Array(route.photos.enumerated()), id: \.offset) { idx, path in
                        PhotoCell(path: path, hasGPS: photoHasGPS(idx))
                            .onTapGesture {
                                appState.selectedPhotoInfo = SelectedPhotoInfo(routeId: route.id, index: idx)
                            }
                    }
                }
                .padding(.top, 4)
            }
        }
    }

    private func photoHasGPS(_ index: Int) -> Bool {
        stats?.photoCoordinates.contains(where: { $0.index == index }) ?? false
    }
}

// MARK: - Photo cache (shared across all PhotoCell instances)
private let photoCache: NSCache<NSString, UIImage> = {
    let c = NSCache<NSString, UIImage>()
    c.countLimit = 60
    c.totalCostLimit = 80 * 1024 * 1024 // 80 MB
    return c
}()

// MARK: - Photo Cell
private struct PhotoCell: View {
    let path: String
    let hasGPS: Bool
    @State private var image: UIImage? = nil

    var body: some View {
        Group {
            if let img = image {
                Image(uiImage: img)
                    .resizable()
                    .scaledToFill()
            } else {
                Rectangle()
                    .fill(DS.glass)
                    .overlay(Image(systemName: "photo").foregroundColor(DS.textTertiary))
            }
        }
        .frame(height: 112)
        .clipped()
        .overlay(alignment: .bottomTrailing) {
            if hasGPS {
                Image(systemName: "location.fill")
                    .font(.system(size: 9, weight: .bold))
                    .foregroundColor(.white)
                    .padding(4)
                    .background(Color(red: 0.20, green: 0.60, blue: 1.0).opacity(0.85))
                    .clipShape(Circle())
                    .padding(4)
            }
        }
        .onAppear { loadImage() }
    }

    private func loadImage() {
        guard image == nil else { return }
        // В ленте хватает превью из бандла — крупную версию тянуть незачем
        Task.detached(priority: .background) {
            let img = PhotoStore.thumbnail(path)
            await MainActor.run { self.image = img }
        }
    }
}

// MARK: - Photo selection wrapper (for in-panel opens; global fullscreen via ContentView)
private struct PhotoSelection: Identifiable {
    let id: Int
}

// MARK: - Fullscreen photo viewer
struct PhotoFullscreenView: View {
    let photos: [String]
    let initialIndex: Int
    let photoGPSCoords: [CLLocationCoordinate2D?]
    let onFlyToCoordinate: ((CLLocationCoordinate2D) -> Void)?

    @Environment(\.dismiss) private var dismiss
    @State private var currentIndex: Int
    @State private var dragOffset: CGSize = .zero
    @State private var images: [String: UIImage] = [:]

    init(photos: [String],
         initialIndex: Int,
         photoGPSCoords: [CLLocationCoordinate2D?] = [],
         onFlyToCoordinate: ((CLLocationCoordinate2D) -> Void)? = nil) {
        self.photos             = photos
        self.initialIndex       = initialIndex
        self.photoGPSCoords     = photoGPSCoords
        self.onFlyToCoordinate  = onFlyToCoordinate
        _currentIndex = State(initialValue: initialIndex)
    }

    private var currentGPS: CLLocationCoordinate2D? {
        guard currentIndex < photoGPSCoords.count else { return nil }
        return photoGPSCoords[currentIndex]
    }

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            TabView(selection: $currentIndex) {
                ForEach(Array(photos.enumerated()), id: \.offset) { idx, path in
                    photoPage(path: path, idx: idx).tag(idx)
                }
            }
            .tabViewStyle(.page(indexDisplayMode: .never))
            .offset(y: dragOffset.height)
            .gesture(
                DragGesture()
                    .onChanged { v in
                        if abs(v.translation.height) > abs(v.translation.width) {
                            dragOffset = v.translation
                        }
                    }
                    .onEnded { v in
                        if abs(v.translation.height) > 80 {
                            dismiss()
                        } else {
                            withAnimation(.spring(response: 0.3)) { dragOffset = .zero }
                        }
                    }
            )

            // Top bar
            VStack {
                HStack(alignment: .center, spacing: 10) {
                    Text("\(currentIndex + 1) / \(photos.count)")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundColor(.white.opacity(0.8))

                    Spacer()

                    // Fly-to-location button (only when photo has GPS)
                    if let coord = currentGPS {
                        Button(action: {
                            dismiss()
                            onFlyToCoordinate?(coord)
                        }) {
                            HStack(spacing: 5) {
                                Image(systemName: "location.fill")
                                    .font(.system(size: 12, weight: .semibold))
                                Text("На трек")
                                    .font(.system(size: 12, weight: .semibold))
                            }
                            .foregroundColor(.white)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 7)
                            .background(Color(red: 0.20, green: 0.60, blue: 1.0).opacity(0.85))
                            .clipShape(Capsule())
                        }
                    }

                    Button(action: { dismiss() }) {
                        Image(systemName: "xmark")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundColor(.white)
                            .frame(width: 32, height: 32)
                            .background(Color.white.opacity(0.15))
                            .clipShape(Circle())
                    }
                }
                .padding(.horizontal, 20)
                .padding(.top, 56)
                Spacer()
            }
        }
        .statusBarHidden()
    }

    private func photoPage(path: String, idx: Int) -> some View {
        Group {
            if let img = images[path] {
                Image(uiImage: img).resizable().scaledToFit()
            } else {
                ProgressView().tint(.white).onAppear { loadImage(path: path) }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func loadImage(path: String) {
        guard images[path] == nil else { return }
        // Сначала прилетит превью из бандла, следом — версия 1280 px из R2,
        // если она есть на диске или доступна сеть
        PhotoStore.large(path) { img in
            guard let img else { return }
            DispatchQueue.main.async { self.images[path] = img }
        }
    }
}
