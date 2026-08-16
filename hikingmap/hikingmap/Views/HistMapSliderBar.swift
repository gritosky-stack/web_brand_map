import SwiftUI

/// Ползунок плотности гравюры, вынесенный на карту.
///
/// Живёт внизу по центру, над кнопками зума и локации. Крестик не прячет
/// ползунок совсем, а возвращает его в панель «Слои» — то же самое, что
/// выключить там тумблер «Ползунок на карте».
struct HistMapSliderBar: View {
    @EnvironmentObject var appState: AppState

    /// Высота вместе с отступами — на неё сдвигаются кнопки под баром,
    /// чтобы он не лёг поверх них.
    static let height: CGFloat = 34

    var body: some View {
        HStack(spacing: 8) {
            Text("🗺")
                .font(.system(size: 11))

            Text("\(Int(appState.histMapAlpha * 100))%")
                .font(.system(size: 10, weight: .semibold))
                .foregroundColor(DS.textPrimary)
                .monospacedDigit()
                .frame(width: 30, alignment: .leading)

            Slider(value: $appState.histMapAlpha, in: 0...1)
                .tint(DS.accent)
                .scaleEffect(0.85, anchor: .center)
        }
        .padding(.leading, 10)
        .padding(.trailing, 6)
        .frame(height: HistMapSliderBar.height)
        .background(.ultraThinMaterial)
        .background(Color(red: 0.04, green: 0.04, blue: 0.04).opacity(0.7))
        .clipShape(Capsule())
        .overlay(Capsule().stroke(DS.border, lineWidth: 1))
        .shadow(color: .black.opacity(0.35), radius: 8, y: 3)
        // Крестик выходит за край плашки, поэтому у него своя подложка —
        // иначе он терялся бы на карте.
        .overlay(alignment: .topTrailing) {
            Button {
                withAnimation(.spring(response: 0.3, dampingFraction: 0.8)) {
                    appState.histMapSliderOnMap = false
                }
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 8, weight: .bold))
                    .foregroundColor(DS.textPrimary)
                    .frame(width: 18, height: 18)
                    .background(Color(red: 0.10, green: 0.10, blue: 0.10))
                    .clipShape(Circle())
                    .overlay(Circle().stroke(DS.borderFocus, lineWidth: 1))
                    .contentShape(Circle())
            }
            .buttonStyle(.plain)
            .offset(x: 7, y: -7)
            .accessibilityLabel("Убрать ползунок в «Слои»")
        }
        .frame(maxWidth: 210)
        .padding(.horizontal, 16)
    }
}
