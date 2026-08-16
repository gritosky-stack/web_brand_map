import CoreLocation

/// Офлайн-граф пешеходных троп.
///
/// Собирается из отрезков — маршруты PSS из бандла плюс тропы, вытащенные
/// из загруженных векторных тайлов, — и ищет по нему путь алгоритмом A*.
/// Нужен там, где сетевого роутера нет: в горах это обычное дело, а рисовать
/// маршрут по тропам хочется и без сети.
final class TrailGraph: @unchecked Sendable {
    typealias Segment = TrailSnapService.Segment

    /// Сетка склейки узлов, ~1.1 м. Тайл квантует геометрию по своему экстенту,
    /// и один и тот же узел OSM в соседних тайлах приезжает чуть разным —
    /// без округления граф рассыпается на несвязанные кусочки линий.
    private static let gridDeg = 1e-5
    /// На границе тайла линия обрывается. Свободные концы, оказавшиеся ближе
    /// этого, сшиваем — иначе путь не пройдёт из тайла в соседний тайл.
    private static let looseEndJoinMeters = 20.0
    /// Ячейка хеш-сетки для поиска соседних свободных концов (~33 м).
    private static let bucketDeg = 3e-4
    /// Предохранитель: на разорванной сети A* иначе перебирает весь граф.
    private static let maxSettledNodes = 250_000

    private struct Key: Hashable { let x: Int32; let y: Int32 }

    private var positions: [CLLocationCoordinate2D] = []
    private var adjacency: [[(node: Int32, cost: Double)]] = []
    private var nodeByKey: [Key: Int32] = [:]
    /// Рёбра парами узлов — по ним ищем, куда сесть произвольной точке.
    private var edges: [(a: Int32, b: Int32)] = []

    var isEmpty: Bool { edges.isEmpty }
    var nodeCount: Int { positions.count }
    var edgeCount: Int { edges.count }

    // MARK: - Сборка

    init(segments: [Segment]) {
        positions.reserveCapacity(segments.count)
        adjacency.reserveCapacity(segments.count)
        edges.reserveCapacity(segments.count)

        // Буферы соседних тайлов перекрываются, и одно ребро приезжает дважды
        var seenEdges = Set<Int64>()
        seenEdges.reserveCapacity(segments.count)

        for (a, b) in segments {
            let ia = node(for: a)
            let ib = node(for: b)
            guard ia != ib else { continue }
            let lo = Int64(min(ia, ib)), hi = Int64(max(ia, ib))
            guard seenEdges.insert(lo << 32 | hi).inserted else { continue }

            let cost = TrailGraph.meters(positions[Int(ia)], positions[Int(ib)])
            adjacency[Int(ia)].append((ib, cost))
            adjacency[Int(ib)].append((ia, cost))
            edges.append((ia, ib))
        }

        joinLooseEnds()
    }

    private func node(for c: CLLocationCoordinate2D) -> Int32 {
        let key = Key(x: Int32((c.longitude / TrailGraph.gridDeg).rounded()),
                      y: Int32((c.latitude  / TrailGraph.gridDeg).rounded()))
        if let existing = nodeByKey[key] { return existing }
        let idx = Int32(positions.count)
        nodeByKey[key] = idx
        positions.append(c)
        adjacency.append([])
        return idx
    }

    /// Сшивает висящие концы: разрывы на границах тайлов и мелкие
    /// расхождения между тем же путём из разных источников.
    private func joinLooseEnds() {
        var loose: [Int32] = []
        for i in 0..<adjacency.count where adjacency[i].count == 1 { loose.append(Int32(i)) }
        guard loose.count > 1 else { return }

        var buckets: [Key: [Int32]] = [:]
        for i in loose { buckets[bucketKey(positions[Int(i)]), default: []].append(i) }

        for i in loose {
            let k = bucketKey(positions[Int(i)])
            for dx in -1...1 {
                for dy in -1...1 {
                    guard let bucket = buckets[Key(x: k.x + Int32(dx), y: k.y + Int32(dy))]
                    else { continue }
                    for j in bucket where j > i {
                        let d = TrailGraph.meters(positions[Int(i)], positions[Int(j)])
                        guard d <= TrailGraph.looseEndJoinMeters else { continue }
                        adjacency[Int(i)].append((j, d))
                        adjacency[Int(j)].append((i, d))
                    }
                }
            }
        }
    }

    private func bucketKey(_ c: CLLocationCoordinate2D) -> Key {
        Key(x: Int32((c.longitude / TrailGraph.bucketDeg).rounded(.down)),
            y: Int32((c.latitude  / TrailGraph.bucketDeg).rounded(.down)))
    }

    // MARK: - Привязка точки к сети

    private struct Anchor {
        let point: CLLocationCoordinate2D
        let edge: Int
        let a: Int32
        let b: Int32
        let toA: Double
        let toB: Double
    }

    /// Ближайшая точка сети к произвольной — вместе с ребром, на которое села.
    private func anchor(for p: CLLocationCoordinate2D, maxMeters: Double) -> Anchor? {
        var bestDist = maxMeters
        var best: Anchor?

        // Грубый отсев по «коробке»: честное расстояние до сотни тысяч рёбер
        // на каждый тап считать незачем.
        let dLat = maxMeters / 110_540.0
        let dLon = maxMeters / (111_320.0 * max(0.2, cos(p.latitude * .pi / 180)))

        for (i, e) in edges.enumerated() {
            let pa = positions[Int(e.a)], pb = positions[Int(e.b)]
            if min(pa.latitude, pb.latitude)   > p.latitude  + dLat { continue }
            if max(pa.latitude, pb.latitude)   < p.latitude  - dLat { continue }
            if min(pa.longitude, pb.longitude) > p.longitude + dLon { continue }
            if max(pa.longitude, pb.longitude) < p.longitude - dLon { continue }

            let candidate = TrailSnapService.nearestPointOnSegment(p: p, a: pa, b: pb)
            let d = TrailGraph.meters(p, candidate)
            guard d < bestDist else { continue }
            bestDist = d
            best = Anchor(point: candidate, edge: i, a: e.a, b: e.b,
                          toA: TrailGraph.meters(candidate, pa),
                          toB: TrailGraph.meters(candidate, pb))
        }
        return best
    }

    // MARK: - Поиск пути

    /// Путь по тропам между двумя произвольными точками, либо nil, если сеть
    /// до них не дотягивается или обход выходит абсурдно длинным.
    func path(from start: CLLocationCoordinate2D,
              to end: CLLocationCoordinate2D,
              maxSnapMeters: Double = 200,
              maxDetourFactor: Double = 8) -> [CLLocationCoordinate2D]? {
        guard !edges.isEmpty,
              let source = anchor(for: start, maxMeters: maxSnapMeters),
              let target = anchor(for: end,   maxMeters: maxSnapMeters)
        else { return nil }

        // Обе точки сели на одно ребро — идти по нему, и всё
        if source.edge == target.edge { return [source.point, target.point] }

        let straight = TrailGraph.meters(source.point, target.point)
        let limit = straight * maxDetourFactor + 3000

        var g      = [Double](repeating: .infinity, count: positions.count)
        var parent = [Int32](repeating: -1, count: positions.count)
        var closed = [Bool](repeating: false, count: positions.count)
        var heap   = MinHeap()

        // Стартовать можно с любого конца ребра, на которое села точка
        for (node, cost) in [(source.a, source.toA), (source.b, source.toB)] {
            guard cost < g[Int(node)] else { continue }
            g[Int(node)] = cost
            heap.push(node: node, priority: cost + TrailGraph.meters(positions[Int(node)], target.point))
        }

        // Финишем считается любой конец целевого ребра плюс добор по нему
        var goalCost: [Int32: Double] = [target.a: target.toA]
        goalCost[target.b] = min(goalCost[target.b] ?? .infinity, target.toB)

        var bestTotal = Double.infinity
        var bestNode: Int32 = -1
        var settled = 0

        while let top = heap.pop() {
            // f — нижняя оценка полного пути через этот узел: дальше только хуже
            if top.priority >= min(bestTotal, limit) { break }
            let n = Int(top.node)
            if closed[n] { continue }
            closed[n] = true
            settled += 1
            if settled > TrailGraph.maxSettledNodes { break }

            if let extra = goalCost[top.node] {
                let total = g[n] + extra
                if total < bestTotal { bestTotal = total; bestNode = top.node }
            }

            for (next, cost) in adjacency[n] {
                let ni = Int(next)
                guard !closed[ni] else { continue }
                let tentative = g[n] + cost
                guard tentative < g[ni] else { continue }
                g[ni] = tentative
                parent[ni] = top.node
                heap.push(node: next,
                          priority: tentative + TrailGraph.meters(positions[ni], target.point))
            }
        }

        guard bestNode >= 0, bestTotal <= limit else { return nil }

        var chain: [Int32] = []
        var cursor = bestNode
        while cursor >= 0 {
            chain.append(cursor)
            cursor = parent[Int(cursor)]
        }
        chain.reverse()

        var result: [CLLocationCoordinate2D] = [source.point]
        result.append(contentsOf: chain.map { positions[Int($0)] })
        result.append(target.point)
        return TrailGraph.dedupe(result)
    }

    // MARK: - Геометрия

    /// Плоское приближение: в горячем цикле A* честная гаверсинуса не нужна.
    static func meters(_ a: CLLocationCoordinate2D, _ b: CLLocationCoordinate2D) -> Double {
        TrailSnapService.planarMeters(a, b)
    }

    private static func dedupe(_ coords: [CLLocationCoordinate2D]) -> [CLLocationCoordinate2D] {
        var out: [CLLocationCoordinate2D] = []
        out.reserveCapacity(coords.count)
        for c in coords {
            if let last = out.last, meters(last, c) < 0.5 { continue }
            out.append(c)
        }
        return out
    }
}

// MARK: - Куча

private struct MinHeap {
    private var items: [(node: Int32, priority: Double)] = []

    mutating func push(node: Int32, priority: Double) {
        items.append((node, priority))
        var i = items.count - 1
        while i > 0 {
            let parent = (i - 1) / 2
            guard items[i].priority < items[parent].priority else { break }
            items.swapAt(i, parent)
            i = parent
        }
    }

    mutating func pop() -> (node: Int32, priority: Double)? {
        guard let first = items.first else { return nil }
        let last = items.removeLast()
        if !items.isEmpty {
            items[0] = last
            var i = 0
            while true {
                let l = 2 * i + 1, r = 2 * i + 2
                var smallest = i
                if l < items.count, items[l].priority < items[smallest].priority { smallest = l }
                if r < items.count, items[r].priority < items[smallest].priority { smallest = r }
                guard smallest != i else { break }
                items.swapAt(i, smallest)
                i = smallest
            }
        }
        return first
    }
}

// MARK: - Кэш

/// Граф дорог в сборке — сотня тысяч отрезков, — поэтому держим собранный
/// до смены набора троп: карта поднимает `token`, когда подвезла новые.
actor TrailGraphCache {
    static let shared = TrailGraphCache()

    private var cached: TrailGraph?
    private var cachedToken = Int.min

    func graph(for segments: [TrailGraph.Segment], token: Int) -> TrailGraph {
        if let cached, cachedToken == token { return cached }
        let built = TrailGraph(segments: segments)
        cached = built
        cachedToken = token
        return built
    }
}
