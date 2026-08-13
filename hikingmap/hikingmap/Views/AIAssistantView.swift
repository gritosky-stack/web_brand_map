import SwiftUI

// MARK: - Message model

struct AIMessage: Identifiable {
    enum Role { case user, assistant }
    let id = UUID()
    let role: Role
    let text: String
    var results: [MatchResult] = []
    var visibleCount: Int = 5        // how many result cards are revealed (grows via "Ещё")
}

// MARK: - Session store (survives sheet open/close within the app session)

final class AssistantStore: ObservableObject {
    static let shared = AssistantStore()
    @Published var messages: [AIMessage] = [
        AIMessage(role: .assistant,
                  text: "Привет! Опиши маршрут текстом — длину, сложность, район — или нажми ⚙︎ и подбери по параметрам 🏔")
    ]
    private init() {}
}

// MARK: - Quick suggestions (fill input + search)

private let aiSuggestions = [
    "лёгкий на выходные рядом с Белградом",
    "кольцевой до 15 км",
    "до 10 км, простой",
    "сложный с большим набором",
    "маршрут на Тару",
]

// MARK: - View

struct AIAssistantView: View {
    @EnvironmentObject var appState: AppState
    @ObservedObject private var store = AssistantStore.shared
    @Environment(\.dismiss) private var dismiss

    @State private var inputText = ""
    @State private var isThinking = false
    @State private var showFacets = false
    @FocusState private var isInputFocused: Bool

    private var hasUserMessage: Bool { store.messages.contains { $0.role == .user } }

    var body: some View {
        ZStack(alignment: .bottom) {
            Color(red: 0.05, green: 0.05, blue: 0.05).ignoresSafeArea()

            VStack(spacing: 0) {
                header
                Divider().background(DS.border)

                ScrollViewReader { proxy in
                    ScrollView(showsIndicators: false) {
                        LazyVStack(spacing: 12) {
                            ForEach(store.messages) { msg in
                                messageBubble(msg).id(msg.id)
                            }
                            if !hasUserMessage { suggestionsBubble }
                            if isThinking { thinkingBubble }
                            Color.clear.frame(height: 1).id("bottom")
                        }
                        .padding(.horizontal, 16)
                        .padding(.vertical, 12)
                        .padding(.bottom, 80)
                    }
                    .onChange(of: store.messages.count) { _ in
                        withAnimation { proxy.scrollTo("bottom") }
                    }
                    .onChange(of: isThinking) { _ in
                        withAnimation { proxy.scrollTo("bottom") }
                    }
                    .onAppear {
                        // Restore scroll position to the latest message on (re)open
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
                            proxy.scrollTo("bottom")
                        }
                    }
                }

                inputBar
            }
        }
        .presentationDetents([.fraction(0.6), .large])
        .presentationBackground(.ultraThinMaterial)
        .presentationDragIndicator(.visible)
        .sheet(isPresented: $showFacets) {
            FacetSearchSheet(candidates: buildCandidates()) { filters, summary in
                showFacets = false
                runStructured(filters, summary)
            }
        }
    }

    // MARK: - Header
    private var header: some View {
        HStack(spacing: 10) {
            ZStack {
                Circle()
                    .fill(LinearGradient(colors: [DS.accent, DS.diffMedium],
                                         startPoint: .topLeading, endPoint: .bottomTrailing))
                    .frame(width: 32, height: 32)
                Text("✦").font(.system(size: 14))
            }
            VStack(alignment: .leading, spacing: 1) {
                Text("AI Ассистент").font(.system(size: 14, weight: .bold)).foregroundColor(DS.textPrimary)
                Text("● онлайн").font(.system(size: 10)).foregroundColor(DS.diffEasy)
            }
            Spacer()
            Button(action: { dismiss() }) {
                Image(systemName: "xmark")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(DS.textSecondary)
                    .frame(width: 28, height: 28)
                    .background(DS.glass)
                    .clipShape(Circle())
                    .overlay(Circle().stroke(DS.border, lineWidth: 1))
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }

    // MARK: - Suggestion chips (empty state)
    private var suggestionsBubble: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("ПОПРОБУЙ ТАК")
                .font(.system(size: 10, weight: .bold)).tracking(0.8)
                .foregroundColor(DS.textTertiary)
            FlowChips(items: aiSuggestions) { s in
                inputText = s
                send()
            }
            Button {
                isInputFocused = false
                showFacets = true
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: "slider.horizontal.3").font(.system(size: 12, weight: .semibold))
                    Text("Подбор по параметрам").font(.system(size: 12, weight: .semibold))
                }
                .foregroundColor(DS.accent)
                .padding(.horizontal, 12).padding(.vertical, 8)
                .background(DS.accent.opacity(0.14))
                .clipShape(Capsule())
                .overlay(Capsule().stroke(DS.accent.opacity(0.4), lineWidth: 1))
            }
            .buttonStyle(.plain)
            .padding(.top, 2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: - Bubble
    @ViewBuilder
    private func messageBubble(_ msg: AIMessage) -> some View {
        switch msg.role {
        case .user:
            HStack {
                Spacer()
                Text(msg.text)
                    .font(.system(size: 13))
                    .foregroundColor(DS.textPrimary)
                    .padding(.horizontal, 12).padding(.vertical, 9)
                    .background(DS.accent.opacity(0.22))
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .stroke(DS.accent.opacity(0.44), lineWidth: 1)
                    )
                    .frame(maxWidth: 280, alignment: .trailing)
            }

        case .assistant:
            VStack(alignment: .leading, spacing: 8) {
                Text(msg.text)
                    .font(.system(size: 13))
                    .foregroundColor(DS.textPrimary)
                    .padding(.horizontal, 12).padding(.vertical, 9)
                    .background(DS.surfaceRaised)
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .stroke(DS.border, lineWidth: 1)
                    )
                    .frame(maxWidth: 280, alignment: .leading)

                ForEach(Array(msg.results.prefix(msg.visibleCount).enumerated()), id: \.element.candidate.id) { idx, result in
                    aiResultCard(result, isTop: idx == 0)
                        .transition(.asymmetric(insertion: .move(edge: .bottom).combined(with: .opacity), removal: .opacity))
                }
                if msg.results.count > msg.visibleCount {
                    showMoreButton(msg)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    // "Ещё" — reveals the next batch of result cards for this message.
    private func showMoreButton(_ msg: AIMessage) -> some View {
        let remaining = msg.results.count - msg.visibleCount
        let step = min(5, remaining)
        return Button {
            guard let i = store.messages.firstIndex(where: { $0.id == msg.id }) else { return }
            withAnimation(.spring(response: 0.4)) {
                store.messages[i].visibleCount += 5
            }
        } label: {
            HStack(spacing: 6) {
                Image(systemName: "chevron.down").font(.system(size: 11, weight: .bold))
                Text("Ещё \(step) · осталось \(remaining)").font(.system(size: 12, weight: .semibold))
            }
            .foregroundColor(DS.accent)
            .padding(.horizontal, 14).padding(.vertical, 10)
            .frame(maxWidth: 300, alignment: .center)
            .background(DS.accent.opacity(0.12))
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(DS.accent.opacity(0.4), lineWidth: 1))
        }
        .buttonStyle(.plain)
    }

    // MARK: - Result card
    private func aiResultCard(_ result: MatchResult, isTop: Bool) -> some View {
        let c = result.candidate
        return Button {
            open(c)
        } label: {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(isTop ? "✓ ЛУЧШИЙ ВАРИАНТ" : (c.source == .curated ? "ТВОЙ МАРШРУТ" : "ВАРИАНТ"))
                            .font(.system(size: 10, weight: .bold))
                            .foregroundColor(isTop ? DS.diffEasy : DS.textSecondary)
                        Text(c.name)
                            .font(.system(size: 15, weight: .bold))
                            .foregroundColor(DS.textPrimary)
                            .lineLimit(2)
                    }
                    Spacer()
                    Text(c.source == .curated ? "📍" : "🏔").font(.system(size: 18))
                }

                HStack(spacing: 14) {
                    miniStat("↔", String(format: "%.1f", c.distanceKm), "км")
                    if let a = c.ascentM { miniStat("↑", "\(Int(a))", "м") }
                    if let t = c.durationH { miniStat("⏱", String(format: "%.1f", t), "ч") }
                }

                HStack(spacing: 6) {
                    Text(c.difficulty.rawValue)
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundColor(.white)
                        .padding(.horizontal, 7).padding(.vertical, 3)
                        .background(Color(c.difficulty.color))
                        .clipShape(Capsule())
                    if let m = c.mountain {
                        Text(m).font(.system(size: 10)).foregroundColor(DS.textSecondary).lineLimit(1)
                    }
                }

                if !result.reasons.isEmpty {
                    Text("✓ " + result.reasons.joined(separator: " · "))
                        .font(.system(size: 11))
                        .foregroundColor(DS.textSecondary)
                        .lineLimit(2)
                }

                Divider().background(DS.border)

                HStack {
                    Text("Нажми чтобы увидеть на карте →")
                        .font(.system(size: 11))
                        .foregroundColor(DS.textSecondary)
                    Spacer()
                }
            }
            .padding(.horizontal, 14).padding(.vertical, 12)
            .background(Color(red: 0.10, green: 0.10, blue: 0.10).opacity(0.95))
            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .stroke((isTop ? DS.accent : DS.border).opacity(isTop ? 0.44 : 1), lineWidth: isTop ? 1.5 : 1)
            )
            .shadow(color: .black.opacity(0.4), radius: 6, y: 3)
        }
        .buttonStyle(.plain)
        .frame(maxWidth: 300, alignment: .leading)
    }

    private func miniStat(_ icon: String, _ value: String, _ unit: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 3) {
            Text(icon).font(.system(size: 11)).foregroundColor(DS.textSecondary)
            Text(value).font(.system(size: 13, weight: .bold, design: .monospaced)).foregroundColor(DS.textPrimary)
            if !unit.isEmpty {
                Text(unit).font(.system(size: 9)).foregroundColor(DS.textSecondary)
            }
        }
    }

    // MARK: - Thinking
    private var thinkingBubble: some View {
        HStack(spacing: 5) {
            ForEach(0..<3, id: \.self) { i in
                Circle()
                    .fill(DS.textTertiary)
                    .frame(width: 6, height: 6)
                    .scaleEffect(isThinking ? 1.0 : 0.5)
                    .animation(.easeInOut(duration: 0.4).repeatForever().delay(Double(i) * 0.15), value: isThinking)
            }
        }
        .padding(.horizontal, 14).padding(.vertical, 10)
        .background(DS.surfaceRaised)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(DS.border, lineWidth: 1))
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: - Input bar
    private var inputBar: some View {
        HStack(spacing: 10) {
            Button {
                isInputFocused = false
                showFacets = true
            } label: {
                Image(systemName: "slider.horizontal.3")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundColor(DS.textSecondary)
                    .frame(width: 36, height: 36)
                    .background(DS.glass)
                    .clipShape(Circle())
                    .overlay(Circle().stroke(DS.border, lineWidth: 1))
            }

            TextField("Спроси что-нибудь...", text: $inputText)
                .font(.system(size: 13))
                .foregroundColor(DS.textPrimary)
                .padding(.horizontal, 14).padding(.vertical, 10)
                .background(DS.glass)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(DS.border, lineWidth: 1))
                .focused($isInputFocused)
                .onSubmit { send() }

            Button(action: send) {
                Image(systemName: "arrow.up")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(.white)
                    .frame(width: 36, height: 36)
                    .background(inputText.isEmpty ? DS.textTertiary : DS.accent)
                    .clipShape(Circle())
            }
            .disabled(inputText.isEmpty || isThinking)
        }
        .padding(.horizontal, 16).padding(.vertical, 10)
        .background(Color(red: 0.05, green: 0.05, blue: 0.05))
    }

    // MARK: - Candidates (PSS index + curated bridged from RouteStats)
    private func buildCandidates() -> [MatchCandidate] {
        var list = RouteMatcher.pssCandidates()
        for route in RouteStore.all {
            guard let s = appState.routeStats[route.id] else { continue }
            list.append(MatchCandidate(
                id: route.id, name: route.name, distanceKm: s.distance,
                ascentM: route.overrideAscent.map(Double.init) ?? s.ascent,
                durationH: nil, difficulty: s.difficulty,
                region: nil, mountain: nil, category: nil,
                start: s.coordinates.first ?? s.center, source: .curated))
        }
        return list
    }

    private func open(_ c: MatchCandidate) {
        dismiss()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
            switch c.source {
            case .pss:
                if let r = appState.pssRoutes.first(where: { $0.id == c.id }) { appState.selectPSSRoute(r) }
            case .curated:
                if let r = RouteStore.all.first(where: { $0.id == c.id }) { appState.select(r) }
            }
        }
    }

    // MARK: - Search
    private func send() {
        let text = inputText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        store.messages.append(AIMessage(role: .user, text: text))
        inputText = ""
        runMatch { RouteMatcher.match(query: text, candidates: buildCandidates(), limit: 20).results }
    }

    private func runStructured(_ filters: RouteMatcher.Filters, _ summary: String) {
        store.messages.append(AIMessage(role: .user, text: summary))
        runMatch { RouteMatcher.match(filters: filters, candidates: buildCandidates(), limit: 9999) }
    }

    private func runMatch(_ work: @escaping () -> [MatchResult]) {
        isThinking = true
        DispatchQueue.global(qos: .userInitiated).async {
            let results = work()
            let reply = results.isEmpty
                ? "Не нашёл подходящего маршрута. Уточни длину, сложность, район или ослабь фильтры."
                : "Нашёл \(results.count) — вот что подобрал 👇"
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                withAnimation(.spring(response: 0.4)) {
                    store.messages.append(AIMessage(role: .assistant, text: reply, results: results))
                    isThinking = false
                }
            }
        }
    }
}

// MARK: - Faceted (structured) search sheet

struct FacetSearchSheet: View {
    let candidates: [MatchCandidate]
    let onSearch: (RouteMatcher.Filters, String) -> Void
    @Environment(\.dismiss) private var dismiss

    @State private var diff = Set<Difficulty>()
    @State private var regions = Set<String>()
    @State private var distanceIdx = 0   // 0 любая,1 <10,2 10-20,3 20-35,4 35+
    @State private var durationIdx = 0   // 0 любая,1 <4,2 4-8,3 8+
    @State private var typeIdx = 0       // 0 любой,1 кольцевой,2 линейный,3 трансверзала

    private let distanceLabels = ["Любая", "до 10 км", "10–20 км", "20–35 км", "35+ км"]
    private let durationLabels = ["Любая", "до 4 ч", "4–8 ч", "8+ ч"]
    private let typeLabels = ["Любой", "Кольцевой", "Линейный", "Трансверзала"]

    private var regionOptions: [String] {
        Array(Set(candidates.compactMap { $0.region })).sorted()
    }

    private func buildFilters() -> RouteMatcher.Filters {
        var f = RouteMatcher.Filters()
        f.difficulty = diff
        f.regions = regions
        switch distanceIdx {
        case 1: f.distanceMax = 10
        case 2: f.distanceMin = 10; f.distanceMax = 20
        case 3: f.distanceMin = 20; f.distanceMax = 35
        case 4: f.distanceMin = 35
        default: break
        }
        switch durationIdx {
        case 1: f.durationMax = 4
        case 2: f.durationMin = 4; f.durationMax = 8
        case 3: f.durationMin = 8
        default: break
        }
        switch typeIdx {
        case 1: f.categories = ["kružna"]
        case 2: f.categories = ["linijska"]
        case 3: f.categories = ["transverzala", "E-transverzala"]
        default: break
        }
        return f
    }

    private func summary() -> String {
        var parts: [String] = []
        if !diff.isEmpty {
            let order: [Difficulty] = [.easy, .medium, .hard, .expert]
            parts.append(order.filter { diff.contains($0) }.map { $0.rawValue }.joined(separator: ", "))
        }
        if !regions.isEmpty { parts.append(regions.sorted().joined(separator: ", ")) }
        if distanceIdx > 0 { parts.append(distanceLabels[distanceIdx]) }
        if durationIdx > 0 { parts.append(durationLabels[durationIdx]) }
        if typeIdx > 0 { parts.append(typeLabels[typeIdx].lowercased()) }
        return parts.isEmpty ? "Любой маршрут" : "🔎 " + parts.joined(separator: " · ")
    }

    private var matchCount: Int {
        RouteMatcher.match(filters: buildFilters(), candidates: candidates, limit: 9999).count
    }

    var body: some View {
        ZStack(alignment: .bottom) {
            Color(red: 0.05, green: 0.05, blue: 0.05).ignoresSafeArea()
            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 22) {
                    HStack {
                        Text("Подбор по параметрам").font(.system(size: 16, weight: .bold)).foregroundColor(DS.textPrimary)
                        Spacer()
                        Button(action: { dismiss() }) {
                            Image(systemName: "xmark").font(.system(size: 12, weight: .semibold))
                                .foregroundColor(DS.textSecondary).frame(width: 28, height: 28)
                                .background(DS.glass).clipShape(Circle())
                        }
                    }

                    facetSection("СЛОЖНОСТЬ") {
                        FlowChips(items: ["Любая"] + Difficulty.allCases.map { $0.rawValue },
                                  selected: { label in
                                      label == "Любая" ? diff.isEmpty
                                          : (Difficulty(rawValue: label).map { diff.contains($0) } ?? false)
                                  }) { label in
                            if label == "Любая" { diff.removeAll() }
                            else if let d = Difficulty(rawValue: label) {
                                if diff.contains(d) { diff.remove(d) } else { diff.insert(d) }
                            }
                        }
                    }
                    facetSection("РАССТОЯНИЕ") {
                        FlowChips(items: distanceLabels, selected: { distanceLabels[distanceIdx] == $0 }) { label in
                            distanceIdx = distanceLabels.firstIndex(of: label) ?? 0
                        }
                    }
                    facetSection("ВРЕМЯ В ПУТИ") {
                        FlowChips(items: durationLabels, selected: { durationLabels[durationIdx] == $0 }) { label in
                            durationIdx = durationLabels.firstIndex(of: label) ?? 0
                        }
                    }
                    facetSection("ТИП") {
                        FlowChips(items: typeLabels, selected: { typeLabels[typeIdx] == $0 }) { label in
                            typeIdx = typeLabels.firstIndex(of: label) ?? 0
                        }
                    }
                    facetSection("РЕГИОН") {
                        FlowChips(items: ["Любой"] + regionOptions,
                                  selected: { label in label == "Любой" ? regions.isEmpty : regions.contains(label) }) { label in
                            if label == "Любой" { regions.removeAll() }
                            else if regions.contains(label) { regions.remove(label) } else { regions.insert(label) }
                        }
                    }
                    Color.clear.frame(height: 70)
                }
                .padding(20)
            }

            Button {
                onSearch(buildFilters(), summary())
            } label: {
                Text("Показать маршруты · \(matchCount)")
                    .font(.system(size: 15, weight: .bold)).foregroundColor(.white)
                    .frame(maxWidth: .infinity).padding(.vertical, 15)
                    .background(DS.accent).clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            }
            .buttonStyle(.plain)
            .padding(.horizontal, 20).padding(.bottom, 16)
        }
        .presentationDetents([.large])
        .presentationBackground(.ultraThinMaterial)
        .presentationDragIndicator(.visible)
    }

    private func facetSection<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title).font(.system(size: 11, weight: .bold)).tracking(0.8).foregroundColor(DS.textTertiary)
            content()
        }
    }
}

// MARK: - Wrapping chip row

struct FlowChips: View {
    let items: [String]
    var selected: (String) -> Bool = { _ in false }
    let action: (String) -> Void

    var body: some View {
        FlowLayout(spacing: 8, lineSpacing: 8) {
            ForEach(items, id: \.self) { item in
                let on = selected(item)
                Button { action(item) } label: {
                    Text(item)
                        .font(.system(size: 12, weight: on ? .semibold : .regular))
                        .foregroundColor(on ? .white : DS.textSecondary)
                        .padding(.horizontal, 12).padding(.vertical, 7)
                        .background(on ? DS.accent.opacity(0.9) : DS.glass)
                        .clipShape(Capsule())
                        .overlay(Capsule().stroke(on ? DS.accent : DS.border, lineWidth: 1))
                }
                .buttonStyle(.plain)
            }
        }
    }
}

// Simple flow layout that wraps chips to new lines (iOS 16+).
struct FlowLayout: Layout {
    var spacing: CGFloat = 8
    var lineSpacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let maxW = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, lineH: CGFloat = 0
        for v in subviews {
            let s = v.sizeThatFits(.unspecified)
            if x + s.width > maxW, x > 0 { x = 0; y += lineH + lineSpacing; lineH = 0 }
            x += s.width + spacing
            lineH = max(lineH, s.height)
        }
        return CGSize(width: maxW == .infinity ? x : maxW, height: y + lineH)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let maxW = bounds.width
        var x: CGFloat = bounds.minX, y: CGFloat = bounds.minY, lineH: CGFloat = 0
        for v in subviews {
            let s = v.sizeThatFits(.unspecified)
            if x - bounds.minX + s.width > maxW, x > bounds.minX { x = bounds.minX; y += lineH + lineSpacing; lineH = 0 }
            v.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(s))
            x += s.width + spacing
            lineH = max(lineH, s.height)
        }
    }
}
