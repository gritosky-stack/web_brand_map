import SwiftUI

/// Флажки железнодорожных станций поверх карты.
///
/// Почему не слоем стиля: символьный слой Mapbox не умеет ни «древка» с
/// табличкой, ни анимации появления. Здесь же станция — обычная SwiftUI-вьюха,
/// поэтому флажок вырастает пружинкой, когда попадает в кадр, и складывается,
/// когда уходит.
///
/// Рисуем только то, что видно: список станций собирает `refreshStations()`
/// по загруженным тайлам и обрезает по краям экрана, а позиции пересчитываются
/// на каждом кадре камеры — иначе флажки отставали бы от карты.
struct StationFlagsLayer: View {
    @EnvironmentObject var appState: AppState

    var body: some View {
        ZStack(alignment: .topLeading) {
            ForEach(appState.stationMarkers) { marker in
                StationFlag(name: marker.name, isMajor: marker.isMajor)
                    .position(x: marker.screen.x, y: marker.screen.y)
                    .transition(.scale(scale: 0.4, anchor: .bottom)
                        .combined(with: .opacity))
            }
        }
        .allowsHitTesting(false)
        .animation(.spring(response: 0.34, dampingFraction: 0.7),
                   value: appState.stationMarkers.map(\.id))
    }
}

/// Кружок на путях и табличка на древке.
private struct StationFlag: View {
    let name: String
    let isMajor: Bool

    private var dot: CGFloat { isMajor ? 13 : 9 }
    private var poleHeight: CGFloat { isMajor ? 20 : 15 }

    var body: some View {
        // Якорь — точка на путях, поэтому всё строим вверх от неё
        VStack(spacing: 0) {
            plate
            pole
            circle
        }
        .fixedSize()
        // Сдвигаем так, чтобы кружок оказался ровно на координате станции
        .offset(y: -(plateHeight + poleHeight) / 2)
        .shadow(color: .black.opacity(0.28), radius: 2.5, y: 1)
    }

    private var plateHeight: CGFloat { isMajor ? 20 : 17 }

    private var plate: some View {
        Text(name)
            .font(.system(size: isMajor ? 12 : 10.5, weight: isMajor ? .semibold : .medium))
            .foregroundColor(DS.topoTextColor)
            .lineLimit(1)
            .padding(.horizontal, 7)
            .frame(height: plateHeight)
            .background(
                RoundedRectangle(cornerRadius: 5, style: .continuous)
                    .fill(Color.white)
                    .overlay(
                        RoundedRectangle(cornerRadius: 5, style: .continuous)
                            .stroke(DS.railInk, lineWidth: 1.2)
                    )
            )
    }

    private var pole: some View {
        Rectangle()
            .fill(DS.railInk)
            .frame(width: 1.6, height: poleHeight)
    }

    private var circle: some View {
        Circle()
            .fill(Color.white)
            .frame(width: dot, height: dot)
            .overlay(Circle().stroke(DS.railInk, lineWidth: isMajor ? 3 : 2.2))
    }
}
