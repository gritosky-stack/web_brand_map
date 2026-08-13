import SwiftUI
import PhotosUI

// MARK: - Live Track HUD (full-screen overlay over map)

struct LiveTrackHUD: View {
    @EnvironmentObject var appState: AppState
    @ObservedObject private var recorder: TrackRecorder
    @StateObject private var stopVM = StopConfirmVM()

    // Stats panel mode
    @State private var statsMode: StatsMode = .pill
    @State private var statsDrag: CGFloat = 0

    // Fan (events bubble)
    @State private var fanOpen = false

    // Segment cards
    @State private var segVisible = false

    // Photo picker
    @State private var showPhotoPicker = false
    @State private var photoPicker: PhotosPickerItem? = nil
    @State private var camGlow = false
    @State private var recentPhotos: [UUID] = []

    // Event flash
    @State private var eventFlash: SightingType? = nil

    enum StatsMode { case collapsed, pill, expanded }

    init(recorder: TrackRecorder) {
        self.recorder = recorder
    }

    var body: some View {
        ZStack(alignment: .top) {
            // Transparent — map shows through

            // Top: REC bar + stats panel
            VStack(spacing: 0) {
                recBar
                    .padding(.top, 56)
                    .padding(.horizontal, 16)
                statsPanel
                    .padding(.horizontal, 10)
                    .padding(.top, 8)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .zIndex(30)

            // Segment cards row (above tray)
            if segVisible {
                VStack {
                    Spacer()
                    segmentCardsRow
                        .padding(.bottom, 98)
                }
                .transition(.move(edge: .bottom).combined(with: .opacity))
                .zIndex(25)
            }

            // Photo thumbnails (above tray)
            VStack {
                Spacer()
                HStack {
                    Spacer()
                    photosStrip
                        .padding(.trailing, 14)
                        .padding(.bottom, segVisible ? 212 : 112)
                }
            }
            .animation(.spring(response: 0.35, dampingFraction: 0.78), value: segVisible)
            .zIndex(26)

            // Fan bubble overlay
            if fanOpen {
                fanOverlay
                    .zIndex(40)
                    .transition(.opacity)
            }

            // Event flash overlay
            if let type = eventFlash {
                eventFlashOverlay(type)
                    .zIndex(50)
                    .allowsHitTesting(false)
            }

            // Bottom action tray
            VStack {
                Spacer()
                bottomTray
            }
            .zIndex(30)
        }
        .animation(.spring(response: 0.36, dampingFraction: 0.80), value: statsMode)
        .animation(.spring(response: 0.40, dampingFraction: 0.80), value: segVisible)
        .animation(.easeInOut(duration: 0.18), value: fanOpen)
        .photosPicker(isPresented: $showPhotoPicker, selection: $photoPicker,
                      matching: .images, photoLibrary: .shared())
        .onChange(of: photoPicker) { item in
            guard let item else { return }
            Task {
                if let data = try? await item.loadTransferable(type: Data.self),
                   let img = UIImage(data: data) {
                    await MainActor.run {
                        appState.addPhoto(img)
                        let id = UUID()
                        recentPhotos.append(id)
                        camGlow = true
                        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { camGlow = false }
                        DispatchQueue.main.asyncAfter(deadline: .now() + 3.0) {
                            recentPhotos.removeAll { $0 == id }
                        }
                        photoPicker = nil
                    }
                }
            }
        }
    }

    // MARK: - REC bar

    private var recBar: some View {
        HStack(spacing: 10) {
            // Pulsing REC dot + label
            HStack(spacing: 6) {
                PulsingDot(color: .red)
                Text("REC")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundColor(.red)
                    .kerning(0.8)
            }

            // Time
            Text(formatTime(recorder.elapsedSeconds))
                .font(.system(size: 20, weight: .bold, design: .monospaced))
                .foregroundColor(.white)
                .frame(maxWidth: .infinity, alignment: .leading)
                .shadow(color: .black.opacity(0.9), radius: 6, y: 1)

            // Stop button
            Button {
                stopVM.showConfirm = true
            } label: {
                Text("Стоп")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(Color(red: 1, green: 0.47, blue: 0.39))
                    .padding(.horizontal, 16)
                    .padding(.vertical, 7)
                    .background(Color(red: 0.24, green: 0.06, blue: 0.06).opacity(0.85))
                    .clipShape(Capsule())
                    .overlay(Capsule().stroke(Color.red.opacity(0.35), lineWidth: 1))
            }
            .buttonStyle(.plain)
            .confirmationDialog("Остановить запись?", isPresented: $stopVM.showConfirm) {
                Button("Сохранить и выйти", role: .destructive) { appState.stopRecording() }
                Button("Отмена", role: .cancel) {}
            }
        }
        .shadow(color: .black.opacity(0.6), radius: 8, y: 2)
    }

    // MARK: - Stats panel (collapsible: collapsed / pill / expanded)

    @ViewBuilder
    private var statsPanel: some View {
        let dragGesture = DragGesture(minimumDistance: 8)
            .onChanged { v in statsDrag = v.translation.height }
            .onEnded { v in
                statsDrag = 0
                if abs(v.translation.height) < 8 {
                    statsMode = statsMode == .pill ? .collapsed : .pill
                } else if v.translation.height > 40 {
                    statsMode = .expanded
                } else if v.translation.height < -40 {
                    statsMode = statsMode == .expanded ? .pill : .collapsed
                }
            }

        Group {
            if statsMode == .collapsed {
                HStack(spacing: 8) {
                    Circle().fill(DS.accent).frame(width: 6, height: 6)
                    Text(String(format: "%.1f км · ↑%.0f м", recorder.distanceKm, recorder.currentAscent))
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundColor(.white.opacity(0.5))
                    chevron(down: true)
                }
                .padding(.horizontal, 14).padding(.vertical, 5)
                .background(glassBg)
                .clipShape(Capsule())
                .frame(maxWidth: .infinity, alignment: .center)
                .gesture(dragGesture)
                .transition(.scale(scale: 0.92).combined(with: .opacity))

            } else if statsMode == .pill {
                HStack(spacing: 0) {
                    statPillItem(String(format: "%.1f", recorder.distanceKm), unit: "км")
                    divider
                    statPillItem(String(format: "%.0f", recorder.currentAscent), unit: "м ↑")
                    divider
                    statPillItem(String(format: "%.1f", recorder.currentSpeedKmh), unit: "км/ч")
                    divider
                    chevron(down: true).padding(.leading, 6)
                }
                .padding(.horizontal, 18).padding(.vertical, 8)
                .background(glassBg)
                .clipShape(Capsule())
                .shadow(color: .black.opacity(0.4), radius: 14, y: 4)
                .frame(maxWidth: .infinity, alignment: .center)
                .gesture(dragGesture)
                .transition(.scale(scale: 0.96).combined(with: .opacity))

            } else {
                expandedStats
                    .gesture(dragGesture)
                    .transition(.scale(scale: 0.96, anchor: .top).combined(with: .opacity))
            }
        }
    }

    private func statPillItem(_ value: String, unit: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 2) {
            Text(value)
                .font(.system(size: 13, weight: .bold, design: .monospaced))
                .foregroundColor(.white)
            Text(unit)
                .font(.system(size: 10))
                .foregroundColor(.white.opacity(0.45))
        }
        .padding(.horizontal, 10)
    }

    private var expandedStats: some View {
        VStack(spacing: 12) {
            // Handle
            Capsule().fill(.white.opacity(0.2)).frame(width: 32, height: 3)

            // Stats grid
            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
                expandedStatCell(String(format: "%.1f", recorder.distanceKm), unit: "км", label: "Расстояние")
                expandedStatCell(String(format: "%.0f", recorder.currentAscent), unit: "м", label: "Подъём")
                expandedStatCell(String(format: "%.1f", recorder.currentSpeedKmh), unit: "км/ч", label: "Скорость")
                expandedStatCell(String(format: "%.0f", recorder.currentAltitude), unit: "м", label: "Высота")
                expandedStatCell(formatTime(recorder.elapsedSeconds), unit: "", label: "Время")
                expandedStatCell("\(appState.liveSegments.count)", unit: "сег", label: "Сегменты")
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 14)
        .background(
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .fill(.ultraThinMaterial)
                .background(Color(red: 0.04, green: 0.04, blue: 0.04).opacity(0.96)
                    .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous)))
        )
        .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).stroke(DS.border, lineWidth: 1))
        .shadow(color: .black.opacity(0.7), radius: 30, y: 8)
    }

    private func expandedStatCell(_ value: String, unit: String, label: String) -> some View {
        VStack(spacing: 3) {
            Text(label)
                .font(.system(size: 9))
                .foregroundColor(.white.opacity(0.35))
                .textCase(.uppercase)
                .kerning(0.5)
            HStack(alignment: .firstTextBaseline, spacing: 2) {
                Text(value)
                    .font(.system(size: 15, weight: .bold, design: .monospaced))
                    .foregroundColor(.white)
                if !unit.isEmpty {
                    Text(unit)
                        .font(.system(size: 9))
                        .foregroundColor(.white.opacity(0.4))
                }
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 10)
        .background(Color.white.opacity(0.04))
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    // MARK: - Segment cards

    private var segmentCardsRow: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 10) {
                ForEach(Array(appState.liveSegments.suffix(5).enumerated()), id: \.element.id) { idx, seg in
                    segCard(seg, delay: Double(idx) * 0.06)
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
        }
        .background(
            LinearGradient(colors: [.clear, Color(red: 0.04, green: 0.04, blue: 0.04).opacity(0.6), .clear],
                           startPoint: .top, endPoint: .bottom)
        )
    }

    private func segCard(_ seg: TrackSegment, delay: Double) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack {
                Text(seg.label)
                    .font(.system(size: 12, weight: .black, design: .monospaced))
                    .foregroundColor(DS.accent)
                Spacer()
                Circle().fill(DS.accent.opacity(0.5)).frame(width: 6, height: 6)
            }
            Text(String(format: "%.1f км", seg.distanceKm))
                .font(.system(size: 13, weight: .bold))
                .foregroundColor(.white)
            Text(seg.durationFormatted)
                .font(.system(size: 10, design: .monospaced))
                .foregroundColor(.white.opacity(0.4))
            Text("↑\(Int(seg.ascent)) м")
                .font(.system(size: 10))
                .foregroundColor(.white.opacity(0.4))
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .frame(width: 110)
        .background(Color(red: 0.055, green: 0.055, blue: 0.055).opacity(0.96))
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous)
            .stroke(DS.accent.opacity(0.25), lineWidth: 1))
        .transition(.move(edge: .trailing).combined(with: .opacity))
    }

    // MARK: - Fan bubble

    private var fanOverlay: some View {
        ZStack(alignment: .bottomLeading) {
            Color.black.opacity(0.42)
                .ignoresSafeArea()
                .onTapGesture { fanOpen = false }

            // Fan items in semicircle above the Events button
            // Events button is at approximately x=36 from left, bottom=76
            let items = SightingType.allCases.filter { $0 != .waypoint }
            let count = items.count
            let spread: Double = 180
            let startAngle: Double = -90 - spread / 2
            let radius: CGFloat = 90

            ZStack {
                ForEach(Array(items.enumerated()), id: \.element) { i, type in
                    let angle = startAngle + (spread / Double(count - 1)) * Double(i)
                    let rad = angle * .pi / 180
                    let x = cos(rad) * Double(radius)
                    let y = sin(rad) * Double(radius)

                    VStack(spacing: 3) {
                        Text(type.rawValue)
                            .font(.system(size: 22))
                        Text(type.label)
                            .font(.system(size: 8, weight: .semibold))
                            .foregroundColor(.white.opacity(0.7))
                    }
                    .frame(width: 48, height: 48)
                    .background(Color(red: 0.08, green: 0.08, blue: 0.08).opacity(0.92))
                    .clipShape(Circle())
                    .overlay(Circle().stroke(Color.white.opacity(0.18), lineWidth: 1))
                    .shadow(color: .black.opacity(0.5), radius: 10, y: 3)
                    .offset(x: CGFloat(x), y: CGFloat(y))
                    .onTapGesture {
                        handleEvent(type)
                    }
                    .transition(
                        .scale(scale: 0.3).combined(with: .opacity)
                    )
                    .animation(.spring(response: 0.35, dampingFraction: 0.72)
                        .delay(Double(i) * 0.04), value: fanOpen)
                }
            }
            .offset(x: 36, y: -76)
        }
    }

    private func handleEvent(_ type: SightingType) {
        fanOpen = false
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        appState.addSighting(type)
        eventFlash = type
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) { eventFlash = nil }
    }

    // MARK: - Event flash

    private func eventFlashOverlay(_ type: SightingType) -> some View {
        ZStack {
            Color.black.opacity(0.42).ignoresSafeArea()

            // Radial glow
            Circle()
                .fill(RadialGradient(colors: [Color.orange.opacity(0.3), .clear],
                                     center: .center, startRadius: 0, endRadius: 120))
                .frame(width: 240, height: 240)

            VStack(spacing: 14) {
                Text(type.rawValue)
                    .font(.system(size: 80))
                    .scaleEffect(1.0)
                    .transition(.scale(scale: 0.3).combined(with: .opacity))

                Text("\(type.label) отмечен")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundColor(.white)
            }
        }
        .transition(.opacity)
        .animation(.spring(response: 0.4, dampingFraction: 0.72), value: eventFlash != nil)
    }

    // MARK: - Photos strip

    private var photosStrip: some View {
        HStack(spacing: 6) {
            ForEach(recentPhotos, id: \.self) { _ in
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(Color(red: 0.14, green: 0.22, blue: 0.14))
                    .frame(width: 44, height: 44)
                    .overlay(
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .stroke(Color.white.opacity(0.18), lineWidth: 2)
                    )
                    .shadow(color: .black.opacity(0.5), radius: 8, y: 3)
                    .transition(.move(edge: .trailing).combined(with: .opacity))
            }
        }
    }

    // MARK: - Bottom tray

    private var bottomTray: some View {
        VStack(spacing: 0) {
            HStack(alignment: .bottom) {
                Spacer()

                // События (fan)
                trayBtn(emoji: "🎯", label: "События", active: fanOpen) {
                    withAnimation(.spring(response: 0.35, dampingFraction: 0.72)) {
                        fanOpen.toggle()
                    }
                }

                Spacer()

                // Сегмент
                trayBtnBadged(emoji: "⏱", label: "Сегмент",
                              badge: appState.liveSegments.isEmpty ? nil : appState.liveSegments.count,
                              active: segVisible) {
                    UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                    if segVisible {
                        withAnimation { segVisible = false }
                    } else {
                        appState.markSegment()
                        withAnimation { segVisible = true }
                    }
                }

                Spacer()

                // ФОТО — main button
                VStack(spacing: 5) {
                    Button {
                        showPhotoPicker = true
                    } label: {
                        Text("📷")
                            .font(.system(size: 26))
                            .frame(width: 58, height: 58)
                            .background(
                                LinearGradient(colors: [Color(red: 1, green: 0.42, blue: 0.24),
                                                        Color(red: 1, green: 0.60, blue: 0)],
                                               startPoint: .topLeading, endPoint: .bottomTrailing)
                            )
                            .clipShape(Circle())
                            .shadow(color: camGlow
                                    ? DS.accent.opacity(0.9)
                                    : DS.accent.opacity(0.45),
                                    radius: camGlow ? 22 : 14, y: 4)
                            .scaleEffect(camGlow ? 1.08 : 1.0)
                            .animation(.spring(response: 0.25, dampingFraction: 0.65), value: camGlow)
                    }
                    .buttonStyle(.plain)

                    Text("Фото")
                        .font(.system(size: 9))
                        .foregroundColor(.white.opacity(0.35))
                }

                Spacer()

                // Опасно
                trayBtn(emoji: "⚠️", label: "Опасно", danger: true) {
                    UINotificationFeedbackGenerator().notificationOccurred(.error)
                    appState.addSighting(.hazard)
                    eventFlash = .hazard
                    DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) { eventFlash = nil }
                }

                Spacer()

                // Метка
                trayBtn(emoji: "📍", label: "Метка") {
                    UIImpactFeedbackGenerator(style: .light).impactOccurred()
                    appState.addSighting(.waypoint)
                }

                Spacer()
            }
            .padding(.top, 14)
            .padding(.bottom, 28)
        }
        .background(
            UnevenRoundedRectangle(topLeadingRadius: 22, bottomLeadingRadius: 0,
                                   bottomTrailingRadius: 0, topTrailingRadius: 22)
                .fill(.ultraThinMaterial)
                .background(
                    Color(red: 0.04, green: 0.04, blue: 0.04).opacity(0.94)
                        .clipShape(UnevenRoundedRectangle(topLeadingRadius: 22, bottomLeadingRadius: 0,
                                                          bottomTrailingRadius: 0, topTrailingRadius: 22))
                )
        )
        .overlay(
            UnevenRoundedRectangle(topLeadingRadius: 22, bottomLeadingRadius: 0,
                                   bottomTrailingRadius: 0, topTrailingRadius: 22)
                .stroke(DS.border, lineWidth: 1)
        )
        .ignoresSafeArea(edges: .bottom)
    }

    private func trayBtn(emoji: String, label: String,
                         active: Bool = false, danger: Bool = false,
                         action: @escaping () -> Void) -> some View {
        TrayButton(emoji: emoji, label: label, size: 44,
                   active: active, danger: danger, action: action)
    }

    private func trayBtnBadged(emoji: String, label: String,
                                badge: Int?, active: Bool,
                                action: @escaping () -> Void) -> some View {
        TrayButton(emoji: emoji, label: label, size: 44,
                   badge: badge, active: active, action: action)
    }

    // MARK: - Helpers

    private var glassBg: some View {
        ZStack {
            Color(red: 0.04, green: 0.04, blue: 0.04).opacity(0.72)
            Color.white.opacity(0.04)
        }
        .blur(radius: 0)
    }

    private var divider: some View {
        Rectangle()
            .fill(Color.white.opacity(0.12))
            .frame(width: 1, height: 14)
    }

    private func chevron(down: Bool) -> some View {
        Image(systemName: down ? "chevron.down" : "chevron.up")
            .font(.system(size: 9, weight: .semibold))
            .foregroundColor(.white.opacity(0.35))
    }

    private func formatTime(_ s: Int) -> String {
        let h = s / 3600, m = (s % 3600) / 60, sec = s % 60
        return String(format: "%02d:%02d:%02d", h, m, sec)
    }
}

// MARK: - Stop confirm VM

private final class StopConfirmVM: ObservableObject {
    @Published var showConfirm = false
}

// MARK: - Pulsing dot

private struct PulsingDot: View {
    let color: Color
    @State private var pulsing = false

    var body: some View {
        ZStack {
            Circle()
                .fill(color.opacity(0.4))
                .frame(width: 16, height: 16)
                .scaleEffect(pulsing ? 2.2 : 1.0)
                .opacity(pulsing ? 0 : 0.4)
                .animation(.easeInOut(duration: 1.4).repeatForever(autoreverses: false), value: pulsing)
            Circle().fill(color).frame(width: 9, height: 9)
        }
        .onAppear { pulsing = true }
    }
}

// MARK: - Tray button

private struct TrayButton: View {
    let emoji: String
    let label: String
    let size: CGFloat
    var badge: Int? = nil
    var active: Bool = false
    var danger: Bool = false
    let action: () -> Void

    @State private var pressed = false

    private var bgColor: Color {
        if active  { return DS.accent.opacity(0.2) }
        if danger  { return Color.red.opacity(0.15) }
        return Color.white.opacity(0.07)
    }

    private var strokeColor: Color {
        if active  { return DS.accent.opacity(0.5) }
        if danger  { return Color.red.opacity(0.3) }
        return Color.white.opacity(0.12)
    }

    var body: some View {
        VStack(spacing: 5) {
            ZStack(alignment: .topTrailing) {
                Button(action: action) {
                    Text(emoji)
                        .font(.system(size: 22))
                        .frame(width: size, height: size)
                        .background(bgColor)
                        .clipShape(Circle())
                        .overlay(Circle().stroke(strokeColor, lineWidth: 1))
                        .scaleEffect(pressed ? 0.88 : 1.0)
                        .animation(.spring(response: 0.12, dampingFraction: 0.8), value: pressed)
                }
                .buttonStyle(.plain)
                .simultaneousGesture(DragGesture(minimumDistance: 0)
                    .onChanged { _ in pressed = true }
                    .onEnded   { _ in pressed = false })

                if let n = badge {
                    Text("\(n)")
                        .font(.system(size: 8, weight: .bold))
                        .foregroundColor(.white)
                        .frame(width: 16, height: 16)
                        .background(DS.accent)
                        .clipShape(Circle())
                        .overlay(Circle().stroke(Color(red: 0.04, green: 0.04, blue: 0.04), lineWidth: 1.5))
                        .offset(x: 3, y: -3)
                }
            }

            Text(label)
                .font(.system(size: 9))
                .foregroundColor(.white.opacity(0.35))
        }
    }
}
