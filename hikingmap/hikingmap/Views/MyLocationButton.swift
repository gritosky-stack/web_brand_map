import SwiftUI
import UIKit

/// Кнопка «моя локация» — правый нижний угол карты.
///
/// Три состояния: не следим (тёмное стекло), следим (акцентный диск),
/// следим с доворотом по компасу (стрелка на север). По нажатию расходится
/// волна, а пока ждём первую засечку GPS — крутится дуга.
struct MyLocationButton: View {
    @EnvironmentObject var appState: AppState

    /// Волна от нажатия: 0 — кольцо на размере кнопки и видимое,
    /// 1 — разошлось и погасло. В покое держим на единице.
    @State private var ripple: CGFloat = 1
    @State private var spin = false

    private let size: CGFloat = 52

    private var isActive: Bool { appState.locationFollowMode != .idle }

    private var icon: String {
        switch appState.locationFollowMode {
        case .idle:    return "location"
        case .follow:  return "location.fill"
        case .heading: return "location.north.line.fill"
        }
    }

    var body: some View {
        Button(action: tap) {
            ZStack {
                // Волна от нажатия
                Circle()
                    .stroke(DS.accent, lineWidth: 2)
                    .frame(width: size, height: size)
                    .scaleEffect(1 + ripple * 0.9)
                    .opacity((1 - ripple) * 0.85)
                    .allowsHitTesting(false)

                // Диск. Стекло само по себе сливается и со снимком, и с
                // бумажной топоосновой — поэтому под ним всегда плотная
                // подложка: кнопка должна читаться на любом фоне.
                ZStack {
                    Circle().fill(.ultraThinMaterial)
                    Circle().fill(isActive
                                  ? DS.accent
                                  : Color(red: 0.04, green: 0.04, blue: 0.04).opacity(0.72))
                }
                .frame(width: size, height: size)
                .overlay(
                    Circle().stroke(isActive ? DS.accent.opacity(0.9) : DS.border, lineWidth: 1)
                )
                .shadow(color: isActive ? DS.accent.opacity(0.45) : .black.opacity(0.35),
                        radius: isActive ? 12 : 8, y: 3)

                // Дуга поиска первой засечки
                if appState.isAwaitingLocationFix {
                    Circle()
                        .trim(from: 0, to: 0.28)
                        .stroke(DS.accent, style: StrokeStyle(lineWidth: 2, lineCap: .round))
                        .frame(width: size - 10, height: size - 10)
                        .rotationEffect(.degrees(spin ? 360 : 0))
                }

                Image(systemName: icon)
                    .font(.system(size: 19, weight: .semibold))
                    .foregroundColor(isActive ? .white : DS.textPrimary)
            }
            .frame(width: size, height: size)
            .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .animation(.spring(response: 0.3, dampingFraction: 0.7), value: appState.locationFollowMode)
        .onChange(of: appState.isAwaitingLocationFix) { _, awaiting in
            if awaiting {
                spin = false
                withAnimation(.linear(duration: 1.1).repeatForever(autoreverses: false)) {
                    spin = true
                }
            } else {
                withAnimation(.easeOut(duration: 0.2)) { spin = false }
            }
        }
        .accessibilityLabel("Моя локация")
    }

    private func tap() {
        UIImpactFeedbackGenerator(style: .soft).impactOccurred()

        var reset = Transaction()
        reset.disablesAnimations = true
        withTransaction(reset) { ripple = 0 }
        withAnimation(.easeOut(duration: 0.55)) { ripple = 1 }

        appState.requestMyLocation()
    }
}
