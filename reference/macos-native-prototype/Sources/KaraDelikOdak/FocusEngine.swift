import Foundation
#if canImport(AppKit)
import AppKit
#endif

/// Odak döngüsünün durum makinesi.
///
/// Zaman, tik sayacı biriktirerek değil, duvar saatinden (Date) hesaplanır —
/// böylece Mac uyuyup uyansa bile faz hesabı asla kaymaz.
///
/// Döngü düzeni (varsayılan 50 + 10):
///   0 ............ 45 ............. 50 ................. 60 dk
///   |  çalışma     |  uyarı        |  mola              |
///   |  (görünmez)  |  kara delik   |  ekran kapalı      |
///   |              |  doğar+büyür  |  geri sayım        |
///   sonra döngü otomatik olarak baştan başlar.
final class FocusEngine {

    enum Phase: Equatable {
        case idle       // sayaç çalışmıyor
        case working    // sessiz çalışma dönemi
        case warning    // kara delik görünür ve büyür
        case breakTime  // ekran ele geçirildi, mola
    }

    struct Durations {
        /// Toplam çalışma süresi (uyarı penceresi dahil).
        var work: TimeInterval
        /// Çalışmanın SONUNDAKİ uyarı penceresi (kara deliğin büyüme süresi).
        var warning: TimeInterval
        /// Mola süresi.
        var breakTime: TimeInterval

        static let standard = Durations(work: 50 * 60, warning: 5 * 60, breakTime: 10 * 60)

        static func preset(workMinutes: Int, breakMinutes: Int) -> Durations {
            let work = TimeInterval(workMinutes * 60)
            // Uyarı penceresi 5 dk, ama kısa çalışma sürelerinde işin %20'sini geçmesin.
            let warning = min(5 * 60, work * 0.2)
            return Durations(work: work, warning: warning, breakTime: TimeInterval(breakMinutes * 60))
        }
    }

    /// UI katmanına her tikte verilen anlık görüntü.
    struct Snapshot: Equatable {
        var phase: Phase
        /// Çalışma fazında: molaya kalan süre. Molada: molanın bitmesine kalan süre.
        var remaining: TimeInterval
        /// Uyarı fazında 0→1 (kara deliğin büyüme oranı). Diğer fazlarda 0 veya 1.
        var warningProgress: Double
        /// Kaçıncı tur (1'den başlar).
        var cycle: Int
    }

    var durations: Durations = .standard
    /// Hızlı test modu: 60 → tüm süreler 60 kat kısalır (50 dk → 50 sn).
    var timeScale: Double = 1.0

    var onTick: ((Snapshot) -> Void)?
    var onPhaseChange: ((Phase, Phase) -> Void)?

    private(set) var isRunning = false
    private var cycleStart: Date?
    private var completedCycles = 0
    private var timer: Timer?
    private var lastPhase: Phase = .idle

    /// Testlerde sahte saat enjekte edebilmek için.
    var now: () -> Date = { Date() }

    // MARK: - Kontrol

    func start() {
        cycleStart = now()
        completedCycles = 0
        isRunning = true
        lastPhase = .idle
        startTimer()
        tick()
    }

    func stop() {
        timer?.invalidate()
        timer = nil
        isRunning = false
        cycleStart = nil
        let old = lastPhase
        lastPhase = .idle
        if old != .idle { onPhaseChange?(old, .idle) }
        onTick?(Snapshot(phase: .idle, remaining: 0, warningProgress: 0, cycle: completedCycles))
    }

    /// Molayı atla: mola fazından çıkıp hemen yeni çalışma turu başlat.
    func skipBreak() {
        guard isRunning else { return }
        NSLog("[KaraDelik] Mola atlandı")
        completedCycles += 1
        cycleStart = now()
        tick()
    }

    /// Şimdi mola ver: doğrudan mola fazının başına atla.
    func startBreakNow() {
        guard isRunning else { return }
        cycleStart = now().addingTimeInterval(-effective(durations.work))
        tick()
    }

    // MARK: - Hesap

    private func effective(_ t: TimeInterval) -> TimeInterval { t / timeScale }

    func snapshot(at date: Date) -> Snapshot {
        guard isRunning, let start = cycleStart else {
            return Snapshot(phase: .idle, remaining: 0, warningProgress: 0, cycle: completedCycles)
        }
        let work = effective(durations.work)
        let warning = effective(durations.warning)
        let brk = effective(durations.breakTime)
        let cycleLen = work + brk

        var elapsed = date.timeIntervalSince(start)

        // Döngü otomatik tekrarlar: geçen tam turları düş.
        if elapsed >= cycleLen {
            let finished = Int(elapsed / cycleLen)
            completedCycles += finished
            cycleStart = start.addingTimeInterval(Double(finished) * cycleLen)
            elapsed = date.timeIntervalSince(cycleStart!)
        }

        let phase: Phase
        let remaining: TimeInterval
        var warningProgress = 0.0

        if elapsed < work - warning {
            phase = .working
            remaining = work - elapsed
        } else if elapsed < work {
            phase = .warning
            remaining = work - elapsed
            warningProgress = (elapsed - (work - warning)) / warning
        } else {
            phase = .breakTime
            remaining = cycleLen - elapsed
            warningProgress = 1.0
        }

        return Snapshot(phase: phase,
                        remaining: remaining,
                        warningProgress: min(max(warningProgress, 0), 1),
                        cycle: completedCycles + 1)
    }

    /// Test için: timer kurmadan, verilen tarihte başlamış say.
    func startForTest(at date: Date) {
        cycleStart = date
        isRunning = true
        completedCycles = 0
        lastPhase = .idle
    }

    // MARK: - Tik

    private func startTimer() {
        timer?.invalidate()
        let t = Timer(timeInterval: 0.25, repeats: true) { [weak self] _ in self?.tick() }
        t.tolerance = 0.05
        RunLoop.main.add(t, forMode: .common)
        timer = t
    }

    private func tick() {
        let snap = snapshot(at: now())
        if snap.phase != lastPhase {
            let old = lastPhase
            lastPhase = snap.phase
            onPhaseChange?(old, snap.phase)
        }
        onTick?(snap)
    }
}

// MARK: - Kendi kendini test

enum SelfTest {
    /// `--selftest` ile çalıştırılır: durum makinesini sahte saatle 3 tur simüle eder.
    static func run() -> Bool {
        let engine = FocusEngine()
        engine.durations = .standard
        engine.timeScale = 1.0

        var fakeNow = Date(timeIntervalSince1970: 1_000_000)
        engine.now = { fakeNow }
        engine.startForTest(at: fakeNow)

        var failures = 0
        func expect(_ cond: Bool, _ label: String) {
            if cond { print("  ✓ \(label)") } else { print("  ✗ BAŞARISIZ: \(label)"); failures += 1 }
        }

        print("Durum makinesi öz-testi (50 dk çalışma / 5 dk uyarı / 10 dk mola):")

        func at(minutes: Double) -> FocusEngine.Snapshot {
            fakeNow = Date(timeIntervalSince1970: 1_000_000 + minutes * 60)
            return engine.snapshot(at: fakeNow)
        }

        var s = at(minutes: 0)
        expect(s.phase == .working && abs(s.remaining - 3000) < 1, "0. dk: çalışma, kalan 50:00")

        s = at(minutes: 30)
        expect(s.phase == .working && abs(s.remaining - 1200) < 1, "30. dk: çalışma, kalan 20:00")

        s = at(minutes: 44.99)
        expect(s.phase == .working, "44:59: hâlâ çalışma (kara delik yok)")

        s = at(minutes: 45.01)
        expect(s.phase == .warning && s.warningProgress < 0.01, "45:01: uyarı başladı, büyüme ~%0")

        s = at(minutes: 47.5)
        expect(s.phase == .warning && abs(s.warningProgress - 0.5) < 0.01, "47:30: büyüme %50")

        s = at(minutes: 49.9)
        expect(s.phase == .warning && s.warningProgress > 0.95, "49:54: büyüme >%95")

        s = at(minutes: 50.01)
        expect(s.phase == .breakTime && abs(s.remaining - 599.4) < 1, "50:01: MOLA başladı, kalan ~10:00")

        s = at(minutes: 59.9)
        expect(s.phase == .breakTime && s.remaining < 7, "59:54: mola bitmek üzere")

        s = at(minutes: 60.5)
        expect(s.phase == .working && s.cycle == 2, "60:30: 2. tur otomatik başladı")

        s = at(minutes: 60.0 + 46)
        expect(s.phase == .warning, "106. dk (2. turun 46. dk'sı): uyarı fazı")

        s = at(minutes: 60.5 + 60)
        expect(s.phase == .working && s.cycle == 3, "120:30: 3. tur otomatik başladı")

        // Hızlı mod ölçekleme testi
        let fast = FocusEngine()
        fast.timeScale = 60
        fast.now = { fakeNow }
        fast.startForTest(at: fakeNow)
        let f = fast.snapshot(at: fakeNow.addingTimeInterval(47.5))
        expect(f.phase == .warning && abs(f.warningProgress - 0.5) < 0.01,
               "hızlı mod: 47.5 sn = uyarı %50")

        print(failures == 0 ? "TÜM TESTLER GEÇTİ ✅" : "\(failures) TEST BAŞARISIZ ❌")
        return failures == 0
    }
}
