import Foundation
import CoreLocation
import Combine
import UIKit

final class TrackRecorder: NSObject, ObservableObject, CLLocationManagerDelegate {
    @Published var currentLocation: CLLocationCoordinate2D?
    @Published var elapsedSeconds: Int = 0
    @Published var distanceKm: Double = 0
    @Published var currentSpeedKmh: Double = 0
    @Published var currentAscent: Double = 0
    @Published var currentAltitude: Double = 0
    @Published var isRecording = false

    private(set) var recording = TrackRecording()
    private var segmentStartIndex: Int = 0
    private var segmentStartTime: Date = Date()

    private let manager = CLLocationManager()
    private var timer: AnyCancellable?
    private var lastLocation: CLLocation?
    private var startTime: Date?

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBestForNavigation
        manager.distanceFilter = 5
        manager.pausesLocationUpdatesAutomatically = false
    }

    // MARK: - Control

    func requestPermission() {
        manager.requestAlwaysAuthorization()
    }

    // Разрешено только когда UIBackgroundModes.location реально прописан
    // и юзер выдал .authorizedAlways. Иначе CoreLocation бросает
    // NSInternalInconsistencyException и краш.
    private func enableBackgroundUpdatesIfAllowed() {
        guard manager.authorizationStatus == .authorizedAlways else { return }
        let modes = Bundle.main.object(forInfoDictionaryKey: "UIBackgroundModes") as? [String] ?? []
        guard modes.contains("location") else { return }
        manager.allowsBackgroundLocationUpdates = true
    }

    func startRecording(linkedRouteId: String? = nil) {
        recording = TrackRecording()
        recording.linkedRouteId = linkedRouteId
        segmentStartIndex = 0
        segmentStartTime = Date()
        distanceKm = 0
        currentAscent = 0
        elapsedSeconds = 0
        lastLocation = nil
        startTime = Date()
        isRecording = true

        enableBackgroundUpdatesIfAllowed()
        manager.startUpdatingLocation()

        timer = Timer.publish(every: 1, on: .main, in: .common)
            .autoconnect()
            .sink { [weak self] _ in
                guard let self, let start = self.startTime else { return }
                self.elapsedSeconds = Int(Date().timeIntervalSince(start))
            }
    }

    func stopRecording() -> TrackRecording {
        manager.stopUpdatingLocation()
        timer?.cancel()
        timer = nil
        isRecording = false
        return recording
    }

    func addSighting(_ type: SightingType) {
        guard let loc = currentLocation else { return }
        recording.sightings.append(Sighting(type: type, coordinate: loc))
    }

    func addPhoto(_ image: UIImage) -> TrackPhoto? {
        guard let loc = currentLocation,
              let data = image.jpegData(compressionQuality: 0.82)
        else { return nil }
        let filename = "track_photo_\(UUID().uuidString).jpg"
        let url = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent(filename)
        try? data.write(to: url)
        let photo = TrackPhoto(coordinate: loc, localFilename: filename)
        recording.photos.append(photo)
        return photo
    }

    func markSegment() -> TrackSegment? {
        let endIndex = recording.coordinates.count - 1
        guard endIndex > segmentStartIndex else { return nil }

        let segCoords = Array(recording.clCoordinates[segmentStartIndex...endIndex])
        let segElevs  = recording.elevations.count > endIndex
            ? Array(recording.elevations[segmentStartIndex...endIndex])
            : []

        let dist = zip(segCoords, segCoords.dropFirst()).reduce(0.0) { acc, pair in
            acc + CLLocation(latitude: pair.0.latitude, longitude: pair.0.longitude)
                .distance(from: CLLocation(latitude: pair.1.latitude, longitude: pair.1.longitude)) / 1000
        }
        let asc = zip(segElevs, segElevs.dropFirst()).reduce(0.0) { acc, pair in
            acc + max(0, pair.1 - pair.0)
        }
        let duration = Date().timeIntervalSince(segmentStartTime)
        let n = recording.segments.count + 1
        let seg = TrackSegment(id: UUID(), number: n, distanceKm: dist,
                               duration: duration, ascent: asc,
                               startIndex: segmentStartIndex, endIndex: endIndex)
        recording.segments.append(seg)
        segmentStartIndex = endIndex
        segmentStartTime = Date()
        return seg
    }

    // MARK: - CLLocationManagerDelegate

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let loc = locations.last, loc.horizontalAccuracy < 40 else { return }

        currentLocation = loc.coordinate
        currentAltitude = loc.altitude

        if let prev = lastLocation {
            let d = prev.distance(from: loc) / 1000
            distanceKm += d
            recording.coordinates.append(CodableCoordinate(loc.coordinate))
            recording.elevations.append(loc.altitude)
            let ascDelta = max(0, loc.altitude - prev.altitude)
            currentAscent += ascDelta

            if loc.speed > 0 {
                currentSpeedKmh = loc.speed * 3.6
            }
        } else {
            recording.coordinates.append(CodableCoordinate(loc.coordinate))
            recording.elevations.append(loc.altitude)
        }
        lastLocation = loc
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        if manager.authorizationStatus == .authorizedWhenInUse ||
           manager.authorizationStatus == .authorizedAlways {
            manager.startUpdatingLocation()
        }
    }
}
