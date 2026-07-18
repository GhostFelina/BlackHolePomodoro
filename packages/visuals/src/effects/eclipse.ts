import type { FocusEffect } from './types.js';

/**
 * Eclipse — the quiet one.
 *
 * No star field, no disc, no swirl: a matte dark disc with a thin corona and a
 * gentle refraction ring. Built for people who find Gargantua too busy, and it
 * costs a fraction of the instructions.
 */
export const eclipse: FocusEffect = {
  id: 'eclipse',
  nameKey: 'effect.eclipse.name',
  descriptionKey: 'effect.eclipse.description',
  supportsScreenLensing: true,
  influenceRadiusFactor: 3.4,

  fragmentSource: /* glsl */ `
void main() {
  vec2  pixel = vUv * uResolution;
  vec2  d     = pixel - uCenter;
  float r     = max(length(d), 1e-4);
  float rs    = max(uRadius, 1.0);

  float influence = rs * 3.4;
  if (r > influence && uBlackout < 0.001) { fragColor = vec4(0.0); return; }
  if (uBlackout > 0.999) { fragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }

  vec2  dir      = d / r;
  float edgeFade = 1.0 - smoothstep(influence * 0.55, influence, r);

  // A soft lens rather than a gravitational one — refraction, not collapse.
  float deflect = (0.85 * rs * rs) / r * edgeFade;
  float rSrc    = max(r - deflect, rs * 0.05);

  vec3 background = vec3(0.0);
  if (uHasScreen > 0.5) {
    background = sampleScreen(uCenter + dir * rSrc);
    background *= smoothstep(rs * 0.98, rs * 1.9, r);
  }

  // Corona: one thin ring, breathing slowly.
  float breathe = uReducedMotion > 0.5 ? 1.0 : 0.92 + 0.08 * sin(uTime * 0.55);
  float corona  = exp(-pow((r - rs * 1.07 * breathe) / (rs * 0.085), 2.0));
  background += mix(uAccent, vec3(1.0), 0.55) * corona * 1.35;

  float horizon = 1.0 - smoothstep(rs - 1.25, rs + 1.25, r);
  vec3  color   = mix(background, vec3(0.0), horizon);

  float warp  = clamp(deflect / 1.6, 0.0, 1.0) * edgeFade;
  float alpha = clamp(max(max(warp, corona), horizon), 0.0, 1.0);

  color = mix(color, vec3(0.0), uBlackout);
  alpha = max(alpha, uBlackout) * uIntensity;

  fragColor = vec4(color * alpha, alpha);
}
`,
};
