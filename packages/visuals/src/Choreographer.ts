import type { EngineSnapshot, Phase } from '@blackholock/core';
import type { EffectFrameContext } from './effects/types.js';

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
}

export const SWALLOW_SECONDS = 2.2;
export const COLLAPSE_SECONDS = 1.2;
const BIRTH_SECONDS = 1.5;

/** Where the hole is allowed to appear, as fractions of the viewport. */
const SPAWN_POINTS: ReadonlyArray<readonly [number, number]> = [
  [0.28, 0.30],
  [0.72, 0.30],
  [0.30, 0.68],
  [0.70, 0.66],
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
    };

    switch (this.stage) {
      case 'hidden':
        return null;

      case 'growing': {
        const p = snapshot.warningProgress;

        // Starts as a handful of pixels; ends covering the screen. Slow at the
        // start so it reads as a curiosity, then unmistakably urgent.
        const eased = 0.15 * p + 0.85 * p * p * p;
        const minRadius = Math.max(4, minEdge * 0.005);
        const radius = minRadius + (diagonal * 0.55 - minRadius) * eased;

        // Drift from the spawn point toward the centre.
        const drift = smoothstep(0.15, 0.95, p);
        const baseX = lerp(this.spawn[0] * width, width * 0.5, drift);
        const baseY = lerp(this.spawn[1] * height, height * 0.5, drift);

        // Two out-of-phase sines per axis: organic, never repeating visibly,
        // and settling down as the hole grows.
        let cx = baseX;
        let cy = baseY;
        if (!input.reducedMotion) {
          const amp = minEdge * 0.08 * (1 - 0.7 * p);
          cx += (Math.sin(now * 0.31) * 0.6 + Math.sin(now * 0.13 + 2.1) * 0.4) * amp;
          cy += (Math.sin(now * 0.23 + 1.3) * 0.6 + Math.sin(now * 0.11 + 4.2) * 0.4) * amp;
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
        const radius = lerp(this.radiusAtSwallow, diagonal * 0.78, accelerate);

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
          blackout: smoothstep(0.55, 1, s),
        };
      }

      case 'blackout':
        return {
          ...base,
          center: [width * 0.5, height * 0.5],
          radius: diagonal,
          growth: 1,
          blackout: 1,
          intensity: 1,
        };

      case 'collapsing': {
        const s = clamp01(elapsed / COLLAPSE_SECONDS);
        const easeOut = 1 - Math.pow(1 - s, 3);
        return {
          ...base,
          center: [width * 0.5, height * 0.5],
          radius: lerp(diagonal * 0.78, 0, easeOut),
          growth: 1 - easeOut,
          blackout: 1 - smoothstep(0, 0.45, s),
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
