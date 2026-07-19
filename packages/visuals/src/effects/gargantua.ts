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
 * That decision is a setting rather than a constant. At 0 the disc is
 * symmetric and film-accurate; at 1 it is physically complete and visibly
 * lopsided. It defaults to 0.12 — enough asymmetry to read as a rotating
 * object, far short of drowning one side — and the panel exposes the slider.
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

const STEPS = 110;

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

// Domain-warped fractal noise. The warp is what turns smooth blobs into the
// stretched filaments real accretion discs show.
float warpedFbm(vec2 p) {
  vec2 q = vec2(fbm(p), fbm(p + vec2(5.2, 1.3)));
  vec2 r = vec2(fbm(p + 4.0 * q + vec2(1.7, 9.2)),
                fbm(p + 4.0 * q + vec2(8.3, 2.8)));
  return fbm(p + 4.0 * r);
}

// Emission colour across the disc.
//
// The accent tints the *outer* material only. That is not an arbitrary choice:
// disc temperature rises steeply inward, and anything hot enough to sit near
// the inner edge radiates essentially white whatever its composition. Letting
// the accent reach the core would make the whole disc read as coloured plastic
// rather than as something incandescent, so the core is pinned near white and
// the accent owns the cooler rim where colour is physically plausible.
vec3 discColour(float t) {
  // Four stops, not three. Reference frames of Gargantua darken through tan
  // into a deep rust at the outermost material rather than holding one
  // saturated hue to the edge, and that falloff is a large part of why the
  // disc reads as something with depth instead of a coloured ribbon.
  vec3 outer = uAccent * vec3(0.42, 0.30, 0.22);              // far edge, dim and brown
  vec3 rim   = uAccent;
  vec3 mid   = mix(uAccent, vec3(1.00, 0.90, 0.74), 0.58);
  vec3 core  = mix(vec3(1.00, 0.98, 0.93), uAccent, 0.07);    // near white

  if (t < 0.26) return mix(outer, rim, t / 0.26);
  if (t < 0.62) return mix(rim, mid, (t - 0.26) / 0.36);
  return mix(mid, core, (t - 0.62) / 0.38);
}


// ---------------------------------------------------------------- deep sky
//
// A galaxy rendered rather than photographed. A bitmap would need to be 16k
// across before it stopped going soft under the lens — the black hole magnifies
// the background enormously near the photon ring — and would still add tens of
// megabytes to the download. Evaluated instead, it stays sharp at any
// magnification and costs nothing to ship.
//
// Four layers, in the order a real image builds up:
//
//   1. the galactic band     dust-laned, brightest toward the core
//   2. emission nebulae      hydrogen-alpha reds and oxygen teals
//   3. dark nebulae          cold dust that *subtracts*, which is what gives
//                            a real Milky Way its structure
//   4. stars                 four density layers with a realistic magnitude
//                            distribution and colours drawn from stellar
//                            temperature classes
vec3 deepSky(vec2 sky, float time) {
  // Tilt the galactic plane so it does not sit parallel to the disc.
  float ga = sky.x * 0.85 + 0.4;
  float gb = sky.y + sin(sky.x * 0.6) * 0.22;
  vec2  gal = vec2(ga, gb);

  // --- 1. galactic band ----------------------------------------------------
  float bandDist = abs(gb);
  float band = exp(-bandDist * bandDist * 5.5);
  float core = exp(-(ga * ga) * 0.30) * exp(-bandDist * bandDist * 11.0);

  float dust = fbm(gal * vec2(2.2, 7.0) + vec2(time * 0.002, 0.0));
  float lanes = smoothstep(0.42, 0.78, dust);

  vec3 bandWarm = vec3(0.130, 0.112, 0.090);
  vec3 bandCore = vec3(0.245, 0.200, 0.145);
  vec3 galaxy = mix(bandWarm, bandCore, core) * band;
  galaxy *= 1.0 - lanes * 0.78;              // dust lanes cut the band
  galaxy += bandCore * core * 0.55;

  // --- 2. emission nebulae -------------------------------------------------
  vec2  nUv    = gal * 1.15 + vec2(time * 0.0016, -time * 0.0009);
  float clouds = warpedFbm(nUv);
  float wisp   = warpedFbm(nUv * 2.6 + 11.0);

  // Hydrogen alpha dominates real emission nebulae; doubly-ionised oxygen
  // gives the teal. Mixing on a second noise field keeps them from tracking
  // each other and looking like one tinted cloud.
  vec3 hAlpha = vec3(0.205, 0.050, 0.072);
  vec3 oIII   = vec3(0.042, 0.115, 0.135);
  vec3 nebula = mix(hAlpha, oIII, smoothstep(0.35, 0.72, wisp));
  // A high threshold keeps the nebulae as distinct structures. Lower and they
  // merge into a uniform haze that reads as fog rather than sky.
  nebula *= smoothstep(0.58, 0.96, clouds) * (0.45 + 0.90 * band);

  // A cooler reflection component where the gas is thickest.
  nebula += vec3(0.048, 0.070, 0.135) * smoothstep(0.74, 0.99, clouds) * 0.85;

  // --- 3. dark nebulae -----------------------------------------------------
  // Cold dust in front of everything. Subtracting rather than adding is what
  // makes a sky look photographed instead of painted.
  float darkDust = smoothstep(0.55, 0.86, warpedFbm(gal * 1.9 + 31.0));
  vec3 sky3 = (galaxy + nebula) * (1.0 - darkDust * 0.84);

  sky3 *= uNebula;

  // --- 4. stars ------------------------------------------------------------
  vec3 stars = vec3(0.0);
  for (int layer = 0; layer < 4; layer++) {
    float scale = 46.0 + float(layer) * 52.0;
    vec2  cell  = floor(sky * scale);
    float rnd   = hash21(cell + float(layer) * 37.13);

    // More stars inside the galactic band, as in reality.
    float cutoff = mix(0.9805, 0.9600, band) - (uStarDensity - 1.0) * 0.012;
    if (rnd <= cutoff) continue;

    float mag    = (rnd - cutoff) / max(1.0 - cutoff, 1e-4);
    float bright = mag * mag * mag;                 // few bright, many faint

    vec2  local = fract(sky * scale) - 0.5;
    float twk   = 0.80 + 0.20 * sin(time * 1.05 + rnd * 91.0);
    float point = exp(-dot(local, local) * mix(460.0, 130.0, bright));

    // Diffraction spikes on the brightest stars only.
    float spike = bright * bright
                * exp(-abs(local.x) * 52.0) * exp(-abs(local.y) * 3.5)
                + bright * bright
                * exp(-abs(local.y) * 52.0) * exp(-abs(local.x) * 3.5);

    // Colour by stellar class: blue-white O/B through to deep orange M.
    float temp = hash11(rnd * 53.7);
    vec3  tint = temp < 0.5
      ? mix(vec3(0.62, 0.72, 1.00), vec3(1.00, 0.99, 0.97), temp * 2.0)
      : mix(vec3(1.00, 0.99, 0.97), vec3(1.00, 0.74, 0.48), (temp - 0.5) * 2.0);

    stars += tint * (point + spike * 0.22) * twk * (0.30 + 1.70 * bright);
  }

  return sky3 + stars * uStarDensity;
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

  float incline = radians(uInclination);
  float ci = cos(incline), si = sin(incline);
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
  float spin = uReducedMotion > 0.5 ? 0.0 : uTime * 0.09 * uDiscSpeed;

  // ------------------------------------------------------------- integrate
  vec3  disc     = vec3(0.0);
  float captured = 0.0;

  for (int i = 0; i < ${STEPS}; i++) {
    float r2 = dot(pos, pos);
    float r  = sqrt(r2);

    if (r < 1.0) { captured = 1.0; break; }
    if (r > 30.0 && dot(pos, vel) > 0.0) break;

    // Step size: fine near the photon sphere where the path curves hard, and
    // fine again near the equatorial plane so the slab is sampled properly
    // rather than stepped over.
    float nearPlane = 1.0 - smoothstep(0.0, DISC_THICK * 3.0, abs(pos.y));
    float dt = clamp(0.16 * (r - 0.9), 0.030, 2.20);
    dt = mix(dt, min(dt, 0.075), nearPlane);

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
      // Anisotropic sampling: the noise is stretched hard along the direction
      // of orbit and compressed across it, which is what turns mottling into
      // the long drawn-out wisps the reference frames show. Isotropic noise
      // can never look like flowing material however many octaves it has.
      vec2  uvA = vec2(sw * 0.55, rd * 0.72);
      vec2  uvB = vec2(sw * 2.10, rd * 2.60);
      vec2  uvC = vec2(sw * 6.40, rd * 5.10);

      // Plain fbm plus two ridged bands, never the domain-warped variant.
      // warpedFbm is three fbm evaluations; calling it on every step a ray
      // takes through the slab was costing roughly sixty hash operations per
      // step and was single-handedly responsible for the frame time. The
      // anisotropic sampling below already stretches the noise along the flow,
      // which is what the warp was there to achieve.
      float base  = fbm(uvA);
      float ridge = 1.0 - abs(2.0 * fbm(uvB) - 1.0);
      float fine  = 1.0 - abs(2.0 * fbm(uvC) - 1.0);

      float fil = base * 0.46 + ridge * ridge * 0.36 + fine * fine * 0.18;
      // Steeper than square: widens the dark gaps between streams so the
      // bright ones read as distinct strands.
      fil = 0.06 + 2.45 * fil * fil * fil;

      // Radial brightness: bright inner rim falling off outward.
      float profile = pow(1.0 - t, 1.9);
      profile *= smoothstep(0.0, 0.06, t);              // soft inner edge
      profile *= 1.0 - smoothstep(0.78, 1.0, t);        // soft outer edge

      vec3 emission = discColour(1.0 - t) * profile * fil * density;

      // Doppler beaming and gravitational shift, scaled by DOPPLER. At the
      // shipped value this is a hint of asymmetry, not a blackout.
      if (uDoppler > 0.001) {
        vec3  tangent = normalize(cross(vec3(0.0, 1.0, 0.0), pos));
        float vOrb    = min(sqrt(0.5 / max(rd, 0.5)), 0.70);
        float beta    = vOrb * dot(tangent, -normalize(vel));
        float gam     = inversesqrt(max(1.0 - vOrb * vOrb, 0.02));
        float delta   = 1.0 / max(gam * (1.0 - beta), 0.05);
        float grav    = sqrt(max(1.0 - 1.0 / rd, 0.02));
        float full    = clamp(pow(delta, 3.0) * grav, 0.05, 6.0);
        emission *= mix(1.0, full, uDoppler);
      }

      disc += emission * dt * 0.92 * uDiscBrightness;
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

    // ------------------------------------------------------------- the sky
    // Sampled in the *deflected* direction, so a single star can appear twice:
    // once directly and once smeared into an Einstein arc around the hole.
    vec2 sky = vec2(atan(outDir.z, outDir.x), asin(clamp(outDir.y, -1.0, 1.0)));
    background += deepSky(sky, uTime);
  }

  // --------------------------------------------------------- photon ring
  // Light that orbited the hole one or more times before escaping piles up at
  // the critical impact parameter. It is the brightest, sharpest feature in a
  // real image and it was previously a hairline lost against the disc, so it
  // is reinforced here rather than left to emerge from the march alone.
  float ringR = rs * 1.005;
  float ring  = exp(-pow((rPix - ringR) / (rs * 0.028), 2.0));
  disc += mix(vec3(1.00, 0.95, 0.86), uAccent, 0.18) * ring * 0.26;

  disc     *= lensStrength;
  captured *= lensStrength;

  // --------------------------------------------------------------- compose
  // Emission from material in front of the hole stays visible even when the
  // ray is ultimately swallowed — that light never entered the horizon.
  vec3 color = background * (1.0 - captured) + disc;

  // Reinhard roll-off. Without it the disc clips to flat white and every
  // filament in it is lost; the coefficient is tuned so the inner rim still
  // blooms but structure survives all the way into the brightest part.
  // A gentler denominator lets the brightest material run further before it
  // compresses, which widens the gap between the blown-out core of a stream
  // and the dark lane beside it — the high contrast the reference frames have.
  color = color / (1.0 + color * 0.62);
  color *= 1.74;

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
