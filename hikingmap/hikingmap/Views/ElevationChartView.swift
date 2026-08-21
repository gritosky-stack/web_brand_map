import SwiftUI
import CoreLocation

/// Профиль высот обычного и PSS-маршрута. Всё содержимое — в общем
/// `ProfileChart`: он же стоит в карточке своего маршрута, и жесты, оси и
/// выделение участка живут в одном месте, а не в двух копиях.
struct ElevationChartView: View {
    let stats: RouteStats

    var body: some View {
        // График рисуется по прореженным точкам, а раскраска считается по
        // полной геометрии — той же, что у линии на карте
        ProfileChart(elevations: stats.elevationSampled,
                     coordinates: stats.coordinatesSampled,
                     totalKm: stats.distance,
                     accent: DS.accent,
                     distancesKm: stats.sampledDistancesKm,
                     gradeCoordinates: stats.coordinates,
                     gradeElevations: stats.elevations)
    }
}
