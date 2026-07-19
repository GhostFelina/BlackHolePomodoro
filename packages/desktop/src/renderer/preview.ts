/**
 * Live effect preview.
 *
 * Runs the *shipped* shader — the same source the overlay uses — animated in
 * real time, with the controls needed to judge it: size, effect, whether the
 * desktop is being bent, and a live frame-rate readout.
 *
 * This exists because the alternative is waiting 45 minutes for a real cycle
 * to reach the interesting part, and because reviewing a still image tells you
 * nothing about whether the disc rotates convincingly.
 *
 *   npm run preview
 */

import {
  Choreographer,
  EffectRenderer,
  accentToRgb,
  getEffect,
  listEffects,
} from '@blackholock/visuals';
import { DEFAULT_EFFECT_PARAMS } from '@blackholock/visuals';
import type { EffectFrameContext, EffectParams } from '@blackholock/visuals';
import type { ThemeAccent } from '@blackholock/core';

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const hud = document.getElementById('hud') as HTMLElement;
const params = new URLSearchParams(location.search);

const state = {
  effectId: params.get('effect') ?? 'gargantua',
  growth: Number(params.get('growth') ?? 0.5),
  lensing: params.get('lensing') !== '0',
  accent: (params.get('accent') ?? 'ember') as ThemeAccent,
  playing: true,
  autoGrow: false,
  intensity: 1,
  params: { ...DEFAULT_EFFECT_PARAMS } as EffectParams,
};

// Any tunable can be overridden from the query string for quick comparisons.
for (const key of Object.keys(DEFAULT_EFFECT_PARAMS) as Array<keyof EffectParams>) {
  const raw = params.get(key);
  if (raw !== null && Number.isFinite(Number(raw))) state.params[key] = Number(raw);
}

/** A stand-in desktop so lensing has something recognisable to bend. */
function buildFakeDesktop(width: number, height: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const ctx = c.getContext('2d')!;

  ctx.fillStyle = '#11131a';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#0a0c11';
  ctx.fillRect(0, 0, width, 30);
  ctx.fillStyle = '#0d0f16';
  ctx.fillRect(0, 30, 220, height - 30);

  const palette = ['#7fb3ff', '#c792ea', '#ffcb6b', '#c3e88d', '#89ddff', '#6b7280'];
  let seed = 11;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

  for (let y = 54; y < height; y += 24) {
    let x = 246 + Math.floor(rnd() * 3) * 20;
    const tokens = 3 + Math.floor(rnd() * 8);
    for (let i = 0; i < tokens; i += 1) {
      const w = 30 + rnd() * 110;
      if (x + w > width - 30) break;
      ctx.fillStyle = palette[Math.floor(rnd() * palette.length)]!;
      ctx.globalAlpha = 0.72 + rnd() * 0.28;
      ctx.fillRect(x, y - 10, w, 12);
      x += w + 12;
    }
    ctx.globalAlpha = 1;
  }
  return c;
}

const renderer = new EffectRenderer(canvas, {
  maxRenderEdge: 3200,
  bloom: Number(params.get('bloom') ?? 1),
});
if (!renderer.isAvailable) {
  hud.textContent = 'WebGL 2 unavailable on this machine.';
  throw new Error('no webgl2');
}

const desktop = buildFakeDesktop(3200, 2000);
const choreographer = new Choreographer();
void choreographer;

let startedAt = performance.now();
let pausedAt = 0;

function applyEffect(): void {
  const effect = getEffect(state.effectId);
  if (!renderer.setEffect(effect)) {
    hud.textContent = `Shader "${effect.id}" failed to compile — see console.`;
    return;
  }
  renderer.setScreenSource(
    state.lensing && effect.supportsScreenLensing
      ? (desktop as unknown as HTMLVideoElement)
      : null,
  );
}

function frame(): EffectFrameContext | null {
  const dpr = window.devicePixelRatio || 1;
  const [width, height] = renderer.resize(window.innerWidth, window.innerHeight, dpr);

  if (state.autoGrow && state.playing) {
    // One full growth sweep every 24 seconds, purely to inspect the curve.
    state.growth = ((performance.now() - startedAt) / 24000) % 1;
    (document.getElementById('growth') as HTMLInputElement).value = String(state.growth);
  }

  const minEdge = Math.min(width, height);
  const diagonal = Math.hypot(width, height);
  const eased = 0.15 * state.growth + 0.85 * state.growth ** 3;
  const radius = Math.max(4, minEdge * 0.005) + (diagonal * 0.55 - 4) * eased;

  const now = state.playing
    ? (performance.now() - startedAt) / 1000
    : (pausedAt - startedAt) / 1000;

  const stats = renderer.getStats();
  hud.innerHTML =
    `<b>${state.effectId}</b> · growth ${(state.growth * 100).toFixed(0)}% · ` +
    `${stats.fps} fps · GPU ${stats.gpuMs.toFixed(2)} ms · ` +
    `${stats.renderWidth}×${stats.renderHeight} · ` +
    `lensing ${state.lensing ? 'on' : 'off'}`;

  return {
    time: now,
    resolution: [width, height],
    center: [width / 2, height / 2],
    radius,
    growth: state.growth,
    intensity: state.intensity,
    blackout: 0,
    hasScreenTexture: state.lensing && getEffect(state.effectId).supportsScreenLensing,
    accent: accentToRgb(state.accent),
    reducedMotion: false,
    params: state.params,
  };
}

// ------------------------------------------------------------------ controls

function buildControls(): void {
  const panel = document.getElementById('controls') as HTMLElement;

  const effectSelect = document.getElementById('effect') as HTMLSelectElement;
  for (const effect of listEffects()) {
    const option = document.createElement('option');
    option.value = effect.id;
    option.textContent = effect.id;
    effectSelect.append(option);
  }
  effectSelect.value = state.effectId;
  effectSelect.addEventListener('change', () => {
    state.effectId = effectSelect.value;
    applyEffect();
  });

  const growth = document.getElementById('growth') as HTMLInputElement;
  growth.value = String(state.growth);
  growth.addEventListener('input', () => {
    state.autoGrow = false;
    (document.getElementById('autogrow') as HTMLInputElement).checked = false;
    state.growth = Number(growth.value);
  });

  const lensing = document.getElementById('lensing') as HTMLInputElement;
  lensing.checked = state.lensing;
  lensing.addEventListener('change', () => {
    state.lensing = lensing.checked;
    applyEffect();
  });

  const autogrow = document.getElementById('autogrow') as HTMLInputElement;
  autogrow.addEventListener('change', () => {
    state.autoGrow = autogrow.checked;
    startedAt = performance.now();
  });

  panel.addEventListener('keydown', (event) => event.stopPropagation());
}

window.addEventListener('keydown', (event) => {
  if (event.code === 'Space') {
    event.preventDefault();
    state.playing = !state.playing;
    if (state.playing) startedAt += performance.now() - pausedAt;
    else pausedAt = performance.now();
  }
  if (event.key === 'h') {
    document.body.classList.toggle('clean');
  }
});

buildControls();
applyEffect();
renderer.start(frame);

// Printed to stdout so a headless capture run can report the real cost.
const previewStatsTimer = window.setInterval(() => {
  const s = renderer.getStats();
  console.info(`STATS fps=${s.fps} gpu=${s.gpuMs}ms scale=${s.scale} ${s.renderWidth}x${s.renderHeight}`);
}, 1200);
void previewStatsTimer;
