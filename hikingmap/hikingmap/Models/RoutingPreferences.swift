import Foundation

/// Правила прокладки маршрута по тропам («Нарисовать» → BRouter, см.
/// `Services/TrailRouter.swift`). Дружелюбная надстройка над тем, что
/// brouter.de показывает как «Customize profile»: там десяток чекбоксов и
/// два независимых выпадающих списка про SAC-шкалу, здесь — то же самое,
/// но с понятными для похода формулировками и одним контролом сложности
/// вместо двух.
///
/// Значения по умолчанию совпадают с тем, что уже сегодня зашито в профиль
/// `hiking-beta` (видно на скриншоте brouter.de: все `consider_*` выключены,
/// `hiking_routes_preference` 0,2, `SAC_scale_limit` T3, `_preferred` T1,
/// лестницы и паромы разрешены) — так что пока пользователь не открыл экран
/// правил, прокладка ведёт себя ровно как раньше.
/// ⚠️ Проверено против живого `brouter.de` (21.08.2026, профиль скачан с
/// `https://brouter.de/brouter/profiles2/hiking-beta.brf`): механизм
/// `profile:<имя>=<значение>` работает — `iswet` и `shortest_way` меняют
/// геометрию воспроизводимо, — но переменную, которой в профиле нет, сервер
/// **молча игнорирует** (проверено заведомо выдуманным именем). А в
/// глобальном контексте `hiking-beta` объявлены не все имена, которые мы
/// шлём. Реально работают: `consider_elevation`, `iswet`, `SAC_scale_limit`,
/// `SAC_scale_preferred`, `allow_steps`, `allow_ferries`.
/// **Не объявлены и потому ни на что не влияют**: `consider_forest`,
/// `consider_river`, `consider_town`, `consider_noise`,
/// `hiking_routes_preference` (они есть в `trekking`/`hiking-mountain`, но
/// не в `hiking-beta`). Ближайшие живые аналоги «держаться троп» в этом
/// профиле — `prefer_hiking_routes` / `stick_to_hiking_routes` /
/// `non_hiking_route_penalty` / `non_sticky_route_penalty`.
struct RoutingPreferences: Codable, Equatable {
    var preferForest    = false
    var preferWater      = false
    var avoidTowns       = false
    var avoidNoise        = false
    /// ⚠️ По умолчанию **включено**: в `hiking-beta` зашито
    /// `consider_elevation 1`, и с `false` приложение молча выключало бы
    /// учёт рельефа у всех, кто экран правил даже не открывал.
    var minimizeElevation = true
    var avoidMud          = false
    var allowSteps    = true
    var allowFerries  = true
    /// `hiking_routes_preference` у BRouter: насколько сильно держаться
    /// размеченных пеших троп, а не срезать асфальтом. 0.1…2.0, по
    /// умолчанию у профиля — 0.2.
    var trailPreference: Double = 0.2
    var maxDifficulty: SACLevel = .t3

    /// Соответствует шкале SAC (Schweizer Alpen-Club), которую использует
    /// BRouter как `SAC_scale_limit` — маршруты сложнее выбранного уровня
    /// роутер не предлагает вовсе.
    enum SACLevel: Int, Codable, CaseIterable, Identifiable, Equatable {
        case t1 = 1, t2, t3, t4, t5, t6
        var id: Int { rawValue }

        var label: String {
            switch self {
            case .t1: return "Прогулочная тропа"
            case .t2: return "Горная тропа"
            case .t3: return "Горный поход"
            case .t4: return "Альпийская тропа"
            case .t5: return "Сложная альпийская"
            case .t6: return "Экстремальная"
            }
        }

        var hint: String {
            switch self {
            case .t1: return "Широкая тропа, обвалов и перил нет"
            case .t2: return "Местами узко и круто, нужна устойчивость"
            case .t3: return "Возможны участки, где держатся руками"
            case .t4: return "Скалы, может понадобиться снаряжение"
            case .t5: return "Сложный альпинистский рельеф"
            case .t6: return "Экстремально сложный, только для экспертов"
            }
        }
    }

    static let `default` = RoutingPreferences()

    /// Оверрайды переменных профиля для BRouter — `profile:<имя>=<значение>`
    /// в query запроса. Механизм подтверждён по исходникам brouter-server
    /// (`ServerHandler.java`, префикс `profile:`), применяется публичным
    /// сервером brouter.de. Отправляем всегда и целиком, а не только то,
    /// что отличается от дефолта — так поведение не зависит от того, какие
    /// значения на самом деле зашиты в `hiking-beta` на сервере.
    ///
    /// `SAC_scale_preferred` в дружелюбном UI не показываем — оставляем
    /// дефолтный T1 у BRouter, второй ползунок только путал бы.
    var brouterQueryItems: [URLQueryItem] {
        [
            item("consider_forest", preferForest),
            item("consider_river", preferWater),
            item("consider_town", avoidTowns),
            item("consider_noise", avoidNoise),
            item("consider_elevation", minimizeElevation),
            item("iswet", avoidMud),
            item("allow_steps", allowSteps),
            item("allow_ferries", allowFerries),
            URLQueryItem(name: "profile:hiking_routes_preference",
                        value: String(format: "%.2f", trailPreference)),
            URLQueryItem(name: "profile:SAC_scale_limit", value: String(maxDifficulty.rawValue)),
            URLQueryItem(name: "profile:SAC_scale_preferred", value: "1")
        ]
    }

    private func item(_ name: String, _ value: Bool) -> URLQueryItem {
        URLQueryItem(name: "profile:\(name)", value: value ? "1" : "0")
    }
}
