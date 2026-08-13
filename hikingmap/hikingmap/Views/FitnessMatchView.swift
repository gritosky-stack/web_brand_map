import SwiftUI
import Charts
import HealthKit

// MARK: - Manager

@MainActor
final class HealthKitManager: ObservableObject {
    static let shared = HealthKitManager()

    @Published var vo2Max: Double?       // mL/kg/min
    @Published var restingHR: Double?    // bpm
    @Published var hrv: Double?          // ms (SDNN)
    @Published var authorized = false
    @Published var unavailable = false

    private let store = HKHealthStore()

    private var readTypes: Set<HKObjectType> {
        Set([
            HKQuantityType(.vo2Max),
            HKQuantityType(.restingHeartRate),
            HKQuantityType(.heartRateVariabilitySDNN),
        ])
    }

    func requestAccess() async {
        guard HKHealthStore.isHealthDataAvailable() else { unavailable = true; return }
        do {
            try await store.requestAuthorization(toShare: [], read: readTypes)
            authorized = true
            await fetchAll()
        } catch {
            authorized = false
        }
    }

    func fetchAll() async {
        async let v = latestQuantity(.vo2Max)
        async let r = latestQuantity(.restingHeartRate)
        async let h = latestQuantity(.heartRateVariabilitySDNN)
        let (vq, rq, hq) = await (v, r, h)
        if let vq { vo2Max     = vq.doubleValue(for: HKUnit(from: "ml/kg·min")) }
        if let rq { restingHR  = rq.doubleValue(for: .count().unitDivided(by: .minute())) }
        if let hq { hrv        = hq.doubleValue(for: .secondUnit(with: .milli)) }
    }

    private func latestQuantity(_ id: HKQuantityTypeIdentifier) async -> HKQuantity? {
        let type = HKQuantityType(id)
        return await withCheckedContinuation { c in
            let q = HKSampleQuery(sampleType: type, predicate: nil, limit: 1,
                sortDescriptors: [NSSortDescriptor(key: HKSampleSortIdentifierEndDate, ascending: false)]) { _, s, _ in
                c.resume(returning: (s?.first as? HKQuantitySample)?.quantity)
            }
            store.execute(q)
        }
    }
}

// MARK: - Effort enum

enum EffortLevel {
    case easy, moderate, high, unknown

    var label: String {
        switch self {
        case .easy: return "Easy Walk"
        case .moderate: return "Moderate"
        case .high: return "High Effort"
        case .unknown: return "Нет данных"
        }
    }
    var emoji: String {
        switch self {
        case .easy: return "🌿"
        case .moderate: return "💪"
        case .high: return "🔥"
        case .unknown: return "❓"
        }
    }
    var color: Color {
        switch self {
        case .easy: return DS.diffEasy
        case .moderate: return DS.diffMedium
        case .high: return DS.diffHard
        case .unknown: return DS.textSecondary
        }
    }
}

// MARK: - HR zone helpers

private func hrZoneColor(_ bpm: Double) -> Color {
    switch bpm {
    case ..<100: return Color(hex: "#4CAF50")
    case ..<115: return Color(hex: "#8BC34A")
    case ..<130: return Color(hex: "#FF9800")
    case ..<150: return Color(hex: "#FF5722")
    default:     return Color(hex: "#F44336")
    }
}

// Predicted HR along elevation profile (simple model)
private func predictedHR(elevations: [Double], restingHR: Double) -> [Double] {
    guard !elevations.isEmpty else { return [] }
    let minE = elevations.min() ?? 0
    let maxE = elevations.max() ?? 1
    let range = max(maxE - minE, 1)
    return elevations.map { e in
        let intensity = (e - minE) / range      // 0…1
        let effort    = 0.3 + intensity * 0.7   // 30%…100% effort
        return restingHR + (200 - restingHR) * effort * 0.75
    }
}

// MARK: - Chart Point

private struct ElevHRPoint: Identifiable {
    let id: Int
    let x: Double        // 0…1 (normalised distance)
    let elevation: Double
    let hr: Double
}

// MARK: - FitnessMatchView

struct FitnessMatchView: View {
    let stats: RouteStats
    @StateObject private var hk = HealthKitManager.shared

    private var effort: EffortLevel {
        guard let vo2 = hk.vo2Max else { return .unknown }
        let intensity = stats.ascent / max(stats.distance, 0.1)  // m ascent per km
        switch (vo2, intensity) {
        case (let v, let i) where v >= 45 && i < 40: return .easy
        case (let v, _)     where v >= 35:            return .moderate
        default:                                       return .high
        }
    }

    private var rhr: Double { hk.restingHR ?? 60 }

    private var chartPoints: [ElevHRPoint] {
        let elevs = stats.elevationSampled
        let hrs   = predictedHR(elevations: elevs, restingHR: rhr)
        return elevs.enumerated().map { i, e in
            ElevHRPoint(id: i, x: Double(i) / Double(max(elevs.count - 1, 1)),
                        elevation: e, hr: hrs[i])
        }
    }

    private var predictedPeakHR: Int {
        Int((chartPoints.map(\.hr).max() ?? 150).rounded())
    }

    var body: some View {
        if hk.unavailable {
            unavailableCard
        } else if !hk.authorized {
            connectCard
        } else {
            readinessCard
        }
    }

    // ── Connect prompt ────────────────────────────────────────
    private var connectCard: some View {
        Button {
            Task { await hk.requestAccess() }
        } label: {
            HStack(spacing: 10) {
                Image(systemName: "heart.fill")
                    .font(.system(size: 16))
                    .foregroundColor(DS.diffHard)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Подключить Apple Health")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundColor(DS.textPrimary)
                    Text("Персональный прогноз нагрузки")
                        .font(.system(size: 11))
                        .foregroundColor(DS.textSecondary)
                }
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.system(size: 12))
                    .foregroundColor(DS.textTertiary)
            }
            .padding(14)
            .background(DS.glass)
            .clipShape(RoundedRectangle(cornerRadius: DS.radiusM, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: DS.radiusM, style: .continuous).stroke(DS.border, lineWidth: 1))
        }
        .buttonStyle(.plain)
    }

    private var unavailableCard: some View {
        HStack(spacing: 8) {
            Image(systemName: "heart.slash.fill").foregroundColor(DS.textTertiary)
            Text("HealthKit недоступен на этом устройстве")
                .font(.system(size: 12))
                .foregroundColor(DS.textTertiary)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(DS.glass)
        .clipShape(RoundedRectangle(cornerRadius: DS.radiusM, style: .continuous))
    }

    // ── Full readiness card ───────────────────────────────────
    private var readinessCard: some View {
        VStack(alignment: .leading, spacing: 0) {

            // Header
            HStack(spacing: 6) {
                Circle().fill(effort.color).frame(width: 7, height: 7)
                Text("HEALTHKIT · FITNESS MATCH")
                    .font(.system(size: 10, weight: .bold))
                    .foregroundColor(effort.color)
                    .kerning(0.07 * 10)
            }
            .padding(.bottom, 8)

            // Effort + VO2 gauge
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("\(effort.emoji) \(effort.label)")
                        .font(.system(size: 20, weight: .bold))
                        .foregroundColor(DS.textPrimary)
                    Text(effortDescription)
                        .font(.system(size: 12))
                        .foregroundColor(DS.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer()
                vo2Gauge
            }
            .padding(.bottom, 12)

            Divider().background(DS.border).padding(.bottom, 10)

            // Metrics row
            HStack(spacing: 0) {
                metricCell(icon: "❤️", value: hk.restingHR.map { "\(Int($0))" } ?? "—", unit: "bpm", label: "Пульс покоя")
                Divider().background(DS.border)
                metricCell(icon: "📊", value: hk.hrv.map { "\(Int($0))" } ?? "—", unit: "мс", label: "HRV")
                Divider().background(DS.border)
                metricCell(icon: "🔥", value: "\(predictedPeakHR)", unit: "bpm", label: "Прогноз пульса")
            }
            .frame(height: 56)
            .background(DS.glass)
            .clipShape(RoundedRectangle(cornerRadius: DS.radiusS, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: DS.radiusS, style: .continuous).stroke(DS.border, lineWidth: 1))
            .padding(.bottom, 12)

            // Chart
            hrElevationChart
        }
        .padding(14)
        .background(DS.glass)
        .clipShape(RoundedRectangle(cornerRadius: DS.radiusM, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: DS.radiusM, style: .continuous).stroke(DS.border, lineWidth: 1))
    }

    private var effortDescription: String {
        switch effort {
        case .easy:     return "Этот маршрут будет лёгким для вас"
        case .moderate: return "Маршрут соответствует вашей форме"
        case .high:     return "Ваш VO₂ Max ниже нормы для этого маршрута"
        case .unknown:  return "Нет данных о физической форме"
        }
    }

    private var vo2Gauge: some View {
        VStack(spacing: 2) {
            ZStack {
                Circle()
                    .stroke(DS.border, lineWidth: 4)
                Circle()
                    .trim(from: 0, to: min(CGFloat((hk.vo2Max ?? 42) / 70), 1) * 0.75)
                    .stroke(effort.color, style: StrokeStyle(lineWidth: 4, lineCap: .round))
                    .rotationEffect(.degrees(-135))
                VStack(spacing: 0) {
                    Text(hk.vo2Max.map { "\(Int($0))" } ?? "—")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundColor(DS.textPrimary)
                    Text("VO₂")
                        .font(.system(size: 8))
                        .foregroundColor(DS.textTertiary)
                }
            }
            .frame(width: 52, height: 52)
            Text("Max").font(.system(size: 8)).foregroundColor(DS.textTertiary)
        }
    }

    private func metricCell(icon: String, value: String, unit: String, label: String) -> some View {
        VStack(spacing: 2) {
            Text(icon).font(.system(size: 11))
            HStack(alignment: .firstTextBaseline, spacing: 2) {
                Text(value)
                    .font(.system(size: 15, weight: .bold, design: .monospaced))
                    .foregroundColor(DS.textPrimary)
                Text(unit)
                    .font(.system(size: 9))
                    .foregroundColor(DS.textSecondary)
            }
            Text(label)
                .font(.system(size: 8))
                .foregroundColor(DS.textTertiary)
        }
        .frame(maxWidth: .infinity)
    }

    // ── Combined elevation + HR chart ─────────────────────────
    private var hrElevationChart: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("ПРОФИЛЬ + ПУЛЬСОВЫЕ ЗОНЫ")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundColor(DS.textSecondary)
                    .kerning(0.6)
                Spacer()
                HStack(spacing: 8) {
                    legend(color: Color.white.opacity(0.3), label: "Высота")
                    legend(color: DS.diffHard, label: "HR")
                }
            }

            Chart(chartPoints) { pt in
                // Elevation area
                AreaMark(
                    x: .value("Dist", pt.x),
                    y: .value("Ele", pt.elevation)
                )
                .foregroundStyle(
                    LinearGradient(colors: [.white.opacity(0.15), .white.opacity(0.02)],
                                   startPoint: .top, endPoint: .bottom)
                )
                .interpolationMethod(.catmullRom)

                // Elevation line
                LineMark(
                    x: .value("Dist", pt.x),
                    y: .value("Ele", pt.elevation)
                )
                .foregroundStyle(.white.opacity(0.35))
                .lineStyle(StrokeStyle(lineWidth: 1.5))
                .interpolationMethod(.catmullRom)

                // HR line (uses secondary y via chartYScale)
                LineMark(
                    x: .value("Dist", pt.x),
                    y: .value("HR", pt.hr)
                )
                .foregroundStyle(hrGradient)
                .lineStyle(StrokeStyle(lineWidth: 2.2))
                .interpolationMethod(.catmullRom)
            }
            .chartXAxis(.hidden)
            .chartYAxis(.hidden)
            .chartPlotStyle { p in p.background(Color.clear) }
            .frame(height: 100)

            // Zone legend
            HStack(spacing: 4) {
                ForEach(["Z1","Z2","Z3","Z4","Z5"], id: \.self) { z in
                    VStack(spacing: 2) {
                        RoundedRectangle(cornerRadius: 2)
                            .fill(zoneColor(z))
                            .frame(height: 3)
                        Text(z).font(.system(size: 8)).foregroundColor(DS.textTertiary)
                    }
                }
            }
        }
    }

    private func legend(color: Color, label: String) -> some View {
        HStack(spacing: 4) {
            RoundedRectangle(cornerRadius: 1).fill(color).frame(width: 10, height: 2)
            Text(label).font(.system(size: 8)).foregroundColor(DS.textTertiary)
        }
    }

    private func zoneColor(_ z: String) -> Color {
        switch z {
        case "Z1": return Color(hex: "#4CAF50")
        case "Z2": return Color(hex: "#8BC34A")
        case "Z3": return Color(hex: "#FF9800")
        case "Z4": return Color(hex: "#FF5722")
        default:   return Color(hex: "#F44336")
        }
    }

    private var hrGradient: LinearGradient {
        LinearGradient(
            colors: [Color(hex: "#4CAF50"), Color(hex: "#FF9800"), Color(hex: "#F44336")],
            startPoint: .leading, endPoint: .trailing
        )
    }
}
