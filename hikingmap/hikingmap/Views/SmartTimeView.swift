import SwiftUI

// MARK: - Data

private struct FitnessOption {
    let icon: String; let label: String; let mult: Double
}
private struct WeatherOption {
    let icon: String; let label: String; let mult: Double
}

private let fitnessOptions: [FitnessOption] = [
    .init(icon: "🧒", label: "Новичок", mult: 1.4),
    .init(icon: "🧗", label: "Средний", mult: 1.0),
    .init(icon: "⚡", label: "Профи",   mult: 0.72),
]
private let weatherOptions: [WeatherOption] = [
    .init(icon: "☀️", label: "Ясно",    mult: 1.0),
    .init(icon: "⛅", label: "Облачно", mult: 1.05),
    .init(icon: "🌧", label: "Дождь",   mult: 1.25),
    .init(icon: "❄️", label: "Снег",    mult: 1.45),
]

// MARK: - View

struct SmartTimeView: View {
    let stats: RouteStats

    @State private var groupSize: Double = 3
    @State private var fitnessIdx: Int   = 1
    @State private var weatherIdx: Int   = 0

    // Naismith base: 5 km/h walking + 1 min per 10 m ascent
    private var baseMinutes: Double {
        (stats.distance / 5.0) * 60 + (stats.ascent / 10.0)
    }

    private var groupMult: Double {
        let n = Int(groupSize.rounded())
        if n <= 2 { return 1.0 }
        if n <= 5 { return 1.0 + Double(n - 2) * 0.04 }
        return 1.15 + Double(n - 5) * 0.06
    }

    private var totalMinutes: Int {
        Int((baseMinutes
             * fitnessOptions[fitnessIdx].mult
             * weatherOptions[weatherIdx].mult
             * groupMult).rounded())
    }

    private var deltaMinutes: Int { totalMinutes - Int(baseMinutes.rounded()) }

    private var timeString: String {
        let h = totalMinutes / 60, m = totalMinutes % 60
        return h > 0 ? "\(h)ч \(String(format: "%02d", m))м" : "\(m)м"
    }

    private var deltaString: String {
        guard deltaMinutes != 0 else { return "" }
        let abs = Swift.abs(deltaMinutes)
        let sign = deltaMinutes > 0 ? "+" : "−"
        let h = abs / 60, m = abs % 60
        return h > 0 ? "\(sign)\(h)ч \(m)м" : "\(sign)\(m)м"
    }

    private var deltaColor: Color {
        deltaMinutes > 0 ? DS.diffMedium : DS.diffEasy
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {

            // ── Time display ──────────────────────────────────
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(timeString)
                    .font(.system(size: 30, weight: .bold).monospacedDigit())
                    .foregroundColor(DS.textPrimary)
                    .contentTransition(.numericText(value: Double(totalMinutes)))
                    .animation(.spring(response: 0.4, dampingFraction: 0.8), value: totalMinutes)

                if !deltaString.isEmpty {
                    Text(deltaString)
                        .font(.system(size: 12, weight: .semibold, design: .monospaced))
                        .foregroundColor(deltaColor)
                        .contentTransition(.numericText())
                        .animation(.spring(response: 0.4), value: deltaMinutes)
                }
            }
            .padding(.bottom, 14)

            Divider().background(DS.border).padding(.bottom, 14)

            // ── Group size ────────────────────────────────────
            VStack(spacing: 8) {
                HStack {
                    sectionLabel("ГРУППА")
                    Spacer()
                    Text("\(Int(groupSize.rounded())) чел 👤")
                        .font(.system(size: 13, weight: .bold).monospacedDigit())
                        .foregroundColor(DS.textPrimary)
                }
                Slider(value: $groupSize, in: 1...12, step: 1)
                    .tint(DS.accent)
            }
            .padding(.bottom, 14)

            // ── Fitness level ─────────────────────────────────
            VStack(alignment: .leading, spacing: 8) {
                sectionLabel("УРОВЕНЬ ГРУППЫ")
                HStack(spacing: 8) {
                    ForEach(fitnessOptions.indices, id: \.self) { i in
                        let opt = fitnessOptions[i]
                        let sel = fitnessIdx == i
                        Button {
                            withAnimation(.easeInOut(duration: 0.18)) { fitnessIdx = i }
                        } label: {
                            VStack(spacing: 4) {
                                Text(opt.icon).font(.system(size: 20))
                                Text(opt.label)
                                    .font(.system(size: 10, weight: sel ? .bold : .regular))
                                    .foregroundColor(sel ? DS.textPrimary : DS.textSecondary)
                            }
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 10)
                            .background(sel ? DS.accent.opacity(0.13) : DS.glass)
                            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                            .overlay(
                                RoundedRectangle(cornerRadius: 12, style: .continuous)
                                    .stroke(sel ? DS.accent : DS.border, lineWidth: sel ? 1.5 : 1)
                            )
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .padding(.bottom, 14)

            // ── Weather ───────────────────────────────────────
            VStack(alignment: .leading, spacing: 8) {
                sectionLabel("ПОГОДА")
                HStack(spacing: 8) {
                    ForEach(weatherOptions.indices, id: \.self) { i in
                        let opt = weatherOptions[i]
                        let sel = weatherIdx == i
                        Button {
                            withAnimation(.easeInOut(duration: 0.18)) { weatherIdx = i }
                        } label: {
                            VStack(spacing: 3) {
                                Text(opt.icon).font(.system(size: 18))
                                Text(opt.label)
                                    .font(.system(size: 9, weight: sel ? .bold : .regular))
                                    .foregroundColor(sel ? DS.textPrimary : DS.textTertiary)
                            }
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 9)
                            .background(sel ? DS.accent.opacity(0.13) : DS.glass)
                            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                            .overlay(
                                RoundedRectangle(cornerRadius: 12, style: .continuous)
                                    .stroke(sel ? DS.accent : DS.border, lineWidth: sel ? 1.5 : 1)
                            )
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
        .padding(14)
        .background(DS.glass)
        .clipShape(RoundedRectangle(cornerRadius: DS.radiusM, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: DS.radiusM, style: .continuous)
                .stroke(DS.border, lineWidth: 1)
        )
    }

    private func sectionLabel(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 10, weight: .semibold))
            .foregroundColor(DS.textSecondary)
            .kerning(0.6)
    }
}
