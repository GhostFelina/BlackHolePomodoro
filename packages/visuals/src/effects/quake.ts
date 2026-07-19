import type { FocusEffect } from './types.js';

/**
 * Quake — the display fractures.
 *
 * Cracks spread outward from a point off to one side, the glass shears into
 * shards that no longer quite line up, and the whole thing trembles. Where the
 * weather effects cover the screen, this one *breaks* it: your windows are
 * still there and still lit, but the seams between the pieces make reading
 * across them progressively harder.
 *
 * ## Shards without geometry
 *
 * The fracture is a Voronoi diagram, which is what a real fracture pattern
 * approximates and, conveniently, what a shader can evaluate per pixel with no
 * mesh and no precomputation. Each cell's seed sits at a hashed offset inside
 * its grid square; the nearest seed identifies the shard, and the difference
 * between the nearest and second-nearest distances gives the distance to the
 * seam. That second value is the crack line, free of charge.
 *
 * Each shard is then displaced by a hash of its own id, so the pieces slip
 * against each other rather than shifting as one.
 *
 * ## The tremor
 *
 * A sum of three sine pairs at incommensurable frequencies, so it never
 * settles into a visible rhythm, scaled hard by coverage. Early on it is a
 * fraction of a pixel — enough to feel wrong without being identifiable. It
 * only becomes an obvious shake at the very end.
 *
 * Reduced motion removes the tremor entirely and leaves the fracture static,
 * because a shaking screen is exactly the thing some people cannot tolerate.
 */
export const quake: FocusEffect = {
  id: 'quake',
  nameKey: 'effect.quake.name',
  descriptionKey: 'effect.quake.description',
  supportsScreenLensing: true,
  influenceRadiusFactor: 0,

  fragmentSource: /* glsl */ `
// Voronoi. Returns: .xy the winning cell id, .z the distance to the nearest
// seam — which is the crack line, obtained for free from the runner-up.
vec3 fracture(vec2 p) {
  vec2 cell = floor(p);
  vec2 f    = fract(p);

  float best = 8.0, second = 8.0;
  vec2  bestId = cell;

  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2  offs = vec2(float(i), float(j));
      vec2  id   = cell + offs;
      // Seeds pushed toward their cell centres: fully random placement gives
      // slivers, and real fractured glass has chunkier, blockier pieces.
      vec2  seed = offs + 0.25 + 0.5 * vec2(hash21(id), hash21(id + 41.7));
      float d    = length(seed - f);

      if (d < best) { second = best; best = d; bestId = id; }
      else if (d < second) { second = d; }
    }
  }
  return vec3(bestId, second - best);
}

void main() {
  vec2  uv       = vUv;
  float coverage = clamp(uGrowth, 0.0, 1.0);
  float aspect   = uResolution.x / max(uResolution.y, 1.0);
  vec2  auv      = vec2(uv.x * aspect, uv.y);

  if (uBlackout > 0.999) {
    fragColor = vec4(0.028, 0.026, 0.030, 1.0);
    return;
  }

  // --- tremor --------------------------------------------------------------
  // Incommensurable frequencies so it never resolves into a rhythm. Sub-pixel
  // for most of the countdown: felt rather than seen.
  vec2 shake = vec2(0.0);
  if (uReducedMotion < 0.5) {
    float amp = pow(coverage, 2.2) * 0.011;
    shake = vec2(
      sin(uTime * 37.0) * 0.6 + sin(uTime * 23.3 + 1.7) * 0.4,
      sin(uTime * 31.7 + 0.9) * 0.6 + sin(uTime * 19.1 + 3.3) * 0.4
    ) * amp;
  }

  // --- how far the fracture has spread -------------------------------------
  // From an epicentre off to one side, not the middle: a crack pattern
  // centred on the screen looks like a decoration rather than an impact.
  vec2  epicentre = vec2(0.74 * aspect, 0.32);
  float reach     = coverage * 1.55;
  float spread    = 1.0 - smoothstep(reach * 0.55, reach, length(auv - epicentre));
  spread *= smoothstep(0.02, 0.16, coverage);

  // --- shards --------------------------------------------------------------
  float scale = 7.0;
  vec3  frac  = fracture(auv * scale + 13.0);
  vec2  id    = frac.xy;
  float seam  = frac.z;

  // Each shard slips by its own hashed amount, so the pieces move against one
  // another instead of translating together.
  vec2 slip = (vec2(hash21(id * 1.7), hash21(id * 2.9 + 7.0)) - 0.5)
            * 0.016 * spread * (0.4 + coverage);

  vec2 sampleAt = clamp(uv + slip + shake, 0.0, 1.0);

  vec3 behind = vec3(0.03, 0.03, 0.035);
  if (uHasScreen > 0.5) {
    behind = sampleScreen(sampleAt * uResolution);
  }

  // --- the cracks themselves -----------------------------------------------
  // Thin dark fissure with a bright lit edge, as light catches a broken plane.
  float width = mix(0.045, 0.016, coverage);
  float crack = 1.0 - smoothstep(0.0, width, seam);
  crack *= spread;

  float glint = exp(-pow((seam - width * 1.5) / (width * 0.9), 2.0)) * spread;

  vec3 colour = behind;
  colour = mix(colour, vec3(0.012, 0.012, 0.016), crack * 0.92);
  colour += mix(vec3(0.75, 0.78, 0.86), uAccent, 0.28) * glint * 0.30;

  // Dust hazing the broken area, thickening as the fracture takes hold.
  float dust = smoothstep(0.35, 1.0, coverage) * spread * 0.34;
  colour = mix(colour, vec3(0.13, 0.12, 0.115), dust);

  float alpha = clamp(max(max(crack, glint * 0.8),
                          max(dust, length(slip) * 40.0)), 0.0, 1.0);

  colour = mix(colour, vec3(0.028, 0.026, 0.030), uBlackout);
  alpha  = clamp(max(alpha, uBlackout) * uIntensity, 0.0, 1.0);

  fragColor = vec4(colour * alpha, alpha);
}
`,
};
