#!/usr/bin/env node
/**
 * BlackHolock brand asset generator.
 *
 * Draws the mark procedurally and writes real PNGs with nothing but Node's own
 * zlib — no canvas, no sharp, no native modules. That means the icons rebuild
 * identically on any machine and on CI, and a contributor cloning the repo can
 * regenerate every asset with `npm run brand:icons`.
 *
 * The mark: a pure black event horizon, a bright photon ring, and an accretion
 * disc cutting across it at a slight tilt — legible at 16 px, dramatic at
 * 1024 px. The tray variant is a flat silhouette so macOS can tint it as a
 * template image.
 */

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const brandDir = join(here, '..', 'brand');
const resourcesDir = join(here, '..', 'packages', 'desktop', 'resources');

// ---------------------------------------------------------------- PNG writer

function crc32(buf) {
  let c;
  const table = crc32.table ?? (crc32.table = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c;
    }
    return t;
  })());
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, crc]);
}

/** `rgba` is a Uint8ClampedArray of width*height*4. */
function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // colour type: RGBA
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ------------------------------------------------------------------- drawing

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smoothstep = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const mix = (a, b, t) => a + (b - a) * t;

/**
 * The full-colour mark.
 *
 * Supersampled 3×3 per pixel, which at 16 px is the difference between a
 * jagged blob and a crisp ring.
 */
function drawMark(size, { silhouette = false, padding = 0.10, plate = false } = {}) {
  const rgba = new Uint8ClampedArray(size * size * 4);
  const SS = 3;
  const cx = size / 2;
  const cy = size / 2;
  const R = (size / 2) * (1 - padding);   // outer extent of the artwork

  // Dark backing tile. A rounded-square plate in near-black turns the mark from
  // a ring floating on the wallpaper into a proper dark-themed app icon: it
  // reads as intentional on the Desktop and in the Dock, and the accretion disc
  // glows against it. Never drawn for the silhouette (template) tray icon.
  const plateHalf = size * 0.46;          // half extent, small margin to canvas
  const plateRadius = size * 0.21;        // squircle-ish corner radius
  const plateAA = Math.max(size * 0.006, 0.5);
  const bgCenter = [0.055, 0.063, 0.102]; // lifted deep-navy centre
  const bgEdge = [0.016, 0.020, 0.039];   // near-black edge
  const horizon = R * 0.42;               // event horizon radius
  const ringR = horizon * 1.16;           // photon ring
  const discInner = horizon * 1.55;
  const discOuter = R * 0.99;
  const tilt = -0.20;                     // radians

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;

      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = px + (sx + 0.5) / SS - cx;
          const y = py + (sy + 0.5) / SS - cy;

          // Rotate into the disc's frame.
          const ct = Math.cos(tilt), st = Math.sin(tilt);
          const rx = x * ct - y * st;
          const ry = x * st + y * ct;

          const dist = Math.hypot(x, y);

          // Accretion disc, layer A: seen almost edge-on, a squashed ellipse.
          const eq = Math.hypot(rx, ry / 0.30);
          let band =
            smoothstep(discInner, discInner * 1.14, eq) *
            (1 - smoothstep(discOuter * 0.78, discOuter, eq));

          // The far half of the disc is behind the sphere and therefore
          // hidden; only the near half crosses in front. Without this the
          // band cuts straight through the middle and the depth cue is lost.
          if (dist < horizon && ry < 0) band = 0;

          // Layer B: the arc gravity lifts over the top and under the bottom.
          // This is the detail that reads as a black hole rather than a planet
          // with rings, so it is worth the extra few instructions.
          const arcR = horizon * 1.55;
          const arc =
            Math.exp(-Math.pow((dist - arcR) / (horizon * 0.17), 2)) *
            Math.pow(Math.abs(ry) / Math.max(dist, 1e-3), 1.3);

          const disc = Math.min(1, Math.max(band, arc * 0.95));

          // Photon ring.
          const ring = Math.exp(-Math.pow((dist - ringR) / (horizon * 0.10), 2));

          // Event horizon: pure black, fully opaque.
          const core = 1 - smoothstep(horizon - size * 0.012, horizon + size * 0.012, dist);

          let pr, pg, pb, pa;
          if (silhouette) {
            // Flat mask for the macOS template icon: one colour, alpha only.
            pa = clamp01(Math.max(core, ring * 0.95, disc * 0.9));
            pr = pg = pb = 0;
          } else {
            // Temperature falls outward: white-hot inside, amber at the rim.
            const heat = 1 - smoothstep(discInner, discOuter, Math.min(eq, dist));
            const discR = 1.0;
            const discG = mix(0.48, 0.90, heat);
            const discB = mix(0.12, 0.68, heat);
            const glow = ring * 1.45;

            pr = clamp01(disc * discR * 1.15 + glow);
            pg = clamp01(disc * discG * 1.15 + glow * 0.97);
            pb = clamp01(disc * discB * 1.15 + glow * 0.92);
            pa = clamp01(Math.max(core, Math.max(disc, ring)));

            // The horizon swallows light: darken toward black inside it, but
            // let the disc and ring stay lit where they cross in front.
            const swallow = core * (1 - Math.max(disc * 0.85, ring));
            pr = mix(pr, 0, swallow);
            pg = mix(pg, 0, swallow);
            pb = mix(pb, 0, swallow);
          }

          // Composite the mark over the dark plate.
          if (plate && !silhouette) {
            // Rounded-rectangle signed distance: negative inside the tile.
            const qx = Math.abs(x) - (plateHalf - plateRadius);
            const qy = Math.abs(y) - (plateHalf - plateRadius);
            const sd =
              Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) +
              Math.min(Math.max(qx, qy), 0) -
              plateRadius;
            const cov = 1 - smoothstep(-plateAA, plateAA, sd); // opaque inside

            // Radial gradient, darkest at the edges.
            const t = clamp01(dist / (plateHalf * 1.15));
            const rim = Math.exp(-Math.pow(sd / (size * 0.012), 2)) * 0.10; // faint edge
            const br = clamp01(mix(bgCenter[0], bgEdge[0], t) + rim * 0.5);
            const bgc = clamp01(mix(bgCenter[1], bgEdge[1], t) + rim * 0.55);
            const bb = clamp01(mix(bgCenter[2], bgEdge[2], t) + rim * 0.7);

            const oa = pa + cov * (1 - pa);
            if (oa > 1e-6) {
              pr = (pr * pa + br * cov * (1 - pa)) / oa;
              pg = (pg * pa + bgc * cov * (1 - pa)) / oa;
              pb = (pb * pa + bb * cov * (1 - pa)) / oa;
            }
            pa = oa;
          }

          r += pr; g += pg; b += pb; a += pa;
        }
      }

      const n = SS * SS;
      const i = (py * size + px) * 4;
      const alpha = a / n;
      rgba[i] = Math.round((r / n) * 255);
      rgba[i + 1] = Math.round((g / n) * 255);
      rgba[i + 2] = Math.round((b / n) * 255);
      rgba[i + 3] = Math.round(alpha * 255);
    }
  }
  return rgba;
}

// -------------------------------------------------------------------- output

function write(path, size, options) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, encodePng(size, size, drawMark(size, options)));
  console.log(`  ✓ ${path.replace(join(here, '..'), '.')} (${size}×${size})`);
}

console.log('BlackHolock — generating brand assets');

// App icon, every size electron-builder wants. A dark rounded-square plate with
// the black hole set a little inside it — a proper dark-themed icon rather than
// a ring floating on the wallpaper.
const APP_ICON = { plate: true, padding: 0.22 };
for (const size of [16, 32, 64, 128, 256, 512, 1024]) {
  write(join(brandDir, 'icon', `icon-${size}.png`), size, APP_ICON);
}
write(join(resourcesDir, 'icon.png'), 1024, APP_ICON);

// Tray icons. macOS wants a template silhouette at 1× and 2×; Windows and
// Linux take the colour version.
write(join(resourcesDir, 'trayTemplate.png'), 18, { silhouette: true, padding: 0.06 });
write(join(resourcesDir, 'trayTemplate@2x.png'), 36, { silhouette: true, padding: 0.06 });
write(join(resourcesDir, 'tray.png'), 20, { padding: 0.06 });
write(join(resourcesDir, 'tray@2x.png'), 40, { padding: 0.06 });

// Social preview / README hero.
mkdirSync(brandDir, { recursive: true });
writeFileSync(join(brandDir, 'mark-512.png'), encodePng(512, 512, drawMark(512, APP_ICON)));
console.log('  ✓ ./brand/mark-512.png (512×512)');

console.log('Done.');
