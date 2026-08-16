import SwiftUI

// MARK: - Filter range enums

enum DistRange: String, CaseIterable, Hashable {
    case short = "< 15 км"
    case mid   = "15–20 км"
    case long  = "20–25 км"
    case vlong = "> 25 км"

    func matches(_ d: Double) -> Bool {
        switch self {
        case .short: return d < 15
        case .mid:   return d >= 15 && d < 20
        case .long:  return d >= 20 && d < 25
        case .vlong: return d >= 25
        }
    }
}

enum AscentRange: String, CaseIterable, Hashable {
    case low  = "< 500 м"
    case mid  = "500–1000 м"
    case high = "> 1000 м"

    func matches(_ a: Double) -> Bool {
        switch self {
        case .low:  return a < 500
        case .mid:  return a >= 500 && a < 1000
        case .high: return a >= 1000
        }
    }
}

enum DescentRange: String, CaseIterable, Hashable {
    case low  = "< 400 м"
    case mid  = "400–800 м"
    case high = "> 800 м"

    func matches(_ d: Double) -> Bool {
        switch self {
        case .low:  return d < 400
        case .mid:  return d >= 400 && d < 800
        case .high: return d >= 800
        }
    }
}

// MARK: - Main sheet

struct RouteListSheet: View {
    @EnvironmentObject var appState: AppState
    @Binding var expanded: Bool
    @State private var sheetTab: SheetTab = .routes
    @State private var pssSearch = ""
    @State private var liveDrag: CGFloat = 0

    // Filters (Маршруты tab)
    @State private var showFilters = false
    @State private var filterDifficulty: Set<Difficulty> = []
    @State private var filterDist: DistRange? = nil
    @State private var filterAscent: AscentRange? = nil
    @State private var filterDescent: DescentRange? = nil

    // Filters (PSS tab — search-style facets)
    @State private var showPSSFilters = false
    @State private var pssDiff: Set<Difficulty> = []
    @State private var pssRegions: Set<String> = []
    @State private var pssDistIdx = 0    // 0 любая,1 <10,2 10-20,3 20-35,4 35+
    @State private var pssDurIdx  = 0    // 0 любое,1 <4,2 4-8,3 8+
    @State private var pssTypeIdx = 0    // 0 любой,1 кольцевой,2 линейный,3 трансверзала

    private let pssDistLabels = ["до 10 км", "10–20 км", "20–35 км", "35+ км"]
    private let pssDurLabels  = ["до 4 ч", "4–8 ч", "8+ ч"]
    private let pssTypeLabels = ["Кольцевой", "Линейный", "Трансверзала"]

    enum SheetTab { case routes, pss }

    private let collapsedH: CGFloat = 68
    private let fullH: CGFloat      = UIScreen.main.bounds.height * 0.88

    private var base: CGFloat { expanded ? fullH : collapsedH }
    private var liveH: CGFloat { max(collapsedH, min(fullH, base - liveDrag)) }

    var body: some View {
        VStack(spacing: 0) {
            handle

            if expanded {
                tabBar
                    .padding(.top, 4)

                if sheetTab == .routes && showFilters {
                    filterPanel
                        .transition(.opacity.combined(with: .move(edge: .top)))
                }
                if sheetTab == .pss && showPSSFilters {
                    pssFilterPanel
                        .transition(.opacity.combined(with: .move(edge: .top)))
                }

                Divider().background(DS.border).padding(.top, 4)

                tabContent
            } else {
                collapsedRow
            }
        }
        .frame(maxWidth: .infinity)
        .frame(height: liveH, alignment: .top)
        .background(sheetBg)
        .clipShape(UnevenRoundedRectangle(topLeadingRadius: 22, bottomLeadingRadius: 0,
                                          bottomTrailingRadius: 0, topTrailingRadius: 22))
        .overlay(
            UnevenRoundedRectangle(topLeadingRadius: 22, bottomLeadingRadius: 0,
                                   bottomTrailingRadius: 0, topTrailingRadius: 22)
                .stroke(DS.border, lineWidth: 1)
        )
        .gesture(dragGesture)
        .onTapGesture {
            guard !expanded else { return }
            withAnimation(.spring(response: 0.42, dampingFraction: 0.70)) { expanded = true }
        }
        .animation(.spring(response: 0.42, dampingFraction: 0.70), value: expanded)
        .animation(.easeInOut(duration: 0.18), value: sheetTab)
        .animation(.spring(response: 0.30, dampingFraction: 0.80), value: showFilters)
        .animation(.spring(response: 0.30, dampingFraction: 0.80), value: showPSSFilters)
    }

    private var dragGesture: some Gesture {
        DragGesture(minimumDistance: 8, coordinateSpace: .local)
            .onChanged { value in
                liveDrag = value.translation.height
            }
            .onEnded { value in
                let vel = value.predictedEndTranslation.height
                withAnimation(.spring(response: 0.42, dampingFraction: 0.70)) {
                    if value.translation.height < -40 || vel < -300 {
                        expanded = true
                    } else if value.translation.height > 40 || vel > 300 {
                        expanded = false
                    }
                    liveDrag = 0
                }
            }
    }

    // MARK: - Filter logic

    private var hasActiveFilters: Bool {
        !filterDifficulty.isEmpty || filterDist != nil || filterAscent != nil || filterDescent != nil
    }

    /// Свои маршруты видны и в «Мои», и в «Все» — нарисованный трек не должен
    /// пропадать из общего списка. В «Пройденные»/«Планы» их нет: этих
    /// статусов у своих маршрутов не существует.
    private var customListRoutes: [CustomRoute] {
        guard appState.filter == .mine || appState.filter == .all else { return [] }
        let routes = appState.customRouteStore.routes
        guard hasActiveFilters else { return routes }
        // Сложность своим маршрутам никто не считает, поэтому фильтр по ней
        // их отсекает целиком — иначе они лезли бы в любую выборку.
        if !filterDifficulty.isEmpty { return [] }
        return routes.filter { route in
            if let dr = filterDist, !dr.matches(route.distanceKm) { return false }
            if let ar = filterAscent {
                guard let a = route.ascentM, ar.matches(a) else { return false }
            }
            if let dr = filterDescent {
                guard let d = route.descentM, dr.matches(d) else { return false }
            }
            return true
        }
    }

    private var filteredListRoutes: [Route] {
        guard hasActiveFilters else { return appState.filteredRoutes }
        return appState.filteredRoutes.filter { route in
            guard let stats = appState.routeStats[route.id] else { return true }
            if !filterDifficulty.isEmpty && !filterDifficulty.contains(stats.difficulty) { return false }
            if let dr = filterDist, !dr.matches(stats.distance) { return false }
            if let ar = filterAscent, !ar.matches(stats.ascent) { return false }
            if let dr = filterDescent, !dr.matches(stats.descent) { return false }
            return true
        }
    }

    // MARK: - Subviews

    private var handle: some View {
        Capsule()
            .fill(Color.white.opacity(0.22))
            .frame(width: 36, height: 4)
            .padding(.top, 10)
            .padding(.bottom, 6)
    }

    private var collapsedRouteCount: Int {
        customListRoutes.count + appState.filteredRoutes.count
    }

    private var collapsedRow: some View {
        HStack(spacing: 10) {
            if sheetTab == .pss {
                Text("PSS Клуб")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(DS.textPrimary)
                Text("·").foregroundColor(DS.textTertiary)
                Text("\(appState.pssRoutes.count) \(routeWord(appState.pssRoutes.count))")
                    .font(.system(size: 13)).foregroundColor(DS.textSecondary)
            } else {
                Text("Маршруты")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(DS.textPrimary)
                Text("·").foregroundColor(DS.textTertiary)
                Text("\(collapsedRouteCount) \(routeWord(collapsedRouteCount))")
                    .font(.system(size: 13)).foregroundColor(DS.textSecondary)
            }
            Spacer()
            Image(systemName: "chevron.up")
                .font(.system(size: 12, weight: .semibold))
                .foregroundColor(DS.textTertiary)
        }
        .padding(.horizontal, 18)
        .padding(.bottom, 14)
    }

    private var tabBar: some View {
        HStack(spacing: 0) {
            tabPill("Маршруты", tab: .routes)
            tabPill("PSS Клуб", tab: .pss)
            Spacer()
            if sheetTab == .routes {
                filterToggleButton
            } else {
                pssFilterToggleButton
            }
        }
        .padding(.horizontal, 14)
    }

    private var filterToggleButton: some View {
        Button {
            withAnimation(.spring(response: 0.30, dampingFraction: 0.80)) {
                if showFilters {
                    showFilters = false
                    filterDifficulty = []
                    filterDist = nil
                    filterAscent = nil
                    filterDescent = nil
                } else {
                    showFilters = true
                }
            }
        } label: {
            HStack(spacing: 4) {
                Image(systemName: hasActiveFilters
                      ? "line.3.horizontal.decrease.circle.fill"
                      : "line.3.horizontal.decrease.circle")
                    .font(.system(size: 13, weight: .medium))
                Text(hasActiveFilters ? "Сбросить" : "Фильтры")
                    .font(.system(size: 11, weight: .medium))
            }
            .foregroundColor(hasActiveFilters ? DS.accent : DS.textTertiary)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(hasActiveFilters ? DS.accent.opacity(0.12) : Color.clear)
            .clipShape(Capsule())
            .overlay(Capsule().stroke(hasActiveFilters ? DS.accent.opacity(0.3) : DS.border, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .animation(.easeInOut(duration: 0.18), value: hasActiveFilters)
    }

    private var pssFilterToggleButton: some View {
        Button {
            withAnimation(.spring(response: 0.30, dampingFraction: 0.80)) {
                if showPSSFilters {
                    showPSSFilters = false
                    pssDiff = []; pssRegions = []
                    pssDistIdx = 0; pssDurIdx = 0; pssTypeIdx = 0
                } else {
                    showPSSFilters = true
                }
            }
        } label: {
            HStack(spacing: 4) {
                Image(systemName: hasActivePSSFilters
                      ? "line.3.horizontal.decrease.circle.fill"
                      : "line.3.horizontal.decrease.circle")
                    .font(.system(size: 13, weight: .medium))
                Text(hasActivePSSFilters ? "Сбросить" : "Фильтры")
                    .font(.system(size: 11, weight: .medium))
            }
            .foregroundColor(hasActivePSSFilters ? DS.accent : DS.textTertiary)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(hasActivePSSFilters ? DS.accent.opacity(0.12) : Color.clear)
            .clipShape(Capsule())
            .overlay(Capsule().stroke(hasActivePSSFilters ? DS.accent.opacity(0.3) : DS.border, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .animation(.easeInOut(duration: 0.18), value: hasActivePSSFilters)
    }

    private func tabPill(_ title: String, tab: SheetTab) -> some View {
        Button { withAnimation { sheetTab = tab } } label: {
            Text(title)
                .font(.system(size: 13, weight: .semibold))
                .foregroundColor(sheetTab == tab ? DS.textPrimary : DS.textTertiary)
                .padding(.horizontal, 14)
                .padding(.vertical, 7)
                .background(sheetTab == tab ? Color.white.opacity(0.10) : Color.clear)
                .clipShape(Capsule())
        }
        .buttonStyle(.plain)
    }

    // MARK: - Filter panel

    private var filterPanel: some View {
        VStack(alignment: .leading, spacing: 6) {
            filterRow(label: "Сложность") {
                ForEach(Difficulty.allCases, id: \.self) { d in
                    filterChip(d.rawValue, color: d.dsColor,
                               active: filterDifficulty.contains(d)) {
                        if filterDifficulty.contains(d) { filterDifficulty.remove(d) }
                        else { filterDifficulty.insert(d) }
                    }
                }
            }
            filterRow(label: "Дистанция") {
                ForEach(DistRange.allCases, id: \.self) { r in
                    filterChip(r.rawValue, color: DS.accent, active: filterDist == r) {
                        filterDist = filterDist == r ? nil : r
                    }
                }
            }
            filterRow(label: "Набор ↑") {
                ForEach(AscentRange.allCases, id: \.self) { r in
                    filterChip(r.rawValue, color: DS.accent, active: filterAscent == r) {
                        filterAscent = filterAscent == r ? nil : r
                    }
                }
            }
            filterRow(label: "Сброс ↓") {
                ForEach(DescentRange.allCases, id: \.self) { r in
                    filterChip(r.rawValue, color: DS.accent, active: filterDescent == r) {
                        filterDescent = filterDescent == r ? nil : r
                    }
                }
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .background(DS.glass)
    }

    // MARK: - PSS filter panel (search-style facets)

    private var pssRegionOptions: [String] {
        Array(Set(RouteMatcher.pssCandidates().compactMap { $0.region })).sorted()
    }

    private var pssFilterPanel: some View {
        VStack(alignment: .leading, spacing: 6) {
            filterRow(label: "Сложность") {
                ForEach(Difficulty.allCases, id: \.self) { d in
                    filterChip(d.rawValue, color: d.dsColor, active: pssDiff.contains(d)) {
                        if pssDiff.contains(d) { pssDiff.remove(d) } else { pssDiff.insert(d) }
                    }
                }
            }
            filterRow(label: "Дистанция") {
                ForEach(Array(pssDistLabels.enumerated()), id: \.offset) { i, label in
                    let idx = i + 1
                    filterChip(label, color: DS.accent, active: pssDistIdx == idx) {
                        pssDistIdx = pssDistIdx == idx ? 0 : idx
                    }
                }
            }
            filterRow(label: "Время") {
                ForEach(Array(pssDurLabels.enumerated()), id: \.offset) { i, label in
                    let idx = i + 1
                    filterChip(label, color: DS.accent, active: pssDurIdx == idx) {
                        pssDurIdx = pssDurIdx == idx ? 0 : idx
                    }
                }
            }
            filterRow(label: "Тип") {
                ForEach(Array(pssTypeLabels.enumerated()), id: \.offset) { i, label in
                    let idx = i + 1
                    filterChip(label, color: DS.accent, active: pssTypeIdx == idx) {
                        pssTypeIdx = pssTypeIdx == idx ? 0 : idx
                    }
                }
            }
            filterRow(label: "Регион") {
                ForEach(pssRegionOptions, id: \.self) { r in
                    filterChip(r, color: DS.accent, active: pssRegions.contains(r)) {
                        if pssRegions.contains(r) { pssRegions.remove(r) } else { pssRegions.insert(r) }
                    }
                }
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .background(DS.glass)
    }

    private func filterRow<C: View>(label: String, @ViewBuilder chips: () -> C) -> some View {
        HStack(spacing: 6) {
            Text(label)
                .font(.system(size: 10, weight: .medium))
                .foregroundColor(DS.textTertiary)
                .frame(width: 54, alignment: .leading)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 5) { chips() }
            }
        }
    }

    private func filterChip(_ title: String, color: Color, active: Bool,
                             action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 11, weight: .medium))
                .foregroundColor(active ? .white : DS.textSecondary)
                .padding(.horizontal, 10)
                .padding(.vertical, 5)
                .background(active ? color : color.opacity(0.10))
                .clipShape(Capsule())
                .overlay(Capsule().stroke(active ? color : DS.border, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .animation(.easeInOut(duration: 0.15), value: active)
    }

    // MARK: - Tab content

    @ViewBuilder
    private var tabContent: some View {
        if sheetTab == .routes {
            routeList
        } else {
            pssRouteList
        }
    }

    private var routeList: some View {
        ScrollView(showsIndicators: false) {
            LazyVStack(spacing: 0) {
                // Свои — сверху: их мало, и это то, что человек только что сделал.
                ForEach(customListRoutes) { route in
                    CustomRouteListRow(
                        route: route,
                        isSelected: appState.selectedCustomRoute?.id == route.id
                    ) {
                        withAnimation(.spring(response: 0.34, dampingFraction: 0.82)) {
                            expanded = false
                        }
                        appState.selectCustomRoute(route)
                        appState.showCustomRouteDetail = true
                    }
                    Divider().background(DS.border).padding(.leading, 50)
                }

                ForEach(filteredListRoutes) { route in
                    RouteListRow(
                        route: route,
                        stats: appState.routeStats[route.id],
                        isSelected: appState.selectedRoute?.id == route.id
                    ) {
                        withAnimation(.spring(response: 0.34, dampingFraction: 0.82)) {
                            expanded = false
                        }
                        appState.select(route)
                    }
                    Divider().background(DS.border).padding(.leading, 50)
                }

                if customListRoutes.isEmpty && filteredListRoutes.isEmpty {
                    Text(emptyListMessage)
                        .font(.system(size: 13))
                        .foregroundColor(DS.textTertiary)
                        .multilineTextAlignment(.center)
                        .frame(maxWidth: .infinity)
                        .padding(.top, 40)
                }
            }
            .padding(.bottom, 40)
        }
    }

    private var emptyListMessage: String {
        if hasActiveFilters { return "Нет маршрутов по выбранным фильтрам" }
        return "Нет сохранённых маршрутов.\nНарисуйте маршрут или запишите трек."
    }

    private var pssRouteList: some View {
        VStack(spacing: 0) {
            searchBar

            if appState.pssRoutes.isEmpty {
                Spacer()
                Text("Загрузка маршрутов ПСС…")
                    .font(.system(size: 13))
                    .foregroundColor(DS.textTertiary)
                    .padding()
                Spacer()
            } else {
                ScrollView(showsIndicators: false) {
                    LazyVStack(spacing: 0) {
                        ForEach(filteredPSS) { route in
                            PSSListRow(route: route,
                                       isSelected: appState.selectedPSSRoute?.id == route.id) {
                                appState.selectPSSRoute(route)
                                withAnimation(.spring(response: 0.34, dampingFraction: 0.82)) {
                                    expanded = false
                                }
                            }
                            Divider().background(DS.border).padding(.leading, 50)
                        }
                        if filteredPSS.isEmpty {
                            Text(hasActivePSSFilters || !pssSearch.isEmpty
                                 ? "Нет маршрутов по выбранным фильтрам"
                                 : "Нет маршрутов")
                                .font(.system(size: 13))
                                .foregroundColor(DS.textTertiary)
                                .frame(maxWidth: .infinity)
                                .padding(.top, 40)
                        }
                    }
                    .padding(.bottom, 40)
                }
            }
        }
    }

    private var searchBar: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 13, weight: .medium))
                .foregroundColor(DS.textTertiary)
            TextField("Поиск по PSS маршрутам", text: $pssSearch)
                .font(.system(size: 13))
                .foregroundColor(DS.textPrimary)
                .tint(DS.accent)
            if !pssSearch.isEmpty {
                Button { pssSearch = "" } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 13))
                        .foregroundColor(DS.textTertiary)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 9)
        .background(DS.glass)
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(DS.border, lineWidth: 1))
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
    }

    private var hasActivePSSFilters: Bool {
        !pssDiff.isEmpty || !pssRegions.isEmpty || pssDistIdx != 0 || pssDurIdx != 0 || pssTypeIdx != 0
    }

    private var pssDistRange: (min: Double?, max: Double?) {
        switch pssDistIdx {
        case 1: return (nil, 10); case 2: return (10, 20)
        case 3: return (20, 35); case 4: return (35, nil)
        default: return (nil, nil)
        }
    }

    private var pssDurRange: (min: Double?, max: Double?) {
        switch pssDurIdx {
        case 1: return (nil, 4); case 2: return (4, 8); case 3: return (8, nil)
        default: return (nil, nil)
        }
    }

    private var pssTypeCategories: Set<String> {
        switch pssTypeIdx {
        case 1: return ["kružna"]; case 2: return ["linijska"]
        case 3: return ["transverzala", "E-transverzala"]
        default: return []
        }
    }

    private var filteredPSS: [PSSRoute] {
        var list = appState.pssRoutes
        if !pssSearch.isEmpty {
            let q = pssSearch.lowercased()
            list = list.filter { $0.name.lowercased().contains(q) }
        }
        guard hasActivePSSFilters else { return list }

        let dist = pssDistRange, dur = pssDurRange, cats = pssTypeCategories
        return list.filter { route in
            if !pssDiff.isEmpty, !pssDiff.contains(route.difficulty) { return false }
            if let mx = dist.max, route.distanceKm > mx { return false }
            if let mn = dist.min, route.distanceKm < mn { return false }

            let cand = RouteMatcher.pssCandidate(id: route.id)
            if !pssRegions.isEmpty {
                guard let r = cand?.region, pssRegions.contains(r) else { return false }
            }
            if !cats.isEmpty {
                guard let c = cand?.category, cats.contains(c) else { return false }
            }
            if dur.min != nil || dur.max != nil {
                guard let t = cand?.durationH else { return false }
                if let mx = dur.max, t > mx { return false }
                if let mn = dur.min, t < mn { return false }
            }
            return true
        }
    }

    private func routeWord(_ n: Int) -> String {
        switch n % 10 {
        case 1 where n % 100 != 11: return "маршрут"
        case 2...4 where !(11...14).contains(n % 100): return "маршрута"
        default: return "маршрутов"
        }
    }

    private var sheetBg: some View {
        ZStack {
            Color(red: 0.06, green: 0.06, blue: 0.06)
            Color.white.opacity(0.03)
        }
    }
}

// MARK: - Route row

private struct RouteListRow: View {
    let route: Route
    let stats: RouteStats?
    let isSelected: Bool
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 12) {
                Circle()
                    .fill(route.isPlanned ? DS.planned : DS.completed)
                    .frame(width: 10, height: 10)
                    .padding(.leading, 18)

                VStack(alignment: .leading, spacing: 2) {
                    Text(route.name)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundColor(DS.textPrimary)
                        .lineLimit(1)
                    if let stats {
                        HStack(spacing: 6) {
                            Text(String(format: "%.1f км", stats.distance))
                                .font(.system(size: 12))
                                .foregroundColor(DS.textSecondary)
                            Text("↑\(Int(stats.ascent))м")
                                .font(.system(size: 12))
                                .foregroundColor(DS.textSecondary)
                            Text("↓\(Int(stats.descent))м")
                                .font(.system(size: 12))
                                .foregroundColor(DS.textSecondary)
                            difficultyDot(stats.difficulty)
                        }
                    }
                }

                Spacer()

                if let date = route.formattedDate {
                    Text(date)
                        .font(.system(size: 11))
                        .foregroundColor(DS.textTertiary)
                        .lineLimit(1)
                        .padding(.trailing, 4)
                }

                Image(systemName: "chevron.right")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundColor(DS.textTertiary)
                    .padding(.trailing, 18)
            }
            .padding(.vertical, 12)
            .background(isSelected ? Color.white.opacity(0.05) : Color.clear)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func difficultyDot(_ d: Difficulty) -> some View {
        Circle()
            .fill(d.dsColor)
            .frame(width: 6, height: 6)
    }
}

// MARK: - Custom route row (Мои)

private struct CustomRouteListRow: View {
    let route: CustomRoute
    let isSelected: Bool
    let onTap: () -> Void

    private let purple = Color(hex: "#7B5EA7")

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 12) {
                Image(systemName: "pencil")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundColor(purple)
                    .frame(width: 20)
                    .padding(.leading, 18)

                VStack(alignment: .leading, spacing: 2) {
                    Text(route.name)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundColor(DS.textPrimary)
                        .lineLimit(1)
                    HStack(spacing: 6) {
                        Text(String(format: "%.1f км", route.distanceKm))
                            .font(.system(size: 12))
                            .foregroundColor(DS.textSecondary)
                        if let ascent = route.ascentM {
                            Text("↑\(Int(ascent))м")
                                .font(.system(size: 12))
                                .foregroundColor(DS.textSecondary)
                        }
                    }
                }

                Spacer()

                Image(systemName: "chevron.right")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundColor(DS.textTertiary)
                    .padding(.trailing, 18)
            }
            .padding(.vertical, 12)
            .background(isSelected ? Color.white.opacity(0.05) : Color.clear)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

// MARK: - PSS route row

private struct PSSListRow: View {
    let route: PSSRoute
    let isSelected: Bool
    let onTap: () -> Void

    private let pssOrange = Color(hex: "#FF8C1A")

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 12) {
                Image(systemName: "figure.hiking")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundColor(pssOrange)
                    .frame(width: 20)
                    .padding(.leading, 18)

                VStack(alignment: .leading, spacing: 3) {
                    Text(route.name)
                        .font(.system(size: 13, weight: .medium))
                        .foregroundColor(DS.textPrimary)
                        .lineLimit(2)
                    HStack(spacing: 6) {
                        Text(String(format: "%.1f км", route.distanceKm))
                            .font(.system(size: 11))
                            .foregroundColor(DS.textSecondary)
                        if route.ascent > 0 {
                            Text("↑\(Int(route.ascent))м")
                                .font(.system(size: 11))
                                .foregroundColor(DS.textSecondary)
                        }
                        difficultyDot(route.difficulty)
                    }
                }

                Spacer()

                Image(systemName: "chevron.right")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundColor(DS.textTertiary)
                    .padding(.trailing, 18)
            }
            .padding(.vertical, 11)
            .background(isSelected ? Color.white.opacity(0.05) : Color.clear)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func difficultyDot(_ d: Difficulty) -> some View {
        Circle()
            .fill(d.dsColor)
            .frame(width: 5, height: 5)
    }
}
