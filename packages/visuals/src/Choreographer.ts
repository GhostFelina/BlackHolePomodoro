import type { EngineSnapshot, Phase } from '@blackholock/core';
import { DEFAULT_EFFECT_PARAMS, type EffectFrameContext, type EffectParams } from './effects/types.js';

/**
 * Turns the engine's phase and progress into the effect's position, size and
 * opacity over time.
 *
 * This is the piece that decides what the thing actually *feels* like, and it
 * is deliberately separate from both the timer and the shader: the same
 * choreography will drive the mobile build, and swapping in a different effect
 * does not change any of it.
 *
 * The arc:
 *
 *   birth      a few pixels wide, fading in over ~1.5 s at one of four spawn
 *              points, never dead centre
 *   growth     grows every single second across the whole countdown window,
 *              slow at first and dramatic at the end, while drifting toward
 *              the middle on a two-sine wander that calms as it grows
 *   swallow    2.2 s of cubic acceleration until it covers the diagonal
 *   break      solid black, no motion, no GPU cost worth measuring
 *   collapse   1.2 s contraction back to nothing
 */

export type VisualStage = 'hidden' | 'growing' | 'swallowing' | 'blackout' | 'collapsing';

export interface ChoreographyInput {
  snapshot: EngineSnapshot;
  /** Canvas size in device pixels. */
  width: number;
  height: number;
  /** Seconds, monotonic. */
  now: number;
  intensity: number;
  accent: [number, number, number];
  reducedMotion: boolean;
  hasScreenTexture: boolean;
  /** Effect tunables from settings; defaults are used when omitted. */
  params?: EffectParams;
}

export const SWALLOW_SECONDS = 2.2;
export const COLLAPSE_SECONDS = 1.2;
const BIRTH_SECONDS = 2.5;

/**
 * The break shows the real black hole at rest — the same Gargantua the
 * Appearance preview renders — sized so its own gravity fills the screen with
 * the star field around it. A shadow radius of 0.30 of the short edge makes the
 * influence (8×) exceed the diagonal on any normal aspect ratio, so the scene
 * covers the display without ever collapsing to flat black.
 */
const BREAK_RADIUS = 0.3;

/**
 * Fraction of the countdown the hole spends completely motionless.
 *
 * It appears, and then it does nothing at all: no drift, no growth, no wander.
 * On a five-minute countdown that is the first ninety seconds. The point is
 * that it should register as a distant object you noticed, not as an animation
 * that started playing at you.
 */
const STATIC_HOLD = 0.30;

/** Base wander frequency. Low enough that no single sine is trackable. */
const WANDER_HZ = 0.075;

/**
 * Where the hole is allowed to appear, as fractions of the viewport.
 *
 * All of them sit well away from the centre and away from the top-left, where
 * most people keep the window they are actually working in.
 */
const SPAWN_POINTS: ReadonlyArray<readonly [number, number]> = [
  [0.78, 0.24],
  [0.84, 0.62],
  [0.22, 0.74],
  [0.68, 0.80],
  [0.16, 0.30],
];

export class Choreographer {
  private stage: VisualStage = 'hidden';
  private stageStartedAt = 0;
  private bornAt = 0;
  private spawn: readonly [number, number] = SPAWN_POINTS[0]!;
  private radiusAtSwallow = 0;

  /** Call whenever the engine reports a phase change. */
  onPhaseChange(next: Phase, previous: Phase, now: number): void {
    switch (next) {
      case 'warning':
        this.stage = 'growing';
        this.stageStartedAt = now;
        this.bornAt = now;
        this.spawn = SPAWN_POINTS[Math.floor(Math.random() * SPAWN_POINTS.length)]!;
        break;
      case 'break':
        this.stage = 'swallowing';
        this.stageStartedAt = now;
        break;
      case 'focus':
        if (previous === 'break') {
          this.stage = 'collapsing';
          this.stageStartedAt = now;
        } else {
          this.stage = 'hidden';
        }
        break;
      default:
        this.stage = 'hidden';
    }
  }

  getStage(): VisualStage {
    return this.stage;
  }

  /** True while nothing needs to be drawn — the host can idle the GPU. */
  isIdle(): boolean {
    return this.stage === 'hidden';
  }

  /**
   * Produces the frame context, or `null` when there is nothing to draw.
   * Also advances the internal stage when a timed stage runs out.
   */
  frame(input: ChoreographyInput): EffectFrameContext | null {
    const { snapshot, width, height, now } = input;
    const minEdge = Math.min(width, height);
    const diagonal = Math.hypot(width, height);
    const elapsed = now - this.stageStartedAt;

    // Timed stages hand over on their own.
    if (this.stage === 'swallowing' && elapsed >= SWALLOW_SECONDS) {
      this.stage = 'blackout';
    }
    if (this.stage === 'collapsing' && elapsed >= COLLAPSE_SECONDS) {
      this.stage = 'hidden';
    }
    // Safety net: if the engine says "break" but we never saw the transition
    // (app launched mid-break, machine woke from sleep) go straight to black.
    if (snapshot.phase === 'break' && this.stage === 'hidden') {
      this.stage = 'blackout';
    }

    const base: Omit<EffectFrameContext, 'center' | 'radius' | 'growth' | 'blackout'> = {
      time: now,
      resolution: [width, height],
      intensity: input.intensity,
      hasScreenTexture: input.hasScreenTexture,
      accent: input.accent,
      reducedMotion: input.reducedMotion,
      params: input.params ?? DEFAULT_EFFECT_PARAMS,
    };

    switch (this.stage) {
      case 'hidden':
        return null;

      case 'growing': {
        const p = snapshot.warningProgress;

        // --- size ------------------------------------------------------------
        //
        // Growth is *exponential*, not eased-linear, and it begins only after a
        // motionless hold.
        //
        // The earlier curve reached nine times its birth size in the first
        // minute of a five-minute countdown, which is why nothing ever felt
        // still. Exponential growth is also what an object approaching at
        // constant speed actually does to your field of view: almost nothing
        // for most of the approach, then everything at the end.
        const minRadius = Math.max(5, minEdge * 0.0045);
        // The warning ends with a moderate hole over the desktop; the swallow is
        // what makes it big. Growing all the way to the final size here left
        // nothing for the swallow to do.
        const maxRadius = minEdge * 0.14;

        const advance = p <= STATIC_HOLD ? 0 : (p - STATIC_HOLD) / (1 - STATIC_HOLD);
        const shaped = Math.pow(advance, 2.3);
        const radius = minRadius * Math.pow(maxRadius / minRadius, shaped);

        // --- position --------------------------------------------------------
        //
        // Fixed in place through the hold, then drifting toward the middle over
        // the remainder. The drift is deliberately late and slow: this is a
        // distant object, and distant objects do not visibly cross a field of
        // view in five minutes.
        const drift = smoothstep(STATIC_HOLD, 1.0, p) ** 1.6;
        const baseX = lerp(this.spawn[0] * width, width * 0.5, drift);
        const baseY = lerp(this.spawn[1] * height, height * 0.5, drift);

        let cx = baseX;
        let cy = baseY;

        // The wander amplitude is a multiple of the hole's own radius, never a
        // fraction of the screen. At eight pixels across it used to swing 128
        // pixels either way — sixteen times its own size, which reads as a
        // jitter rather than as drift. Tying it to the radius means a small
        // hole barely stirs and a large one moves with weight.
        if (!input.reducedMotion && advance > 0) {
          const settle = 1 - 0.55 * shaped;                // calms as it fills
          const amp = Math.min(radius * 1.4, minEdge * 0.06) * settle;
          cx += (Math.sin(now * WANDER_HZ) * 0.6
               + Math.sin(now * WANDER_HZ * 0.42 + 2.1) * 0.4) * amp;
          cy += (Math.sin(now * WANDER_HZ * 0.74 + 1.3) * 0.6
               + Math.sin(now * WANDER_HZ * 0.35 + 4.2) * 0.4) * amp;
        }

        const birth = clamp01((now - this.bornAt) / BIRTH_SECONDS);
        this.radiusAtSwallow = radius;

        return {
          ...base,
          center: [cx, cy],
          radius,
          growth: p,
          blackout: 0,
          intensity: base.intensity * smoothstep(0, 1, birth),
        };
      }

      case 'swallowing': {
        const s = clamp01(elapsed / SWALLOW_SECONDS);
        const accelerate = s * s * s;
        // Grow to the resting break size, not past the screen. As the radius
        // grows the hole's influence expands from the centre outward, so the
        // star field fills the display smoothly instead of cutting to black.
        const radius = lerp(this.radiusAtSwallow, minEdge * BREAK_RADIUS, accelerate);

        // Lock to centre quickly so the swallow feels inevitable, not wobbly.
        const lockIn = Math.min(s * 2.5, 1);
        let cx = width * 0.5;
        let cy = height * 0.5;
        if (!input.reducedMotion) {
          const amp = minEdge * 0.04 * (1 - lockIn);
          cx += Math.sin(now * 0.31) * amp;
          cy += Math.sin(now * 0.23 + 1.3) * amp;
        }

        return {
          ...base,
          center: [cx, cy],
          radius,
          growth: 1,
          blackout: 0,
        };
      }

      case 'blackout':
        // The break at rest: the real Gargantua, centred and large, with the
        // star field around it — the same thing the Appearance preview shows.
        // No flat black; the countdown sits over the event horizon, which is
        // black enough to read against on its own.
        return {
          ...base,
          center: [width * 0.5, height * 0.5],
          radius: minEdge * BREAK_RADIUS,
          growth: 1,
          blackout: 0,
        };

      case 'collapsing': {
        const s = clamp01(elapsed / COLLAPSE_SECONDS);
        const easeOut = 1 - Math.pow(1 - s, 3);
        return {
          ...base,
          center: [width * 0.5, height * 0.5],
          radius: lerp(minEdge * BREAK_RADIUS, 0, easeOut),
          growth: 1 - easeOut,
          blackout: 0,
        };
      }
    }
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}
