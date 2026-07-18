import { BrowserWindow, screen, type Display } from 'electron';
import { join } from 'node:path';
import type { EngineSyncState, Settings } from '@blackholock/core';

/**
 * The full-screen overlay window, one per display.
 *
 * Behaviour that took care to get right on both platforms:
 *
 * - **Click-through while the effect grows.** `setIgnoreMouseEvents(true,
 *   { forward: true })` lets every click reach whatever is underneath, so the
 *   countdown never interrupts work. During the break the flag flips and the
 *   window swallows input instead.
 * - **Above everything.** Level `screen-saver` sits over the macOS menu bar and
 *   the Windows taskbar. `setVisibleOnAllWorkspaces` keeps it there when the
 *   user switches Spaces or virtual desktops.
 * - **Excluded from its own capture.** `setContentProtection(true)` sets
 *   NSWindowSharingNone on macOS and WDA_EXCLUDEFROMCAPTURE on Windows, which
 *   is what stops the lensing effect from photographing itself into an
 *   infinite mirror. It is switched off when lensing is off, so the effect
 *   remains screen-recordable for anyone who wants to share it.
 * - **Never focus-stealing.** `focusable: false` outside the break means the
 *   window cannot take keyboard focus away from the editor you are typing in.
 */

const OVERLAY_ROUTE = 'overlay.html';

export class OverlayManager {
  private windows = new Map<number, BrowserWindow>();
  private breakMode = false;
  private lensingEnabled = true;
  private disposed = false;

  constructor(
    private readonly preloadPath: string,
    private readonly rendererDir: string,
    private readonly devServerUrl: string | undefined,
  ) {
    screen.on('display-added', this.syncDisplays);
    screen.on('display-removed', this.syncDisplays);
    screen.on('display-metrics-changed', this.syncDisplays);
  }

  /** Creates windows for every display if they do not exist yet. */
  ensure(settings: Settings): void {
    if (this.disposed) return;
    this.lensingEnabled = settings.screenLensing;
    for (const display of screen.getAllDisplays()) {
      if (!this.windows.has(display.id)) {
        this.windows.set(display.id, this.createWindow(display));
      }
    }
  }

  private createWindow(display: Display): BrowserWindow {
    const win = new BrowserWindow({
      ...display.bounds,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      focusable: false,
      acceptFirstMouse: false,
      enableLargerThanScreen: true,
      webPreferences: {
        preload: this.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        backgroundThrottling: false, // an unfocused overlay must still animate
      },
    });

    win.setAlwaysOnTop(true, 'screen-saver');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.setIgnoreMouseEvents(true, { forward: true });
    win.setContentProtection(this.lensingEnabled);

    // A borderless transparent window should never be draggable or reloadable.
    win.on('close', (event) => {
      if (!this.disposed) event.preventDefault();
    });

    // A transparent overlay has no devtools of its own in normal use, so its
    // console is forwarded to the main log. Shader compile failures and
    // capture problems would otherwise be invisible.
    win.webContents.on('console-message', (_event, level, message) => {
      if (level >= 1) console.log(`[overlay:${display.id}] ${message}`);
    });

    // The window is told which physical display it belongs to. It uses that to
    // request exactly the right capture source, instead of the main process
    // trying to infer it from the request — inference that was unreliable.
    if (this.devServerUrl) {
      void win.loadURL(`${this.devServerUrl}/${OVERLAY_ROUTE}?display=${display.id}`);
    } else {
      void win.loadFile(join(this.rendererDir, OVERLAY_ROUTE), {
        query: { display: String(display.id) },
      });
    }

    return win;
  }

  private syncDisplays = (): void => {
    if (this.disposed) return;
    const live = new Set(screen.getAllDisplays().map((d) => d.id));
    for (const [id, win] of this.windows) {
      if (!live.has(id)) {
        this.windows.delete(id);
        win.destroy();
      }
    }
    for (const display of screen.getAllDisplays()) {
      const win = this.windows.get(display.id);
      if (win) win.setBounds(display.bounds);
    }
  };

  /** Shows the overlay across every display. */
  show(): void {
    for (const win of this.windows.values()) {
      if (!win.isDestroyed()) win.showInactive();
    }
  }

  hide(): void {
    this.setBreakMode(false);
    for (const win of this.windows.values()) {
      if (!win.isDestroyed()) win.hide();
    }
  }

  /**
   * Break mode makes the overlay solid: it takes clicks and keyboard focus so
   * the screen genuinely belongs to the break.
   */
  setBreakMode(active: boolean): void {
    if (this.breakMode === active) return;
    this.breakMode = active;

    for (const win of this.windows.values()) {
      if (win.isDestroyed()) continue;
      win.setIgnoreMouseEvents(!active, { forward: !active });
      win.setFocusable(active);
      if (active) {
        win.show();
        win.moveTop();
        win.focus();
      }
    }
  }

  setLensing(enabled: boolean): void {
    this.lensingEnabled = enabled;
    for (const win of this.windows.values()) {
      if (!win.isDestroyed()) win.setContentProtection(enabled);
    }
  }

  /** Pushes engine state and settings to every overlay window. */
  broadcast(channel: string, payload: unknown): void {
    for (const win of this.windows.values()) {
      if (!win.isDestroyed()) win.webContents.send(channel, payload);
    }
  }

  sync(state: EngineSyncState, settings: Settings): void {
    this.broadcast('engine:sync', state);
    this.broadcast('settings:changed', settings);
  }

  get windowIds(): number[] {
    return [...this.windows.values()].filter((w) => !w.isDestroyed()).map((w) => w.id);
  }

  dispose(): void {
    this.disposed = true;
    screen.removeListener('display-added', this.syncDisplays);
    screen.removeListener('display-removed', this.syncDisplays);
    screen.removeListener('display-metrics-changed', this.syncDisplays);
    for (const win of this.windows.values()) {
      if (!win.isDestroyed()) win.destroy();
    }
    this.windows.clear();
  }
}
