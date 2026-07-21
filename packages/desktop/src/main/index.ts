import {
  app,
  BrowserWindow,
  desktopCapturer,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  screen,
  shell,
  systemPreferences,
  Tray,
  type MenuItemConstructorOptions,
} from 'electron';
import { join } from 'node:path';
import {
  FocusEngine,
  I18n,
  PRODUCT,
  compareVersions,
  formatDuration,
  resolveLocale,
  settingsToDurations,
  type EngineSnapshot,
  type LocaleCode,
  type Phase,
  type Settings,
} from '@blackholock/core';
import { SettingsStore } from './settingsStore.js';
import { StatsStore } from './statsStore.js';
import { OverlayManager } from './overlay.js';
import { trayIconFor } from './trayIcon.js';

const isDev = !app.isPackaged;
const devServerUrl = process.env.ELECTRON_RENDERER_URL;

/**
 * Development accelerators. `--fast=60` compresses a 60-minute cycle into 60
 * seconds so the whole arc — birth, growth, swallow, break, collapse — can be
 * watched and verified in under two minutes instead of an hour.
 */
const fastArg = process.argv.find((arg) => arg.startsWith('--fast'));
const TIME_SCALE = fastArg ? Number(fastArg.split('=')[1] ?? 60) || 60 : 1;
const AUTOSTART = process.argv.includes('--autostart');
/** How long the Mola Ver gate waits before the break begins on its own. */
const MOLA_VER_SECONDS = 20;
/** Opens the settings window straight away — used when reviewing the panel. */
const OPEN_SETTINGS = process.argv.includes('--settings');
const rendererDir = join(__dirname, '../renderer');
const preloadPath = join(__dirname, '../preload/index.cjs');

/** One instance only: two overlays fighting for the screen would be a mess. */
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

class BlackHolock {
  private readonly store = new SettingsStore();
  private readonly stats = new StatsStore();
  private readonly engine: FocusEngine;
  private readonly i18n = new I18n();
  private overlay!: OverlayManager;
  private tray: Tray | null = null;
  private settingsWindow: BrowserWindow | null = null;
  private tickTimer: NodeJS.Timeout | null = null;
  private molaVerTimer: NodeJS.Timeout | null = null;
  private breakSoonNotified = false;
  private lastRenderedTrayTitle = '';
  /** Wall time of the last stats sample, so a tick records real elapsed time. */
  private lastStatsAt = 0;

  constructor() {
    const settings = this.store.get();
    this.engine = new FocusEngine({
      durations: settingsToDurations(settings),
      autoContinue: settings.autoContinue,
      targetCycles: settings.sessionCycles,
      timeScale: TIME_SCALE,
    });
    this.i18n.setLocale(settings.locale, app.getLocale());
  }

  // ------------------------------------------------------------------ startup

  async start(): Promise<void> {
    // Start as a menu-bar utility with no Dock icon. A Dock icon and a window
    // appear together the moment there is a real window to show, and go away
    // again when it closes — see syncDock(). The transparent overlay never adds
    // a Dock entry of its own: it is borderless and skips the taskbar.
    if (process.platform === 'darwin') app.dock?.hide();

    // The overlay windows are created on the first countdown, not at launch.
    // A full-screen transparent window at screen-saver level is composited by
    // the OS over everything else for as long as it exists, so one should not
    // exist during the 45 minutes when it has nothing to show.
    this.overlay = new OverlayManager(preloadPath, rendererDir, devServerUrl);
    // If an overlay renderer ever crashes or hangs, stop the whole cycle so the
    // screen is never left covered by a dead, input-swallowing window.
    this.overlay.setEmergencyHandler(() => this.emergencyRelease('overlay renderer failure'));

    this.buildTray();
    this.registerIpc();
    // The hard guarantee that the app can never trap the machine: a global
    // shortcut, live for the entire session, handled entirely here in the main
    // process. It works from any phase and does not depend on the overlay
    // renderer being alive.
    this.registerPanicShortcut();

    this.engine.onPhaseChange((next, previous) => this.handlePhaseChange(next, previous));
    this.i18n.subscribe(() => {
      this.refreshTray();
      this.overlay.broadcast('locale:changed', this.i18n.getLocale());
    });

    // The tick only runs while a cycle is running. When idle there is nothing
    // to count down and nothing to notify, so leaving a 500 ms timer firing
    // forever just burned wakeups and kept the CPU (and App Nap) from settling.
    // It is started in startFocus() and stopped when the engine goes idle.

    const settings = this.store.get();
    if (settings.launchAtLogin !== app.getLoginItemSettings().openAtLogin) {
      this.applyLoginItem(settings.launchAtLogin);
    }
    if (settings.autoStartOnLaunch || AUTOSTART) this.startFocus();
    // Open the main window on a normal launch, so double-clicking the app icon
    // opens a window in the Dock like any ordinary app. When macOS started us
    // hidden at login, stay in the background — tray only, no window, no Dock.
    const startedHidden =
      process.platform === 'darwin' && app.getLoginItemSettings().wasOpenedAsHidden;
    if (OPEN_SETTINGS) this.openSettings('appearance');
    else if (!startedHidden) this.openSettings();
    if (TIME_SCALE !== 1) console.log(`[BlackHolock] Fast mode: ${TIME_SCALE}× time scale`);
    if (settings.checkForUpdates) void this.checkForUpdates(false);

    if (process.env.DEBUG_CAPTURE) {
      const every = Number(process.env.DEBUG_CAPTURE) || 1500;
      setInterval(() => {
        void this.overlay.captureTo(`/tmp/cap_${Date.now()}.png`);
      }, every);
    }
    if (process.env.DEBUG_SETTINGS_CAP) {
      this.openSettings();
      setTimeout(() => {
        const w = this.settingsWindow;
        if (!w || w.isDestroyed()) return;
        w.webContents.send('settings:navigate', process.env.DEBUG_SETTINGS_CAP);
        setTimeout(() => {
          w.webContents
            .capturePage()
            .then((img) => import('node:fs').then((fs) => {
              fs.writeFileSync('/tmp/settings_cap.png', img.toPNG());
              console.log('[BlackHolock] settings captured → /tmp/settings_cap.png');
            }))
            .catch((e) => console.error('[BlackHolock] settings-cap failed:', e));
        }, 900);
      }, 3500);
    }

    const storeError = this.store.takeError();
    if (storeError) {
      this.notify(this.i18n.t('error.settingsCorrupt'), '');
    }

    this.refreshTray();
  }

  // ------------------------------------------------------------------- engine

  private startFocus(): void {
    this.breakSoonNotified = false;
    this.engine.start();
    this.startTicking();
    this.pushSync();
    this.refreshTray();
  }

  private stopFocus(): void {
    this.engine.stop();
    this.stopTicking();
    this.overlay.hide();
    this.pushSync();
    this.refreshTray();
  }

  /** Runs the 500 ms countdown tick only while a cycle is live. */
  private startTicking(): void {
    if (this.tickTimer) return;
    this.lastStatsAt = Date.now();
    this.tickTimer = setInterval(() => this.tick(), 500);
  }

  private stopTicking(): void {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }

  private tick(): void {
    const snapshot = this.engine.tick();
    this.recordStats(snapshot);
    this.maybeNotifyBreakSoon(snapshot);
    this.refreshTray(snapshot);
  }

  /**
   * Attributes the real time elapsed since the last sample to focus or break.
   * Focus and warning both count as focused work; only a running (not paused)
   * break counts as break time.
   */
  private recordStats(snapshot: EngineSnapshot): void {
    const now = Date.now();
    const delta = (now - this.lastStatsAt) / 1000;
    this.lastStatsAt = now;
    // Ignore the first tick and any implausibly large gap (sleep, clock jump).
    if (delta <= 0 || delta > 5) return;

    if (snapshot.phase === 'focus' || snapshot.phase === 'warning') {
      this.stats.record('focus', delta, this.store.get().effectId, now);
    } else if (snapshot.phase === 'break' && !this.engine.isPaused) {
      this.stats.record('break', delta, this.store.get().effectId, now);
    }
  }

  private handlePhaseChange(next: Phase, previous: Phase): void {
    const settings = this.store.get();
    console.log(`[BlackHolock] Phase: ${previous} → ${next}`);

    // The swallow and collapse animations are wall-clock, so in fast mode they
    // must be scaled too or they would outlast the phase they belong to.
    const scale = TIME_SCALE;

    switch (next) {
      case 'warning':
        this.overlay.ensure(settings);
        this.overlay.show();
        this.overlay.setBreakMode('off');
        break;

      case 'break':
        this.overlay.ensure(settings);
        this.overlay.show();
        // Freeze the break at its full length: it does not begin counting down
        // until the user presses Mola Ver, or the gate times out.
        this.engine.pause();
        // A system-wide escape hatch, live for the whole break.
        this.registerBreakEscape();
        // After the swallow animation has covered the screen, raise the Mola Ver
        // gate — the break UI, but paused, waiting to begin.
        setTimeout(() => {
          if (this.engine.snapshot().phase !== 'break') return;
          const autoBeginAt = Date.now() + MOLA_VER_SECONDS * 1000;
          this.overlay.setBreakMode('pending', autoBeginAt);
          // Auto-begin if the user does nothing.
          this.clearMolaVerTimeout();
          this.molaVerTimer = setTimeout(() => this.beginBreak(), MOLA_VER_SECONDS * 1000);
        }, 2200 / scale);
        break;

      case 'focus':
        this.overlay.setBreakMode('off');
        this.clearMolaVerTimeout();
        this.breakSoonNotified = false;
        this.unregisterBreakEscape();
        if (previous === 'break') {
          if (settings.notifyBeforeBreak) {
            this.notify(
              this.i18n.t('notify.breakOverTitle'),
              this.i18n.t('notify.breakOverBody', { number: this.engine.snapshot().cycle }),
            );
          }
          // Give the collapse animation time to play before hiding.
          setTimeout(() => {
            if (this.engine.snapshot().phase === 'focus') this.overlay.hide();
          }, 1400 / scale);
        } else {
          this.overlay.hide();
        }
        break;

      case 'idle':
        this.unregisterBreakEscape();
        this.clearMolaVerTimeout();
        this.stopTicking();
        this.overlay.hide();
        break;
    }

    this.pushSync();
    this.refreshTray();
  }

  private maybeNotifyBreakSoon(snapshot: EngineSnapshot): void {
    if (!this.store.get().notifyBeforeBreak) return;
    if (snapshot.phase === 'break' || snapshot.phase === 'idle') return;

    const untilBreak = this.engine.secondsUntilBreak();
    if (!this.breakSoonNotified && untilBreak > 0 && untilBreak <= 60) {
      this.breakSoonNotified = true;
      this.notify(this.i18n.t('notify.breakSoonTitle'), this.i18n.t('notify.breakSoonBody'));
    }
  }

  private pushSync(): void {
    this.overlay.sync(this.engine.getSyncState(), this.store.get());
    this.settingsWindow?.webContents.send('engine:sync', this.engine.getSyncState());
  }

  // --------------------------------------------------------------------- tray

  private buildTray(): void {
    this.tray = new Tray(trayIconFor('idle'));
    this.tray.setToolTip(PRODUCT.name);
    this.refreshTray();
  }

  private refreshTray(snapshot: EngineSnapshot = this.engine.snapshot()): void {
    if (!this.tray) return;
    const t = this.i18n.t;
    const time = formatDuration(snapshot.remaining);

    let title = '';
    let status = t('tray.statusIdle');
    switch (snapshot.phase) {
      case 'focus':
        title = time;
        status = t('tray.statusFocus', { time });
        break;
      case 'warning':
        title = time;
        status = t('tray.statusWarning', { time });
        break;
      case 'break':
        title = time;
        status = t('tray.statusBreak', { time });
        break;
      default:
        title = '';
    }

    // Only touch the tray when something actually changed — on macOS an
    // unnecessary setTitle repaints the menu bar every tick.
    if (title !== this.lastRenderedTrayTitle) {
      this.lastRenderedTrayTitle = title;
      if (process.platform === 'darwin') this.tray.setTitle(title ? ` ${title}` : '');
      this.tray.setImage(trayIconFor(snapshot.phase));
    }
    this.tray.setToolTip(`${PRODUCT.name} — ${status}`);
    this.tray.setContextMenu(this.buildMenu(snapshot, status));
  }

  private buildMenu(snapshot: EngineSnapshot, status: string): Menu {
    const t = this.i18n.t;
    const running = this.engine.isRunning;
    const inBreak = snapshot.phase === 'break';

    const items: MenuItemConstructorOptions[] = [
      { label: status, enabled: false },
      ...(running
        ? [{ label: t('tray.cycleLabel', { number: snapshot.cycle }), enabled: false }]
        : []),
      { type: 'separator' },
      ...(running
        ? [
            { label: t('tray.stop'), click: () => this.stopFocus() },
            ...(inBreak
              ? [{ label: t('tray.skipBreak'), click: () => this.skipBreak() }]
              : [{ label: t('tray.breakNow'), click: () => this.breakNow() }]),
          ]
        : [{ label: t('tray.start'), click: () => this.startFocus() }]),
      { type: 'separator' },
      { label: t('tray.settings'), click: () => this.openSettings() },
      { label: t('tray.about'), click: () => this.openSettings('about') },
      { type: 'separator' },
      { label: t('tray.quit'), click: () => this.quit() },
    ];

    return Menu.buildFromTemplate(items);
  }

  /**
   * Binds the emergency escape for the duration of a break.
   *
   * Cmd+Escape (Ctrl+Escape on Windows/Linux) ends the break immediately, from
   * anywhere, regardless of what has keyboard focus. The break overlay is
   * deliberately not focusable and sits above the menu bar, which means the
   * ordinary ways out — the tray menu, a click on a control — can be out of
   * reach. This cannot be. A focus app that can lock you out of your own
   * machine for ten minutes is broken, so this shortcut is the hard guarantee
   * that the break is always escapable.
   */
  private registerBreakEscape(): void {
    const accel = process.platform === 'darwin' ? 'Command+Escape' : 'Control+Escape';
    for (const shortcut of [accel, 'CommandOrControl+Shift+B']) {
      try {
        const ok = globalShortcut.register(shortcut, () => {
          if (this.engine.snapshot().phase === 'break') this.skipBreak();
        });
        if (!ok || !globalShortcut.isRegistered(shortcut)) {
          // register() returns false (rather than throwing) when the OS owns the
          // combo — Command+Escape on macOS often does. Do not trust it silently;
          // the always-on panic shortcut is the real guarantee, so just note it.
          console.warn(`[BlackHolock] Break-skip shortcut unavailable: ${shortcut}`);
        }
      } catch (error) {
        console.error(`[BlackHolock] Could not register ${shortcut}:`, error);
      }
    }
  }

  private unregisterBreakEscape(): void {
    globalShortcut.unregister('Command+Escape');
    globalShortcut.unregister('Control+Escape');
    globalShortcut.unregister('CommandOrControl+Shift+B');
  }

  /**
   * The panic release. Registered once, for the whole life of the app, and
   * handled entirely in the main process so it survives an overlay renderer
   * crash. It returns full control from *any* state: break mode off, overlay
   * destroyed, engine stopped so nothing re-covers the screen. This is the
   * promise that BlackHolock can never lock you out of your own machine.
   *
   * The accelerators are kept disjoint from the break-skip ones above so the
   * two never clobber each other's registration.
   */
  private registerPanicShortcut(): void {
    const accelerators = [
      'CommandOrControl+Alt+Shift+H', // primary — registers reliably everywhere
      'CommandOrControl+Alt+Shift+Escape',
    ];
    const registered: string[] = [];
    for (const accel of accelerators) {
      try {
        if (
          globalShortcut.register(accel, () => this.emergencyRelease('panic shortcut')) &&
          globalShortcut.isRegistered(accel)
        ) {
          registered.push(accel);
        }
      } catch (error) {
        console.error(`[BlackHolock] Could not register ${accel}:`, error);
      }
    }
    if (registered.length === 0) {
      console.error(
        '[BlackHolock] No emergency-release shortcut could be registered. ' +
          'The tray menu is still available; investigate before shipping.',
      );
    } else {
      console.log(`[BlackHolock] Emergency release: ${registered.join(' / ')}`);
    }
  }

  /**
   * Returns full control to the user, from any phase, right now. Safe to call
   * repeatedly and whether or not a cycle is running.
   */
  private emergencyRelease(source: string): void {
    console.log(`[BlackHolock] Emergency release (${source}) — returning control to the user`);
    // Drop input-swallowing immediately, before the slower teardown below.
    this.overlay.forceReleaseInput();
    this.unregisterBreakEscape();
    this.clearMolaVerTimeout();
    this.engine.stop();
    this.overlay.hide();
    this.breakSoonNotified = false;
    this.pushSync();
    this.refreshTray();
  }

  private breakNow(): void {
    this.engine.breakNow();
    this.pushSync();
    this.refreshTray();
  }

  private skipBreak(): void {
    this.clearMolaVerTimeout();
    this.engine.skipBreak();
    this.overlay.setBreakMode('off');
    this.overlay.hide();
    this.pushSync();
    this.refreshTray();
  }

  /**
   * The Mola Ver button (or the gate's timeout): begin the break countdown now.
   * Resumes the paused engine and switches the overlay from the waiting gate to
   * the running countdown.
   */
  private beginBreak(): void {
    this.clearMolaVerTimeout();
    if (this.engine.snapshot().phase !== 'break') return;
    this.engine.resume();
    this.overlay.setBreakMode('active');
    this.pushSync();
    this.refreshTray();
  }

  private clearMolaVerTimeout(): void {
    if (this.molaVerTimer) {
      clearTimeout(this.molaVerTimer);
      this.molaVerTimer = null;
    }
  }

  // ----------------------------------------------------------------- settings

  /**
   * The Dock icon follows the window: shown while a settings window is open,
   * hidden when there is none. This is what lets a double-click on the app icon
   * open a real Dock window, without the app cluttering the Dock the rest of the
   * time it lives quietly in the menu bar.
   */
  private syncDock(): void {
    if (process.platform !== 'darwin') return;
    const hasWindow = !!this.settingsWindow && !this.settingsWindow.isDestroyed();
    if (hasWindow) void app.dock?.show();
    else app.dock?.hide();
  }

  /**
   * Reopen from the Dock icon or from double-clicking the app while it is
   * already running (macOS fires `activate` / `second-instance`). Brings the
   * settings window back, creating it if the last one was closed.
   */
  reopen(): void {
    this.openSettings();
  }

  private openSettings(section?: string): void {
    if (this.settingsWindow && !this.settingsWindow.isDestroyed()) {
      this.syncDock();
      this.settingsWindow.show();
      this.settingsWindow.focus();
      if (section) this.settingsWindow.webContents.send('settings:navigate', section);
      return;
    }

    const win = new BrowserWindow({
      // Wide enough for the Appearance panel's two columns; below
      // minWidth it falls back to a single column.
      width: 1080,
      height: 720,
      minWidth: 760,
      minHeight: 560,
      show: false,
      title: PRODUCT.name,
      backgroundColor: '#05060a',
      titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
      autoHideMenuBar: true,
      webPreferences: {
        preload: preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });

    // Same console bridge as the overlay: a failure inside the settings
    // renderer would otherwise be invisible.
    win.webContents.on('console-message', (_event, level, message) => {
      if (level >= 1 || isDev) console.log(`[settings] ${message}`);
    });

    // The settings window runs a live WebGL preview. If that renderer ever
    // crashes the window would be left blank; reload it once so the panel comes
    // back instead of showing an empty shell.
    win.webContents.on('render-process-gone', (_event, details) => {
      if (details.reason === 'clean-exit' || win.isDestroyed()) return;
      console.error(`[settings] renderer gone (${details.reason}); reloading`);
      win.reload();
    });

    win.once('ready-to-show', () => {
      // Show the Dock icon alongside the window, then bring both to the front.
      this.syncDock();
      win.show();
      win.focus();
      if (process.platform === 'darwin') app.focus({ steal: true });
      if (section) win.webContents.send('settings:navigate', section);
    });
    win.on('closed', () => {
      this.settingsWindow = null;
      // Back to a pure menu-bar utility once the last window is gone.
      this.syncDock();
    });

    // External links open in the real browser, never inside the app.
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('https://')) void shell.openExternal(url);
      return { action: 'deny' };
    });

    if (devServerUrl) void win.loadURL(`${devServerUrl}/settings.html`);
    else void win.loadFile(join(rendererDir, 'settings.html'));

    this.settingsWindow = win;
  }

  private applySettings(patch: Partial<Settings>): Settings {
    const before = this.store.get();
    const settings = this.store.update(patch);

    if (
      settings.workMinutes !== before.workMinutes ||
      settings.breakMinutes !== before.breakMinutes ||
      settings.warningMinutes !== before.warningMinutes
    ) {
      // Restarting the cycle is the honest thing to do: silently keeping the
      // old countdown after the user shortened it would be a surprise.
      this.engine.setDurations(settingsToDurations(settings));
    }
    if (settings.autoContinue !== before.autoContinue) {
      this.engine.setAutoContinue(settings.autoContinue);
    }
    if (settings.sessionCycles !== before.sessionCycles) {
      this.engine.setTargetCycles(settings.sessionCycles);
    }
    if (settings.locale !== before.locale) {
      this.i18n.setLocale(settings.locale, app.getLocale());
    }
    if (settings.screenLensing !== before.screenLensing) {
      this.overlay.setLensing(settings.screenLensing);
    }
    if (settings.launchAtLogin !== before.launchAtLogin) {
      this.applyLoginItem(settings.launchAtLogin);
    }

    this.pushSync();
    this.refreshTray();
    this.settingsWindow?.webContents.send('settings:changed', settings);
    return settings;
  }

  private applyLoginItem(enabled: boolean): void {
    if (isDev) return; // a dev build registering itself at login is a trap
    app.setLoginItemSettings({ openAtLogin: enabled, openAsHidden: true });
  }

  // ---------------------------------------------------------------- capturing

  /**
   * Resolves the capture source for a given display.
   *
   * The earlier approach answered `getDisplayMedia()` and tried to work out
   * which overlay had asked from the request object. That matching was
   * unreliable and failed outright, so lensing never ran. Now each overlay
   * knows its own display id (passed in its URL) and asks for that source by
   * name, which removes the guesswork entirely.
   *
   * Because the overlay window sets content protection, it is absent from the
   * frames it receives and cannot photograph itself into a feedback loop.
   */
  private async resolveCaptureSource(displayId: number): Promise<string | null> {
    if (!this.store.get().screenLensing) return null;
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 0, height: 0 },
        fetchWindowIcons: false,
      });
      if (sources.length === 0) return null;

      const exact = sources.find((source) => source.display_id === String(displayId));
      return (exact ?? sources[0]!).id;
    } catch (error) {
      // On macOS this is what a missing Screen Recording permission looks like.
      console.warn('[BlackHolock] Capture source unavailable:', String(error));
      return null;
    }
  }

  /** `granted`, `denied`, `restricted`, `not-determined`, or `unknown`. */
  private screenPermission(): string {
    if (process.platform !== 'darwin') return 'granted';
    try {
      return systemPreferences.getMediaAccessStatus('screen');
    } catch {
      return 'unknown';
    }
  }

  // ------------------------------------------------------------------ updates

  /**
   * Checks the public releases API. No account, no telemetry, no identifiers —
   * one anonymous GET whose only payload is the tag name that comes back.
   */
  private async checkForUpdates(interactive: boolean): Promise<{
    status: 'current' | 'available' | 'error';
    version?: string;
    url?: string;
  }> {
    try {
      const response = await fetch(PRODUCT.latestReleaseApi, {
        headers: { Accept: 'application/vnd.github+json' },
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) return { status: 'error' };

      const release = (await response.json()) as { tag_name?: string; html_url?: string };
      const latest = release.tag_name ?? '';
      if (!latest) return { status: 'error' };

      if (compareVersions(latest, PRODUCT.version) > 0) {
        if (interactive === false) {
          this.notify(
            this.i18n.t('about.updateAvailable', { version: latest.replace(/^v/, '') }),
            PRODUCT.name,
          );
        }
        return { status: 'available', version: latest.replace(/^v/, ''), url: release.html_url };
      }
      return { status: 'current' };
    } catch {
      return { status: 'error' };
    }
  }

  // --------------------------------------------------------------------- misc

  private notify(title: string, body: string): void {
    if (!Notification.isSupported()) return;
    new Notification({ title, body, silent: !this.store.get().soundEnabled }).show();
  }

  private registerIpc(): void {
    ipcMain.handle('settings:get', () => this.store.get());
    ipcMain.handle('settings:set', (_event, patch: Partial<Settings>) => this.applySettings(patch));
    ipcMain.handle('settings:reset', () => {
      const settings = this.store.reset();
      this.engine.setDurations(settingsToDurations(settings));
      this.i18n.setLocale(settings.locale, app.getLocale());
      this.overlay.setLensing(settings.screenLensing);
      this.pushSync();
      this.refreshTray();
      return settings;
    });

    ipcMain.handle('engine:state', () => this.engine.getSyncState());
    ipcMain.handle('engine:start', () => {
      this.startFocus();
      return this.engine.getSyncState();
    });
    ipcMain.handle('engine:stop', () => {
      this.stopFocus();
      return this.engine.getSyncState();
    });
    ipcMain.handle('engine:breakNow', () => {
      this.breakNow();
      return this.engine.getSyncState();
    });
    ipcMain.handle('engine:skipBreak', () => {
      this.skipBreak();
      return this.engine.getSyncState();
    });
    ipcMain.handle('engine:beginBreak', () => {
      this.beginBreak();
      return this.engine.getSyncState();
    });

    ipcMain.handle('stats:get', () => this.stats.get());

    ipcMain.handle('app:info', () => ({
      name: PRODUCT.name,
      version: PRODUCT.version,
      channel: PRODUCT.channel,
      platform: `${process.platform === 'darwin' ? 'macOS' : process.platform === 'win32' ? 'Windows' : process.platform} · Electron ${process.versions.electron}`,
      repository: PRODUCT.repository,
      releasesUrl: PRODUCT.releasesUrl,
      licence: PRODUCT.licence,
      settingsPath: this.store.path,
      systemLocale: app.getLocale(),
      isDev,
    }));
    ipcMain.handle('app:checkUpdates', () => this.checkForUpdates(true));
    ipcMain.handle('capture:source', (_event, displayId: number) =>
      this.resolveCaptureSource(displayId),
    );
    ipcMain.handle('capture:permission', () => this.screenPermission());
    ipcMain.handle('capture:openPrefs', () => {
      if (process.platform === 'darwin') {
        void shell.openExternal(
          'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
        );
      }
    });
    ipcMain.handle('app:openExternal', (_event, url: string) => {
      // Only ever open https, and only to our own project.
      if (typeof url === 'string' && url.startsWith('https://')) void shell.openExternal(url);
    });
    ipcMain.handle('locale:resolve', (_event, requested: LocaleCode | 'system') =>
      requested === 'system' ? resolveLocale(app.getLocale()) : requested,
    );
  }

  private quit(): void {
    globalShortcut.unregisterAll();
    this.store.flush();
    this.stats.flush();
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.overlay.dispose();
    this.tray?.destroy();
    app.exit(0);
  }
}

// ---------------------------------------------------------------- entry point

app.setAppUserModelId(PRODUCT.appId);
// Transparent windows composite far better with the GPU rasteriser left alone.
app.commandLine.appendSwitch('enable-gpu-rasterization');

const instance = new BlackHolock();

void app.whenReady().then(() => instance.start());

// Double-clicking the app icon while it is already running (it lives in the
// menu bar, so it usually is) lands here rather than starting a new process.
// Both paths reopen the window instead of doing nothing.
app.on('second-instance', () => instance.reopen());
app.on('activate', () => instance.reopen());

// Visibility into GPU / utility process crashes. The overlay renderer has its
// own recovery (see OverlayManager); this catches the GPU process and friends,
// which is where the transparent-window + WebGL crashes showed up. Logged, not
// swallowed, so a support build can tell why a machine misbehaved. A repeatedly
// crashing GPU process is Chromium's own signal to consider disabling hardware
// acceleration, but we never trap the user over it.
app.on('child-process-gone', (_event, details) => {
  if (details.reason === 'clean-exit' || details.reason === 'killed') return;
  console.error(
    `[BlackHolock] Child process gone: type=${details.type} reason=${details.reason} exit=${details.exitCode}`,
  );
});
app.on('render-process-gone', (_event, _contents, details) => {
  if (details.reason === 'clean-exit') return;
  console.error(`[BlackHolock] Renderer gone: reason=${details.reason} exit=${details.exitCode}`);
});

app.on('window-all-closed', () => {
  // A tray app stays alive with no windows open. This is deliberate.
});

export { nativeImage };
