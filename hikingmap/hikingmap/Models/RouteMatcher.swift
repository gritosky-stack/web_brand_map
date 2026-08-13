import Foundation
import CoreLocation

// MARK: - Candidate model
//
// A source-agnostic route the matcher can rank. PSS routes come from the
// bundled enriched index (routes_index.json); curated routes are bridged from
// RouteStore + RouteStats by the caller. Same engine ranks both.

enum CandidateSource { case pss, curated }

struct MatchCandidate {
    let id: String              // PSS slug or curated Route.id
    let name: String
    let distanceKm: Double
    let ascentM: Double?
    let durationH: Double?
    let difficulty: Difficulty
    let region: String?
    let mountain: String?
    let category: String?       // "kružna" / "transverzala" / ...
    let start: CLLocationCoordinate2D?
    let source: CandidateSource
}

struct MatchResult {
    let candidate: MatchCandidate
    let score: Double
    let reasons: [String]
}

// MARK: - Engine

enum RouteMatcher {

    // ---- normalisation: lowercase, fold diacritics, transliterate Cyrillic ----
    private static let cyr: [Character: String] = [
        "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "ђ": "dj", "е": "e", "ж": "z",
        "з": "z", "и": "i", "й": "i", "ј": "j", "к": "k", "л": "l", "љ": "lj", "м": "m",
        "н": "n", "њ": "nj", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t", "ћ": "c",
        "у": "u", "ф": "f", "х": "h", "ц": "c", "ч": "c", "џ": "dz", "ш": "s", "щ": "s",
        "ъ": "", "ы": "i", "ь": "", "э": "e", "ю": "u", "я": "a",
    ]

    static func norm(_ s: String) -> String {
        let folded = s.lowercased().folding(options: .diacriticInsensitive,
                                            locale: Locale(identifier: "en"))
        var out = ""
        for ch in folded {
            if let rep = cyr[ch] { out += rep }
            else if ch == "đ" { out += "dj" }
            else { out.append(ch) }
        }
        return out
    }

    // ---- difficulty synonyms (multi-lingual) -> Difficulty ----
    private static let difficultyWords: [(Difficulty, [String])] = [
        (.easy,   ["lak", "lagan", "lako", "laku", "lake", "easy", "lahka",
                   "legk", "lyogk", "nesloz", "prost", "pocetni", "nacetnic", "blaga"]),
        (.medium, ["umeren", "srednj", "moderate", "sredn"]),
        (.hard,   ["tezak", "tesk", "zahtevn", "hard", "tjazel", "tyazh", "naporn"]),
        (.expert, ["vrlo tezak", "vrlo tesk", "very hard", "ekstrem", "najtez",
                   "ocen sloz", "ochen slozh", "transverzal"]),
    ]

    // ---- gazetteer: place -> (lon, lat) (major SRB cities + hiking hubs) ----
    private static let places: [String: (lon: Double, lat: Double)] = [
        "beograd": (20.457, 44.787), "belgrad": (20.457, 44.787), "novi sad": (19.833, 45.267),
        "nis": (21.896, 43.321), "kragujevac": (20.917, 44.013), "kraljevo": (20.689, 43.726),
        "cacak": (20.349, 43.891), "uzice": (19.842, 43.857), "valjevo": (19.89, 44.275),
        "sabac": (19.69, 44.755), "loznica": (19.224, 44.533), "zajecar": (22.27, 43.904),
        "bor": (22.097, 44.075), "vranje": (21.9, 42.551), "leskovac": (21.946, 42.998),
        "pirot": (22.586, 43.153), "sokobanja": (21.873, 43.644), "arandjelovac": (20.56, 44.308),
        "jagodina": (21.261, 43.977), "paracin": (21.408, 43.86), "knjazevac": (22.258, 43.567),
        "prijepolje": (19.651, 43.39), "nova varos": (19.81, 43.46), "sjenica": (20.0, 43.27),
        "ivanjica": (20.23, 43.58), "gornji milanovac": (20.46, 44.025), "bajina basta": (19.567, 43.972),
        "ljubovija": (19.371, 44.187), "zlatibor": (19.7, 43.73), "sremska mitrovica": (19.61, 44.977),
        "subotica": (19.665, 46.1), "pozarevac": (21.186, 44.617), "smederevo": (20.93, 44.663),
        "cuprija": (21.38, 43.93), "gadzin han": (22.03, 43.23),
    ]

    // ---- parsed query ----
    struct Filters {
        var difficulty = Set<Difficulty>()
        var regions = Set<String>()
        var mountains = Set<String>()
        var distanceMin: Double?
        var distanceMax: Double?
        var durationMin: Double?
        var durationMax: Double?
        var near: (center: (lon: Double, lat: Double), radiusKm: Double, place: String)?
        var loop = false
        var categories = Set<String>()   // structured facet on route.category
        var anyFilter: Bool {
            !difficulty.isEmpty || !regions.isEmpty || !mountains.isEmpty ||
            distanceMin != nil || distanceMax != nil || durationMin != nil ||
            durationMax != nil || near != nil || loop || !categories.isEmpty
        }
    }

    private static func contains(_ haystack: String, _ needle: String) -> Bool {
        haystack.range(of: needle) != nil
    }

    private static func firstInt(_ s: String, _ pattern: String) -> Double? {
        guard let re = try? NSRegularExpression(pattern: pattern) else { return nil }
        let r = NSRange(s.startIndex..., in: s)
        guard let m = re.firstMatch(in: s, range: r), m.numberOfRanges >= 2,
              let g = Range(m.range(at: 1), in: s) else { return nil }
        return Double(s[g])
    }

    private static func findNear(_ q: String) -> String? {
        let tokens = q.split(whereSeparator: { !$0.isLetter }).map(String.init).filter { $0.count >= 3 }
        var best: String?
        for key in places.keys {
            var hit = false
            if key.contains(" ") {
                hit = contains(q, key) || contains(q, key.split(separator: " ").first.map(String.init)! + " ")
            } else {
                hit = tokens.contains { t in
                    if t == key { return true }
                    guard key.count >= 5, t.count >= 5 else { return false }
                    return t.prefix(5) == key.prefix(5) && abs(t.count - key.count) <= 4
                }
            }
            if hit, best == nil || key.count > best!.count { best = key }
        }
        return best
    }

    // Generic words shared across massif names — ignored when stem-matching.
    private static let mtnStop: Set<String> = ["planina", "planine", "gora", "gore", "vrh", "i", "na", "srbija"]

    // Match massif names tolerant of case endings ("Тару"->Tara, "Suvoj"->Suva)
    // via a prefix-stem comparison of query tokens against significant words.
    private static func matchMountains(_ q: String, _ mountains: [String]) -> [String] {
        let tokens = q.split(whereSeparator: { !$0.isLetter }).map(String.init).filter { $0.count >= 3 }
        var hits: [String] = []
        for m in mountains {
            let nm = norm(m)
            if nm.count >= 4, contains(q, nm) { hits.append(m); continue }   // full name present
            let words = nm.split(whereSeparator: { !$0.isLetter }).map(String.init)
                .filter { $0.count >= 3 && !mtnStop.contains($0) }
            let ok = words.contains { w in
                let wc = Array(w)
                return tokens.contains { t in
                    let tc = Array(t)
                    let n = min(tc.count, wc.count)
                    var p = 0
                    while p < n && tc[p] == wc[p] { p += 1 }
                    if p >= 4 { return true }
                    return wc.count <= 4 && p >= 3 && p >= wc.count - 1
                }
            }
            if ok { hits.append(m) }
        }
        return hits
    }

    static func parse(_ query: String, regions: [String], mountains: [String]) -> Filters {
        let q = " " + norm(query) + " "
        var f = Filters()

        for (diff, words) in difficultyWords where words.contains(where: { contains(q, $0) }) {
            f.difficulty.insert(diff)
        }
        if contains(q, "sloz") && !contains(q, "nesloz") { f.difficulty.insert(.hard) }

        // distance: range / max / min
        if let re = try? NSRegularExpression(pattern: #"(\d{1,3})\s*[-–]\s*(\d{1,3})\s*km"#) {
            let r = NSRange(q.startIndex..., in: q)
            if let m = re.firstMatch(in: q, range: r),
               let g1 = Range(m.range(at: 1), in: q), let g2 = Range(m.range(at: 2), in: q) {
                f.distanceMin = Double(q[g1]); f.distanceMax = Double(q[g2])
            }
        }
        if f.distanceMax == nil {
            f.distanceMax = firstInt(q, #"(?:do|<|manje od|ispod|maks\w*|max|menee|mense)\s*(\d{1,3})\s*km"#)
        }
        f.distanceMin = f.distanceMin ?? firstInt(q, #"(?:preko|>|vise od|iznad|min\w*|od|bolee|bolse|ot)\s*(\d{1,3})\s*km"#)

        // qualitative length
        if f.distanceMax == nil, q.range(of: #"kratk|short|korot|korat"#, options: .regularExpression) != nil { f.distanceMax = 10 }
        if f.distanceMin == nil, q.range(of: #"\bdug|long|dlinn"#, options: .regularExpression) != nil { f.distanceMin = 20 }

        // duration
        if q.range(of: #"vikend|weekend|vihodn|visednevn|mnogodnevn"#, options: .regularExpression) != nil { f.durationMin = 6 }
        if q.range(of: #"pola dana|poldnevn|half day|poldna"#, options: .regularExpression) != nil { f.durationMax = 4 }
        if let h = firstInt(q, #"(\d{1,2})\s*(?:h|sat|cas|hour)"#) { f.durationMin = h - 1.5; f.durationMax = h + 1.5 }

        if q.range(of: #"kruzn|loop|krug|polukruzn"#, options: .regularExpression) != nil { f.loop = true }

        // near place (+ optional radius)
        if let place = findNear(q) {
            let radius = firstInt(q, #"(\d{1,3})\s*km\s*(?:od|ot|from)"#) ?? 50
            f.near = (center: places[place]!, radiusKm: radius, place: place)
        }

        for r in regions where contains(q, norm(r)) { f.regions.insert(r) }
        for m in matchMountains(q, mountains) { f.mountains.insert(m) }

        return f
    }

    private static func haversineKm(_ a: (lon: Double, lat: Double), _ b: CLLocationCoordinate2D) -> Double {
        let R = 6371.0, toRad = Double.pi / 180
        let dLat = (b.latitude - a.lat) * toRad, dLon = (b.longitude - a.lon) * toRad
        let s = sin(dLat / 2) * sin(dLat / 2) +
            cos(a.lat * toRad) * cos(b.latitude * toRad) * sin(dLon / 2) * sin(dLon / 2)
        return 2 * R * asin(min(1, sqrt(s)))
    }

    private static func cap(_ s: String) -> String { s.prefix(1).uppercased() + s.dropFirst() }

    private static func score(_ c: MatchCandidate, _ f: Filters) -> (Double, [String]) {
        var score = 0.0
        var reasons: [String] = []

        if !f.difficulty.isEmpty {
            if f.difficulty.contains(c.difficulty) { score += 5; reasons.append(c.difficulty.rawValue) }
            else { score -= 4 }
        }
        if f.distanceMax != nil || f.distanceMin != nil {
            let d = c.distanceKm
            let okMax = f.distanceMax == nil || d <= f.distanceMax!
            let okMin = f.distanceMin == nil || d >= f.distanceMin!
            if okMax && okMin { score += 3; reasons.append(String(format: "%.1f км", d)) }
            else {
                let over = okMax ? (f.distanceMin! - d) : (d - f.distanceMax!)
                score -= min(5, over / 5)
            }
        }
        if f.durationMax != nil || f.durationMin != nil, let t = c.durationH {
            let okt = (f.durationMax == nil || t <= f.durationMax!) && (f.durationMin == nil || t >= f.durationMin!)
            if okt { score += 2; reasons.append(String(format: "~%.1f ч", t)) } else { score -= 1.5 }
        }
        if !f.mountains.isEmpty, let m = c.mountain, f.mountains.contains(m) { score += 6; reasons.append(m) }
        if !f.regions.isEmpty, let r = c.region, f.regions.contains(r) { score += 4; reasons.append(r) }
        if let near = f.near, let start = c.start {
            let km = haversineKm(near.center, start)
            if km <= near.radiusKm { score += 4 * (1 - km / near.radiusKm); reasons.append("\(Int(km.rounded())) км от \(cap(near.place))") }
            else { score -= min(5, (km - near.radiusKm) / 25) }
        }
        if f.loop, c.category == "kružna" { score += 2; reasons.append("кольцевой") }
        if !f.categories.isEmpty {
            if let cat = c.category, f.categories.contains(cat) { score += 4; reasons.append(catLabel(cat)) }
            else { score -= 3 }
        }

        return (score, reasons)
    }

    /// Hard AND predicate for structured / faceted filters. Every *active* facet
    /// must be satisfied for the candidate to pass; an unknown value (nil) fails
    /// any facet that is active. This is what makes the count narrow monotonically
    /// as the user adds facets — unlike the soft scoring used for free text.
    static func passes(_ c: MatchCandidate, _ f: Filters) -> Bool {
        if !f.difficulty.isEmpty, !f.difficulty.contains(c.difficulty) { return false }
        if !f.regions.isEmpty {
            guard let r = c.region, f.regions.contains(r) else { return false }
        }
        if !f.mountains.isEmpty {
            guard let m = c.mountain, f.mountains.contains(m) else { return false }
        }
        if !f.categories.isEmpty {
            guard let cat = c.category, f.categories.contains(cat) else { return false }
        }
        if let mx = f.distanceMax, c.distanceKm > mx { return false }
        if let mn = f.distanceMin, c.distanceKm < mn { return false }
        if f.durationMin != nil || f.durationMax != nil {
            guard let t = c.durationH else { return false }
            if let mx = f.durationMax, t > mx { return false }
            if let mn = f.durationMin, t < mn { return false }
        }
        if f.loop, c.category != "kružna" { return false }
        if let near = f.near {
            guard let start = c.start, haversineKm(near.center, start) <= near.radiusKm else { return false }
        }
        return true
    }

    static func catLabel(_ c: String) -> String {
        switch c {
        case "kružna": return "кольцевой"
        case "linijska": return "линейный"
        case "transverzala", "E-transverzala": return "трансверзала"
        default: return c
        }
    }

    private static func rank(_ f: Filters, _ candidates: [MatchCandidate], _ limit: Int) -> [MatchResult] {
        var scored = candidates.map { c -> MatchResult in
            let (s, r) = score(c, f)
            return MatchResult(candidate: c, score: s, reasons: r)
        }
        if f.anyFilter {
            scored.sort { $0.score != $1.score ? $0.score > $1.score : $0.candidate.distanceKm < $1.candidate.distanceKm }
            let positive = scored.filter { $0.score > 0 }
            if positive.count >= 3 { scored = positive }
        } else {
            scored.sort { $0.candidate.distanceKm < $1.candidate.distanceKm }
        }
        return Array(scored.prefix(limit))
    }

    /// Rank candidates against a free-text query.
    static func match(query: String, candidates: [MatchCandidate], limit: Int = 5) -> (filters: Filters, results: [MatchResult]) {
        let regions = Array(Set(candidates.compactMap { $0.region }))
        let mountains = Array(Set(candidates.compactMap { $0.mountain }))
        let f = parse(query, regions: regions, mountains: mountains)
        return (f, rank(f, candidates, limit))
    }

    /// Rank candidates against an explicit (structured / faceted) filter set.
    /// Every active facet is a hard AND constraint: candidates must pass all of
    /// them, then the survivors are ordered by score (best fit first) and distance.
    static func match(filters f: Filters, candidates: [MatchCandidate], limit: Int = 5) -> [MatchResult] {
        var scored = candidates.filter { passes($0, f) }.map { c -> MatchResult in
            let (s, r) = score(c, f)
            return MatchResult(candidate: c, score: s, reasons: r)
        }
        scored.sort { $0.score != $1.score ? $0.score > $1.score : $0.candidate.distanceKm < $1.candidate.distanceKm }
        return Array(scored.prefix(limit))
    }
}

// MARK: - PSS index loader (bundled enriched routes_index.json)

extension RouteMatcher {
    private struct IndexEntry: Decodable {
        let slug: String
        let name: String
        let distance_km: Double?
        let ascent_m: Double?
        let duration_h: Double?
        let difficulty: String?
        let category: String?
        let region: String?
        let mountain: String?
        let start: [Double]?
    }

    private static func difficulty(from serbian: String?) -> Difficulty {
        switch serbian {
        case "lak": return .easy
        case "umeren": return .medium
        case "težak": return .hard
        default: return .expert  // "vrlo težak", "višednevna transverzala", nil
        }
    }

    /// PSS candidates from the bundled index. Cached after first load.
    static func pssCandidates() -> [MatchCandidate] {
        if let cached = _pssCache { return cached }
        guard let url = Bundle.main.url(forResource: "routes_index", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let entries = try? JSONDecoder().decode([IndexEntry].self, from: data) else {
            _pssCache = []
            return []
        }
        let result = entries.map { e -> MatchCandidate in
            let start = (e.start?.count == 2) ? CLLocationCoordinate2D(latitude: e.start![1], longitude: e.start![0]) : nil
            return MatchCandidate(
                id: e.slug, name: e.name, distanceKm: e.distance_km ?? 0,
                ascentM: e.ascent_m, durationH: e.duration_h,
                difficulty: difficulty(from: e.difficulty),
                region: e.region, mountain: e.mountain, category: e.category,
                start: start, source: .pss)
        }
        _pssCache = result
        return result
    }

    /// Enriched PSS candidate (region / category / duration / mountain) by slug id.
    static func pssCandidate(id: String) -> MatchCandidate? {
        if _pssByID == nil {
            _pssByID = Dictionary(pssCandidates().map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        }
        return _pssByID?[id]
    }
}

private var _pssCache: [MatchCandidate]?
private var _pssByID: [String: MatchCandidate]?
