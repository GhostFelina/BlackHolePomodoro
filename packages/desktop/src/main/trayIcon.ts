import { nativeImage, type NativeImage } from 'electron';
import { join } from 'node:path';
import type { Phase } from '@blackholock/core';

/**
 * Tray artwork.
 *
 * macOS gets a template image: a flat silhouette that the system tints itself,
 * so the icon stays legible in light mode, dark mode and under a tinted menu
 * bar. Windows and Linux get the colour mark, since neither tints tray icons.
 *
 * Images are loaded once and cached — the tray is refreshed on a timer and
 * re-decoding a PNG twice a second would be wasteful.
 */

const resourcesDir = join(__dirname, '../../resources');
const cache = new Map<string, NativeImage>();

function load(fileName: string, template: boolean): NativeImage {
  const cached = cache.get(fileName);
  if (cached) return cached;

  const image = nativeImage.createFromPath(join(resourcesDir, fileName));
  if (template) image.setTemplateImage(true);
  cache.set(fileName, image);
  return image;
}

/**
 * The phase is accepted so future builds can swap in a distinct glyph per
 * phase without touching the caller. Today every phase shares one mark: the
 * countdown is already communicated by the title text next to it, and a tray
 * icon that changes shape mid-work is a distraction rather than information.
 */
export function trayIconFor(_phase: Phase | 'idle'): NativeImage {
  return process.platform === 'darwin'
    ? load('trayTemplate.png', true)
    : load('tray.png', false);
}
