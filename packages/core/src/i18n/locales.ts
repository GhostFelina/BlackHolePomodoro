/**
 * Supported locales and their presentation metadata.
 *
 * `nativeName` is what the language picker shows — people find their own
 * language faster when it is written the way they write it.
 */

export const LOCALE_CODES = [
  'en',
  'tr',
  'es',
  'de',
  'it',
  'pt',
  'ru',
  'ar',
  'ja',
  'ko',
  'zh',
] as const;

export type LocaleCode = (typeof LOCALE_CODES)[number];

export interface LocaleMeta {
  code: LocaleCode;
  /** Endonym — the language's name in that language. */
  nativeName: string;
  /** English name, used for search and for the accessibility label. */
  englishName: string;
  direction: 'ltr' | 'rtl';
  /** BCP 47 tag handed to Intl for number and date formatting. */
  intlTag: string;
}

export const LOCALES: Readonly<Record<LocaleCode, LocaleMeta>> = Object.freeze({
  en: { code: 'en', nativeName: 'English', englishName: 'English', direction: 'ltr', intlTag: 'en-US' },
  tr: { code: 'tr', nativeName: 'Türkçe', englishName: 'Turkish', direction: 'ltr', intlTag: 'tr-TR' },
  es: { code: 'es', nativeName: 'Español', englishName: 'Spanish', direction: 'ltr', intlTag: 'es-ES' },
  de: { code: 'de', nativeName: 'Deutsch', englishName: 'German', direction: 'ltr', intlTag: 'de-DE' },
  it: { code: 'it', nativeName: 'Italiano', englishName: 'Italian', direction: 'ltr', intlTag: 'it-IT' },
  pt: { code: 'pt', nativeName: 'Português', englishName: 'Portuguese', direction: 'ltr', intlTag: 'pt-BR' },
  ru: { code: 'ru', nativeName: 'Русский', englishName: 'Russian', direction: 'ltr', intlTag: 'ru-RU' },
  ar: { code: 'ar', nativeName: 'العربية', englishName: 'Arabic', direction: 'rtl', intlTag: 'ar-SA' },
  ja: { code: 'ja', nativeName: '日本語', englishName: 'Japanese', direction: 'ltr', intlTag: 'ja-JP' },
  ko: { code: 'ko', nativeName: '한국어', englishName: 'Korean', direction: 'ltr', intlTag: 'ko-KR' },
  zh: { code: 'zh', nativeName: '简体中文', englishName: 'Chinese (Simplified)', direction: 'ltr', intlTag: 'zh-CN' },
});

export const DEFAULT_LOCALE: LocaleCode = 'en';

/**
 * Maps a system locale string (`"tr-TR"`, `"zh-Hans-CN"`, `"pt_BR"`) onto a
 * supported code, falling back to English rather than failing.
 */
export function resolveLocale(candidate: string | undefined | null): LocaleCode {
  if (!candidate) return DEFAULT_LOCALE;
  const normalized = candidate.replace('_', '-').toLowerCase();

  const exact = LOCALE_CODES.find((code) => code === normalized);
  if (exact) return exact;

  const primary = normalized.split('-')[0];
  const base = LOCALE_CODES.find((code) => code === primary);
  if (base) return base;

  // Script-tagged Chinese variants all fold onto Simplified for now.
  if (normalized.startsWith('zh')) return 'zh';
  return DEFAULT_LOCALE;
}
