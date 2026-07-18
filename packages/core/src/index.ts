export {
  FocusEngine,
  formatDuration,
  normalizeDurations,
  IDLE_SNAPSHOT,
  type CycleDurations,
  type EngineSnapshot,
  type EngineSyncState,
  type FocusEngineOptions,
  type Phase,
} from './engine/FocusEngine.js';

export {
  DEFAULT_SETTINGS,
  LIMITS,
  SETTINGS_VERSION,
  sanitizeSettings,
  settingsToDurations,
  type BreakStrictness,
  type Settings,
  type ThemeAccent,
} from './settings/schema.js';

export {
  CATALOG,
  DEFAULT_LOCALE,
  I18n,
  LOCALES,
  LOCALE_CODES,
  findMissingKeys,
  resolveLocale,
  type LocaleCode,
  type LocaleMeta,
  type MessageKey,
  type Messages,
  type TranslateParams,
  type Translator,
} from './i18n/index.js';

export { APP_VERSION, BUILD_CHANNEL, PRODUCT, compareVersions, type BuildChannel } from './meta.js';
