import { describe, expect, it } from 'vitest';
import { FocusEngine, formatDuration, normalizeDurations } from './FocusEngine.js';

/**
 * The timer is the one part of this app that must not be wrong. A visual
 * glitch is a disappointment; a break that arrives at the wrong time, or a
 * countdown that drifts over an afternoon, defeats the whole purpose.
 *
 * Every test below drives a fake clock, so they check the arithmetic rather
 * than waiting on real time.
 */

const MINUTE = 60;

function engineAt(startMs: number, overrides = {}) {
  let clock = startMs;
  const engine = new FocusEngine({
    durations: { workSeconds: 50 * MINUTE, breakSeconds: 10 * MINUTE, warningSeconds: 5 * MINUTE },
    now: () => clock,
    ...overrides,
  });
  return {
    engine,
    /** Move the fake clock forward by minutes and return a fresh snapshot. */
    at(minutes: number) {
      clock = startMs + minutes * MINUTE * 1000;
      return engine.snapshot();
    },
  };
}

describe('phase boundaries', () => {
  it('walks focus → warning → break at exactly the configured minutes', () => {
    const { engine, at } = engineAt(1_000_000);
    engine.start();

    expect(at(0).phase).toBe('focus');
    expect(at(44.99).phase).toBe('focus');
    expect(at(45.01).phase).toBe('warning');
    expect(at(49.99).phase).toBe('warning');
    expect(at(50.01).phase).toBe('break');
    expect(at(59.99).phase).toBe('break');
  });

  it('reports the remaining time of the current phase, not the cycle', () => {
    const { engine, at } = engineAt(1_000_000);
    engine.start();

    // During focus, "remaining" counts down to the warning, which is when
    // something first appears on screen.
    expect(at(0).remaining).toBeCloseTo(45 * MINUTE, 1);
    expect(at(20).remaining).toBeCloseTo(25 * MINUTE, 1);

    // During the warning it counts down to the break itself.
    expect(at(47).remaining).toBeCloseTo(3 * MINUTE, 1);

    // During the break, to the end of the break.
    expect(at(55).remaining).toBeCloseTo(5 * MINUTE, 1);
  });

  it('moves warningProgress from 0 to 1 across the countdown window', () => {
    const { engine, at } = engineAt(1_000_000);
    engine.start();

    expect(at(44).warningProgress).toBe(0);
    expect(at(45).warningProgress).toBeCloseTo(0, 2);
    expect(at(47.5).warningProgress).toBeCloseTo(0.5, 2);
    expect(at(49.9).warningProgress).toBeGreaterThan(0.97);
    expect(at(52).warningProgress).toBe(1);
  });
});

describe('cycles', () => {
  it('rolls into the next cycle automatically and counts them', () => {
    const { engine, at } = engineAt(1_000_000);
    engine.start();

    expect(at(30).cycle).toBe(1);
    expect(at(60.5).cycle).toBe(2);
    expect(at(60.5).phase).toBe('focus');
    expect(at(120.5).cycle).toBe(3);
  });

  it('lands in the right phase after skipping many cycles at once', () => {
    // This is what a laptop lid closed over lunch looks like: the clock jumps
    // forward by hours between two ticks. Nothing may drift.
    const { engine, at } = engineAt(1_000_000);
    engine.start();

    const afterFiveHours = at(300);        // exactly five 60-minute cycles
    expect(afterFiveHours.cycle).toBe(6);
    expect(afterFiveHours.phase).toBe('focus');
    expect(afterFiveHours.remaining).toBeCloseTo(45 * MINUTE, 1);

    const later = at(347);                 // 5h + 47min → inside a warning
    expect(later.phase).toBe('warning');
  });

  it('stops instead of continuing when autoContinue is off', () => {
    const { engine, at } = engineAt(1_000_000, { autoContinue: false });
    engine.start();

    expect(at(55).phase).toBe('break');
    expect(at(61).phase).toBe('idle');
    expect(engine.isRunning).toBe(false);
  });
});

describe('controls', () => {
  it('breakNow jumps straight to the break without touching the cycle count', () => {
    const { engine, at } = engineAt(1_000_000);
    engine.start();
    at(10);

    engine.breakNow();
    const snap = engine.snapshot();
    expect(snap.phase).toBe('break');
    expect(snap.cycle).toBe(1);
    expect(snap.remaining).toBeCloseTo(10 * MINUTE, 1);
  });

  it('skipBreak starts a fresh cycle and advances the counter', () => {
    const { engine, at } = engineAt(1_000_000);
    engine.start();
    at(52);
    expect(engine.snapshot().phase).toBe('break');

    engine.skipBreak();
    const snap = engine.snapshot();
    expect(snap.phase).toBe('focus');
    expect(snap.cycle).toBe(2);
    expect(snap.remaining).toBeCloseTo(45 * MINUTE, 1);
  });

  it('stop returns to idle with nothing left running', () => {
    const { engine, at } = engineAt(1_000_000);
    engine.start();
    at(20);
    engine.stop();

    expect(engine.snapshot().phase).toBe('idle');
    expect(engine.isRunning).toBe(false);
  });
});

describe('synchronisation', () => {
  it('a mirror engine reproduces the original exactly', () => {
    // The overlay runs its own engine seeded from the main process. If the two
    // could disagree, the animation would not match the tray countdown.
    let clock = 1_000_000;
    const primary = new FocusEngine({
      durations: { workSeconds: 50 * MINUTE, breakSeconds: 10 * MINUTE, warningSeconds: 5 * MINUTE },
      now: () => clock,
    });
    primary.start();

    const mirror = new FocusEngine({
      durations: { workSeconds: 1, breakSeconds: 1, warningSeconds: 1 },
      now: () => clock,
    });
    mirror.applySyncState(primary.getSyncState());

    for (const minutes of [0, 12, 44.9, 45.1, 47.5, 50.1, 58, 61, 130]) {
      clock = 1_000_000 + minutes * MINUTE * 1000;
      const a = primary.snapshot();
      const b = mirror.snapshot();
      expect(b.phase, `phase at ${minutes} min`).toBe(a.phase);
      expect(b.remaining, `remaining at ${minutes} min`).toBeCloseTo(a.remaining, 6);
      expect(b.warningProgress, `progress at ${minutes} min`).toBeCloseTo(a.warningProgress, 6);
    }
  });
});

describe('duration validation', () => {
  it('never lets the countdown window outlast the focus period', () => {
    const d = normalizeDurations({ workSeconds: 600, breakSeconds: 300, warningSeconds: 900 });
    expect(d.warningSeconds).toBe(600);
  });

  it('rejects zero and negative durations', () => {
    const d = normalizeDurations({ workSeconds: 0, breakSeconds: -5, warningSeconds: 0 });
    expect(d.workSeconds).toBeGreaterThan(0);
    expect(d.breakSeconds).toBeGreaterThan(0);
    expect(d.warningSeconds).toBeGreaterThan(0);
  });

  it('honours a one-minute focus with a one-minute break', () => {
    let clock = 0;
    const engine = new FocusEngine({
      durations: { workSeconds: 60, breakSeconds: 60, warningSeconds: 30 },
      now: () => clock,
    });
    engine.start();

    clock = 29_000;
    expect(engine.snapshot().phase).toBe('focus');
    clock = 31_000;
    expect(engine.snapshot().phase).toBe('warning');
    clock = 61_000;
    expect(engine.snapshot().phase).toBe('break');
    clock = 121_000;
    expect(engine.snapshot().phase).toBe('focus');
  });
});

describe('formatDuration', () => {
  it('formats the values the countdown actually shows', () => {
    expect(formatDuration(0)).toBe('00:00');
    expect(formatDuration(59)).toBe('00:59');
    expect(formatDuration(600)).toBe('10:00');
    expect(formatDuration(3000)).toBe('50:00');
    expect(formatDuration(3725)).toBe('1:02:05');
  });

  it('never renders a negative time', () => {
    expect(formatDuration(-30)).toBe('00:00');
  });
});

describe('pause / resume (Mola Ver gate)', () => {
  it('freezes the countdown while paused and loses no time on resume', () => {
    let clock = 0;
    const engine = new FocusEngine({
      durations: { workSeconds: 60, breakSeconds: 600, warningSeconds: 30 },
      now: () => clock,
    });
    engine.start();

    // Enter the break, then pause exactly at its start.
    clock = 60_000;
    expect(engine.snapshot().phase).toBe('break');
    engine.pause();
    const full = engine.snapshot().remaining;
    expect(full).toBeCloseTo(600, 1);

    // Ten seconds of frozen wall time change nothing.
    clock = 70_000;
    expect(engine.snapshot().remaining).toBeCloseTo(full, 1);
    expect(engine.isPaused).toBe(true);

    // Resuming does not count the frozen time: the break still has its length.
    engine.resume();
    expect(engine.snapshot().remaining).toBeCloseTo(600, 1);
    clock = 80_000; // 10s into the break now
    expect(engine.snapshot().remaining).toBeCloseTo(590, 1);
  });
});

describe('targetCycles (session length)', () => {
  it('stops after the requested number of cycles', () => {
    let clock = 0;
    const engine = new FocusEngine({
      durations: { workSeconds: 60, breakSeconds: 60, warningSeconds: 10 },
      autoContinue: true,
      targetCycles: 2,
      now: () => clock,
    });
    engine.start(); // cycle length = 120s

    clock = 130_000; // into the 2nd cycle
    expect(engine.snapshot().phase).not.toBe('idle');
    clock = 240_000; // end of the 2nd cycle
    expect(engine.snapshot().phase).toBe('idle');
  });

  it('runs indefinitely when the target is zero', () => {
    let clock = 0;
    const engine = new FocusEngine({
      durations: { workSeconds: 60, breakSeconds: 60, warningSeconds: 10 },
      autoContinue: true,
      targetCycles: 0,
      now: () => clock,
    });
    engine.start();
    clock = 600_000; // five cycles later
    expect(engine.snapshot().phase).not.toBe('idle');
  });
});
