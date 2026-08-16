import Foundation
import Combine
import Supabase

/// Маршруты пользователя в облаке.
///
/// Это резервная копия с переездом на новое устройство, а не полноценная
/// синхронизация: разрешение конфликтов — «чья правка свежее, та и права»
/// по `updated_at`. Удаление уходит на сервер сразу, поэтому удаление
/// в офлайне на другом устройстве не разъедется — но и не догонит.
///
/// Сам маршрут едет целиком в колонку `payload` (jsonb): `CustomRoute` уже
/// `Codable`, а дублировать его поля колонками значило бы держать две схемы
/// синхронными руками. Отдельными колонками вынесено только то, по чему
/// осмысленно фильтровать и сортировать на стороне базы.
@MainActor
final class RouteSync: ObservableObject {
    static let shared = RouteSync()

    @Published private(set) var isSyncing = false
    @Published private(set) var lastSyncedAt: Date?

    private let store = CustomRouteStore.shared
    private var client: SupabaseClient? { AccountService.shared.client }
    private var isSignedIn: Bool { AccountService.shared.state == .signedIn }

    private init() {}

    private struct RouteRow: Codable {
        let id: String
        let name: String
        let distance_km: Double
        let recorded_at: Date
        let updated_at: Date
        let payload: CustomRoute
    }

    // MARK: - Синхронизация

    func sync() async {
        guard let client, isSignedIn, !isSyncing else { return }
        isSyncing = true
        defer { isSyncing = false }

        do {
            let remote: [RouteRow] = try await client
                .from("routes")
                .select()
                .execute()
                .value

            var merged = Dictionary(uniqueKeysWithValues: store.routes.map { ($0.id, $0) })

            // Сначала тянем чужое: всё, чего на устройстве нет или что там старее
            for row in remote {
                let local = merged[row.id]
                let localStamp = local?.updatedAt ?? local?.date
                if local == nil || (localStamp ?? .distantPast) < row.updated_at {
                    var route = row.payload
                    route.updatedAt = row.updated_at
                    merged[row.id] = route
                }
            }

            let remoteById = Dictionary(uniqueKeysWithValues: remote.map { ($0.id, $0) })
            store.replaceAll(merged.values.sorted { $0.date > $1.date })

            // Потом отдаём своё: то, чего на сервере нет или что там старее
            let toPush = store.routes.filter { route in
                guard let row = remoteById[route.id] else { return true }
                return (route.updatedAt ?? route.date) > row.updated_at
            }
            if !toPush.isEmpty {
                try await client.from("routes").upsert(toPush.map(Self.row)).execute()
            }

            lastSyncedAt = Date()
        } catch {
            NSLog("[sync] failed: %@", error.localizedDescription)
        }
    }

    /// Отправляет один маршрут — вызывается сразу после сохранения, чтобы не
    /// ждать следующего полного прохода.
    func push(_ route: CustomRoute) async {
        guard let client, isSignedIn else { return }
        do {
            try await client.from("routes").upsert(Self.row(route)).execute()
        } catch {
            NSLog("[sync] push failed: %@", error.localizedDescription)
        }
    }

    func delete(id: String) async {
        guard let client, isSignedIn else { return }
        do {
            try await client.from("routes").delete().eq("id", value: id).execute()
        } catch {
            NSLog("[sync] delete failed: %@", error.localizedDescription)
        }
    }

    /// `user_id` не отправляем: его проставляет сама база через
    /// `default auth.uid()`, и подделать чужой RLS всё равно не даст.
    private static func row(_ route: CustomRoute) -> RouteRow {
        RouteRow(id: route.id,
                 name: route.name,
                 distance_km: route.distanceKm,
                 recorded_at: route.date,
                 updated_at: route.updatedAt ?? route.date,
                 payload: route)
    }
}
