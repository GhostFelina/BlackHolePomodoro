/**
 * The full user-facing settings surface, with validation and safe defaults.
 *
 * Every value is a primitive so the whole object survives JSON round-trips
 * across the Electron IPC boundary today and a mobile bridge later.
 */

import { LOCALE_CODES, type LocaleCode } from '../i18n/locales.js';

export type ThemeAccent = 'ember' | 'ion' | 'aurora' | 'monochrome';
export type BreakStrictness = 'gentle' | 'standard' | 'strict';

export interface Settings {
  /** Schema version, so future migrations can upgrade stored files safely. */
  version: number;

  // -- timing ---------------------------------------------------------------
  /** Focus length in minutes, warning window included. */
  workMinutes: number;
  /** Break length in minutes. */
  breakMinutes: number;
  /** How many minutes before the break the effect appears and starts growing. */
  warningMinutes: number;
  /** Begin the next focus cycle automatically once a break ends. */
  autoContinue: boolean;
  /** Start the timer as soon as the app launches. */
  autoStartOnLaunch: boolean;

  // -- visuals --------------------------------------------------------------
  /** Which registered effect to render. Extensible: not hardcoded to the hole. */
  effectId: string;
  /** Bend the real desktop behind the effect (needs screen-capture permission). */
  screenLensing: boolean;
  /** Cap the render loop. 0 means "follow the display", including 120 Hz. */
  maxFps: number;
  /** Overall effect opacity, 0.2–1. Lets sensitive users tone it down. */
  intensity: number;
  accent: ThemeAccent;
  /** Skip the growth animation and render a still effect (accessibility). */
  reducedMotion: boolean;

  // -- break behaviour ------------------------------------------------------
  /**
   * gentle   – the break screen can be dismissed instantly
   * standard – the skip control appears after a delay and asks to confirm
   * strict   – no skip control at all; the break runs its course
   */
  strictness: BreakStrictness;
  /** Seconds before the skip control appears (standard strictness). */
  skipArmSeconds: number;
  soundEnabled: boolean;
  /** Show a system notification a minute before the break. */
  notifyBeforeBreak: boolean;

  // -- system ---------------------------------------------------------------
  locale: LocaleCode | 'system';
  launchAtLogin: boolean;
  checkForUpdates: boolean;
}

export const SETTINGS_VERSION = 1;

export const DEFAULT_SETTINGS: Settings = Object.freeze({
  version: SETTINGS_VERSION,

  workMinutes: 50,
  breakMinutes: 10,
  warningMinutes: 5,
  autoContinue: true,
  autoStartOnLaunch: false,

  effectId: 'gargantua',
  screenLensing: true,
  maxFps: 0,
  intensity: 1,
  accent: 'ember',
  reducedMotion: false,

  strictness: 'standard',
  skipArmSeconds: 6,
  soundEnabled: true,
  notifyBeforeBreak: true,

  locale: 'system',
  launchAtLogin: false,
  checkForUpdates: true,
});

/** Inclusive bounds for every numeric field, shared by the UI sliders. */
export const LIMITS = Object.freeze({
  workMinutes: { min: 1, max: 240, step: 1 },
  breakMinutes: { min: 1, max: 120, step: 1 },
  warningMinutes: { min: 1, max: 60, step: 1 },
  skipArmSeconds: { min: 0, max: 60, step: 1 },
  intensity: { min: 0.2, max: 1, step: 0.05 },
  maxFps: { min: 0, max: 240, step: 10 },
});

const ACCENTS: readonly ThemeAccent[] = ['ember', 'ion', 'aurora', 'monochrome'];
const STRICTNESS: readonly BreakStrictness[] = ['gentle', 'standard', 'strict'];

/**
 * Coerces anything (a stale settings file, a hand-edited JSON, a partial patch
 * from the UI) into a valid Settings object. Never throws — a corrupt file must
 * not stop the app from launching.
 */
export function sanitizeSettings(input: unknown, base: Settings = DEFAULT_SETTINGS): Settings {
  const raw = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;

  const settings: Settings = {
    version: SETTINGS_VERSION,

    workMinutes: num(raw.workMinutes, base.workMinutes, LIMITS.workMinutes),
    breakMinutes: num(raw.breakMinutes, base.breakMinutes, LIMITS.breakMinutes),
    warningMinutes: num(raw.warningMinutes, base.warningMinutes, LIMITS.warningMinutes),
    autoContinue: bool(raw.autoContinue, base.autoContinue),
    autoStartOnLaunch: bool(raw.autoStartOnLaunch, base.autoStartOnLaunch),

    effectId: str(raw.effectId, base.effectId),
    screenLensing: bool(raw.screenLensing, base.screenLensing),
    maxFps: num(raw.maxFps, base.maxFps, LIMITS.maxFps),
    intensity: num(raw.intensity, base.intensity, LIMITS.intensity, true),
    accent: oneOf(raw.accent, ACCENTS, base.accent),
    reducedMotion: bool(raw.reducedMotion, base.reducedMotion),

    strictness: oneOf(raw.strictness, STRICTNESS, base.strictness),
    skipArmSeconds: num(raw.skipArmSeconds, base.skipArmSeconds, LIMITS.skipArmSeconds),
    soundEnabled: bool(raw.soundEnabled, base.soundEnabled),
    notifyBeforeBreak: bool(raw.notifyBeforeBreak, base.notifyBeforeBreak),

    locale: locale(raw.locale, base.locale),
    launchAtLogin: bool(raw.launchAtLogin, base.launchAtLogin),
    checkForUpdates: bool(raw.checkForUpdates, base.checkForUpdates),
  };

  // The warning window can never outlast the focus period it belongs to.
  if (settings.warningMinutes > settings.workMinutes) {
    settings.warningMinutes = settings.workMinutes;
  }
  return settings;
}

export function settingsToDurations(settings: Settings) {
  return {
    workSeconds: settings.workMinutes * 60,
    breakSeconds: settings.breakMinutes * 60,
    warningSeconds: settings.warningMinutes * 60,
  };
}

// ------------------------------------------------------------------ coercion

function num(
  value: unknown,
  fallback: number,
  limit: { min: number; max: number },
  allowFloat = false,
): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const rounded = allowFloat ? Math.round(parsed * 100) / 100 : Math.round(parsed);
  return Math.min(Math.max(rounded, limit.min), limit.max);
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function str(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

function locale(value: unknown, fallback: LocaleCode | 'system'): LocaleCode | 'system' {
  if (value === 'system') return 'system';
  return typeof value === 'string' && (LOCALE_CODES as readonly string[]).includes(value)
    ? (value as LocaleCode)
    : fallback;
}
