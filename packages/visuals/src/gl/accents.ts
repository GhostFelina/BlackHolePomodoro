import type { ThemeAccent } from '@blackholock/core';

/**
 * Accent colours, given as the dominant hue of the accretion light.
 *
 * These are linear RGB triples fed straight to the shader, not CSS colours —
 * the shader adds its own white-hot core, so these read as the *outer* colour
 * of the glow rather than its overall tone.
 */
export const ACCENT_RGB: Record<ThemeAccent, [number, number, number]> = {
  // --- warm ----------------------------------------------------------------
  /** Classic Interstellar amber. The default. */
  ember: [1.0, 0.62, 0.24],
  /** Sunlit orange — brighter and yellower than ember. */
  solar: [1.0, 0.78, 0.36],
  /** Yellow-gold, the coolest-looking of the warm set. */
  gold: [1.0, 0.87, 0.44],
  /** Deep, dark orange. Heavier and more molten. */
  rust: [0.88, 0.40, 0.11],
  /** Red-orange, pushed toward the red end without going pink. */
  crimson: [1.0, 0.34, 0.20],

  // --- cool ----------------------------------------------------------------
  /** Cold plasma blue. */
  ion: [0.42, 0.68, 1.0],
  /** Green-teal, like a high-latitude sky. */
  aurora: [0.38, 0.95, 0.72],
  /** Magenta-violet, the most synthetic of the set. */
  violet: [0.80, 0.46, 1.0],
  /** No hue at all — pure luminance, for the purists. */
  monochrome: [0.86, 0.88, 0.92],
};

export function accentToRgb(accent: ThemeAccent): [number, number, number] {
  return ACCENT_RGB[accent] ?? ACCENT_RGB.ember;
}

/** CSS form of the same colours, for the settings UI swatches. */
export function accentToCss(accent: ThemeAccent): string {
  const [r, g, b] = accentToRgb(accent);
  const to255 = (v: number) => Math.round(Math.min(Math.max(v, 0), 1) * 255);
  return `rgb(${to255(r)}, ${to255(g)}, ${to255(b)})`;
}
