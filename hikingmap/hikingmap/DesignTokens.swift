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
