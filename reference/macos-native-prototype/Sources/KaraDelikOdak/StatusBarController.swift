import AppKit
import ServiceManagement

/// Menü çubuğu ikonu, sayaç gösterimi ve tüm kullanıcı komutları.
final class StatusBarController: NSObject, NSMenuDelegate {

    private let statusItem: NSStatusItem
    private let engine: FocusEngine
    private let defaults = UserDefaults.standard

    private var statusLine: NSMenuItem!
    private var startItem: NSMenuItem!
    private var stopItem: NSMenuItem!
    private var breakNowItem: NSMenuItem!
    private var skipBreakItem: NSMenuItem!
    private var fastModeItem: NSMenuItem!
    private var permissionItem: NSMenuItem!
    private var loginItem: NSMenuItem!
    private var presetItems: [NSMenuItem] = []

    /// (çalışma dk, mola dk) hazır seçenekleri
    private let presets: [(Int, Int)] = [(50, 10), (25, 5), (90, 15)]

    init(engine: FocusEngine) {
        self.statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        self.engine = engine
        super.init()
        buildMenu()
        applySavedPreset()
        render(snapshot: FocusEngine.Snapshot(phase: .idle, remaining: 0, warningProgress: 0, cycle: 1))
    }

    private func buildMenu() {
        statusItem.button?.title = "🕳"

        let menu = NSMenu()
        menu.delegate = self

        statusLine = NSMenuItem(title: "Hazır", action: nil, keyEquivalent: "")
        statusLine.isEnabled = false
        menu.addItem(statusLine)
        menu.addItem(.separator())

        startItem = NSMenuItem(title: "Başlat", action: #selector(startTapped), keyEquivalent: "b")
        startItem.target = self
        menu.addItem(startItem)

        stopItem = NSMenuItem(title: "Durdur", action: #selector(stopTapped), keyEquivalent: "d")
        stopItem.target = self
        menu.addItem(stopItem)

        breakNowItem = NSMenuItem(title: "Şimdi Mola Ver", action: #selector(breakNowTapped), keyEquivalent: "")
        breakNowItem.target = self
        menu.addItem(breakNowItem)

        skipBreakItem = NSMenuItem(title: "Molayı Atla", action: #selector(skipBreakTapped), keyEquivalent: "")
        skipBreakItem.target = self
        menu.addItem(skipBreakItem)

        menu.addItem(.separator())

        let durationsMenu = NSMenu()
        for (i, preset) in presets.enumerated() {
            let item = NSMenuItem(title: "\(preset.0) dk çalışma + \(preset.1) dk mola",
                                  action: #selector(presetTapped(_:)), keyEquivalent: "")
            item.target = self
            item.tag = i
            durationsMenu.addItem(item)
            presetItems.append(item)
        }
        let durationsRoot = NSMenuItem(title: "Süreler", action: nil, keyEquivalent: "")
        durationsRoot.submenu = durationsMenu
        menu.addItem(durationsRoot)

        fastModeItem = NSMenuItem(title: "🧪 Hızlı Test Modu (60×)", action: #selector(fastModeTapped), keyEquivalent: "")
        fastModeItem.target = self
        menu.addItem(fastModeItem)

        menu.addItem(.separator())

        permissionItem = NSMenuItem(title: "Ekran Kaydı İzni Ver…", action: #selector(permissionTapped), keyEquivalent: "")
        permissionItem.target = self
        menu.addItem(permissionItem)

        loginItem = NSMenuItem(title: "Girişte Başlat", action: #selector(loginTapped), keyEquivalent: "")
        loginItem.target = self
        menu.addItem(loginItem)

        menu.addItem(.separator())
        let quit = NSMenuItem(title: "Çıkış", action: #selector(quitTapped), keyEquivalent: "q")
        quit.target = self
        menu.addItem(quit)

        statusItem.menu = menu
    }

    // MARK: - Motor -> arayüz

    func render(snapshot: FocusEngine.Snapshot) {
        let time = OverlayController.format(snapshot.remaining)
        switch snapshot.phase {
        case .idle:
            statusItem.button?.title = "🕳"
            statusLine.title = "Hazır — başlatmak için Başlat'a bas"
        case .working:
            statusItem.button?.title = "🕳 \(time)"
            statusLine.title = "\(snapshot.cycle). tur — çalışma (molaya \(time))"
        case .warning:
            statusItem.button?.title = "🕳⚠️ \(time)"
            statusLine.title = "\(snapshot.cycle). tur — kara delik büyüyor! Molaya \(time)"
        case .breakTime:
            statusItem.button?.title = "☕️ \(time)"
            statusLine.title = "\(snapshot.cycle). tur — mola (\(time) kaldı)"
        }
    }

    // MARK: - NSMenuDelegate

    func menuNeedsUpdate(_ menu: NSMenu) {
        let running = engine.isRunning
        let snap = engine.snapshot(at: engine.now())
        startItem.isHidden = running
        stopItem.isHidden = !running
        breakNowItem.isHidden = !running || snap.phase == .breakTime
        skipBreakItem.isHidden = !running || snap.phase != .breakTime

        let savedPreset = defaults.integer(forKey: "presetIndex")
        for (i, item) in presetItems.enumerated() {
            item.state = i == savedPreset ? .on : .off
        }
        fastModeItem.state = engine.timeScale > 1 ? .on : .off
        permissionItem.isHidden = ScreenCapturer.hasPermission

        if #available(macOS 13.0, *), Bundle.main.bundlePath.hasSuffix(".app") {
            loginItem.isHidden = false
            loginItem.state = SMAppService.mainApp.status == .enabled ? .on : .off
        } else {
            loginItem.isHidden = true
        }
    }

    // MARK: - Komutlar

    @objc private func startTapped() {
        if !ScreenCapturer.hasPermission {
            // İlk başlatmada sistem izin diyaloğunu tetikle; izin gelmese de
            // uygulama stilize modda sorunsuz çalışır.
            ScreenCapturer.requestPermission()
        }
        engine.start()
    }

    @objc private func stopTapped() { engine.stop() }
    @objc private func breakNowTapped() { engine.startBreakNow() }
    @objc private func skipBreakTapped() { engine.skipBreak() }

    @objc private func presetTapped(_ sender: NSMenuItem) {
        defaults.set(sender.tag, forKey: "presetIndex")
        applySavedPreset()
        if engine.isRunning { engine.start() } // yeni sürelerle turu baştan başlat
    }

    private func applySavedPreset() {
        let index = defaults.integer(forKey: "presetIndex")
        let preset = presets[min(max(index, 0), presets.count - 1)]
        engine.durations = .preset(workMinutes: preset.0, breakMinutes: preset.1)
    }

    @objc private func fastModeTapped() {
        engine.timeScale = engine.timeScale > 1 ? 1 : 60
        if engine.isRunning { engine.start() }
    }

    @objc private func permissionTapped() {
        ScreenCapturer.requestPermission()
        if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture") {
            NSWorkspace.shared.open(url)
        }
    }

    @objc private func loginTapped() {
        guard #available(macOS 13.0, *) else { return }
        do {
            if SMAppService.mainApp.status == .enabled {
                try SMAppService.mainApp.unregister()
            } else {
                try SMAppService.mainApp.register()
            }
        } catch {
            NSLog("[KaraDelik] Girişte başlat ayarlanamadı: %@", "\(error)")
        }
    }

    @objc private func quitTapped() { NSApp.terminate(nil) }
}
