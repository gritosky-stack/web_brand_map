import SwiftUI
import UIKit

enum DS {
    // MARK: - Backgrounds
    static let bg            = Color(red: 0.039, green: 0.039, blue: 0.039) // #0A0A0A
    static let surface       = Color(red: 0.078, green: 0.078, blue: 0.078) // #141414
    static let surfaceRaised = Color(red: 0.110, green: 0.110, blue: 0.110) // #1C1C1C

    // MARK: - Accent – Electric Orange
    static let accent        = Color(red: 1.0,   green: 0.341, blue: 0.133) // #FF5722
    static let accentUI      = UIColor(red: 1.0,  green: 0.341, blue: 0.133, alpha: 1)

    // MARK: - Route colours
    static let completed     = Color(red: 1.0,   green: 0.302, blue: 0.302) // #FF4D4D
    static let completedUI   = UIColor(red: 1.0,  green: 0.302, blue: 0.302, alpha: 1)
    static let planned       = Color(red: 1.0,   green: 0.843, blue: 0.0)   // #FFD700
    static let plannedUI     = UIColor(red: 1.0,  green: 0.843, blue: 0.0,  alpha: 1)

    // MARK: - Map pin colours
    static let pinStart      = Color(red: 0.180, green: 0.800, blue: 0.443)            // #2ECC71
    static let pinStartUI    = UIColor(red: 0.180, green: 0.800, blue: 0.443, alpha: 1)
    static let pinFinish     = Color(red: 0.906, green: 0.298, blue: 0.235)            // #E74C3C
    static let pinFinishUI   = UIColor(red: 0.906, green: 0.298, blue: 0.235, alpha: 1)
    static let pinLoop       = Color(red: 1.000, green: 0.341, blue: 0.133)            // #FF5722
    static let pinLoopUI     = UIColor(red: 1.000, green: 0.341, blue: 0.133, alpha: 1)
    static let pinPeak       = Color(red: 1.000, green: 0.757, blue: 0.027)            // #FFC107
    static let pinPeakUI     = UIColor(red: 1.000, green: 0.757, blue: 0.027, alpha: 1)

    // MARK: - Text
    static let textPrimary   = Color.white
    static let textSecondary = Color(white: 0.55)
    static let textTertiary  = Color(white: 0.35)

    // MARK: - Difficulty
    static let diffEasy      = Color(red: 0.298, green: 0.686, blue: 0.314) // #4CAF50
    static let diffMedium    = Color(red: 1.0,   green: 0.596, blue: 0.0)   // #FF9800
    static let diffHard      = Color(red: 0.957, green: 0.263, blue: 0.212) // #F44336
    static let diffExpert    = Color(red: 0.612, green: 0.153, blue: 0.690) // #9C27B0

    // MARK: - Уклон маршрута (спуск)
    // Продолжение шкалы сложности (diffEasy…diffExpert, набор высоты) в
    // синий/голубой для спуска — см. GradeColor. Тот же вес "500", что и у
    // остальной палитры сложности, чтобы шкала читалась как одно целое.
    static let gradeDescentSteep    = Color(red: 0.129, green: 0.588, blue: 0.953) // #2196F3
    static let gradeDescentSteepUI  = UIColor(red: 0.129, green: 0.588, blue: 0.953, alpha: 1)
    static let gradeDescentGentle   = Color(red: 0.0,   green: 0.737, blue: 0.831)  // #00BCD4
    static let gradeDescentGentleUI = UIColor(red: 0.0,   green: 0.737, blue: 0.831, alpha: 1)

    // MARK: - Топооснова
    // Палитра бумажной топокарты: ею перекрашивается satellite-streets,
    // см. applyTopoStyle в MapboxMapView.
    static let topoPaperUI      = UIColor(red: 0.949, green: 0.937, blue: 0.902, alpha: 1) // #F2EFE6
    static let topoWoodUI       = UIColor(red: 0.784, green: 0.863, blue: 0.706, alpha: 1) // #C8DCB4
    static let topoScrubUI      = UIColor(red: 0.855, green: 0.898, blue: 0.780, alpha: 1) // #DAE5C7
    static let topoGrassUI      = UIColor(red: 0.878, green: 0.925, blue: 0.808, alpha: 1) // #E0ECCE
    static let topoFieldUI      = UIColor(red: 0.937, green: 0.918, blue: 0.839, alpha: 1) // #EFEAD6
    static let topoRockUI       = UIColor(red: 0.878, green: 0.867, blue: 0.847, alpha: 1) // #E0DDD8
    static let topoSandUI       = UIColor(red: 0.949, green: 0.925, blue: 0.851, alpha: 1) // #F2ECD9
    static let topoWaterUI      = UIColor(red: 0.639, green: 0.808, blue: 0.890, alpha: 1) // #A3CEE3
    static let topoRoadUI       = UIColor(red: 1.0,   green: 0.988, blue: 0.965, alpha: 1) // #FFFCF6
    static let topoRoadCasingUI = UIColor(red: 0.639, green: 0.612, blue: 0.565, alpha: 1) // #A39C90
    static let topoTrailUI      = UIColor(red: 0.545, green: 0.353, blue: 0.169, alpha: 1) // #8B5A2B
    static let topoTextUI       = UIColor(red: 0.204, green: 0.192, blue: 0.169, alpha: 1) // #34312B
    static let topoAdminUI      = UIColor(red: 0.545, green: 0.478, blue: 0.545, alpha: 1) // #8B7A8B

    /// Цвет железнодорожной графики — общий для путей на карте и флажков станций
    static let railInk       = Color(red: 0.122, green: 0.110, blue: 0.094)  // #1F1C18
    static let railInkUI     = UIColor(red: 0.122, green: 0.110, blue: 0.094, alpha: 1)
    static let topoTextColor = Color(red: 0.204, green: 0.192, blue: 0.169)  // #34312B

    // MARK: - Structural
    static let border        = Color(white: 1, opacity: 0.08)
    static let borderFocus   = Color(white: 1, opacity: 0.18)
    static let glass         = Color(white: 1, opacity: 0.05)
    static let glassHover    = Color(white: 1, opacity: 0.09)

    // MARK: - Corner radii
    static let radiusS: CGFloat = 10
    static let radiusM: CGFloat = 16
    static let radiusL: CGFloat = 22
}

// MARK: - Difficulty helpers
extension Difficulty {
    var dsColor: Color {
        switch self {
        case .easy:   return DS.diffEasy
        case .medium: return DS.diffMedium
        case .hard:   return DS.diffHard
        case .expert: return DS.diffExpert
        }
    }

    var hint: String {
        switch self {
        case .easy:
            return "До ~10 км и ~500 м набора. Подходит новичкам без специальной подготовки"
        case .medium:
            return "~10–20 км или до ~1300 м набора. Нужна базовая физподготовка"
        case .hard:
            return "~20–30 км или до ~2500 м набора. Рекомендуется опыт горных походов"
        case .expert:
            return "30+ км или 2500+ м набора. Серьёзная нагрузка, только для подготовленных"
        }
    }
}

// MARK: - SwiftUI Color helpers
extension Color {
    init(_ uiColor: UIColor) { self.init(uiColor: uiColor) }
    init(hex: String) { self.init(UIColor(hex: hex)) }
}
