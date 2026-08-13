import SwiftUI

struct SaveRouteSheet: View {
    @Binding var routeName: String
    let distanceKm: Double
    let waypointCount: Int
    let onSave: () -> Void
    let onCancel: () -> Void

    @FocusState private var focused: Bool

    var body: some View {
        VStack(spacing: 0) {
            // Handle
            Capsule()
                .fill(Color.white.opacity(0.2))
                .frame(width: 36, height: 4)
                .padding(.top, 12)
                .padding(.bottom, 20)

            // Title
            Text("Сохранить маршрут")
                .font(.system(size: 17, weight: .bold))
                .foregroundColor(DS.textPrimary)

            // Stats
            HStack(spacing: 16) {
                Label(String(format: "%.1f км", distanceKm), systemImage: "arrow.left.and.right")
                Label("\(waypointCount) точек", systemImage: "mappin")
            }
            .font(.system(size: 12))
            .foregroundColor(DS.textSecondary)
            .padding(.top, 6)
            .padding(.bottom, 20)

            // Name field
            VStack(alignment: .leading, spacing: 6) {
                Text("НАЗВАНИЕ")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundColor(DS.textSecondary)
                    .kerning(0.6)

                TextField("", text: $routeName)
                    .font(.system(size: 15))
                    .foregroundColor(DS.textPrimary)
                    .tint(DS.accent)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 12)
                    .background(DS.glass)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .stroke(focused ? DS.accent.opacity(0.6) : DS.border, lineWidth: 1))
                    .focused($focused)
            }
            .padding(.horizontal, 20)

            // Buttons
            HStack(spacing: 12) {
                Button(action: onCancel) {
                    Text("Отмена")
                        .font(.system(size: 15, weight: .medium))
                        .foregroundColor(DS.textSecondary)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .background(DS.glass)
                        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(DS.border, lineWidth: 1))
                }
                .buttonStyle(.plain)

                Button(action: onSave) {
                    Text("Сохранить")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundColor(.black)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .background(DS.accent)
                        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 20)
            .padding(.top, 20)
            .padding(.bottom, 32)
        }
        .background(Color(red: 0.08, green: 0.08, blue: 0.08))
        .onAppear { focused = true }
    }
}
