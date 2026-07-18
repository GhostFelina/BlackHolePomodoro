import AppKit

// MARK: - Komut satırı modları

if CommandLine.arguments.contains("--selftest") {
    exit(SelfTest.run() ? 0 : 1)
}

if let flagIndex = CommandLine.arguments.firstIndex(of: "--rendertest") {
    // Shader'ı ekransız çizip PNG üret: --rendertest <çıkış-klasörü>
    let outDir = URL(fileURLWithPath: CommandLine.arguments.indices.contains(flagIndex + 1)
                     ? CommandLine.arguments[flagIndex + 1] : ".")
    guard let device = MTLCreateSystemDefaultDevice(),
          let renderer = BlackHoleRenderer(device: device) else {
        print("Metal/shader başlatılamadı ❌"); exit(1)
    }
    let size = CGSize(width: 1280, height: 800)
    let cases: [(String, VisualParams)] = [
        ("dogum",   VisualParams(center: CGPoint(x: 380, y: 260), radius: 8,   intensity: 1, blackout: 0)),
        ("buyume",  VisualParams(center: CGPoint(x: 560, y: 350), radius: 70,  intensity: 1, blackout: 0)),
        ("zirve",   VisualParams(center: CGPoint(x: 640, y: 400), radius: 220, intensity: 1, blackout: 0)),
        ("yutma",   VisualParams(center: CGPoint(x: 640, y: 400), radius: 560, intensity: 1, blackout: 0.4)),
        ("mola",    VisualParams(center: CGPoint(x: 640, y: 400), radius: 900, intensity: 1, blackout: 1)),
    ]
    var ok = true
    for (name, params) in cases {
        let url = outDir.appendingPathComponent("rendertest-\(name).png")
        let success = renderer.renderTestPNG(to: url, size: size, params: params)
        print("\(success ? "✓" : "✗") \(url.path)")
        ok = ok && success
    }
    exit(ok ? 0 : 1)
}

// MARK: - Uygulama

final class AppDelegate: NSObject, NSApplicationDelegate {
    private let engine = FocusEngine()
    private var statusBar: StatusBarController!
    private let overlay = OverlayController()
    private var activityToken: NSObjectProtocol?

    func applicationDidFinishLaunching(_ notification: Notification) {
        statusBar = StatusBarController(engine: engine)

        engine.onTick = { [weak self] snap in
            self?.statusBar.render(snapshot: snap)
            self?.overlay.update(snapshot: snap)
        }
        engine.onPhaseChange = { [weak self] old, new in
            NSLog("[KaraDelik] Faz değişti: %@ -> %@", "\(old)", "\(new)")
            self?.overlay.phaseChanged(from: old, to: new)
        }
        overlay.onSkipBreak = { [weak self] in
            self?.engine.skipBreak()
        }

        // App Nap sayaç hassasiyetini bozmasın (sistem uykusunu engellemez).
        activityToken = ProcessInfo.processInfo.beginActivity(
            options: [.userInitiatedAllowingIdleSystemSleep],
            reason: "Odak sayacı hassas çalışmalı")

        // Test kolaylığı: --fast ile hızlı modda, --autostart ile hemen başlat.
        if CommandLine.arguments.contains("--fast") { engine.timeScale = 60 }
        if CommandLine.arguments.contains("--autostart") { engine.start() }

        NSLog("[KaraDelik] Uygulama hazır (izin: %@)",
              ScreenCapturer.hasPermission ? "ekran kaydı VAR" : "ekran kaydı YOK — stilize mod")
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory) // Dock'ta görünme, sadece menü çubuğu
app.run()
