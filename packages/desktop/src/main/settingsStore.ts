import { app } from 'electron';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DEFAULT_SETTINGS, sanitizeSettings, type Settings } from '@blackholock/core';

/**
 * Settings persistence.
 *
 * Writes go to a temporary file first and are then renamed over the real one,
 * which is atomic on both APFS and NTFS. A power cut mid-save can therefore
 * leave the old file or the new one, never a half-written one.
 *
 * A file that is unreadable for any reason is replaced with defaults rather
 * than crashing the app — losing preferences is annoying, failing to launch is
 * unacceptable.
 */
export class SettingsStore {
  private readonly filePath: string;
  private cache: Settings;
  private lastError: string | null = null;
  private writeTimer: NodeJS.Timeout | null = null;

  constructor(fileName = 'settings.json') {
    this.filePath = join(app.getPath('userData'), fileName);
    this.cache = this.read();
  }

  get(): Settings {
    return this.cache;
  }

  /** Where the file lives, for the About panel. */
  get path(): string {
    return this.filePath;
  }

  /** True when the last read failed and defaults were substituted. */
  takeError(): string | null {
    const error = this.lastError;
    this.lastError = null;
    return error;
  }

  /** Applies a partial patch, validates the result, and schedules a save. */
  update(patch: Partial<Settings>): Settings {
    this.cache = sanitizeSettings({ ...this.cache, ...patch }, this.cache);
    this.scheduleWrite();
    return this.cache;
  }

  reset(): Settings {
    this.cache = { ...DEFAULT_SETTINGS };
    this.scheduleWrite();
    return this.cache;
  }

  private read(): Settings {
    try {
      if (!existsSync(this.filePath)) return { ...DEFAULT_SETTINGS };
      const raw = readFileSync(this.filePath, 'utf8');
      return sanitizeSettings(JSON.parse(raw));
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      console.warn('[BlackHolock] Settings unreadable, falling back to defaults:', this.lastError);
      return { ...DEFAULT_SETTINGS };
    }
  }

  /** Coalesces bursts of slider movement into one write. */
  private scheduleWrite(): void {
    if (this.writeTimer) clearTimeout(this.writeTimer);
    this.writeTimer = setTimeout(() => this.flush(), 250);
  }

  flush(): void {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer);
      this.writeTimer = null;
    }
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      const temp = `${this.filePath}.tmp`;
      writeFileSync(temp, JSON.stringify(this.cache, null, 2), 'utf8');
      renameSync(temp, this.filePath);
    } catch (error) {
      console.error('[BlackHolock] Could not save settings:', error);
    }
  }
}
