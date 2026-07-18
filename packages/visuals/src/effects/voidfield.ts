import type { FocusEffect } from './types.js';

/**
 * Void Field — no object at all.
 *
 * The screen simply drains: a vignette closes in from the edges as the
 * countdown runs out. It needs no screen capture and almost no GPU, which
 * makes it the safe fallback on old integrated graphics and on battery.
 */
export const voidfield: FocusEffect = {
  id: 'voidfield',
  nameKey: 'effect.voidfield.name',
  descriptionKey: 'effect.voidfield.description',
  supportsScreenLensing: false,
  influenceRadiusFactor: 0,

  fragmentSource: /* glsl */ `
void main() {
  if (uBlackout > 0.999) { fragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }

  vec2  pixel  = vUv * uResolution;
  vec2  centre = uResolution * 0.5;
  float half   = length(centre);
  float r      = length(pixel - centre) / half;   // 0 centre → 1 corner

  // The dark closes in from the corners; growth pushes the front inward.
  float front = mix(1.35, -0.05, uGrowth);
  float dark  = 1.0 - smoothstep(front - 0.55, front, r);

  // A barely-there drift so it does not look like a static gradient.
  if (uReducedMotion < 0.5) {
    dark *= 0.97 + 0.03 * sin(uTime * 0.35 + r * 4.0);
  }

  float alpha = clamp(max(dark, uBlackout), 0.0, 1.0) * uIntensity;
  fragColor = vec4(0.0, 0.0, 0.0, alpha);
}
`,
};
