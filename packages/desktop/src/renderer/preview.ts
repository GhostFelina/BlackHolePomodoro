/**
 * Effect preview harness (development only).
 *
 * Renders the *real* shader — the same source the overlay ships — at a series
 * of growth values, tiled into one canvas, over a synthetic desktop that mimics
 * a code editor. A screenshot of this page is therefore an honest preview of
 * what the effect will actually do, and it needs no screen-recording
 * permission and no waiting for a real cycle.
 *
 * Open with `?effect=gargantua&lensing=1`.
 */

import { EffectRenderer, accentToRgb, getEffect, listEffects } from '@blackholock/visuals';
import type { EffectFrameContext } from '@blackholock/visuals';

const params = new URLSearchParams(location.search);
const effectId = params.get('effect') ?? 'gargantua';
const useLensing = params.get('lensing') !== '0';
const growthValues = (params.get('growth') ?? '0.08,0.3,0.55,0.8,1')
  .split(',')
  .map(Number);

const TILE_W = 640;
const TILE_H = 400;
const COLS = Math.min(growthValues.length, 3);
const ROWS = Math.ceil(growthValues.length / COLS);

/** A stand-in desktop: dark editor chrome with syntax-coloured "code". */
function buildFakeDesktop(width: number, height: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const ctx = c.getContext('2d')!;

  ctx.fillStyle = '#11131a';
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = '#0a0c11';
  ctx.fillRect(0, 0, width, 26);
  ctx.fillStyle = '#0d0f16';
  ctx.fillRect(0, 26, 190, height - 26);

  const palette = ['#7fb3ff', '#c792ea', '#ffcb6b', '#c3e88d', '#89ddff', '#6b7280'];
  ctx.font = '13px ui-monospace, SFMono-Regular, Menlo, monospace';

  let y = 46;
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

  while (y < height) {
    let x = 210 + Math.floor(rnd() * 3) * 18;
    const tokens = 3 + Math.floor(rnd() * 7);
    for (let i = 0; i < tokens; i += 1) {
      const w = 26 + rnd() * 90;
      if (x + w > width - 24) break;
      ctx.fillStyle = palette[Math.floor(rnd() * palette.length)]!;
      ctx.globalAlpha = 0.75 + rnd() * 0.25;
      ctx.fillRect(x, y - 9, w, 11);
      x += w + 10;
    }
    ctx.globalAlpha = 1;
    y += 21;
  }
  return c;
}

function main(): void {
  const stage = document.getElementById('stage') as HTMLCanvasElement;
  const label = document.getElementById('label') as HTMLElement;

  const effect = getEffect(effectId);
  label.textContent = `${effect.id} · lensing ${useLensing ? 'on' : 'off'} · growth ${growthValues.join(', ')}`;

  const tile = document.createElement('canvas');
  const renderer = new EffectRenderer(tile, { maxRenderEdge: 4096 });
  if (!renderer.isAvailable) {
    label.textContent = 'WebGL 2 unavailable';
    return;
  }
  if (!renderer.setEffect(effect)) {
    label.textContent = 'Shader failed to compile — see console';
    return;
  }

  // Feed the synthetic desktop in through a video-shaped shim, so the renderer
  // takes exactly the same path it does with a real capture stream.
  const desktop = buildFakeDesktop(TILE_W * 2, TILE_H * 2);
  if (useLensing && effect.supportsScreenLensing) {
    renderer.setScreenSource(desktop as unknown as HTMLVideoElement);
  }

  stage.width = TILE_W * COLS;
  stage.height = TILE_H * ROWS;
  const out = stage.getContext('2d')!;
  out.fillStyle = '#000';
  out.fillRect(0, 0, stage.width, stage.height);

  renderer.resize(TILE_W, TILE_H, 2);

  growthValues.forEach((growth, index) => {
    const minEdge = Math.min(TILE_W, TILE_H) * 2;
    const diagonal = Math.hypot(TILE_W * 2, TILE_H * 2);
    const eased = 0.15 * growth + 0.85 * growth ** 3;
    const radius = Math.max(4, minEdge * 0.005) + (diagonal * 0.55 - 4) * eased;

    const context: EffectFrameContext = {
      time: 2.4,
      resolution: [TILE_W * 2, TILE_H * 2],
      center: [TILE_W, TILE_H],
      radius,
      growth,
      intensity: 1,
      blackout: 0,
      hasScreenTexture: useLensing && effect.supportsScreenLensing,
      accent: accentToRgb('ember'),
      reducedMotion: false,
    };

    renderer.renderOnce(context);

    const col = index % COLS;
    const row = Math.floor(index / COLS);
    out.drawImage(tile, col * TILE_W, row * TILE_H, TILE_W, TILE_H);

    out.fillStyle = 'rgba(255,255,255,0.55)';
    out.font = '12px ui-monospace, monospace';
    out.fillText(`growth ${growth}`, col * TILE_W + 10, row * TILE_H + 18);
  });

  console.info(`preview:done effects=${listEffects().map((e) => e.id).join(',')}`);
}

main();
