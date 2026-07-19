/**
 * The effect plug-in contract.
 *
 * An effect is just a fragment shader plus metadata. Everything the renderer
 * knows how to feed it is declared here, so adding a new effect later means
 * writing one file and registering it — no renderer changes, no UI changes, and
 * it shows up in the settings picker automatically.
 */

export interface EffectFrameContext {
  /** Seconds since the renderer started. Monotonic, unaffected by pausing. */
  time: number;
  /** Drawable size in device pixels. */
  resolution: [number, number];
  /** Effect centre in device pixels, top-left origin. */
  center: [number, number];
  /** Core radius in device pixels. */
  radius: number;
  /** 0 → 1 across the countdown window. */
  growth: number;
  /** Global opacity multiplier, including the user's intensity setting. */
  intensity: number;
  /** 0 → 1 fade to solid black for the break screen. */
  blackout: number;
  /** True when a live desktop texture is bound to unit 0. */
  hasScreenTexture: boolean;
  /** Accent tint as linear RGB, chosen in settings. */
  accent: [number, number, number];
  /** True when the user asked for reduced motion. */
  reducedMotion: boolean;
  /**
   * Effect-specific tunables, surfaced in the settings panel.
   *
   * Kept as a flat record of numbers rather than a typed struct per effect so
   * that adding a knob to one effect never touches the renderer, the IPC layer
   * or the settings schema plumbing — only the effect and the panel that draws
   * its controls.
   */
  params: EffectParams;
}

export interface EffectParams {
  /** Overall emission of the accretion disc. */
  discBrightness: number;
  /** Rotation rate multiplier for the disc. */
  discSpeed: number;
  /** Viewing angle above the disc plane, in degrees. */
  inclination: number;
  /** 0 = symmetric as graded for the film, 1 = physically complete. */
  doppler: number;
  /** Density of the background star field. */
  starDensity: number;
  /** Brightness of the nebula and galactic band. */
  nebula: number;
}

export const DEFAULT_EFFECT_PARAMS: EffectParams = Object.freeze({
  discBrightness: 1.0,
  discSpeed: 1.0,
  inclination: 3.2,
  doppler: 0.12,
  starDensity: 1.0,
  nebula: 1.0,
});

export interface FocusEffect {
  /** Stable id persisted in settings. Never rename an existing one. */
  id: string;
  /** i18n keys, so effect names translate like everything else. */
  nameKey: string;
  descriptionKey: string;
  /** Shown in the picker when the effect cannot bend the desktop. */
  supportsScreenLensing: boolean;
  /**
   * How far beyond `radius` the effect paints, as a multiple of radius.
   * The renderer uses it to leave everything outside fully transparent, which
   * is what keeps the desktop untouched and the GPU cost low while the effect
   * is still small.
   */
  influenceRadiusFactor: number;
  /** GLSL ES 3.00 fragment shader body. See `FRAGMENT_PREAMBLE`. */
  fragmentSource: string;
}

/**
 * Injected above every effect shader. Effects implement `vec4 effectColor()`
 * and read these uniforms; they never deal with GL plumbing.
 *
 * Output is premultiplied alpha, so an effect that returns `vec4(0.0)` leaves
 * the desktop pixel-perfect underneath.
 */
export const FRAGMENT_PREAMBLE = /* glsl */ `#version 300 es
precision highp float;

uniform vec2  uResolution;
uniform vec2  uCenter;
uniform float uRadius;
uniform float uTime;
uniform float uGrowth;
uniform float uIntensity;
uniform float uBlackout;
uniform float uHasScreen;
uniform vec3  uAccent;
uniform float uReducedMotion;
uniform sampler2D uScreen;

// User-tunable, all live-updated from the settings panel.
uniform float uDiscBrightness;
uniform float uDiscSpeed;
uniform float uInclination;   // degrees
uniform float uDoppler;
uniform float uStarDensity;
uniform float uNebula;

in  vec2 vUv;
out vec4 fragColor;

// --- shared helpers -------------------------------------------------------

float hash11(float n) { return fract(sin(n) * 43758.5453123); }

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float sum = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 5; i++) {
    sum += valueNoise(p) * amp;
    p = p * 2.03 + vec2(17.3, 9.1);
    amp *= 0.5;
  }
  return sum;
}

vec2 rotate(vec2 v, float a) {
  float c = cos(a), s = sin(a);
  return vec2(v.x * c - v.y * s, v.x * s + v.y * c);
}

vec3 sampleScreen(vec2 pixel) {
  return texture(uScreen, clamp(pixel / uResolution, 0.0, 1.0)).rgb;
}
`;
