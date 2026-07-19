import type { FocusEffect } from './types.js';

/**
 * Flood — the water comes up and your work goes under.
 *
 * The third of the weather set, and the most literal. A waterline climbs the
 * screen; below it everything is submerged, refracted by the surface and lit
 * by caustics, and legible only in the way text at the bottom of a pool is
 * legible. Above it the screen is untouched, which is what makes the rise
 * itself the message: the readable part of your display is visibly shrinking.
 *
 * ## What sells it
 *
 * Three things, in order of how much they matter:
 *
 * **The surface line wobbles.** A straight edge reads as a wipe transition.
 * Two counter-travelling sine trains plus a noise term make it read as water.
 *
 * **Refraction increases with depth.** Near the surface the distortion is
 * slight; further down it is severe. A uniform wobble looks like a filter laid
 * over the image, whereas depth-dependent displacement looks like something
 * seen *through* a volume.
 *
 * **Caustics.** The bright wandering mesh on the bottom of a swimming pool.
 * Approximated here as two layers of ridged noise drifting against each other,
 * which is far cheaper than tracing light through a wavy surface and, at this
 * scale, indistinguishable.
 *
 * Same constant cost as Rain and Snow: no simulation, nothing retained between
 * frames, and no early-out needed because the work is trivial per pixel.
 */
export const flood: FocusEffect = {
  id: 'flood',
  nameKey: 'effect.flood.name',
  descriptionKey: 'effect.flood.description',
  supportsScreenLensing: true,
  influenceRadiusFactor: 0,

  fragmentSource: /* glsl */ `
// Two ridged layers drifting against each other. Where their crests coincide
// you get the bright wandering mesh light makes on the floor of a pool.
float caustic(vec2 p, float time) {
  float a = 1.0 - abs(2.0 * fbm(p * 3.1 + vec2(time * 0.09, time * 0.05)) - 1.0);
  float b = 1.0 - abs(2.0 * fbm(p * 5.7 - vec2(time * 0.06, time * 0.11)) - 1.0);
  float m = a * b;
  return pow(clamp(m, 0.0, 1.0), 2.6);
}

void main() {
  vec2  uv       = vUv;                      // y = 0 at the top, growing down
  float coverage = clamp(uGrowth, 0.0, 1.0);
  float aspect   = uResolution.x / max(uResolution.y, 1.0);
  vec2  auv      = vec2(uv.x * aspect, uv.y);

  if (uBlackout > 0.999) {
    // Fully submerged: deep water, not black, so it still reads as water.
    vec3 deep = vec3(0.014, 0.048, 0.078);
    deep += vec3(0.05, 0.14, 0.18) * caustic(auv * 1.6, uTime) * 0.55;
    fragColor = vec4(deep, 1.0);
    return;
  }

  // --- the waterline -------------------------------------------------------
  // Two counter-travelling trains so the surface never repeats visibly, plus
  // noise so it is not obviously trigonometric.
  float swell = sin(auv.x * 4.3 - uTime * 0.55) * 0.013
              + sin(auv.x * 9.1 + uTime * 0.37) * 0.008
              + sin(auv.x * 21.0 - uTime * 0.81) * 0.003
              + (fbm(vec2(auv.x * 3.0, uTime * 0.12)) - 0.5) * 0.022;

  float level   = 1.0 - coverage;            // 0 = full screen, 1 = empty
  float surface = level + swell;
  float depth   = clamp((uv.y - surface) / max(coverage, 0.001), 0.0, 1.0);
  float under   = smoothstep(surface - 0.004, surface + 0.004, uv.y);

  // --- what is behind ------------------------------------------------------
  vec3 behind = vec3(0.03, 0.05, 0.07);
  if (uHasScreen > 0.5) {
    // Displacement grows with depth: slight at the surface, severe further
    // down. A uniform wobble reads as a filter laid on top of the picture;
    // this reads as looking through a volume of water.
    vec2 ripple = vec2(
      sin(uv.y * 46.0 - uTime * 1.8) * 0.011,
      cos(uv.x * 38.0 * aspect + uTime * 1.3) * 0.007
    ) * depth * under;

    behind = sampleScreen(clamp(uv + ripple, 0.0, 1.0) * uResolution);
  }

  // --- water ---------------------------------------------------------------
  // Colour deepens with depth, and the accent tints the shallows so the effect
  // still answers the colour picker.
  vec3 shallow = mix(vec3(0.10, 0.34, 0.42), uAccent * vec3(0.35, 0.6, 0.7), 0.22);
  vec3 deep    = vec3(0.012, 0.052, 0.090);
  vec3 water   = mix(shallow, deep, smoothstep(0.0, 0.75, depth));

  // Light dies quickly with depth, which is what gives the volume weight.
  float tint = mix(0.42, 0.94, smoothstep(0.0, 0.85, depth));
  vec3  colour = mix(behind, water, tint * under);

  // Caustics, strongest just under the surface where light still reaches.
  float caus = caustic(auv * 2.2 + vec2(0.0, depth * 0.5), uTime);
  colour += vec3(0.35, 0.78, 0.88) * caus * under * (1.0 - depth * 0.75) * 0.42;

  // A bright meniscus along the waterline itself.
  float lip = exp(-pow((uv.y - surface) / 0.0055, 2.0));
  colour += mix(vec3(0.75, 0.93, 1.0), uAccent, 0.25) * lip * 0.55;

  // Foam: noise gated to a thin band under the lip.
  float foamBand = exp(-pow((uv.y - surface - 0.012) / 0.013, 2.0));
  float foam = smoothstep(0.58, 0.92, fbm(vec2(auv.x * 26.0, uTime * 0.9)));
  colour += vec3(0.82, 0.94, 1.0) * foam * foamBand * 0.40;

  float alpha = clamp(max(under * 0.96, max(lip, foam * foamBand)), 0.0, 1.0);

  colour = mix(colour, deep, uBlackout);
  alpha  = clamp(max(alpha, uBlackout) * uIntensity, 0.0, 1.0);

  fragColor = vec4(colour * alpha, alpha);
}
`,
};
