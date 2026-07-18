/**
 * The translator.
 *
 * Reactive by design: `setLocale` notifies subscribers so every open window
 * re-renders in the new language without a restart. Falls back to English for
 * any key a locale somehow lacks, so a missing string can never render blank.
 */

import { DEFAULT_LOCALE, LOCALES, LOCALE_CODES, resolveLocale, type LocaleCode, type LocaleMeta } from './locales.js';
import { interpolate, type MessageKey, type Messages } from './messages.js';

import { en } from './locales/en.js';
import { tr } from './locales/tr.js';
import { es } from './locales/es.js';
import { de } from './locales/de.js';
import { it } from './locales/it.js';
import { pt } from './locales/pt.js';
import { ru } from './locales/ru.js';
import { ar } from './locales/ar.js';
import { ja } from './locales/ja.js';
import { ko } from './locales/ko.js';
import { zh } from './locales/zh.js';

export const CATALOG: Readonly<Record<LocaleCode, Messages>> = Object.freeze({
  en, tr, es, de, it, pt, ru, ar, ja, ko, zh,
});

export type TranslateParams = Record<string, string | number>;
export type Translator = (key: MessageKey, params?: TranslateParams) => string;

export class I18n {
  private locale: LocaleCode;
  private listeners = new Set<(locale: LocaleCode) => void>();

  constructor(initial: LocaleCode = DEFAULT_LOCALE) {
    this.locale = initial;
  }

  getLocale(): LocaleCode {
    return this.locale;
  }

  getMeta(): LocaleMeta {
    return LOCALES[this.locale];
  }

  setLocale(next: LocaleCode | 'system', systemLocale?: string): LocaleCode {
    const resolved = next === 'system' ? resolveLocale(systemLocale) : next;
    if (resolved === this.locale) return resolved;
    this.locale = resolved;
    for (const listener of this.listeners) listener(resolved);
    return resolved;
  }

  subscribe(listener: (locale: LocaleCode) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Bound so it can be destructured: `const { t } = i18n`. */
  t: Translator = (key, params) => {
    const table = CATALOG[this.locale];
    const fallback = CATALOG[DEFAULT_LOCALE];
    const template = table[key] ?? fallback[key] ?? key;
    return interpolate(template, params);
  };

  /** Locale metadata for the picker, ordered with the active language first. */
  listLocales(): LocaleMeta[] {
    const all = LOCALE_CODES.map((code) => LOCALES[code]);
    return all.sort((a, b) => {
      if (a.code === this.locale) return -1;
      if (b.code === this.locale) return 1;
      return a.englishName.localeCompare(b.englishName);
    });
  }
}

/**
 * Verifies at runtime that every locale defines every key. TypeScript already
 * enforces this at build time; this is the guard for hand-edited files and for
 * the CI check.
 */
export function findMissingKeys(): Record<string, MessageKey[]> {
  const referenceKeys = Object.keys(CATALOG.en) as MessageKey[];
  const gaps: Record<string, MessageKey[]> = {};

  for (const code of LOCALE_CODES) {
    const table = CATALOG[code] as unknown as Record<string, unknown>;
    const missing = referenceKeys.filter((key) => {
      const value = table[key];
      return typeof value !== 'string' || value.trim().length === 0;
    });
    if (missing.length > 0) gaps[code] = missing;
  }
  return gaps;
}

export { LOCALES, LOCALE_CODES, DEFAULT_LOCALE, resolveLocale };
export type { LocaleCode, LocaleMeta, MessageKey, Messages };
