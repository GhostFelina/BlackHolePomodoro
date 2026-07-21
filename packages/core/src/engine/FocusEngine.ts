/**
 * The focus cycle state machine.
 *
 * Platform-agnostic on purpose: no DOM, no Electron, no Node APIs. The desktop
 * app, and later the iOS/Android app, drive the exact same engine.
 *
 * Time is always derived from the wall clock, never accumulated from ticks, so
 * the phase never drifts if the machine sleeps, the tab is throttled, or a
 * frame is dropped.
 *
 *   0 ─────────────── work-warning ───── work ─────────── work+break
 *   │   focus (silent)   │  warning (effect grows)  │  break (screen taken)  │
 */

export type Phase = 'idle' | 'focus' | 'warning' | 'break';

export interface CycleDurations {
  /** Total focus length in seconds, warning window included. */
  workSeconds: number;
  /** Break length in seconds. */
  breakSeconds: number;
  /** Trailing part of the focus period during which the effect is visible. */
  warningSeconds: number;
}

export interface EngineSnapshot {
  phase: Phase;
  /** Seconds until the current phase ends. */
  remaining: number;
  /** Seconds elapsed inside the current cycle. */
  elapsed: number;
  /** 0 → 1 across the warning window. 0 while focusing, 1 during break. */
  warningProgress: number;
  /** 1-based cycle counter. */
  cycle: number;
  /** Total length of one full cycle, in seconds. */
  cycleSeconds: number;
}

export interface FocusEngineOptions {
  durations: CycleDurations;
  /** Debug/demo accelerator. 60 turns a 60-minute cycle into 60 seconds. */
  timeScale?: number;
  /** Start a fresh cycle automatically when a break ends. */
  autoContinue?: boolean;
  /** Stop after this many complete cycles. 0 means never stop on its own. */
  targetCycles?: number;
  /** Injectable clock (milliseconds since epoch) for deterministic tests. */
  now?: () => number;
}

export const IDLE_SNAPSHOT: EngineSnapshot = Object.freeze({
  phase: 'idle',
  remaining: 0,
  elapsed: 0,
  warningProgress: 0,
  cycle: 0,
  cycleSeconds: 0,
});

export interface EngineSyncState {
  running: boolean;
  cycleStartMs: number | null;
  completedCycles: number;
  durations: CycleDurations;
  timeScale: number;
  autoContinue: boolean;
  targetCycles: number;
  /** When the engine is frozen (e.g. waiting on the Mola Ver gate), the wall
   * time it was frozen at; null when running normally. */
  pausedAt: number | null;
}

type PhaseListener = (next: Phase, previous: Phase, snapshot: EngineSnapshot) => void;

export class FocusEngine {
  private durations: CycleDurations;
  private timeScale: number;
  private autoContinue: boolean;
  private targetCycles: number;
  private readonly now: () => number;

  private running = false;
  private cycleStartMs: number | null = null;
  private completedCycles = 0;
  private pausedAt: number | null = null;
  private lastPhase: Phase = 'idle';
  private phaseListeners = new Set<PhaseListener>();

  constructor(options: FocusEngineOptions) {
    this.durations = normalizeDurations(options.durations);
    this.timeScale = options.timeScale && options.timeScale > 0 ? options.timeScale : 1;
    this.autoContinue = options.autoContinue ?? true;
    this.targetCycles = Math.max(0, Math.floor(options.targetCycles ?? 0));
    this.now = options.now ?? (() => Date.now());
  }

  /** The clock the evaluation uses: frozen while paused, live otherwise. */
  private clock(): number {
    return this.pausedAt ?? this.now();
  }

  // ---------------------------------------------------------------- lifecycle

  start(): EngineSnapshot {
    this.cycleStartMs = this.now();
    this.completedCycles = 0;
    this.pausedAt = null;
    this.running = true;
    return this.emit();
  }

  stop(): EngineSnapshot {
    this.running = false;
    this.cycleStartMs = null;
    this.pausedAt = null;
    return this.emit();
  }

  /**
   * Freezes the whole engine at the current instant. Used by the Mola Ver gate
   * to hold the break at its full length until the user (or a timeout) begins
   * it. Idempotent, and a no-op unless a cycle is running.
   */
  pause(): EngineSnapshot {
    if (this.running && this.pausedAt === null) this.pausedAt = this.now();
    return this.snapshot();
  }

  /** Resumes from a pause, shifting the cycle so no frozen time is counted. */
  resume(): EngineSnapshot {
    if (this.pausedAt !== null && this.cycleStartMs !== null) {
      this.cycleStartMs += this.now() - this.pausedAt;
    }
    this.pausedAt = null;
    return this.emit();
  }

  get isPaused(): boolean {
    return this.pausedAt !== null;
  }

  /** Jump straight into the break, skipping any remaining focus time. */
  breakNow(): EngineSnapshot {
    if (!this.running) return this.snapshot();
    this.pausedAt = null;
    this.cycleStartMs = this.now() - this.scaled(this.durations.workSeconds) * 1000;
    return this.emit();
  }

  /** End the break early and begin the next focus cycle immediately. */
  skipBreak(): EngineSnapshot {
    if (!this.running) return this.snapshot();
    this.pausedAt = null;
    // Skipping the final cycle of a bounded session ends it rather than
    // rolling into a cycle the user did not ask for.
    if (this.targetCycles > 0 && this.completedCycles + 1 >= this.targetCycles) {
      this.completedCycles = this.targetCycles;
      this.running = false;
      this.cycleStartMs = null;
      return this.emit();
    }
    this.completedCycles += 1;
    this.cycleStartMs = this.now();
    return this.emit();
  }

  /** Restart the current cycle from zero without touching the cycle counter. */
  restartCycle(): EngineSnapshot {
    if (!this.running) return this.snapshot();
    this.pausedAt = null;
    this.cycleStartMs = this.now();
    return this.emit();
  }

  // ------------------------------------------------------------------ config

  setDurations(durations: CycleDurations, options: { restart?: boolean } = {}): EngineSnapshot {
    this.durations = normalizeDurations(durations);
    if (this.running && options.restart !== false) this.cycleStartMs = this.now();
    return this.emit();
  }

  setTimeScale(scale: number, options: { restart?: boolean } = {}): EngineSnapshot {
    this.timeScale = scale > 0 ? scale : 1;
    if (this.running && options.restart !== false) this.cycleStartMs = this.now();
    return this.emit();
  }

  setAutoContinue(value: boolean): void {
    this.autoContinue = value;
  }

  /** 0 means unlimited; otherwise the session stops after this many cycles. */
  setTargetCycles(value: number): void {
    this.targetCycles = Math.max(0, Math.floor(value));
  }

  get isRunning(): boolean {
    return this.running;
  }

  getDurations(): CycleDurations {
    return { ...this.durations };
  }

  // ------------------------------------------------------------------- sync

  /**
   * A complete, serialisable description of where the engine stands.
   *
   * The desktop app runs the authoritative engine in the main process and
   * ships this to each window, where a mirror engine reproduces it exactly.
   * That way the growth animation is computed locally every frame at 120 Hz
   * without a single IPC message per frame, and the two can never disagree
   * because both derive everything from the same `cycleStartMs`.
   */
  getSyncState(): EngineSyncState {
    return {
      running: this.running,
      cycleStartMs: this.cycleStartMs,
      completedCycles: this.completedCycles,
      durations: { ...this.durations },
      timeScale: this.timeScale,
      autoContinue: this.autoContinue,
      targetCycles: this.targetCycles,
      pausedAt: this.pausedAt,
    };
  }

  /** Adopts a sync state wholesale. Fires phase listeners if the phase moved. */
  applySyncState(state: EngineSyncState): EngineSnapshot {
    this.running = state.running;
    this.cycleStartMs = state.cycleStartMs;
    this.completedCycles = state.completedCycles;
    this.durations = normalizeDurations(state.durations);
    this.timeScale = state.timeScale > 0 ? state.timeScale : 1;
    this.autoContinue = state.autoContinue;
    this.targetCycles = Math.max(0, Math.floor(state.targetCycles ?? 0));
    this.pausedAt = state.pausedAt ?? null;
    return this.emit();
  }

  // -------------------------------------------------------------- evaluation

  /**
   * Recomputes the current phase. Call this as often as you like — it is pure
   * apart from rolling the cycle counter forward, and cheap enough for 120 Hz.
   */
  snapshot(): EngineSnapshot {
    if (!this.running || this.cycleStartMs === null) return IDLE_SNAPSHOT;

    const work = this.scaled(this.durations.workSeconds);
    const warning = Math.min(this.scaled(this.durations.warningSeconds), work);
    const brk = this.scaled(this.durations.breakSeconds);
    const cycleSeconds = work + brk;

    let elapsed = (this.clock() - this.cycleStartMs) / 1000;

    if (elapsed >= cycleSeconds) {
      if (!this.autoContinue) {
        // Park at the very end of the break until the user starts again.
        this.running = false;
        this.cycleStartMs = null;
        this.pausedAt = null;
        return IDLE_SNAPSHOT;
      }
      const finished = Math.floor(elapsed / cycleSeconds);
      // A cycle target ends the session once it is reached.
      if (this.targetCycles > 0 && this.completedCycles + finished >= this.targetCycles) {
        this.completedCycles = this.targetCycles;
        this.running = false;
        this.cycleStartMs = null;
        this.pausedAt = null;
        return IDLE_SNAPSHOT;
      }
      this.completedCycles += finished;
      this.cycleStartMs += finished * cycleSeconds * 1000;
      elapsed -= finished * cycleSeconds;
    }

    const focusEnd = work - warning;
    let phase: Phase;
    let remaining: number;
    let warningProgress: number;

    if (elapsed < focusEnd) {
      phase = 'focus';
      remaining = focusEnd - elapsed;
      warningProgress = 0;
    } else if (elapsed < work) {
      phase = 'warning';
      remaining = work - elapsed;
      warningProgress = warning > 0 ? (elapsed - focusEnd) / warning : 1;
    } else {
      phase = 'break';
      remaining = cycleSeconds - elapsed;
      warningProgress = 1;
    }

    return {
      phase,
      remaining: Math.max(remaining, 0),
      elapsed,
      warningProgress: clamp01(warningProgress),
      cycle: this.completedCycles + 1,
      cycleSeconds,
    };
  }

  /** Seconds until the break starts, regardless of the current phase. */
  secondsUntilBreak(): number {
    const snap = this.snapshot();
    if (snap.phase === 'idle' || snap.phase === 'break') return 0;
    return this.scaled(this.durations.workSeconds) - snap.elapsed;
  }

  // ------------------------------------------------------------------ events

  onPhaseChange(listener: PhaseListener): () => void {
    this.phaseListeners.add(listener);
    return () => this.phaseListeners.delete(listener);
  }

  /**
   * Evaluate and fire phase-change listeners. The host calls this on its own
   * cadence (a frame loop, or a coarse timer when nothing is on screen).
   */
  tick(): EngineSnapshot {
    return this.emit();
  }

  private emit(): EngineSnapshot {
    const snap = this.snapshot();
    if (snap.phase !== this.lastPhase) {
      const previous = this.lastPhase;
      this.lastPhase = snap.phase;
      for (const listener of this.phaseListeners) listener(snap.phase, previous, snap);
    }
    return snap;
  }

  private scaled(seconds: number): number {
    return seconds / this.timeScale;
  }
}

// ------------------------------------------------------------------- helpers

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * Keeps the warning window inside the focus period. A user who sets a 10-minute
 * focus and a 15-minute warning gets a warning that spans the whole focus block
 * rather than a negative silent period.
 */
export function normalizeDurations(input: CycleDurations): CycleDurations {
  const workSeconds = Math.max(1, Math.round(input.workSeconds));
  const breakSeconds = Math.max(1, Math.round(input.breakSeconds));
  const warningSeconds = Math.min(Math.max(1, Math.round(input.warningSeconds)), workSeconds);
  return { workSeconds, breakSeconds, warningSeconds };
}

/** `1500` → `"25:00"`, `3725` → `"1:02:05"`. */
export function formatDuration(totalSeconds: number): string {
  const total = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}
