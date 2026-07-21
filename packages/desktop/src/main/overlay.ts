import { BrowserWindow, ipcMain, screen, type Display, type IpcMainEvent } from 'electron';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
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

export type BreakMode = 'off' | 'pending' | 'active';

export class OverlayManager {
  private windows = new Map<number, BrowserWindow>();
  private breakMode: BreakMode = 'off';
  private lensingEnabled = true;
  private disposed = false;
  private tearingDown = false;
  private onEmergency: (() => void) | null = null;
  /** webContents ids that have confirmed their break UI is on screen. */
  private breakAcked = new Set<number>();
  private breakAckTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly preloadPath: string,
    private readonly rendererDir: string,
    private readonly devServerUrl: string | undefined,
  ) {
    screen.on('display-added', this.syncDisplays);
    screen.on('display-removed', this.syncDisplays);
    screen.on('display-metrics-changed', this.syncDisplays);
    ipcMain.on('overlay:ready', this.onOverlayReady);
  }

  /**
   * Called when an overlay renderer crashes or hangs while it may be swallowing
   * input. The manager has already released input by the time this fires; the
   * handler is the main process's chance to stop everything so nothing puts the
   * cover back up.
   */
  setEmergencyHandler(handler: () => void): void {
    this.onEmergency = handler;
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
    // Stop the *user* closing the overlay, but never block our own teardown.
    win.on('close', (event) => {
      if (!this.disposed && !this.tearingDown) event.preventDefault();
    });

    // A transparent overlay has no devtools of its own in normal use, so its
    // console is forwarded to the main log. Shader compile failures and
    // capture problems would otherwise be invisible.
    win.webContents.on('console-message', (_event, level, message) => {
      if (level >= 1) console.log(`[overlay:${display.id}] ${message}`);
    });

    // The break overlay swallows input across the whole screen. If its renderer
    // crashes or hangs while it is doing so, the in-page Escape and skip button
    // are dead and the machine is trapped. The crash reports show this renderer
    // *does* crash (EXC_BREAKPOINT out of the WebGL path), so it must never be
    // able to leave a screen-covering, input-swallowing window behind. Release
    // input the instant the renderer goes, from the main process, which cannot
    // itself have crashed with it.
    win.webContents.on('render-process-gone', (_event, details) => {
      // 'clean-exit' is our own destroy() during a normal phase change — not a
      // failure, and treating it as one would stop the cycle every break. Only a
      // genuine crash counts.
      if (details.reason === 'clean-exit') return;
      console.error(`[overlay:${display.id}] render process gone: ${details.reason}`);
      this.handleOverlayFailure();
    });
    win.on('unresponsive', () => {
      console.error(`[overlay:${display.id}] renderer unresponsive`);
      this.handleOverlayFailure();
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

  /**
   * Hides the overlay and destroys the windows.
   *
   * Hiding alone is not enough. A borderless, transparent, screen-saver-level
   * window is part of the compositor's tree for as long as it exists, and on
   * macOS keeping one alive across a whole work session was measurably making
   * the machine feel sluggish. Recreating them takes a few milliseconds at the
   * start of a countdown, which is a far better trade than paying for them
   * during the 45 minutes they show nothing.
   */
  hide(): void {
    this.tearingDown = true;
    this.setBreakMode('off');
    for (const win of this.windows.values()) {
      if (!win.isDestroyed()) {
        win.hide();
        win.destroy();
      }
    }
    this.windows.clear();
    this.tearingDown = false;
    this.breakMode = 'off';
  }

  /**
   * Break mode makes the overlay solid — but only once the window has proven it
   * has a visible way out on screen.
   *
   * The old version swallowed input the instant the break began. If the shader
   * had failed, that left a screen-covering window eating every click and key
   * with no visible controls: the machine was trapped. Now the sequence is
   *
   *   1. tell the renderer the break has begun (it raises the HTML break UI),
   *   2. show and focus the window but keep it CLICK-THROUGH,
   *   3. start swallowing input for a window only when it acknowledges its UI is
   *      actually on screen (onOverlayReady),
   *   4. if no window acknowledges within the timeout, treat it as a failure and
   *      release everything — a covering window with no working UI must go.
   *
   * Input is therefore never captured while there is no visible escape.
   */
  setBreakMode(mode: BreakMode, autoBeginAt?: number): void {
    if (this.breakMode === mode) return;
    const wasOff = this.breakMode === 'off';
    this.breakMode = mode;

    if (mode === 'off') {
      this.breakAcked.clear();
      if (this.breakAckTimer) {
        clearTimeout(this.breakAckTimer);
        this.breakAckTimer = null;
      }
      for (const win of this.windows.values()) {
        if (win.isDestroyed()) continue;
        win.webContents.send('overlay:break', { mode: 'off' });
        win.setIgnoreMouseEvents(true, { forward: true });
        win.setFocusable(false);
      }
      return;
    }

    // Tell every window which break UI to show (pending = Mola Ver gate, active
    // = the running countdown). The renderer switches instantly either way.
    for (const win of this.windows.values()) {
      if (!win.isDestroyed()) win.webContents.send('overlay:break', { mode, autoBeginAt });
    }

    // Only the first entry from 'off' needs the show / focus / ack-gate dance.
    // A pending → active switch keeps the input capture it already has.
    if (!wasOff) return;

    this.breakAcked.clear();
    if (this.breakAckTimer) clearTimeout(this.breakAckTimer);

    for (const win of this.windows.values()) {
      if (win.isDestroyed()) continue;
      // Shown and focusable, but still click-through until the renderer acks.
      win.setIgnoreMouseEvents(true, { forward: true });
      win.setFocusable(true);
      win.show();
      win.moveTop();
      win.focusOnWebView();
      win.focus();
    }
    if (process.platform === 'darwin') {
      // Bring the app forward so its key window can receive the Escape key.
      import('electron').then(({ app }) => app.focus({ steal: true })).catch(() => {});
    }

    // Safety net: if the break UI never shows (renderer dead or wedged), do not
    // leave a covering window on the screen. Release everything.
    this.breakAckTimer = setTimeout(() => {
      if (this.breakMode === 'off' || this.disposed || this.tearingDown) return;
      const live = [...this.windows.values()].filter((w) => !w.isDestroyed());
      const allAcked = live.length > 0 && live.every((w) => this.breakAcked.has(w.webContents.id));
      if (!allAcked) {
        console.error('[BlackHolock] Break UI did not confirm in time — releasing control.');
        this.handleOverlayFailure();
      }
    }, 2500);
  }

  /**
   * A window has confirmed its break UI is on screen. Now — and only now — it is
   * safe to let that window swallow input, because there is a visible way out.
   */
  private onOverlayReady = (event: IpcMainEvent): void => {
    if (this.breakMode === 'off') return;
    const id = event.sender.id;
    this.breakAcked.add(id);
    for (const win of this.windows.values()) {
      if (win.isDestroyed() || win.webContents.id !== id) continue;
      win.setIgnoreMouseEvents(false);
      win.setFocusable(true);
      win.focusOnWebView();
      win.focus();
      console.log(`[BlackHolock] Break UI ready on window ${id} — input capture enabled`);
    }
  };

  /**
   * A crashed or hung overlay must not hold the screen hostage. Release input
   * from every window right now, then let the main process stop the cycle so
   * nothing re-covers the screen a moment later.
   */
  private handleOverlayFailure(): void {
    // During our own teardown a renderer going away is expected, not a trap.
    if (this.disposed || this.tearingDown) return;
    this.forceReleaseInput();
    this.onEmergency?.();
  }

  /**
   * Makes every overlay window click-through and non-focusable immediately,
   * independent of break state. The user gets their mouse and keyboard back
   * even before the overlay is torn down.
   */
  forceReleaseInput(): void {
    this.breakMode = 'off';
    this.breakAcked.clear();
    if (this.breakAckTimer) {
      clearTimeout(this.breakAckTimer);
      this.breakAckTimer = null;
    }
    for (const win of this.windows.values()) {
      if (win.isDestroyed()) continue;
      try {
        win.setIgnoreMouseEvents(true, { forward: true });
        win.setFocusable(false);
      } catch {
        // A window mid-destruction can throw here; releasing the others matters
        // more than this one succeeding.
      }
    }
  }

  /** Debug: capture the first overlay window's pixels to a PNG (no OS perm). */
  async captureTo(path: string): Promise<void> {
    const win = [...this.windows.values()].find((w) => !w.isDestroyed());
    if (!win) return;
    try {
      const img = await win.webContents.capturePage();
      writeFileSync(path, img.toPNG());
      console.log(`[BlackHolock] Captured overlay → ${path}`);
    } catch (error) {
      console.error('[BlackHolock] capture failed:', error);
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
    if (this.breakAckTimer) {
      clearTimeout(this.breakAckTimer);
      this.breakAckTimer = null;
    }
    ipcMain.removeListener('overlay:ready', this.onOverlayReady);
    screen.removeListener('display-added', this.syncDisplays);
    screen.removeListener('display-removed', this.syncDisplays);
    screen.removeListener('display-metrics-changed', this.syncDisplays);
    for (const win of this.windows.values()) {
      if (!win.isDestroyed()) win.destroy();
    }
    this.windows.clear();
  }
}
