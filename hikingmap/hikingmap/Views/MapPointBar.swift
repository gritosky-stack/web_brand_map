import SwiftUI

/// Плашка про точечный объект: родник, колонку, навес, кемпинг.
///
/// Намеренно маленькая и без «подробнее»: про такую точку OSM знает три-четыре
/// факта, и разворачивать их на пол-экрана было бы обещанием содержания,
/// которого нет.
struct MapPointBar: View {
    let point: MapPoint
    let onClose: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            Text(point.kind.emoji)
                .font(.system(size: 26))
                .frame(width: 38, height: 38)
                .background(Circle().fill(Color.white.opacity(0.08)))

            VStack(alignment: .leading, spacing: 3) {
                Text(point.title)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundColor(DS.textPrimary)
                    .lineLimit(1)
                Text(point.subtitle)
                    .font(.system(size: 11))
                    .foregroundColor(DS.textSecondary)
                    .lineLimit(2)
                // Предупреждение только там, где источник прямо сказал «пересыхает»
                // или «пить нельзя». Молчание OSM за факт не выдаём.
                if point.seasonal == true || point.drinking == false {
                    Text(point.drinking == false
                         ? "Пить нельзя — так указано в OSM"
                         : "Летом может пересохнуть")
                        .font(.system(size: 10, weight: .medium))
                        .foregroundColor(DS.pinFinish)
                }
            }

            Spacer(minLength: 0)

            Button(action: onClose) {
                Image(systemName: "xmark")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(DS.textSecondary)
                    .frame(width: 30, height: 30)
                    .background(Circle().fill(Color.white.opacity(0.08)))
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .background(.ultraThinMaterial)
        .background(Color(red: 0.04, green: 0.04, blue: 0.04).opacity(0.65))
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(DS.border, lineWidth: 1))
        .padding(.horizontal, 12)
        .padding(.bottom, 10)
    }
}
