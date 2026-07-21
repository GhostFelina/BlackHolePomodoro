import {
  FocusEngine,
  I18n,
  formatDuration,
  type EngineSyncState,
  type LocaleCode,
  type Settings,
} from '@blackholock/core';
import {
  Choreographer,
  EffectRenderer,
  accentToRgb,
  getEffect,
} from '@blackholock/visuals';
import type { BlackHolockApi } from '../preload/index.js';

declare global {
  interface Window {
    blackholock: BlackHolockApi;
  }
}

/**
 * The overlay window.
 *
 * The main process owns the authoritative clock and sends a sync state
 * whenever something changes. This window keeps a mirror engine seeded from
 * that state and evaluates it every single frame, so the growth animation is
 * smooth at whatever rate the display runs — 120 Hz included — without one
 * IPC message per frame.
 */

const api = window.blackholock;
/** Which physical display this overlay covers; supplied by the main process. */
const displayId = Number(new URLSearchParams(location.search).get('display') ?? 0);
const canvas = document.getElementById('stage') as HTMLCanvasElement;
const breakLayer = document.getElementById('break') as HTMLElement;
const backdropLayer = document.getElementById('backdrop') as HTMLElement;
const countdownEl = document.getElementById('countdown') as HTMLElement;
const subtitleEl = document.getElementById('subtitle') as HTMLElement;
const skipButton = document.getElementById('skip') as HTMLButtonElement;
const noticeEl = document.getElementById('notice') as HTMLElement;
const molaVerButton = document.getElementById('molaVer') as HTMLButtonElement;
const molaVerHint = document.getElementById('molaVerHint') as HTMLElement;
const teamPanel = document.getElementById('teamPanel') as HTMLElement;

const engine = new FocusEngine({
  durations: { workSeconds: 3000, breakSeconds: 600, warningSeconds: 300 },
});
const choreographer = new Choreographer();
const i18n = new I18n();

let settings: Settings | null = null;
let screenVideo: HTMLVideoElement | null = null;
let captureStream: MediaStream | null = null;
let captureRequested = false;
let skipArmedAt = 0;
let skipConfirmUntil = 0;
let breakVisible = false;
/** off = no break UI, pending = Mola Ver gate, active = running countdown. */
let breakMode: 'off' | 'pending' | 'active' = 'off';
let autoBeginAt = 0;

const renderer = new EffectRenderer(canvas, {
  // The black hole is a ray-march with fine filaments and sharp lensed edges, so
  // it needs real resolution — a low cap made the fully-grown hole visibly soft.
  // The buffer follows the display up to 3200 on the long edge; adaptive scaling
  // still trims it if a weaker GPU cannot keep the frame budget.
  maxRenderEdge: 2560,
  onUnavailable: (reason) => console.error('[BlackHolock]', reason),
  onContextLost: () => {
    // Losing the context must not trap the user behind a frozen black screen.
    breakLayer.classList.add('visible');
  },
});

// ------------------------------------------------------------------- capture

/**
 * Starts the desktop capture used for lensing.
 *
 * The overlay sets content protection in the main process, so the stream it
 * receives never contains this window — no infinite mirror. If the user denies
 * permission, or the platform refuses, the effect simply renders without a
 * desktop texture rather than failing.
 */
async function startCapture(): Promise<void> {
  if (captureRequested || !settings?.screenLensing) return;
  const effect = getEffect(settings.effectId);
  if (!effect.supportsScreenLensing) return;

  captureRequested = true;
  try {
    const sourceId = await api.capture.sourceForDisplay(displayId);
    if (!sourceId) {
      const permission = await api.capture.permission();
      console.warn(
        `[BlackHolock] No capture source (permission: ${permission}). ` +
          'Rendering without desktop lensing.',
      );
      return;
    }

    // Electron's explicit desktop-source path. Unlike getDisplayMedia it needs
    // no picker and no guessing about which screen was meant.
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: sourceId,
          maxFrameRate: 30,
        },
      },
    } as unknown as MediaStreamConstraints);

    const video = document.createElement('video');
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    await video.play();

    captureStream = stream;
    screenVideo = video;
    renderer.setScreenSource(video);
  } catch (error) {
    console.warn('[BlackHolock] Screen capture unavailable, rendering without lensing:', error);
  }
}

function stopCapture(): void {
  renderer.setScreenSource(null);
  captureStream?.getTracks().forEach((track) => track.stop());
  captureStream = null;
  screenVideo?.remove();
  screenVideo = null;
  captureRequested = false;
}

// -------------------------------------------------------------------- render

function applySettings(next: Settings): void {
  const changedEffect = settings?.effectId !== next.effectId;
  const changedLensing = settings?.screenLensing !== next.screenLensing;
  settings = next;

  renderer.setEffect(getEffect(next.effectId));
  renderer.setFpsCap(next.maxFps);

  if (changedLensing || changedEffect) {
    if (!next.screenLensing) stopCapture();
    else if (choreographer.getStage() !== 'hidden') void startCapture();
  }
  updateBreakText();
}

const escapeHintEl = document.getElementById('escapeHint') as HTMLElement;

function updateBreakText(): void {
  countdownEl.textContent = formatDuration(engine.snapshot().remaining);
  subtitleEl.textContent = i18n.t('break.subtitle');
  escapeHintEl.textContent = i18n.t('break.escapeHint');
  molaVerButton.textContent = i18n.t('break.startBreak');

  const strict = settings?.strictness === 'strict';
  noticeEl.textContent = strict ? i18n.t('break.strictNotice') : '';
  noticeEl.classList.toggle('visible', strict);
  skipButton.hidden = strict;

  if (Date.now() < skipConfirmUntil) {
    skipButton.textContent = i18n.t('break.skipConfirm');
    skipButton.classList.add('armed');
  } else {
    skipButton.textContent = i18n.t('break.skip');
    skipButton.classList.remove('armed');
  }
}

let skipArmTimer: number | null = null;
let breakTicker: number | null = null;

/**
 * Drives the break UI, entirely from the main process (not the WebGL stage), so
 * it works even if the shader never renders:
 *
 *   pending  the hole has swallowed the screen; a Mola Ver button waits with a
 *            countdown to its automatic start
 *   active   the break is running; the big countdown and the skip control show
 *   off      nothing
 */
function setBreakUI(mode: 'off' | 'pending' | 'active'): void {
  breakMode = mode;
  const show = mode !== 'off';
  breakVisible = show;
  breakLayer.classList.toggle('visible', show);
  breakLayer.classList.toggle('pending', mode === 'pending');
  breakLayer.classList.toggle('active', mode === 'active');
  backdropLayer.classList.toggle('visible', show);

  if (!show) {
    setTeamPanel(false);
    if (skipArmTimer) {
      clearTimeout(skipArmTimer);
      skipArmTimer = null;
    }
    if (breakTicker) {
      clearInterval(breakTicker);
      breakTicker = null;
    }
    return;
  }

  if (mode === 'active') {
    skipArmedAt = Date.now() + (settings?.skipArmSeconds ?? 6) * 1000;
    skipConfirmUntil = 0;
    skipButton.classList.remove('ready');
    if (skipArmTimer) clearTimeout(skipArmTimer);
    skipArmTimer = window.setTimeout(
      () => skipButton.classList.add('ready'),
      (settings?.skipArmSeconds ?? 6) * 1000,
    );
  }
  updateBreakText();

  // A single ticker keeps the countdown live and arms the skip control WITHOUT
  // depending on the WebGL frame loop — the break must work even if the shader
  // is dead.
  if (breakTicker) clearInterval(breakTicker);
  breakTicker = window.setInterval(tickBreakUI, 250);
  tickBreakUI();
}

function tickBreakUI(): void {
  if (breakMode === 'active') {
    countdownEl.textContent = formatDuration(engine.snapshot().remaining);
    if (Date.now() >= skipArmedAt) skipButton.classList.add('ready');
    if (skipConfirmUntil && Date.now() > skipConfirmUntil) {
      skipConfirmUntil = 0;
      updateBreakText();
    }
  } else if (breakMode === 'pending') {
    const seconds = Math.max(0, Math.ceil((autoBeginAt - Date.now()) / 1000));
    molaVerHint.textContent = i18n.t('break.startBreakIn', { seconds: String(seconds) });
  }
}

/**
 * One frame. Called exactly once per display refresh by the renderer, and it
 * is the only place the choreographer is advanced — calling it twice would
 * double-step the timed stages.
 */
function frame(): ReturnType<Choreographer['frame']> {
  const now = performance.now() / 1000;
  const snapshot = engine.tick();
  const dpr = window.devicePixelRatio || 1;
  const [width, height] = renderer.resize(window.innerWidth, window.innerHeight, dpr);

  const stage = choreographer.getStage();

  // The break chrome (Mola Ver gate, countdown, skip) is driven by the main
  // process via setBreakUI(), not by the visual stage, so it works even when
  // the shader is not rendering. Nothing to do for it here.

  // Capture only while something is actually on screen.
  if (stage === 'hidden') {
    if (captureRequested) stopCapture();
    // Nothing to draw. Tear the loop down rather than spinning on a frame
    // that produces no pixels — see stopRendering().
    stopRendering();
    return null;
  }
  if (settings?.screenLensing && !captureRequested) {
    void startCapture();
  }

  const context = choreographer.frame({
    snapshot,
    width,
    height,
    now,
    intensity: settings?.intensity ?? 1,
    accent: accentToRgb(settings?.accent ?? 'ember'),
    reducedMotion: settings?.reducedMotion ?? false,
    hasScreenTexture: screenVideo !== null,
  });

  document.body.classList.toggle('active', context !== null);
  return context;
}

// --------------------------------------------------------------------- wiring

/**
 * Escape reveals the skip control early.
 *
 * The button is deliberately slow to appear so a stray click cannot end a
 * break. That is right for the mouse, but someone who genuinely needs out —
 * a call, an alarm, a meeting — should not have to wait and hunt for it.
 * Escape is a deliberate, unambiguous keystroke, so it arms the control
 * immediately. It still asks for confirmation; it only skips the waiting.
 */
window.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  // Escape first dismisses the team card if it is open, without ending the break.
  if (teamVisible) {
    setTeamPanel(false);
    return;
  }
  // Gated on the break UI being visible, NOT on the WebGL stage. If the shader
  // failed, there is no 'blackout' stage — but the break screen is still up and
  // Escape must still end it.
  if (!breakVisible) return;

  // One press ends it. The button's two-press confirmation exists to stop a
  // stray *mouse* click from ending a break; a deliberate Escape key is not a
  // stray click, and someone reaching for Escape wants out now.
  //
  // Escape works even in strict mode. Strict makes a break harder to skip on a
  // whim — the button is hidden, it asks twice — but it must never make the app
  // able to trap the machine. A deliberate keystroke always returns control.
  void api.engine.skipBreak();
});

/**
 * The main process drives the break screen directly, independent of the shader.
 *
 * When the break begins it sends `true`; we raise the HTML break layer at once
 * — solid dark background, live countdown, skip button, escape hint — and only
 * then acknowledge. That acknowledgement is the main process's signal that it
 * is safe to let this window swallow input: it never captures the mouse and
 * keyboard until a visible way out is genuinely on screen. If the shader is
 * broken, none of that changes; the break screen is HTML, not WebGL.
 */
api.overlay.onBreak((signal) => {
  autoBeginAt = signal.autoBeginAt ?? 0;
  if (signal.mode === 'off') {
    setBreakUI('off');
    return;
  }
  const wasOff = breakMode === 'off';
  setBreakUI(signal.mode);
  // Acknowledge only on first appearance (a pending → active switch keeps the
  // input capture it already has). Two frames guarantees the layer painted
  // before we tell main it is safe to capture input.
  if (wasOff) {
    requestAnimationFrame(() => requestAnimationFrame(() => api.overlay.ready()));
  }
});

// The Mola Ver button: begin the break countdown immediately.
molaVerButton.addEventListener('click', () => {
  void api.engine.beginBreak();
});

// Easter egg: four clicks into the event horizon during a break reveal the
// team card. It dismisses on the next click or on Escape.
let teamVisible = false;
let holeClickTimes: number[] = [];

function setTeamPanel(show: boolean): void {
  teamVisible = show;
  if (show) teamPanel.hidden = false;
  requestAnimationFrame(() => {
    teamPanel.classList.toggle('visible', show);
    if (!show) window.setTimeout(() => (teamPanel.hidden = true), 500);
  });
}

document.addEventListener('click', (event) => {
  if (teamVisible) {
    setTeamPanel(false);
    return;
  }
  if (breakMode === 'off') return;
  if ((event.target as HTMLElement).closest('button')) return; // not the controls
  const reach = Math.min(window.innerWidth, window.innerHeight) * 0.2;
  const dx = event.clientX - window.innerWidth / 2;
  const dy = event.clientY - window.innerHeight / 2;
  if (Math.hypot(dx, dy) > reach) return; // only the event horizon counts
  const now = Date.now();
  holeClickTimes = holeClickTimes.filter((t) => now - t < 2000);
  holeClickTimes.push(now);
  if (holeClickTimes.length >= 4) {
    holeClickTimes = [];
    setTeamPanel(true);
  }
});

skipButton.addEventListener('click', () => {
  if (Date.now() < skipArmedAt) return;      // still disarmed
  if (Date.now() < skipConfirmUntil) {
    skipConfirmUntil = 0;
    void api.engine.skipBreak();
    return;
  }
  // First press only arms the confirmation. A stray click must never end a
  // break — that bug cost a whole break during testing of the prototype.
  skipConfirmUntil = Date.now() + 4000;
  updateBreakText();
});

api.engine.onSync((state: EngineSyncState) => {
  const previous = engine.snapshot().phase;
  engine.applySyncState(state);
  const next = engine.snapshot().phase;
  if (next !== previous) {
    choreographer.onPhaseChange(next, previous, performance.now() / 1000);
    syncRenderLoop();
  }
});

api.settings.onChanged((next: Settings) => applySettings(next));

api.app.onLocaleChanged((locale: LocaleCode) => {
  i18n.setLocale(locale);
  document.documentElement.lang = locale;
  document.documentElement.dir = i18n.getMeta().direction;
  updateBreakText();
});

engine.onPhaseChange((next, previous) => {
  choreographer.onPhaseChange(next, previous, performance.now() / 1000);
  syncRenderLoop();
});

/**
 * The render loop only exists while there is something to draw.
 *
 * It used to start at launch and run for the whole session. For the 45 minutes
 * of a focus period — with nothing on screen at all — a full-screen
 * transparent window per display was still turning a 60 Hz requestAnimationFrame
 * loop, resizing and clearing a WebGL context every frame. Worse,
 * `backgroundThrottling` is switched off on these windows (the overlay must
 * keep animating while unfocused), so Chromium's own protection against
 * exactly this was disabled too.
 *
 * Now the loop is torn down the moment the choreographer goes idle and rebuilt
 * when a phase change brings the effect back. Idle cost is zero, not merely
 * small.
 */
let rendering = false;

function startRendering(): void {
  if (rendering) return;
  rendering = true;
  // Actually drive the frame loop. Without this call the renderer never runs,
  // `frame()` is never invoked, and nothing is ever drawn — which is exactly
  // why the black hole never appeared. `renderer.start` hands it the per-frame
  // provider and begins the requestAnimationFrame loop.
  renderer.start(frame);
}

function stopRendering(): void {
  if (!rendering) return;
  rendering = false;
  renderer.stop();
}

/** Called on every phase change; decides whether the loop should be alive. */
function syncRenderLoop(): void {
  if (choreographer.getStage() === 'hidden') stopRendering();
  else startRendering();
}

async function boot(): Promise<void> {
  const [initialSettings, state, info] = await Promise.all([
    api.settings.get(),
    api.engine.state(),
    api.app.info(),
  ]);

  const locale = await api.app.resolveLocale(initialSettings.locale);
  i18n.setLocale(locale);
  document.documentElement.lang = locale;
  document.documentElement.dir = i18n.getMeta().direction;

  applySettings(initialSettings);
  engine.applySyncState(state);
  choreographer.onPhaseChange(engine.snapshot().phase, 'idle', performance.now() / 1000);

  syncRenderLoop();

  if (info.isDev) {
    (window as unknown as { rendererStats: () => unknown }).rendererStats = () =>
      renderer.getStats();

    // Development only: proves the shader is actually drawing, and at what
    // rate. Forwarded to the main log by the console bridge.
    window.setInterval(() => {
      if (choreographer.getStage() === 'hidden') return;
      const stats = renderer.getStats();
      console.info(
        `stage=${choreographer.getStage()} fps=${stats.fps} gpu=${stats.gpuMs}ms cpu=${stats.frameMs}ms ` +
          `buffer=${stats.renderWidth}×${stats.renderHeight} dropped=${stats.droppedFrames} ` +
          `lensing=${screenVideo ? 'on' : 'off'}`,
      );
    }, 2000);
  }
}

void boot();
