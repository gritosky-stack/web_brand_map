import SwiftUI

/// Прицел в центре кадра и «резинка» до него от последней поставленной точки.
///
/// Точку в конструкторе ставят двумя способами: тапом по карте или кнопкой
/// «Шаг» — тогда она встаёт ровно под прицел. Пунктир показывает, куда
/// протянется следующий отрезок; на карту он не ложится, потому что должен
/// двигаться вместе с камерой каждый кадр — экранные координаты для этого
/// дешевле, чем перерисовка источника.
struct ConstructorAimLayer: View {
    @EnvironmentObject var appState: AppState

    var body: some View {
        GeometryReader { geo in
            let center = appState.mapCenterScreen
                ?? CGPoint(x: geo.size.width / 2, y: geo.size.height / 2)
            ZStack {
                if let anchor = appState.constructorAnchorScreen {
                    rubberBand(from: anchor, to: center)
                }
                crosshair.position(center)
            }
        }
        .allowsHitTesting(false)
    }

    // MARK: - Резинка

    /// Пунктир «бегущими муравьями»: фаза считается от времени, а не от
    /// анимации состояния — иначе она сбрасывалась бы на каждом кадре камеры.
    private func rubberBand(from: CGPoint, to: CGPoint) -> some View {
        TimelineView(.animation) { timeline in
            let phase = timeline.date.timeIntervalSinceReferenceDate
                .truncatingRemainder(dividingBy: 2) * 14
            ZStack {
                line(from: from, to: to)
                    .stroke(Color.black.opacity(0.35),
                            style: StrokeStyle(lineWidth: 5, lineCap: .round,
                                               dash: [7, 8], dashPhase: -phase))
                line(from: from, to: to)
                    .stroke(DS.accent.opacity(0.95),
                            style: StrokeStyle(lineWidth: 2.5, lineCap: .round,
                                               dash: [7, 8], dashPhase: -phase))
            }
        }
    }

    private func line(from: CGPoint, to: CGPoint) -> Path {
        Path { path in
            path.move(to: from)
            path.addLine(to: to)
        }
    }

    // MARK: - Прицел

    /// Кольцо крутится, пока рисуют: так видно, что прицел живой и держит
    /// центр кадра, а не приклеен к карте.
    private var crosshair: some View {
        TimelineView(.animation) { timeline in
            let angle = timeline.date.timeIntervalSinceReferenceDate
                .truncatingRemainder(dividingBy: 8) / 8 * 360
            ZStack {
                Circle()
                    .stroke(Color.black.opacity(0.35), lineWidth: 4)
                    .frame(width: 24, height: 24)
                Circle()
                    .stroke(DS.accent, lineWidth: 1.8)
                    .frame(width: 24, height: 24)

                // Засечки: на пёстрой карте по ним прицел читается сразу
                ForEach(0..<4, id: \.self) { index in
                    Capsule()
                        .fill(DS.accent)
                        .frame(width: 1.8, height: 6)
                        .offset(y: -18)
                        .rotationEffect(.degrees(Double(index) * 90))
                        .shadow(color: .black.opacity(0.45), radius: 1.5)
                }
                .rotationEffect(.degrees(angle))

                Circle()
                    .fill(DS.accent)
                    .frame(width: 4.5, height: 4.5)
                    .overlay(Circle().stroke(Color.white.opacity(0.9), lineWidth: 1.2))
            }
            .shadow(color: .black.opacity(0.35), radius: 3)
        }
    }
}
