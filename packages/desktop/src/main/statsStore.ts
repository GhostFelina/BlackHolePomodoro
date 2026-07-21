import { app } from 'electron';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Usage analytics — entirely local, never sent anywhere.
 *
 * Records how many seconds were spent focusing and on break each day, and how
 * long each effect was on screen, so the Analytics panel can show the user
 * their own history. Persisted the same atomic-rename way as settings; a
 * corrupt file resets to empty rather than crashing.
 */

export interface DayRecord {
  /** Seconds spent focusing (focus + warning phases). */
  focus: number;
  /** Seconds spent on an active break. */
  break: number;
}

export interface StatsData {
  /** ISO date (YYYY-MM-DD, local) → totals. */
  days: Record<string, DayRecord>;
  /** effectId → seconds it was the visible effect. */
  effects: Record<string, number>;
}

/** How many days of history to keep. */
const MAX_DAYS = 120;

function emptyStats(): StatsData {
  return { days: {}, effects: {} };
}

function localDateKey(now: number): string {
  const d = new Date(now);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export class StatsStore {
  private readonly filePath: string;
  private data: StatsData;
  private writeTimer: NodeJS.Timeout | null = null;

  constructor(fileName = 'stats.json') {
    this.filePath = join(app.getPath('userData'), fileName);
    this.data = this.read();
  }

  get(): StatsData {
    return this.data;
  }

  /**
   * Adds elapsed time to the current day. `kind` is which bucket, `effectId`
   * the effect that was on screen (only counted for focus time, since that is
   * when the effect grows).
   */
  record(kind: 'focus' | 'break', seconds: number, effectId: string, now = Date.now()): void {
    if (!(seconds > 0)) return;
    const key = localDateKey(now);
    const day = this.data.days[key] ?? { focus: 0, break: 0 };
    day[kind] += seconds;
    this.data.days[key] = day;

    if (kind === 'focus') {
      this.data.effects[effectId] = (this.data.effects[effectId] ?? 0) + seconds;
    }
    this.scheduleWrite();
  }

  private read(): StatsData {
    try {
      if (!existsSync(this.filePath)) return emptyStats();
      const raw = JSON.parse(readFileSync(this.filePath, 'utf8')) as Partial<StatsData>;
      const days = typeof raw.days === 'object' && raw.days ? raw.days : {};
      const effects = typeof raw.effects === 'object' && raw.effects ? raw.effects : {};
      return { days: days as Record<string, DayRecord>, effects: effects as Record<string, number> };
    } catch (error) {
      console.warn('[BlackHolock] Stats unreadable, starting fresh:', String(error));
      return emptyStats();
    }
  }

  private scheduleWrite(): void {
    if (this.writeTimer) return; // coalesce; a save every few seconds is plenty
    this.writeTimer = setTimeout(() => this.flush(), 4000);
  }

  flush(): void {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer);
      this.writeTimer = null;
    }
    this.prune();
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      const temp = `${this.filePath}.tmp`;
      writeFileSync(temp, JSON.stringify(this.data, null, 2), 'utf8');
      renameSync(temp, this.filePath);
    } catch (error) {
      console.error('[BlackHolock] Could not save stats:', error);
    }
  }

  /** Drops days beyond the retention window so the file cannot grow forever. */
  private prune(): void {
    const keys = Object.keys(this.data.days).sort();
    if (keys.length <= MAX_DAYS) return;
    for (const key of keys.slice(0, keys.length - MAX_DAYS)) {
      delete this.data.days[key];
    }
  }
}
