import type { FocusEffect } from './types.js';

/**
 * Snow — it settles on your screen until there is nothing left to read.
 *
 * Where Rain obscures the whole surface at once, snow *accumulates*: a drift
 * builds from the bottom edge upward, and the line it reaches is the countdown
 * made physical. You can see, without reading a clock, roughly how long is
 * left by how much of the window is buried. That is the point of it.
 *
 * ## The drift line
 *
 * The top edge of the drift is not a straight line but a sum of three sine
 * waves at different frequencies, plus a slow noise term. Real settled snow is
 * uneven, and a perfectly level horizon reads instantly as a progress bar
 * rather than as weather.
 *
 * The line rises with the square root of coverage rather than linearly. Snow
 * piling into a wedge covers area faster than it gains height, so a linear
 * rise looks wrong: it appears to stall near the end. The square root
 * compensates and the accumulation feels steady.
 *
 * ## Cost
 *
 * The same constant-cost trick as Rain. Flakes live one-per-grid-cell with
 * their position hashed from the cell index, so a pixel tests a fixed number
 * of neighbours no matter how heavy the snowfall. There is no particle buffer
 * and nothing to update between frames.
 */
export const snow: FocusEffect = {
  id: 'snow',
  nameKey: 'effect.snow.name',
  descriptionKey: 'effect.snow.description',
  supportsScreenLensing: true,
  influenceRadiusFactor: 0,

  fragmentSource: /* glsl */ `
// One flake per cell of a drifting grid. Returns its brightness at this point.
float flake(vec2 uv, vec2 cell, float scale, float time, float fall) {
  vec2  id   = floor(uv * scale) + cell;
  float seed = hash21(id);
  if (seed > 0.42) return 0.0;

  // Each flake falls at its own rate and sways on its own phase, so the fall
  // never resolves into visible rows.
  float rate = 0.30 + hash11(seed * 4.7) * 0.55;
  float y    = fract(seed * 9.3 - time * rate * fall);
  float sway = sin(time * (0.5 + hash11(seed * 2.1)) + seed * 31.0) * 0.22;

  vec2  pos  = (id + vec2(hash11(seed * 6.1) + sway, y)) / scale;
  float size = (0.030 + hash11(seed * 8.9) * 0.055) / scale;

  float d = length(uv - pos);
  // Soft round flake, brighter in the middle. Nearer flakes (bigger cells)
  // are naturally larger and brighter, which gives the fall depth.
  return exp(-pow(d / size, 2.0)) * (0.45 + hash11(seed * 12.7) * 0.55);
}

void main() {
  vec2  uv       = vUv;                       // y = 0 at the top
  float coverage = clamp(uGrowth, 0.0, 1.0);
  float aspect   = uResolution.x / max(uResolution.y, 1.0);
  vec2  auv      = vec2(uv.x * aspect, uv.y);

  if (uBlackout > 0.999) {
    // Buried. A cold near-white rather than pure white, which at full screen
    // would be painfully bright on an OLED panel.
    fragColor = vec4(0.68, 0.72, 0.79, 1.0);
    return;
  }

  // --- the drift -----------------------------------------------------------
  // Square root, not linear: a wedge of snow covers area faster than it gains
  // height, so a linear rise appears to stall near the end.
  float height = sqrt(clamp(coverage * 1.06, 0.0, 1.0));

  // An uneven crest. Three sines and a noise term, because a level horizon
  // reads as a progress bar rather than as settled snow.
  float crest = sin(auv.x * 3.1 + 0.7) * 0.022
              + sin(auv.x * 7.9 + 2.3) * 0.013
              + sin(auv.x * 17.3 + 5.1) * 0.006
              + (fbm(vec2(auv.x * 2.4, uTime * 0.02)) - 0.5) * 0.05;

  float driftTop = 1.0 - (height + crest);
  // A soft shoulder so the crest is powder rather than a cut edge.
  //
  // Note the edge order: vUv.y is 0 at the *top* of the screen and grows
  // downward, so "below the drift line" means a larger y, not a smaller one.
  // Getting this backwards filled the screen from the ceiling down.
  float buried = smoothstep(driftTop - 0.012, driftTop + 0.012, uv.y);

  // --- falling flakes ------------------------------------------------------
  float fall = 0.0;
  for (int i = -1; i <= 1; i++) {
    for (int j = -1; j <= 1; j++) {
      vec2 cell = vec2(float(i), float(j));
      fall += flake(auv, cell, 7.0,  uTime, 0.55) * 0.85;   // near, large
      fall += flake(auv, cell, 19.0, uTime, 0.80) * 0.45;   // far, small
    }
  }
  fall = clamp(fall, 0.0, 1.0) * (0.25 + coverage * 0.85);

  // --- the screen behind ---------------------------------------------------
  vec3 behind = vec3(0.02, 0.025, 0.035);
  if (uHasScreen > 0.5) {
    behind = sampleScreen(uv * uResolution);
  }

  // Above the drift the screen is still readable but the air is thickening.
  float haze = smoothstep(0.25, 1.0, coverage) * 0.55;
  vec3  air  = mix(vec3(0.16, 0.18, 0.23), vec3(0.30, 0.33, 0.40), coverage);
  vec3  colour = mix(behind, air, haze);

  // Snow itself: cool white, faintly shaded so the drift has volume rather
  // than reading as a flat fill.
  float shade = 0.86 + fbm(auv * 6.0) * 0.14;
  vec3  pack  = mix(vec3(0.60, 0.65, 0.74), vec3(0.78, 0.82, 0.88), shade);
  // A thin bright line along the crest, as light catches the powder edge.
  float rim   = exp(-pow((uv.y - driftTop) / 0.010, 2.0));
  pack += mix(vec3(1.0), uAccent, 0.20) * rim * 0.30;

  colour = mix(colour, pack, buried);
  colour += vec3(0.92, 0.95, 1.00) * fall * (1.0 - buried) * 0.85;

  float alpha = clamp(max(max(buried, haze), fall * 0.9), 0.0, 1.0);

  colour = mix(colour, vec3(0.68, 0.72, 0.79), uBlackout);
  alpha  = clamp(max(alpha, uBlackout) * uIntensity, 0.0, 1.0);

  fragColor = vec4(colour * alpha, alpha);
}
`,
};
