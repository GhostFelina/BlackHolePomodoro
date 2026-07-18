import type { FocusEffect } from './types.js';

/**
 * Gargantua — a physically ray-traced Schwarzschild black hole.
 *
 * This does not fake the lensing with a radial pinch. It integrates the actual
 * path light takes through curved spacetime, which is why the image looks like
 * the one from Interstellar rather than like a photo with a swirl filter.
 *
 * ## The physics, and why each piece is here
 *
 * **Geodesics.** For a photon around a Schwarzschild mass, the orbit obeys
 *
 *     d²u/dφ² + u = (3/2) rs u²        where u = 1/r
 *
 * Integrated in Cartesian form that becomes an acceleration toward the mass of
 *
 *     a = −(3/2) h² r̂ / |r|⁵          with h = |r × v| conserved
 *
 * which is the single line at the heart of the loop below. The Newtonian term
 * alone would bend starlight by half as much; the extra factor is general
 * relativity, and it is what produces the photon ring and the Einstein arcs.
 *
 * **The shadow.** Rays whose impact parameter falls below b = 3√3/2 · rs spiral
 * in and are captured. Nothing is drawn for them: the result is true #000000,
 * which on an OLED panel is a genuinely unlit pixel.
 *
 * **The disc over the top.** The accretion disc is flat and lies in the
 * equatorial plane. Because light bends, we see the far side of it *through*
 * the space above and below the hole — that is the arc, and it emerges from
 * the integration rather than being drawn as a separate ring.
 *
 * **Doppler beaming.** Disc material orbits at a large fraction of c. The side
 * rotating toward the viewer is blueshifted and brightened by δ⁴; the receding
 * side is dimmed. This asymmetry is the single most recognisable cue that the
 * object is real and not a texture.
 *
 * **Gravitational redshift.** Light climbing out of the well loses energy by
 * √(1 − rs/r), reddening and dimming the inner disc.
 *
 * ## Performance
 *
 * Cost is paid only where it buys something:
 *
 * - Pixels outside the influence radius return transparent immediately, so
 *   while the hole is small almost the whole screen costs one branch. This is
 *   what keeps the first four minutes of the countdown effectively free.
 * - The step size scales with distance from the hole: coarse far away where
 *   spacetime is nearly flat, fine near the photon sphere where it is not.
 * - The march stops the moment a ray is captured or clearly escaping.
 */

const STEPS = 128;

export const gargantua: FocusEffect = {
  id: 'gargantua',
  nameKey: 'effect.gargantua.name',
  descriptionKey: 'effect.gargantua.description',
  supportsScreenLensing: true,
  influenceRadiusFactor: 7.0,

  fragmentSource: /* glsl */ `
// Units: rs = 1. Camera distance and disc extent are all multiples of it.
const float DISC_IN  = 2.30;   // inner edge, near the innermost stable orbit
const float DISC_OUT = 9.50;
const float B_CRIT   = 2.598;  // 3*sqrt(3)/2 — the shadow's angular radius
const float CAM_DIST = 14.0;
const float INCLINE  = 0.150;  // radians above the disc plane

// Blackbody-ish ramp for the disc, warm at the rim and white at the centre.
vec3 discTemperature(float t) {
  vec3 cool = vec3(0.85, 0.22, 0.05);
  vec3 warm = vec3(1.00, 0.62, 0.22);
  vec3 hot  = vec3(1.00, 0.94, 0.82);
  return t < 0.5 ? mix(cool, warm, t * 2.0) : mix(warm, hot, (t - 0.5) * 2.0);
}

void main() {
  vec2  pixel = vUv * uResolution;
  vec2  d     = pixel - uCenter;
  float rPix  = length(d);
  float rs    = max(uRadius, 1.0);

  float influence = rs * ${7.0.toFixed(1)};
  if (rPix > influence && uBlackout < 0.001) { fragColor = vec4(0.0); return; }
  if (uBlackout > 0.999) { fragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }

  // ---------------------------------------------------------------- camera
  // uRadius is the on-screen radius the shadow should occupy, so the angular
  // scale follows from the critical impact parameter. Growing uRadius is
  // therefore identical to flying toward the hole.
  float pixPerRad = rs / (B_CRIT / CAM_DIST);

  float ci = cos(INCLINE), si = sin(INCLINE);
  vec3 camPos = vec3(0.0, CAM_DIST * si, -CAM_DIST * ci);
  vec3 fwd    = normalize(-camPos);
  vec3 right  = normalize(cross(vec3(0.0, 1.0, 0.0), fwd));
  vec3 up     = cross(fwd, right);

  vec2 theta = vec2(d.x, -d.y) / pixPerRad;
  vec3 pos = camPos;
  vec3 vel = normalize(fwd + right * theta.x + up * theta.y);

  // Conserved specific angular momentum: the whole geodesic hangs off this.
  float h2 = dot(cross(pos, vel), cross(pos, vel));

  float spin = uReducedMotion > 0.5 ? 0.0 : uTime;

  // ------------------------------------------------------------- integrate
  vec3  disc      = vec3(0.0);
  float captured  = 0.0;
  float escaped   = 0.0;

  for (int i = 0; i < ${STEPS}; i++) {
    float r2 = dot(pos, pos);
    float r  = sqrt(r2);

    if (r < 1.0) { captured = 1.0; break; }
    if (r > 42.0 && dot(pos, vel) > 0.0) { escaped = 1.0; break; }

    // Fine near the photon sphere, coarse out in nearly-flat space.
    float dt = clamp(0.11 * (r - 0.9), 0.02, 1.35);

    vec3 acc     = -1.5 * h2 * pos / (r2 * r2 * r);
    vec3 nextVel = vel + acc * dt;
    vec3 nextPos = pos + nextVel * dt;

    // --- disc crossing -----------------------------------------------------
    if (pos.y * nextPos.y < 0.0) {
      float f   = pos.y / (pos.y - nextPos.y);
      vec3  hit = mix(pos, nextPos, f);
      float rd  = length(hit.xz);

      if (rd > DISC_IN && rd < DISC_OUT) {
        float t = clamp((rd - DISC_IN) / (DISC_OUT - DISC_IN), 0.0, 1.0);

        // Keplerian orbit: inner material laps the outer material, which is
        // what makes the filaments shear instead of rotating rigidly.
        float phi   = atan(hit.z, hit.x);
        float omega = 1.0 / max(pow(rd, 1.5), 0.001);
        float sw    = phi + spin * omega * 5.5;

        float band = fbm(vec2(sw * 1.6, rd * 0.85)) * 0.75
                   + fbm(vec2(sw * 4.3, rd * 2.30)) * 0.35;
        band = 0.35 + 1.15 * band;

        // Relativistic Doppler beaming. β is the line-of-sight component of
        // the orbital velocity; observed brightness scales as δ⁴.
        vec3  tangent = normalize(cross(vec3(0.0, 1.0, 0.0), hit));
        float vOrb    = min(sqrt(0.5 / max(rd, 0.5)), 0.72);
        float beta    = vOrb * dot(tangent, -normalize(nextVel));
        float gamma   = inversesqrt(max(1.0 - vOrb * vOrb, 0.02));
        float delta   = 1.0 / max(gamma * (1.0 - beta), 0.05);
        // Physically the exponent is 4, but at these orbital speeds that pins
        // the receding half to black and the image loses the ring entirely.
        // 2.4 keeps the asymmetry unmistakable while both halves stay visible,
        // which is also how the Interstellar renders were graded.
        float beaming = clamp(pow(delta, 2.4), 0.22, 4.2);

        // Gravitational redshift on the way out of the well.
        float grav = sqrt(max(1.0 - 1.0 / rd, 0.02));

        // Radial brightness profile of a thin accretion disc.
        float profile = pow(1.0 - t, 1.35) * (1.0 - exp(-(rd - DISC_IN) * 3.2));

        // Soft edges so the disc does not end on a hard line.
        float edge = smoothstep(0.0, 0.07, t) * (1.0 - smoothstep(0.80, 1.0, t));

        vec3 emission = discTemperature(1.0 - t) * profile * band * beaming * grav * edge;

        // Beamed light shifts blue; receding light reddens.
        emission *= mix(vec3(1.06, 0.94, 0.80), vec3(0.80, 0.92, 1.14),
                        clamp(beta * 1.6 + 0.5, 0.0, 1.0));

        disc += emission * 1.55;
      }
    }

    pos = nextPos;
    vel = nextVel;
  }

  // ------------------------------------------------------- what lies beyond
  vec3 background = vec3(0.0);
  // Declared out here because the alpha calculation below needs to know how far
  // the ray was displaced, including for rays that never escaped.
  vec2 lensed = theta;

  // 1 at the centre, 0 at the influence edge. Everything the effect does is
  // scaled by this, which is what makes it dissolve seamlessly into the real
  // desktop instead of ending on a visible circle.
  float lensStrength = 1.0 - smoothstep(influence * 0.45, influence, rPix);

  if (captured < 0.5) {
    vec3 outDir = normalize(vel);

    // Where this ray would have landed on the desktop had space been flat.
    float denom = dot(outDir, fwd);
    lensed = vec2(dot(outDir, right), -dot(outDir, up)) / max(denom, 0.05);

    // Sample by the *deflection angle*, not by the projected position.
    //
    // The incoming ray's own gnomonic angle is exactly theta by
    // construction, so (lensed - theta) is precisely how far gravity moved
    // this ray and nothing else. With no mass present it is identically zero,
    // which means far-from-the-hole pixels map to themselves perfectly.
    // Sampling the absolute projected position instead re-projected the whole
    // screen through the camera model and bowed the desktop into a bubble.
    vec2 deflection = (lensed - theta) * pixPerRad * lensStrength;
    vec2 samplePx = pixel + vec2(deflection.x, -deflection.y);

    if (uHasScreen > 0.5 && denom > 0.05) {
      background = sampleScreen(samplePx);
    }

    // Star field and nebula, sampled in the deflected direction so a single
    // star can appear twice — once directly, once as its lensed arc.
    vec2 sky = vec2(atan(outDir.z, outDir.x), asin(clamp(outDir.y, -1.0, 1.0)));

    vec2  cellId = floor(sky * 58.0);
    float rnd    = hash21(cellId);
    if (rnd > 0.975) {
      vec2  local = fract(sky * 58.0) - 0.5;
      float twink = 0.70 + 0.30 * sin(spin * 1.7 + rnd * 71.0);
      float point = exp(-dot(local, local) * 150.0) * twink;
      vec3  tint  = mix(vec3(0.78, 0.85, 1.0), vec3(1.0, 0.90, 0.74), hash11(rnd * 27.1));
      background += tint * point * 1.35;
    }

    float clouds = fbm(sky * 1.6 + vec2(spin * 0.004, 0.0));
    vec3  nebula = mix(vec3(0.016, 0.022, 0.052), vec3(0.075, 0.038, 0.100), clouds);
    background += nebula * smoothstep(0.42, 0.95, clouds) * 0.80;
  }

  // The disc and the shadow also fade at the edge, for the same reason.
  disc *= lensStrength;
  captured *= lensStrength;

  // --------------------------------------------------------------- compose
  vec3 color = background + disc;

  // Everything inside the shadow is unlit. No glow, no haze, no cheating.
  color *= (1.0 - captured);

  // How different this pixel is from the untouched desktop decides how much
  // of the overlay we actually paint.
  float discLum = clamp(dot(disc, vec3(0.30, 0.59, 0.11)) * 2.2, 0.0, 1.0);
  float cosmos  = smoothstep(0.12, 0.75, uGrowth) * lensStrength;

  float alpha;
  if (uHasScreen > 0.5) {
    // With the desktop bound we must cover any pixel whose light was moved.
    float displaced = clamp(length((lensed - theta) * pixPerRad * lensStrength)
                            / (rs * 0.45), 0.0, 1.0);
    alpha = max(max(captured, discLum), max(displaced, cosmos * 0.55));
  } else {
    alpha = max(max(captured, discLum), cosmos);
  }

  color = mix(color, vec3(0.0), uBlackout);
  alpha = clamp(max(alpha, uBlackout) * uIntensity, 0.0, 1.0);

  fragColor = vec4(color * alpha, alpha); // premultiplied
}
`,
};
