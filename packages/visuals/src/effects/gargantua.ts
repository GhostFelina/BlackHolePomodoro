import type { FocusEffect } from './types.js';

/**
 * Gargantua — a ray-traced black hole graded the way Interstellar graded theirs.
 *
 * ## The physics
 *
 * Light paths are integrated, not faked. For a photon around a Schwarzschild
 * mass the orbit obeys
 *
 *     d²u/dφ² + u = (3/2) rs u²        u = 1/r
 *
 * which in Cartesian form is an acceleration toward the mass of
 *
 *     a = −(3/2) h² r⃗ / |r|⁵          h = |r⃗ × v⃗|, conserved
 *
 * That single line produces everything: the shadow, the photon ring, the
 * Einstein arcs, and the disc lensed up over the top of the hole. The Newtonian
 * term alone bends light by half as much — the extra factor is general
 * relativity.
 *
 * ## Why the disc is symmetric
 *
 * A physically complete render applies relativistic Doppler beaming and
 * gravitational frequency shift to the orbiting material. Both are real, and
 * both were deliberately switched off for the film. Kip Thorne's account of the
 * decision: with them on, "the right side of the disk becomes so dark you can
 * hardly see it, and the left side becomes so bright that it dominates in a
 * really puzzling way."
 *
 * Double Negative's renderer could do it correctly; Nolan chose clarity. The
 * result is the image everyone recognises — a disc with the right *shape* but
 * not the right lopsidedness.
 *
 * `DOPPLER_MIX` is that decision, exposed as a number. At 0 the disc is
 * symmetric and film-accurate. At 1 it is physically complete and visibly
 * lopsided. It ships at 0.12: enough asymmetry to read as a rotating object,
 * far short of drowning one side.
 *
 * ## The disc has volume
 *
 * Earlier revisions treated the disc as an infinitely thin plane and coloured
 * the single point where a ray crossed it. That renders a decal, not an object.
 * Here the disc is a slab of finite thickness that the ray integrates *through*,
 * accumulating emission along its path. Rays entering at a shallow angle travel
 * further through the material and come out brighter, which is what gives the
 * inner edge its glow and the whole thing a sense of depth.
 *
 * ## Detail
 *
 * Filaments come from domain-warped fractal noise evaluated in the disc's own
 * rotating frame, so structure shears differentially — inner material laps the
 * outer material, exactly as a Keplerian disc does. The rotation is deliberately
 * slow: Gargantua is 100 million solar masses, and at that scale the disc should
 * look majestic rather than busy.
 */

const STEPS = 220;

/**
 * 0 = symmetric, as graded for the film.
 * 1 = physically complete, and lopsided enough to be confusing.
 */
const DOPPLER_MIX = 0.12;

export const gargantua: FocusEffect = {
  id: 'gargantua',
  nameKey: 'effect.gargantua.name',
  descriptionKey: 'effect.gargantua.description',
  supportsScreenLensing: true,
  influenceRadiusFactor: 8.0,

  fragmentSource: /* glsl */ `
// Units: rs = 1.
const float DISC_IN    = 2.20;   // inner edge
const float DISC_OUT   = 13.0;   // outer edge — Gargantua's disc is wide and thin
const float DISC_THICK = 0.20;   // vertical half-thickness of the slab
const float B_CRIT     = 2.598;  // 3*sqrt(3)/2 — angular radius of the shadow
const float CAM_DIST   = 16.0;
const float INCLINE    = 0.055;  // radians above the disc plane — nearly edge-on
const float DOPPLER    = ${DOPPLER_MIX.toFixed(3)};

// Domain-warped fractal noise. The warp is what turns smooth blobs into the
// stretched filaments real accretion discs show.
float warpedFbm(vec2 p) {
  vec2 q = vec2(fbm(p), fbm(p + vec2(5.2, 1.3)));
  vec2 r = vec2(fbm(p + 4.0 * q + vec2(1.7, 9.2)),
                fbm(p + 4.0 * q + vec2(8.3, 2.8)));
  return fbm(p + 4.0 * r);
}

// Emission colour across the disc. Cream and white rather than saturated
// orange: the film's disc reads as hot metal, not fire.
vec3 discColour(float t) {
  vec3 rim   = vec3(1.00, 0.68, 0.34);   // outer, coolest
  vec3 mid   = vec3(1.00, 0.86, 0.60);
  vec3 core  = vec3(1.00, 0.97, 0.90);   // inner, near white
  return t < 0.55 ? mix(rim, mid, t / 0.55) : mix(mid, core, (t - 0.55) / 0.45);
}

void main() {
  vec2  pixel = vUv * uResolution;
  vec2  d     = pixel - uCenter;
  float rPix  = length(d);
  float rs    = max(uRadius, 1.0);

  float influence = rs * ${8.0.toFixed(1)};
  if (rPix > influence && uBlackout < 0.001) { fragColor = vec4(0.0); return; }
  if (uBlackout > 0.999) { fragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }

  // ---------------------------------------------------------------- camera
  // uRadius is the on-screen radius the shadow occupies, so the angular scale
  // follows from the critical impact parameter.
  float pixPerRad = rs / (B_CRIT / CAM_DIST);

  float ci = cos(INCLINE), si = sin(INCLINE);
  vec3 camPos = vec3(0.0, CAM_DIST * si, -CAM_DIST * ci);
  vec3 fwd    = normalize(-camPos);
  vec3 right  = normalize(cross(vec3(0.0, 1.0, 0.0), fwd));
  vec3 up     = cross(fwd, right);

  vec2 theta = vec2(d.x, -d.y) / pixPerRad;
  vec3 pos   = camPos;
  vec3 vel   = normalize(fwd + right * theta.x + up * theta.y);

  vec3  hvec = cross(pos, vel);
  float h2   = dot(hvec, hvec);

  // Slow on purpose. This is a hundred million solar masses.
  float spin = uReducedMotion > 0.5 ? 0.0 : uTime * 0.09;

  // ------------------------------------------------------------- integrate
  vec3  disc     = vec3(0.0);
  float captured = 0.0;

  for (int i = 0; i < ${STEPS}; i++) {
    float r2 = dot(pos, pos);
    float r  = sqrt(r2);

    if (r < 1.0) { captured = 1.0; break; }
    if (r > 46.0 && dot(pos, vel) > 0.0) break;

    // Step size: fine near the photon sphere where the path curves hard, and
    // fine again near the equatorial plane so the slab is sampled properly
    // rather than stepped over.
    float nearPlane = 1.0 - smoothstep(0.0, DISC_THICK * 3.0, abs(pos.y));
    float dt = clamp(0.085 * (r - 0.9), 0.015, 1.10);
    dt = mix(dt, min(dt, 0.055), nearPlane);

    // --- volumetric disc ---------------------------------------------------
    float rd = length(pos.xz);
    if (rd > DISC_IN && rd < DISC_OUT && abs(pos.y) < DISC_THICK * 3.0) {
      // Gaussian vertical profile, thinner toward the inner edge.
      float scaleH  = DISC_THICK * (0.45 + 0.55 * smoothstep(DISC_IN, DISC_OUT, rd));
      float density = exp(-(pos.y * pos.y) / (2.0 * scaleH * scaleH));

      float t = clamp((rd - DISC_IN) / (DISC_OUT - DISC_IN), 0.0, 1.0);

      // Keplerian shear in the disc's own rotating frame.
      float phi   = atan(pos.z, pos.x);
      float omega = pow(max(rd, 0.5), -1.5);
      float sw    = phi + spin * omega * 34.0;

      // Two scales of filament: broad streams, then fine structure inside them.
      vec2  uvA = vec2(sw * 0.85, rd * 0.42);
      vec2  uvB = vec2(sw * 3.10, rd * 1.55);
      // Ridged noise rather than plain fbm: taking |2n-1| and inverting it
      // turns smooth hills into creases, which is what gives an accretion disc
      // its defined lanes instead of a uniform fog.
      float base   = warpedFbm(uvA);
      float ridge  = 1.0 - abs(2.0 * fbm(uvB) - 1.0);
      float fil    = base * 0.60 + ridge * ridge * 0.40;
      fil = 0.10 + 2.05 * fil * fil;

      // Radial brightness: bright inner rim falling off outward.
      float profile = pow(1.0 - t, 1.9);
      profile *= smoothstep(0.0, 0.06, t);              // soft inner edge
      profile *= 1.0 - smoothstep(0.78, 1.0, t);        // soft outer edge

      vec3 emission = discColour(1.0 - t) * profile * fil * density;

      // Doppler beaming and gravitational shift, scaled by DOPPLER. At the
      // shipped value this is a hint of asymmetry, not a blackout.
      if (DOPPLER > 0.001) {
        vec3  tangent = normalize(cross(vec3(0.0, 1.0, 0.0), pos));
        float vOrb    = min(sqrt(0.5 / max(rd, 0.5)), 0.70);
        float beta    = vOrb * dot(tangent, -normalize(vel));
        float gam     = inversesqrt(max(1.0 - vOrb * vOrb, 0.02));
        float delta   = 1.0 / max(gam * (1.0 - beta), 0.05);
        float grav    = sqrt(max(1.0 - 1.0 / rd, 0.02));
        float full    = clamp(pow(delta, 3.0) * grav, 0.05, 6.0);
        emission *= mix(1.0, full, DOPPLER);
      }

      disc += emission * dt * 0.92;
    }

    vec3 acc = -1.5 * h2 * pos / (r2 * r2 * r);
    vel += acc * dt;
    pos += vel * dt;
  }

  // ------------------------------------------------------- what lies beyond
  vec3 background = vec3(0.0);
  vec2 lensed = theta;

  // 1 at the centre, 0 at the influence edge. Everything is scaled by this so
  // the effect dissolves into the real desktop with no visible boundary.
  float lensStrength = 1.0 - smoothstep(influence * 0.45, influence, rPix);

  if (captured < 0.5) {
    vec3  outDir = normalize(vel);
    float denom  = dot(outDir, fwd);
    lensed = vec2(dot(outDir, right), -dot(outDir, up)) / max(denom, 0.05);

    // Sample by deflection *angle*, never by projected position: the incoming
    // ray's own angle is exactly theta, so (lensed - theta) is precisely how
    // far gravity moved it. With no mass it is zero, so distant pixels map to
    // themselves and the desktop is left untouched.
    vec2 deflection = (lensed - theta) * pixPerRad * lensStrength;
    vec2 samplePx   = pixel + vec2(deflection.x, -deflection.y);

    if (uHasScreen > 0.5 && denom > 0.05) {
      background = sampleScreen(samplePx);
    }

    // Stars, sampled in the deflected direction so one star can appear twice:
    // once directly, once smeared into an Einstein arc.
    vec2 sky = vec2(atan(outDir.z, outDir.x), asin(clamp(outDir.y, -1.0, 1.0)));

    // Three layers with a steep brightness distribution: many faint stars,
    // few bright ones. A flat cutoff gives every star the same magnitude and
    // reads immediately as a texture rather than a sky.
    for (int layer = 0; layer < 3; layer++) {
      float scale = 54.0 + float(layer) * 46.0;
      vec2  cell  = floor(sky * scale);
      float rnd   = hash21(cell + float(layer) * 31.7);
      if (rnd > 0.968) {
        // Remap the tail of the hash into a magnitude, then cube it so the
        // bright end is rare.
        float mag   = (rnd - 0.968) / 0.032;
        float bright = mag * mag * mag;

        vec2  local = fract(sky * scale) - 0.5;
        float tw    = 0.78 + 0.22 * sin(uTime * 1.1 + rnd * 83.0);
        float core  = exp(-dot(local, local) * mix(420.0, 150.0, bright));
        // A faint cross-shaped flare on the brightest stars only.
        float flare = bright * exp(-abs(local.x) * 46.0) * exp(-abs(local.y) * 46.0);

        vec3 tint = mix(vec3(0.72, 0.81, 1.0), vec3(1.0, 0.88, 0.70),
                        hash11(rnd * 27.1));
        background += tint * (core + flare * 0.35) * tw * (0.35 + 1.5 * bright);
      }
    }

    float clouds = warpedFbm(sky * 1.35);
    vec3  nebula = mix(vec3(0.013, 0.018, 0.044), vec3(0.070, 0.034, 0.094), clouds);
    background += nebula * smoothstep(0.40, 0.95, clouds) * 0.75;
  }

  // --------------------------------------------------------- photon ring
  // Light that orbited the hole one or more times before escaping piles up at
  // the critical impact parameter. It is the brightest, sharpest feature in a
  // real image and it was previously a hairline lost against the disc, so it
  // is reinforced here rather than left to emerge from the march alone.
  float ringR = rs * 1.005;
  float ring  = exp(-pow((rPix - ringR) / (rs * 0.028), 2.0));
  disc += vec3(1.00, 0.95, 0.86) * ring * 0.26;

  disc     *= lensStrength;
  captured *= lensStrength;

  // --------------------------------------------------------------- compose
  // Emission from material in front of the hole stays visible even when the
  // ray is ultimately swallowed — that light never entered the horizon.
  vec3 color = background * (1.0 - captured) + disc;

  // Reinhard roll-off. Without it the disc clips to flat white and every
  // filament in it is lost; the coefficient is tuned so the inner rim still
  // blooms but structure survives all the way into the brightest part.
  color = color / (1.0 + color * 0.80);
  color *= 1.62;

  float discLum = clamp(dot(disc, vec3(0.30, 0.59, 0.11)) * 2.6, 0.0, 1.0);
  float cosmos  = smoothstep(0.12, 0.75, uGrowth) * lensStrength;

  float alpha;
  if (uHasScreen > 0.5) {
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
