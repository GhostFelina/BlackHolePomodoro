import Foundation
import ScreenCaptureKit
import CoreVideo
import Metal
import AppKit

/// Ana ekranın canlı görüntüsünü ScreenCaptureKit ile yakalayıp
/// Metal dokusu olarak sunar. Kendi overlay penceremiz yakalamadan
/// hariç tutulur (yoksa sonsuz ayna döngüsü oluşur).
final class ScreenCapturer: NSObject, SCStreamOutput, SCStreamDelegate {

    /// En son kare. CVMetalTexture, MTLTexture'ın arkasındaki belleği canlı
    /// tuttuğu için ikisi birlikte saklanır.
    private struct Frame {
        let texture: MTLTexture
        let backing: CVMetalTexture
    }

    private let device: MTLDevice
    private var textureCache: CVMetalTextureCache?
    private var stream: SCStream?
    private let sampleQueue = DispatchQueue(label: "karadelik.capture", qos: .userInteractive)
    private let lock = NSLock()
    private var latestFrame: Frame?
    private(set) var isCapturing = false

    /// Yakalama gerçekten kare üretiyor mu? (İzin verilmemişse false kalır.)
    private(set) var hasReceivedFrame = false

    init(device: MTLDevice) {
        self.device = device
        super.init()
        CVMetalTextureCacheCreate(kCFAllocatorDefault, nil, device, nil, &textureCache)
    }

    static var hasPermission: Bool {
        CGPreflightScreenCaptureAccess()
    }

    /// Sistem izin diyaloğunu tetikler (uygulama başına bir kez gösterilir).
    static func requestPermission() {
        CGRequestScreenCaptureAccess()
    }

    func start(pixelWidth: Int, pixelHeight: Int) {
        guard stream == nil else { return }
        Task { @MainActor in
            do {
                let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
                guard let display = content.displays.first(where: { $0.displayID == CGMainDisplayID() })
                        ?? content.displays.first else {
                    NSLog("[KaraDelik] Yakalanacak ekran bulunamadı")
                    return
                }
                // Kendi pencerelerimizi hariç tut.
                let myPID = ProcessInfo.processInfo.processIdentifier
                let myWindows = content.windows.filter { $0.owningApplication?.processID == myPID }

                let filter = SCContentFilter(display: display, excludingWindows: myWindows)
                let config = SCStreamConfiguration()
                config.width = pixelWidth
                config.height = pixelHeight
                config.pixelFormat = kCVPixelFormatType_32BGRA
                config.minimumFrameInterval = CMTime(value: 1, timescale: 30)
                config.queueDepth = 3
                config.showsCursor = false // imlecin bükülmüş kopyası görünmesin

                let stream = SCStream(filter: filter, configuration: config, delegate: self)
                try stream.addStreamOutput(self, type: .screen, sampleHandlerQueue: sampleQueue)
                try await stream.startCapture()
                self.stream = stream
                self.isCapturing = true
                NSLog("[KaraDelik] Ekran yakalama başladı (%dx%d)", pixelWidth, pixelHeight)
            } catch {
                NSLog("[KaraDelik] Ekran yakalama başlatılamadı: %@ — stilize moda düşülüyor", "\(error)")
            }
        }
    }

    func stop() {
        guard let stream else { return }
        self.stream = nil
        isCapturing = false
        hasReceivedFrame = false
        Task {
            try? await stream.stopCapture()
        }
        lock.lock()
        latestFrame = nil
        lock.unlock()
        if let cache = textureCache {
            CVMetalTextureCacheFlush(cache, 0)
        }
        NSLog("[KaraDelik] Ekran yakalama durdu")
    }

    /// Renderer her karede bunu okur; kare yoksa nil (stilize mod).
    var currentTexture: MTLTexture? {
        lock.lock(); defer { lock.unlock() }
        return latestFrame?.texture
    }

    // MARK: - SCStreamOutput

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .screen,
              sampleBuffer.isValid,
              let pixelBuffer = sampleBuffer.imageBuffer,
              let cache = textureCache else { return }

        let width = CVPixelBufferGetWidth(pixelBuffer)
        let height = CVPixelBufferGetHeight(pixelBuffer)
        var cvTexture: CVMetalTexture?
        let status = CVMetalTextureCacheCreateTextureFromImage(
            kCFAllocatorDefault, cache, pixelBuffer, nil,
            .bgra8Unorm, width, height, 0, &cvTexture)

        guard status == kCVReturnSuccess,
              let cvTexture,
              let texture = CVMetalTextureGetTexture(cvTexture) else { return }

        lock.lock()
        latestFrame = Frame(texture: texture, backing: cvTexture)
        hasReceivedFrame = true
        lock.unlock()
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        NSLog("[KaraDelik] Yakalama akışı hata ile durdu: %@", "\(error)")
        self.stream = nil
        isCapturing = false
    }
}
