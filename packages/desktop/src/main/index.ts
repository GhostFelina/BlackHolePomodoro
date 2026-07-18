import {
  app,
  BrowserWindow,
  desktopCapturer,
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
const rendererDir = join(__dirname, '../renderer');
const preloadPath = join(__dirname, '../preload/index.cjs');

/** One instance only: two overlays fighting for the screen would be a mess. */
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

class BlackHolock {
  private readonly store = new SettingsStore();
  private readonly engine: FocusEngine;
  private readonly i18n = new I18n();
  private overlay!: OverlayManager;
  private tray: Tray | null = null;
  private settingsWindow: BrowserWindow | null = null;
  private tickTimer: NodeJS.Timeout | null = null;
  private breakSoonNotified = false;
  private lastRenderedTrayTitle = '';

  constructor() {
    const settings = this.store.get();
    this.engine = new FocusEngine({
      durations: settingsToDurations(settings),
      autoContinue: settings.autoContinue,
      timeScale: TIME_SCALE,
    });
    this.i18n.setLocale(settings.locale, app.getLocale());
  }

  // ------------------------------------------------------------------ startup

  async start(): Promise<void> {
    // The overlay must never appear in the Dock or the alt-tab list.
    if (process.platform === 'darwin') app.dock?.hide();

    this.overlay = new OverlayManager(preloadPath, rendererDir, devServerUrl);
    this.overlay.ensure(this.store.get());

    this.buildTray();
    this.registerIpc();

    this.engine.onPhaseChange((next, previous) => this.handlePhaseChange(next, previous));
    this.i18n.subscribe(() => {
      this.refreshTray();
      this.overlay.broadcast('locale:changed', this.i18n.getLocale());
    });

    // A coarse tick is enough in the main process: the windows compute the
    // animation themselves from the synced cycle start.
    this.tickTimer = setInterval(() => this.tick(), 500);

    const settings = this.store.get();
    if (settings.launchAtLogin !== app.getLoginItemSettings().openAtLogin) {
      this.applyLoginItem(settings.launchAtLogin);
    }
    if (settings.autoStartOnLaunch || AUTOSTART) this.startFocus();
    if (TIME_SCALE !== 1) console.log(`[BlackHolock] Fast mode: ${TIME_SCALE}× time scale`);
    if (settings.checkForUpdates) void this.checkForUpdates(false);

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
    this.pushSync();
    this.refreshTray();
  }

  private stopFocus(): void {
    this.engine.stop();
    this.overlay.hide();
    this.pushSync();
    this.refreshTray();
  }

  private tick(): void {
    const snapshot = this.engine.tick();
    this.maybeNotifyBreakSoon(snapshot);
    this.refreshTray(snapshot);
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
        this.overlay.setBreakMode(false);
        break;

      case 'break':
        this.overlay.ensure(settings);
        this.overlay.show();
        // The window only starts swallowing input once the animation has
        // finished covering the screen, so the last seconds of work are not
        // stolen by a window that is still mostly transparent.
        setTimeout(() => {
          if (this.engine.snapshot().phase === 'break') this.overlay.setBreakMode(true);
        }, 2200 / scale);
        break;

      case 'focus':
        this.overlay.setBreakMode(false);
        this.breakSoonNotified = false;
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

  private breakNow(): void {
    this.engine.breakNow();
    this.pushSync();
    this.refreshTray();
  }

  private skipBreak(): void {
    this.engine.skipBreak();
    this.overlay.setBreakMode(false);
    this.overlay.hide();
    this.pushSync();
    this.refreshTray();
  }

  // ----------------------------------------------------------------- settings

  private openSettings(section?: string): void {
    if (this.settingsWindow && !this.settingsWindow.isDestroyed()) {
      this.settingsWindow.show();
      this.settingsWindow.focus();
      if (section) this.settingsWindow.webContents.send('settings:navigate', section);
      return;
    }

    const win = new BrowserWindow({
      width: 880,
      height: 680,
      minWidth: 720,
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

    win.once('ready-to-show', () => {
      win.show();
      if (section) win.webContents.send('settings:navigate', section);
    });
    win.on('closed', () => {
      this.settingsWindow = null;
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
    this.store.flush();
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

app.on('window-all-closed', () => {
  // A tray app stays alive with no windows open. This is deliberate.
});

export { nativeImage };
