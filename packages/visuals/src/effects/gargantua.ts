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

const STEPS = 40;

export const gargantua: FocusEffect = {
  id: 'gargantua',
  styleId: 0,
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
// Style ids. One shader, four looks, selected by a uniform so they share a
// compiled program and cost the same to draw.
const float S_CLASSIC = 0.0;   // Interstellar: cream and white, near edge-on
const float S_INFERNO = 1.0;   // NASA simulation: saturated red through orange
const float S_HALO    = 2.0;   // supermassive: faint disc, bright rim, rich sky
const float S_PRISM   = 3.0;   // chromatic dispersion into rainbow bands

vec3 discColour(float t) {
  // Inferno never reaches white. Real simulation stills of a thin disc render
  // it in a narrow red-to-yellow band, and holding the top end short of white
  // is what keeps it reading as fire rather than as metal.
  if (uStyle == S_INFERNO) {
    vec3 deep = vec3(0.42, 0.03, 0.01);
    vec3 red  = vec3(0.96, 0.16, 0.02);
    vec3 amber= vec3(1.00, 0.52, 0.06);
    vec3 top  = vec3(1.00, 0.80, 0.26);
    if (t < 0.30) return mix(deep, red, t / 0.30);
    if (t < 0.68) return mix(red, amber, (t - 0.30) / 0.38);
    return mix(amber, top, (t - 0.68) / 0.32);
  }

  // Prism: hue swept across the disc so dispersion reads as banding. Real
  // chromatic separation would mean re-marching per wavelength, which costs
  // three times as much for a difference the eye reads as colour anyway.
  if (uStyle == S_PRISM) {
    float h = fract(t * 1.15 + 0.02);
    vec3 rainbow = 0.58 + 0.42 * cos(6.28318 * (h + vec3(0.00, 0.33, 0.67)));
    return mix(rainbow, vec3(1.0), smoothstep(0.72, 1.0, t) * 0.72);
  }

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
  // A clean, deep starfield — no galaxy glow, no nebula haze. The lensing bends
  // crisp stars, which reads far more like real gravitational lensing than
  // bending a cloud. The galactic band is kept only as a density gradient so
  // the stars concentrate along a line rather than scattering uniformly.
  float gb   = sky.y + sin(sky.x * 0.6) * 0.22;
  float band = exp(-gb * gb * 5.5);

  // --- stars ---------------------------------------------------------------
  vec3 stars = vec3(0.0);
  for (int layer = 0; layer < 5; layer++) {
    float scale = 42.0 + float(layer) * 48.0;
    vec2  cell  = floor(sky * scale);
    float rnd   = hash21(cell + float(layer) * 37.13);

    // A denser field than before, so the lensed sky is rich enough to make the
    // bending obvious. More stars inside the galactic band, as in reality.
    float cutoff = mix(0.9680, 0.9350, band) - (uStarDensity - 1.0) * 0.014;
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

  return stars * uStarDensity;
}

/**
 * The break scene.
 *
 * During a break the screen used to be flat #000000 with a countdown on it.
 * That does the job but wastes the one moment the app has the whole display —
 * so instead it opens onto the field: nebulae, a dense star bed, a few slow
 * meteors, and the hole itself far away where it can no longer reach you.
 *
 * It is deliberately dim. This is meant to rest the eyes for ten minutes, so
 * the brightest pixel here sits far below the brightest pixel of the disc.
 */
vec3 breakScene(vec2 uv, vec2 res, float time) {
  vec2  p = (uv - 0.5) * vec2(res.x / res.y, 1.0);
  float dist = length(p);

  // Planar coordinates, not polar. Feeding angle-and-radius into the sky put a
  // singularity at the centre of the screen where every angle converges, which
  // rendered as a starburst of streaks radiating from the middle.
  vec2 sky = p * 2.1 + vec2(time * 0.006, time * 0.004);

  // Just the stars (the nebula is off by default). A faint cool cast keeps the
  // field from reading warm without the galaxy to colour it.
  vec3 field = deepSky(sky, time) * 1.20;
  float lum = dot(field, vec3(0.30, 0.59, 0.11));
  field = mix(field, vec3(0.34, 0.44, 0.82) * lum * 1.25, 0.45);

  // --- the black hole, centred ---------------------------------------------
  // A stylised, aesthetic hole (not the full ray-march) so the break scene can
  // run full-screen with a starfield. It honours the Appearance settings that
  // matter here: disc brightness, disc rotation and the accent colour.
  float horizon   = 0.12;
  float ringR     = horizon * 1.14;
  float discInner = horizon * 1.55;
  float discOuter = horizon * 3.1;
  float tilt      = 0.30;                       // near-edge-on ellipse

  float eq   = length(vec2(p.x, p.y / tilt));   // elliptical disc radius
  float ang  = atan(p.y / tilt, p.x);
  float spin = uReducedMotion > 0.5 ? 0.0 : time * 0.45 * max(uDiscSpeed, 0.15);
  // Turbulent, rotating emission: the swirl is what sells the spacetime motion.
  float swirl = 0.55 + 0.45 * sin(ang * 2.0 - spin * 2.4 + eq * 20.0);
  float band  = smoothstep(discInner, discInner * 1.14, eq)
              * (1.0 - smoothstep(discOuter * 0.78, discOuter, eq));
  // The far half of the disc passes behind the sphere; only the near half is
  // in front — that occlusion is what reads as a hole, not a ring.
  if (dist < horizon && p.y < 0.0) band = 0.0;

  // Gravitational arcs lifting over the top and under the bottom.
  float arcR = horizon * 1.5;
  float arc  = exp(-pow((dist - arcR) / (horizon * 0.18), 2.0))
             * pow(abs(p.y) / max(dist, 1e-3), 1.3);

  float discAmt = clamp(max(band * swirl, arc * 0.9), 0.0, 1.0);
  float heat    = 1.0 - smoothstep(discInner, discOuter, min(eq, dist));
  vec3  warm    = mix(vec3(1.0, 0.62, 0.26), uAccent, 0.35);
  vec3  discCol = warm * mix(0.72, 1.28, heat) * discAmt * max(uDiscBrightness, 0.2) * 1.30;

  // Photon ring: the bright, sharp circle at the shadow's edge.
  float ring    = exp(-pow((dist - ringR) / (horizon * 0.085), 2.0));
  vec3  ringCol = mix(vec3(1.0, 0.96, 0.88), uAccent, 0.15) * ring * 0.75;

  // Event horizon: pure black. Stars behind it vanish; the disc/ring that cross
  // in front stay lit.
  float core = 1.0 - smoothstep(horizon - 0.004, horizon + 0.004, dist);
  field *= (1.0 - core);
  vec3 hole = discCol + ringCol;
  field += hole;
  field = mix(field, vec3(0.0), core * (1.0 - clamp(discAmt + ring, 0.0, 1.0)));

  // --- meteors -------------------------------------------------------------
  // Three lanes, each firing on its own slow cycle. A streak is a distance to
  // a line segment, which is a few instructions rather than a particle buffer.
  for (int i = 0; i < 3; i++) {
    float fi    = float(i);
    float cycle = 9.0 + fi * 4.5;
    float phase = fract((time + fi * 3.1) / cycle);
    float seed  = floor((time + fi * 3.1) / cycle) + fi * 17.0;

    // Each pass picks a fresh entry point and heading.
    vec2  from = vec2(hash11(seed) * 2.2 - 1.1, hash11(seed + 5.0) * 1.4 - 0.7);
    vec2  dir  = normalize(vec2(-0.85, -0.30 - hash11(seed + 9.0) * 0.5));
    float trav = phase * 2.4;

    vec2  head = from + dir * trav;
    vec2  tail = head - dir * 0.20;

    // Distance from this pixel to the head-tail segment.
    vec2  seg = head - tail;
    float t   = clamp(dot(p - tail, seg) / max(dot(seg, seg), 1e-5), 0.0, 1.0);
    float d   = length(p - (tail + seg * t));

    // Bright at the head, fading down the tail; fades in and out over the pass.
    float streak = exp(-d * 320.0) * t;
    float alive  = smoothstep(0.0, 0.10, phase) * (1.0 - smoothstep(0.72, 1.0, phase));
    field += vec3(0.85, 0.92, 1.00) * streak * alive * 0.85;
  }

  return field;
}

// Shooting stars: three lanes, each firing on its own slow cycle. A streak is
// a distance to a line segment — a few instructions, not a particle buffer.
// Screen-space on purpose: meteors are foreground, closer than the lensed sky.
vec3 meteorField(vec2 uv, vec2 res, float time) {
  vec2 p = (uv - 0.5) * vec2(res.x / res.y, 1.0);
  vec3 glow = vec3(0.0);
  for (int i = 0; i < 3; i++) {
    float fi    = float(i);
    float cycle = 9.0 + fi * 4.5;
    float phase = fract((time + fi * 3.1) / cycle);
    float seed  = floor((time + fi * 3.1) / cycle) + fi * 17.0;

    vec2  from = vec2(hash11(seed) * 2.2 - 1.1, hash11(seed + 5.0) * 1.4 - 0.7);
    vec2  dir  = normalize(vec2(-0.85, -0.30 - hash11(seed + 9.0) * 0.5));
    float trav = phase * 2.4;

    vec2  head = from + dir * trav;
    vec2  tail = head - dir * 0.20;

    vec2  seg = head - tail;
    float t   = clamp(dot(p - tail, seg) / max(dot(seg, seg), 1e-5), 0.0, 1.0);
    float dd  = length(p - (tail + seg * t));

    float streak = exp(-dd * 320.0) * t;
    float alive  = smoothstep(0.0, 0.10, phase) * (1.0 - smoothstep(0.72, 1.0, phase));
    glow += vec3(0.85, 0.92, 1.00) * streak * alive * 0.85;
  }
  return glow;
}

void main() {
  vec2  pixel = vUv * uResolution;
  vec2  d     = pixel - uCenter;
  float rPix  = length(d);
  float rs    = max(uRadius, 1.0);

  float influence = rs * ${8.0.toFixed(1)};
  if (rPix > influence && uBlackout < 0.001) { fragColor = vec4(0.0); return; }
  if (uBlackout > 0.999) {
    vec3 scene = breakScene(vUv, uResolution, uTime);
    // Vignette: keeps the edges of a large display calm and puts the weight in
    // the middle, where the countdown sits.
    vec2 v = (vUv - 0.5) * vec2(uResolution.x / uResolution.y, 1.0);
    scene *= 1.0 - smoothstep(0.35, 0.95, length(v)) * 0.55;
    scene = scene / (1.0 + scene * 0.9);
    fragColor = vec4(scene, 1.0);
    return;
  }

  // ---------------------------------------------------------------- camera
  // uRadius is the on-screen radius the shadow occupies, so the angular scale
  // follows from the critical impact parameter.
  float pixPerRad = rs / (B_CRIT / CAM_DIST);

  // Each style has its own natural viewing angle. The user's setting offsets
  // it rather than replacing it, so the styles stay distinguishable at any
  // slider position.
  float baseIncline = uStyle == S_INFERNO ? 11.0
                    : uStyle == S_PRISM   ? 17.0
                    : uStyle == S_HALO    ? 1.6
                    : 3.2;
  float incline = radians(max(0.4, baseIncline + (uInclination - 3.2)));
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

  // The rotation is what makes the disc read as living material rather than a
  // still photograph, so it is pushed well past the physically slow rate a
  // supermassive hole would truly have — the swirl needs to be obvious.
  float spin = uReducedMotion > 0.5 ? 0.0 : uTime * 0.42 * uDiscSpeed;

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

      // Keplerian shear in the disc's own rotating frame. The direction is
      // reversed from before, and the rate is high enough that the material
      // clearly streams around the hole rather than sitting still.
      float phi   = atan(pos.z, pos.x);
      float omega = pow(max(rd, 0.5), -1.5);
      float sw    = phi - spin * omega * 34.0;

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
      // bright ones read as distinct strands that are visible as they orbit,
      // rather than melting into one smooth, static-looking band.
      fil = 0.035 + 3.15 * fil * fil * fil;

      // Radial brightness: bright inner rim falling off outward.
      float profile = pow(1.0 - t, 1.9);
      profile *= smoothstep(0.0, 0.06, t);              // soft inner edge
      profile *= 1.0 - smoothstep(0.78, 1.0, t);        // soft outer edge

      // A broad brightness swell that orbits at one clear rate. Coupled with the
      // streaming filaments it is what makes the disc read as spinning material,
      // not a frozen photograph.
      float hot = 0.82 + 0.34 * (0.5 + 0.5 * cos(phi - uTime * 0.55 * max(uDiscSpeed, 0.3)));
      vec3 emission = discColour(1.0 - t) * profile * fil * density * hot;

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

      // Halo shows almost no disc structure — the light in that reference is a
      // broad rim hugging the shadow, not a thin band cutting across it.
      float styleGain = uStyle == S_HALO ? 0.16
                      : uStyle == S_INFERNO ? 1.22
                      : uStyle == S_PRISM ? 1.05
                      : 1.0;
      disc += emission * dt * 0.92 * uDiscBrightness * styleGain;
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
      // The desktop is not merely bent around the hole — it is *pulled into*
      // it. Each pixel shows content dragged in from further out, hardest just
      // outside the horizon and easing to nothing at the influence edge, with
      // a frame-dragging twist that winds the screen around the spin axis and
      // a slow breathing so the pull reads as a living force.
      float rr    = max(rPix, rs);
      float pull  = uSuction * rs * (0.55 + 0.07 * sin(uTime * 0.45))
                  * exp(-(rr - rs) / (rs * 2.2)) * lensStrength;
      vec2  dirOut = d / max(rPix, 1.0);
      float tw    = uSuction * 0.55 * (rs / rr) * lensStrength;
      float cs = cos(tw), sn = sin(tw);
      vec2 q = samplePx + dirOut * pull - uCenter;
      q = vec2(q.x * cs - q.y * sn, q.x * sn + q.y * cs);
      background = sampleScreen(uCenter + q);
    }

    // ------------------------------------------------------------- the sky
    // Sampled in the *deflected* direction, so a single star can appear twice:
    // once directly and once smeared into an Einstein arc around the hole.
    vec2 sky = vec2(atan(outDir.z, outDir.x), asin(clamp(outDir.y, -1.0, 1.0)));
    // Halo is set against a deep, colourful field — that background is half of
    // what makes the reference image work. Inferno and Prism are near-black,
    // which is what gives their discs their contrast.
    float skyGain = uStyle == S_HALO ? 1.75
                  : uStyle == S_INFERNO ? 0.10
                  : uStyle == S_PRISM ? 0.14
                  : 1.0;
    vec3 field = deepSky(sky, uTime) * skyGain;

    if (uStyle == S_HALO) {
      // The reference field is blue and violet with red knots, not the warm
      // Milky-Way tan the other styles use. Simply brightening the shared sky
      // turned it beige, so the hue is remapped: luminance is preserved and
      // the colour is rebuilt cool, with the red emission kept as accents.
      float lum = dot(field, vec3(0.30, 0.59, 0.11));
      vec3  cool = vec3(0.34, 0.46, 1.00) * lum * 1.55;
      vec3  deep = vec3(0.62, 0.30, 0.95) * lum * 0.85;
      vec3  knot = vec3(1.00, 0.28, 0.34) * pow(lum, 2.2) * 2.10;
      float split = warpedFbm(sky * 0.9 + 17.0);
      field = mix(cool, deep, smoothstep(0.40, 0.78, split)) + knot;
    }

    // Over a captured desktop the stars stay faint until the break fills in,
    // so the bending and suction of the real screen remain the star of the
    // growth phase; without a capture the field is the whole background.
    background += field * mix(1.0, 0.25 + 0.75 * smoothstep(0.6, 1.0, uGrowth), uHasScreen);
  }

  // --------------------------------------------------------- photon ring
  // Light that orbited the hole one or more times before escaping piles up at
  // the critical impact parameter. It is the brightest, sharpest feature in a
  // real image and it was previously a hairline lost against the disc, so it
  // is reinforced here rather than left to emerge from the march alone.
  float ringR = rs * 1.005;
  float ring  = exp(-pow((rPix - ringR) / (rs * 0.028), 2.0));
  disc += mix(vec3(1.00, 0.95, 0.86), uAccent, 0.18) * ring * 0.26;

  if (uStyle == S_HALO) {
    // The broad, soft, warm rim that defines the supermassive reference: wide
    // enough to read as a glow around a sphere rather than as an orbit.
    float halo = exp(-pow((rPix - rs * 1.16) / (rs * 0.30), 2.0));
    vec3  warm = mix(vec3(1.00, 0.86, 0.66), uAccent, 0.45);
    disc += warm * halo * 1.35 * uDiscBrightness;
    // A second, fainter shell further out gives the edge depth.
    disc += warm * exp(-pow((rPix - rs * 1.62) / (rs * 0.62), 2.0)) * 0.30;
  }

  if (uStyle == S_PRISM) {
    // Dispersion fringes: the ring splits into coloured rims.
    float f = exp(-pow((rPix - rs * 1.06) / (rs * 0.075), 2.0));
    vec3  split = 0.5 + 0.5 * cos(6.28318 * (rPix / (rs * 0.32) + vec3(0.0, 0.33, 0.67)));
    disc += split * f * 0.85;
  }

  disc     *= lensStrength;
  captured *= lensStrength;

  // Shooting stars streak the sky once the break has taken over. Added to the
  // background so the event horizon still swallows them.
  background += meteorField(vUv, uResolution, uTime) * smoothstep(0.55, 0.95, uGrowth);

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
  // Without a desktop capture the hole carries a porthole of deep space with it
  // from the first frame, so the lensed starfield is obvious immediately. With
  // a capture, the *real screen* is the thing being bent and swallowed, so the
  // space fill only takes over as the break arrives.
  float fill     = smoothstep(0.02, 0.7, uGrowth);
  float porthole = mix(0.62, 1.0, fill);
  float cosmos   = mix(porthole, smoothstep(0.12, 0.75, uGrowth), uHasScreen) * lensStrength;

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


/**
 * The three sibling styles.
 *
 * They reuse Gargantua's shader source verbatim and differ only by `styleId`,
 * which the renderer passes as a uniform. Because the program cache is keyed
 * on source rather than on effect id, all four share one compiled program:
 * adding a style costs a branch, not a shader.
 */
export const inferno: FocusEffect = {
  ...gargantua,
  id: 'inferno',
  nameKey: 'effect.inferno.name',
  descriptionKey: 'effect.inferno.description',
  styleId: 1,
};

export const halo: FocusEffect = {
  ...gargantua,
  id: 'halo',
  nameKey: 'effect.halo.name',
  descriptionKey: 'effect.halo.description',
  styleId: 2,
};

export const prism: FocusEffect = {
  ...gargantua,
  id: 'prism',
  nameKey: 'effect.prism.name',
  descriptionKey: 'effect.prism.description',
  styleId: 3,
};
