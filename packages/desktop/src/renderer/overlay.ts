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
const countdownEl = document.getElementById('countdown') as HTMLElement;
const subtitleEl = document.getElementById('subtitle') as HTMLElement;
const skipButton = document.getElementById('skip') as HTMLButtonElement;
const noticeEl = document.getElementById('notice') as HTMLElement;

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

const renderer = new EffectRenderer(canvas, {
  // The shader itself costs ~0.1 ms/frame; the expensive part of a fullscreen
  // transparent overlay is the OS compositor blending it over everything else.
  // Capping the buffer at 2048 on the long edge cuts that cost by ~2x and is
  // visually indistinguishable, because the effect is all smooth gradients.
  maxRenderEdge: 2048,
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

function updateBreakText(): void {
  countdownEl.textContent = formatDuration(engine.snapshot().remaining);
  subtitleEl.textContent = i18n.t('break.subtitle');

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

function showBreakLayer(show: boolean): void {
  if (breakVisible === show) return;
  breakVisible = show;
  breakLayer.classList.toggle('visible', show);

  if (show) {
    skipArmedAt = Date.now() + (settings?.skipArmSeconds ?? 6) * 1000;
    skipConfirmUntil = 0;
    skipButton.classList.remove('ready');
    updateBreakText();
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

  // Break chrome: countdown, subtitle, the deliberately awkward skip button.
  const inBlackout = stage === 'blackout';
  showBreakLayer(inBlackout);
  if (inBlackout) {
    countdownEl.textContent = formatDuration(snapshot.remaining);
    if (!skipButton.classList.contains('ready') && Date.now() >= skipArmedAt) {
      skipButton.classList.add('ready');
    }
    if (skipConfirmUntil && Date.now() > skipConfirmUntil) {
      skipConfirmUntil = 0;
      updateBreakText();
    }
  }

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
  if (choreographer.getStage() !== 'blackout') return;
  if (settings?.strictness === 'strict') return;

  skipArmedAt = 0;
  skipButton.classList.add('ready', 'summoned');
  skipButton.focus();
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
  syncRenderLoop();
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
