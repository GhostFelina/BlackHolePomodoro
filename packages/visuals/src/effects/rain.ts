import type { FocusEffect } from './types.js';

/**
 * Rain — the screen behind glass in a downpour.
 *
 * The black holes make the case by force. This one makes it by attrition:
 * droplets gather on the glass, each one refracting the desktop behind it, and
 * the fog between them thickens until reading anything is simply not worth the
 * effort. There is no moment of interruption — the screen just becomes less
 * and less usable, which for some people is a far more agreeable way to be
 * moved off a task.
 *
 * ## Why this is cheap
 *
 * It costs a small fraction of the ray-marched holes, and deliberately so:
 * this is the effect for a laptop on battery, an old integrated GPU, or anyone
 * who wants the screen to fill without the fan spinning up.
 *
 * The droplets are not simulated. Space is cut into a grid, each cell owns one
 * droplet whose position and size come from a hash of the cell index, and a
 * pixel only ever tests the few cells around it. That turns "how many
 * droplets" into a constant-cost question — a thousand of them cost exactly
 * what ten do.
 *
 * Refraction through each droplet is a lens normal derived from the distance
 * to its centre, used to offset the screen sample. Real refraction through a
 * sphere would need a proper surface normal and Snell's law; at this scale the
 * difference is invisible and the shortcut is a handful of instructions.
 */
export const rain: FocusEffect = {
  id: 'rain',
  nameKey: 'effect.rain.name',
  descriptionKey: 'effect.rain.description',
  supportsScreenLensing: true,
  // Rain covers the whole screen rather than sitting in one place, so there is
  // no meaningful influence radius to early-out against.
  influenceRadiusFactor: 0,

  fragmentSource: /* glsl */ `
// One droplet per grid cell. Returns the refraction offset it applies at this
// point, and how strongly, in .z.
vec3 droplet(vec2 uv, vec2 cell, float scale, float time, float coverage) {
  vec2  id   = floor(uv * scale) + cell;
  float seed = hash21(id);

  // Not every cell holds a droplet, and more of them do as the rain builds.
  if (seed > 0.15 + coverage * 0.70) return vec3(0.0);

  // Slow downward creep, with each droplet on its own cycle so they do not
  // march in step.
  float speed = 0.10 + hash11(seed * 7.1) * 0.35;
  float slide = fract(seed * 13.7 + time * speed * 0.35);

  vec2 centre = (id + vec2(hash11(seed * 3.3), slide)) / scale;
  float radius = (0.10 + hash11(seed * 5.9) * 0.22) / scale * (0.55 + coverage * 0.85);

  vec2  delta = uv - centre;
  float dist  = length(delta);
  if (dist > radius) return vec3(0.0);

  // A lens: strongest deflection at the rim, none dead centre, which is what
  // makes a droplet read as a bead of water rather than a blurred disc.
  float t = dist / radius;
  // Stronger bend than the physical lens would give. A real bead of this size
  // barely displaces anything; exaggerating it is what makes the refraction
  // legible at a glance instead of a subtle wobble.
  float bend = sin(t * 3.14159) * radius * 3.10;
  return vec3(normalize(delta + 1e-6) * bend, 1.0 - t * t);
}

void main() {
  vec2 uv = vUv;

  // Rain does not grow from a point, so growth drives coverage directly.
  float coverage = clamp(uGrowth, 0.0, 1.0);
  float aspect   = uResolution.x / max(uResolution.y, 1.0);
  vec2  auv      = vec2(uv.x * aspect, uv.y);

  if (uBlackout > 0.999) {
    // Fully fogged: a dark, wet grey rather than pure black, so it reads as
    // weather rather than as the display having switched off.
    fragColor = vec4(0.035, 0.042, 0.055, 1.0);
    return;
  }

  // --- droplets ------------------------------------------------------------
  vec2  offset = vec2(0.0);
  float wetness = 0.0;

  // Two scales: a few large beads over many small ones.
  for (int i = -1; i <= 1; i++) {
    for (int j = -1; j <= 1; j++) {
      vec2 cell = vec2(float(i), float(j));
      vec3 big   = droplet(auv, cell, 9.0,  uTime, coverage);
      vec3 small = droplet(auv, cell, 26.0, uTime * 1.4 + 11.0, coverage);
      offset  += big.xy * 1.0 + small.xy * 0.55;
      wetness  = max(wetness, max(big.z, small.z * 0.7));
    }
  }

  // --- the screen behind ---------------------------------------------------
  vec3 behind = vec3(0.02, 0.025, 0.035);
  if (uHasScreen > 0.5) {
    vec2 refracted = uv + vec2(offset.x / max(aspect, 0.001), offset.y);
    behind = sampleScreen(clamp(refracted, 0.0, 1.0) * uResolution);
  }

  // Fog between the droplets. This is what actually makes the screen
  // unreadable; the beads alone are decorative.
  // Ramps in early and reaches full opacity well before the countdown ends —
  // the whole point is that the screen stops being worth reading, and a fog
  // that only arrives at the last moment does not achieve that.
  float fog = smoothstep(0.05, 0.72, coverage);
  vec3  mist = mix(vec3(0.10, 0.12, 0.16), vec3(0.16, 0.18, 0.22), wetness);
  vec3  colour = mix(behind, mist, fog * 0.95);

  // A cold rim light on each bead, tinted by the accent.
  // Beads stay clearer than the fog around them, which is what makes them read
  // as water on glass rather than as blobs in the mist.
  colour = mix(colour, behind, wetness * 0.55);
  colour += mix(vec3(0.62, 0.72, 0.88), uAccent, 0.28) * pow(wetness, 2.0) * 0.30;

  // Streaks left by beads that have run down the glass.
  float streak = smoothstep(0.55, 1.0, hash21(floor(vec2(auv.x * 42.0, 0.0))));
  colour += vec3(0.06, 0.08, 0.10) * streak * fog * 0.5;

  float alpha = clamp(max(fog * 0.94, wetness * 0.85), 0.0, 1.0);

  colour = mix(colour, vec3(0.035, 0.042, 0.055), uBlackout);
  alpha  = clamp(max(alpha, uBlackout) * uIntensity, 0.0, 1.0);

  fragColor = vec4(colour * alpha, alpha);
}
`,
};
