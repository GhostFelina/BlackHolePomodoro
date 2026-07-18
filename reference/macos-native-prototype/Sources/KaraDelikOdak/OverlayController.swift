import AppKit
import MetalKit
import QuartzCore

/// Tüm ekranı kaplayan overlay penceresini ve kara deliğin yaşam döngüsü
/// animasyonlarını yönetir:
///
///   uyarı fazı : şeffaf, tıklamalar alta geçer; kara delik doğar, gezinir, büyür
///   yutma      : mola başında ~3.5 sn'de ekranı yutar
///   mola       : ekran siyah, geri sayım görünür, tıklamalar engellenir
///   çekilme    : mola bitince ~1.2 sn'de büzülüp kaybolur
final class OverlayController {

    private enum Mode {
        case hidden
        case warning
        case swallowing(start: CFTimeInterval, fromRadius: CGFloat)
        case breakScreen
        case collapsing(start: CFTimeInterval)
    }

    private let swallowDuration: CFTimeInterval = 2.2
    private let collapseDuration: CFTimeInterval = 1.2

    private var window: NSWindow?
    private var metalView: MTKView?
    private var renderer: BlackHoleRenderer?

    private var countdownLabel: NSTextField?
    private var subtitleLabel: NSTextField?
    private var skipButton: NSButton?

    /// Atlama düğmesi mola başladıktan bu kadar sonra belirir — ekran
    /// kararırken imlecin altına düşen başıboş bir tıklama molayı iptal etmesin.
    private let skipArmDelay: TimeInterval = 6
    /// Tek tık yetmez: ikinci onay tıklaması bu süre içinde gelmelidir.
    private let skipConfirmWindow: TimeInterval = 4
    private var skipConfirmDeadline: Date?
    private var skipRevertTimer: Timer?

    private var mode: Mode = .hidden
    private var snapshot = FocusEngine.Snapshot(phase: .idle, remaining: 0, warningProgress: 0, cycle: 1)
    private var birthTime: CFTimeInterval = 0
    private var spawnAnchor = CGPoint(x: 0.3, y: 0.3) // ekran oranı cinsinden doğuş noktası

    /// Mola atlama düğmesine basılınca çağrılır (AppDelegate bağlar).
    var onSkipBreak: (() -> Void)?

    // MARK: - Motor olayları

    func update(snapshot: FocusEngine.Snapshot) {
        self.snapshot = snapshot
        if case .breakScreen = mode {
            countdownLabel?.stringValue = Self.format(snapshot.remaining)
        }
    }

    func phaseChanged(from old: FocusEngine.Phase, to new: FocusEngine.Phase) {
        switch new {
        case .warning:
            beginWarning()
        case .breakTime:
            beginSwallow()
        case .working:
            if old == .breakTime { beginCollapse() } else { hide() }
        case .idle:
            hide()
        }
    }

    // MARK: - Faz geçişleri

    private func beginWarning() {
        ensureWindow()
        guard let window else { return }
        birthTime = CACurrentMediaTime()
        // Doğuş noktası: köşelere yakın 4 bölgeden biri, rastgele.
        let anchors: [CGPoint] = [CGPoint(x: 0.28, y: 0.30), CGPoint(x: 0.72, y: 0.30),
                                  CGPoint(x: 0.30, y: 0.68), CGPoint(x: 0.70, y: 0.66)]
        spawnAnchor = anchors.randomElement() ?? anchors[0]

        mode = .warning
        setBreakUI(visible: false)
        window.ignoresMouseEvents = true
        metalView?.preferredFramesPerSecond = 60
        window.orderFrontRegardless()
        startCaptureIfPossible()
        playSound("Submarine", volume: 0.35)
    }

    private func beginSwallow() {
        // "Şimdi Mola Ver" ile uyarı fazı atlanmış olabilir; pencere yoksa kur.
        if window == nil {
            ensureWindow()
            guard window != nil else {
                NSLog("[KaraDelik] Overlay penceresi kurulamadı — mola görsel olarak gösterilemiyor")
                return
            }
            birthTime = CACurrentMediaTime()
            window?.orderFrontRegardless()
        }
        let currentRadius = currentParams().radius
        mode = .swallowing(start: CACurrentMediaTime(), fromRadius: currentRadius)
        playSound("Blow", volume: 0.5)

        DispatchQueue.main.asyncAfter(deadline: .now() + swallowDuration) { [weak self] in
            guard let self, case .swallowing = self.mode else { return }
            self.enterBreakScreen()
        }
    }

    private func enterBreakScreen() {
        mode = .breakScreen
        window?.ignoresMouseEvents = false
        metalView?.preferredFramesPerSecond = 10 // sabit siyah, boşa GPU yakma
        renderer?.capturer.stop()
        countdownLabel?.stringValue = Self.format(snapshot.remaining)
        setBreakUI(visible: true)
        // Atlama düğmesi gecikmeli belirir ve çift onay ister.
        disarmSkipConfirm()
        skipButton?.isHidden = true
        DispatchQueue.main.asyncAfter(deadline: .now() + skipArmDelay) { [weak self] in
            guard let self, case .breakScreen = self.mode else { return }
            self.skipButton?.isHidden = false
        }
        // Pencereyi öne al ve klavye odağını üstümüze çek.
        NSApp.activate(ignoringOtherApps: true)
        window?.makeKeyAndOrderFront(nil)
    }

    private func beginCollapse() {
        mode = .collapsing(start: CACurrentMediaTime())
        setBreakUI(visible: false)
        window?.ignoresMouseEvents = true
        metalView?.preferredFramesPerSecond = 60
        playSound("Glass", volume: 0.4)
        DispatchQueue.main.asyncAfter(deadline: .now() + collapseDuration + 0.1) { [weak self] in
            guard let self, case .collapsing = self.mode else { return }
            self.hide()
        }
    }

    private func hide() {
        mode = .hidden
        renderer?.capturer.stop()
        setBreakUI(visible: false)
        window?.orderOut(nil)
    }

    // MARK: - Görsel durum (renderer her karede çağırır)

    private func currentParams() -> VisualParams {
        guard let view = metalView else { return VisualParams() }
        let size = view.bounds.size
        let minDim = min(size.width, size.height)
        let diag = sqrt(size.width * size.width + size.height * size.height)
        let t = CACurrentMediaTime()

        switch mode {
        case .hidden:
            return VisualParams()

        case .warning:
            let p = snapshot.warningProgress
            // Minicik doğar (~birkaç piksel), 5 dk boyunca her saniye büyür ve
            // p=1'de (50. dakika) olay ufku ekranın neredeyse tamamını kaplar.
            // Eğri: başta yavaş ve zarif, sona doğru dramatik hızlanma.
            let f = CGFloat(0.15 * p + 0.85 * p * p * p)
            let minR = max(6, minDim * 0.006)
            let radius = minR + (diag * 0.55 - minR) * f

            // Doğuş noktasından merkeze doğru sürüklenme + organik gezinme
            let drift = smoothstep(0.15, 0.95, p)
            let base = CGPoint(
                x: lerp(spawnAnchor.x * size.width, size.width * 0.5, drift),
                y: lerp(spawnAnchor.y * size.height, size.height * 0.5, drift))
            let amp = minDim * 0.08 * CGFloat(1.0 - 0.7 * p)
            let wx = CGFloat(sin(t * 0.31) * 0.6 + sin(t * 0.13 + 2.1) * 0.4)
            let wy = CGFloat(sin(t * 0.23 + 1.3) * 0.6 + sin(t * 0.11 + 4.2) * 0.4)
            let center = CGPoint(x: base.x + wx * amp, y: base.y + wy * amp)

            // İlk 1.5 sn'de yumuşak doğuş
            let birth = min(max((t - birthTime) / 1.5, 0), 1)
            return VisualParams(center: center, radius: radius,
                                intensity: birth * birth * (3 - 2 * birth), blackout: 0)

        case .swallowing(let start, let fromRadius):
            let s = min(max((t - start) / swallowDuration, 0), 1)
            let easeIn = s * s * s
            let radius = lerp(fromRadius, diag * 0.75, easeIn)
            // Merkeze kilitlen
            let lockIn = min(s * 2.5, 1.0)
            let base = CGPoint(x: size.width * 0.5, y: size.height * 0.5)
            let amp = minDim * 0.04 * CGFloat(1 - lockIn)
            let center = CGPoint(x: base.x + CGFloat(sin(t * 0.31)) * amp,
                                 y: base.y + CGFloat(sin(t * 0.23 + 1.3)) * amp)
            let blackout = smoothstep(0.55, 1.0, s)
            return VisualParams(center: center, radius: radius, intensity: 1, blackout: Double(blackout))

        case .breakScreen:
            return VisualParams(center: CGPoint(x: size.width / 2, y: size.height / 2),
                                radius: diag, intensity: 1, blackout: 1)

        case .collapsing(let start):
            let s = min(max((t - start) / collapseDuration, 0), 1)
            let easeOut = 1 - pow(1 - s, 3)
            let radius = lerp(diag * 0.75, 0, easeOut)
            let blackout = 1.0 - smoothstep(0.0, 0.45, s)
            return VisualParams(center: CGPoint(x: size.width / 2, y: size.height / 2),
                                radius: radius, intensity: 1 - easeOut * 0.3,
                                blackout: Double(blackout))
        }
    }

    // MARK: - Pencere kurulumu

    private func ensureWindow() {
        if window != nil { return }
        guard let screen = NSScreen.main ?? NSScreen.screens.first else {
            NSLog("[KaraDelik] Ekran bulunamadı")
            return
        }
        guard let device = MTLCreateSystemDefaultDevice(),
              let renderer = BlackHoleRenderer(device: device) else {
            NSLog("[KaraDelik] Metal başlatılamadı")
            return
        }
        self.renderer = renderer

        let win = NSWindow(contentRect: screen.frame,
                           styleMask: .borderless,
                           backing: .buffered,
                           defer: false)
        win.level = .screenSaver              // menü çubuğu dahil her şeyin üstü
        win.backgroundColor = .clear
        win.isOpaque = false
        win.hasShadow = false
        win.ignoresMouseEvents = true
        win.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
        win.isReleasedWhenClosed = false

        let view = MTKView(frame: NSRect(origin: .zero, size: screen.frame.size), device: device)
        view.delegate = renderer
        view.framebufferOnly = true
        view.clearColor = MTLClearColor(red: 0, green: 0, blue: 0, alpha: 0)
        view.colorPixelFormat = .bgra8Unorm
        view.preferredFramesPerSecond = 60
        view.autoresizingMask = [.width, .height]
        (view.layer as? CAMetalLayer)?.isOpaque = false

        renderer.paramsProvider = { [weak self] in self?.currentParams() ?? VisualParams() }

        win.contentView = view
        self.window = win
        self.metalView = view
        buildBreakUI(in: view)
    }

    private func buildBreakUI(in container: NSView) {
        let countdown = NSTextField(labelWithString: "10:00")
        countdown.font = NSFont.monospacedDigitSystemFont(ofSize: 110, weight: .thin)
        countdown.textColor = .white
        countdown.alignment = .center
        countdown.translatesAutoresizingMaskIntoConstraints = false

        let subtitle = NSTextField(labelWithString: "Kara delik ekranını yuttu. Kalk, esne, gözlerini dinlendir. 🌌")
        subtitle.font = NSFont.systemFont(ofSize: 20, weight: .light)
        subtitle.textColor = NSColor(white: 1.0, alpha: 0.55)
        subtitle.alignment = .center
        subtitle.translatesAutoresizingMaskIntoConstraints = false

        let skip = NSButton(title: "Molayı atla →", target: self, action: #selector(skipTapped))
        skip.isBordered = false
        skip.attributedTitle = NSAttributedString(
            string: "Molayı atla →",
            attributes: [.foregroundColor: NSColor(white: 1.0, alpha: 0.35),
                         .font: NSFont.systemFont(ofSize: 13)])
        skip.translatesAutoresizingMaskIntoConstraints = false

        container.addSubview(countdown)
        container.addSubview(subtitle)
        container.addSubview(skip)
        NSLayoutConstraint.activate([
            countdown.centerXAnchor.constraint(equalTo: container.centerXAnchor),
            countdown.centerYAnchor.constraint(equalTo: container.centerYAnchor, constant: -20),
            subtitle.centerXAnchor.constraint(equalTo: container.centerXAnchor),
            subtitle.topAnchor.constraint(equalTo: countdown.bottomAnchor, constant: 16),
            skip.trailingAnchor.constraint(equalTo: container.trailingAnchor, constant: -28),
            skip.bottomAnchor.constraint(equalTo: container.bottomAnchor, constant: -24),
        ])

        countdownLabel = countdown
        subtitleLabel = subtitle
        skipButton = skip
        setBreakUI(visible: false)
    }

    private func setBreakUI(visible: Bool) {
        countdownLabel?.isHidden = !visible
        subtitleLabel?.isHidden = !visible
        // Görünürlüğü enterBreakScreen gecikmeli olarak yönetir; burada
        // yalnızca gizleme yönü geçerli.
        if !visible {
            skipButton?.isHidden = true
            disarmSkipConfirm()
        }
    }

    @objc private func skipTapped() {
        guard case .breakScreen = mode else { return }
        if let deadline = skipConfirmDeadline, Date() < deadline {
            disarmSkipConfirm()
            onSkipBreak?()
        } else {
            // İlk tık yalnızca onay ister; kazara tıklama molayı bozamaz.
            skipConfirmDeadline = Date().addingTimeInterval(skipConfirmWindow)
            setSkipTitle("Emin misin? Tekrar bas", alpha: 0.75)
            skipRevertTimer?.invalidate()
            skipRevertTimer = Timer.scheduledTimer(withTimeInterval: skipConfirmWindow,
                                                   repeats: false) { [weak self] _ in
                self?.disarmSkipConfirm()
            }
        }
    }

    private func disarmSkipConfirm() {
        skipRevertTimer?.invalidate()
        skipRevertTimer = nil
        skipConfirmDeadline = nil
        setSkipTitle("Molayı atla →", alpha: 0.35)
    }

    private func setSkipTitle(_ title: String, alpha: CGFloat) {
        skipButton?.attributedTitle = NSAttributedString(
            string: title,
            attributes: [.foregroundColor: NSColor(white: 1.0, alpha: alpha),
                         .font: NSFont.systemFont(ofSize: 13)])
    }

    // MARK: - Yakalama

    private func startCaptureIfPossible() {
        guard let view = metalView, let renderer else { return }
        guard ScreenCapturer.hasPermission else {
            NSLog("[KaraDelik] Ekran kaydı izni yok — stilize mod. Menüden izin verebilirsin.")
            return
        }
        let scale = window?.backingScaleFactor ?? 2.0
        renderer.capturer.start(pixelWidth: Int(view.bounds.width * scale),
                                pixelHeight: Int(view.bounds.height * scale))
    }

    // MARK: - Yardımcılar

    private func playSound(_ name: String, volume: Float) {
        guard let sound = NSSound(named: name) else { return }
        sound.volume = volume
        sound.play()
    }

    static func format(_ interval: TimeInterval) -> String {
        let total = max(Int(interval.rounded()), 0)
        return String(format: "%02d:%02d", total / 60, total % 60)
    }
}

// MARK: - Küçük matematik yardımcıları

private func lerp(_ a: CGFloat, _ b: CGFloat, _ t: CGFloat) -> CGFloat { a + (b - a) * t }
private func lerp(_ a: CGFloat, _ b: CGFloat, _ t: Double) -> CGFloat { a + (b - a) * CGFloat(t) }

private func smoothstep(_ edge0: Double, _ edge1: Double, _ x: Double) -> Double {
    let t = min(max((x - edge0) / (edge1 - edge0), 0), 1)
    return t * t * (3 - 2 * t)
}
