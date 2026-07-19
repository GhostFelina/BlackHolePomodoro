import {
  ACCENT_ORDER,
  I18n,
  LOCALES,
  LOCALE_CODES,
  formatDuration,
  type LocaleCode,
  type MessageKey,
  type Settings,
  type ThemeAccent,
} from '@blackholock/core';
import { EffectRenderer, accentToCss, accentToRgb, getEffect, listEffects } from '@blackholock/visuals';
import { settingsToEffectParams } from '@blackholock/core';
import type { AppInfo, BlackHolockApi } from '../preload/index.js';

declare global {
  interface Window {
    blackholock: BlackHolockApi;
  }
}

const api = window.blackholock;
const i18n = new I18n();

let settings: Settings;
let info: AppInfo;

const $ = <T extends HTMLElement>(selector: string): T =>
  document.querySelector(selector) as T;
const $id = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

// ------------------------------------------------------------------ i18n glue

/**
 * Re-renders every translated node. Called on boot and whenever the language
 * changes, which is what makes the picker feel instant instead of asking for a
 * restart.
 */
function applyTranslations(): void {
  for (const node of document.querySelectorAll<HTMLElement>('[data-i18n]')) {
    const key = node.dataset.i18n as MessageKey;
    node.textContent = i18n.t(key);
  }
  const meta = i18n.getMeta();
  document.documentElement.lang = meta.code;
  document.documentElement.dir = meta.direction;

  $id<HTMLInputElement>('languageSearch').placeholder = i18n.t('settings.language.search');

  renderPresets();
  renderEffects();
  renderAccents();
  renderStrictness();
  renderLanguages();
  renderAbout();
  syncControls();
}

// ---------------------------------------------------------------- navigation

function setupNav(): void {
  const buttons = document.querySelectorAll<HTMLButtonElement>('.nav button');
  const select = (section: string) => {
    for (const button of buttons) {
      button.setAttribute('aria-selected', String(button.dataset.section === section));
    }
    for (const panel of document.querySelectorAll<HTMLElement>('.panel')) {
      panel.hidden = panel.dataset.panel !== section;
    }
    if (section === 'appearance') startPreview();
    else stopPreview();
  };

  for (const button of buttons) {
    button.addEventListener('click', () => select(button.dataset.section!));
  }
  select('timing');
  api.settings.onNavigate((section) => select(section));
}

// -------------------------------------------------------------------- timing

const PRESETS: ReadonlyArray<{ key: MessageKey; work: number; brk: number; warn: number }> = [
  { key: 'settings.preset.classic', work: 25, brk: 5, warn: 3 },
  { key: 'settings.preset.deep', work: 50, brk: 10, warn: 5 },
  { key: 'settings.preset.sprint', work: 90, brk: 15, warn: 8 },
];

function renderPresets(): void {
  const host = $id('presets');
  host.replaceChildren();
  for (const preset of PRESETS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = i18n.t(preset.key);
    const active =
      settings?.workMinutes === preset.work &&
      settings?.breakMinutes === preset.brk &&
      settings?.warningMinutes === preset.warn;
    button.setAttribute('aria-pressed', String(active));
    button.addEventListener('click', () =>
      void patch({
        workMinutes: preset.work,
        breakMinutes: preset.brk,
        warningMinutes: preset.warn,
      }),
    );
    host.append(button);
  }
}

function renderTimeline(): void {
  const focusOnly = Math.max(settings.workMinutes - settings.warningMinutes, 0);
  const total = settings.workMinutes + settings.breakMinutes;

  $id('segFocus').style.flexGrow = String(focusOnly);
  $id('segWarning').style.flexGrow = String(settings.warningMinutes);
  $id('segBreak').style.flexGrow = String(settings.breakMinutes);

  $id('timelineCaption').textContent = i18n.t('settings.timelinePreview', {
    work: formatDuration(focusOnly * 60),
    warning: formatDuration(settings.warningMinutes * 60),
    break: formatDuration(settings.breakMinutes * 60),
  });
  void total;
}

// ---------------------------------------------------------------- appearance

function renderEffects(): void {
  const host = $id('effects');
  host.replaceChildren();
  for (const effect of listEffects()) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'card';
    card.setAttribute('aria-pressed', String(settings?.effectId === effect.id));

    const title = document.createElement('strong');
    title.textContent = i18n.t(effect.nameKey as MessageKey);
    const description = document.createElement('small');
    description.textContent = i18n.t(effect.descriptionKey as MessageKey);

    card.append(title, description);
    card.addEventListener('click', () => void patch({ effectId: effect.id }));
    host.append(card);
  }
}

function renderAccents(): void {
  const host = $id('accents');
  host.replaceChildren();
  for (const accent of ACCENT_ORDER) {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('aria-pressed', String(settings?.accent === accent));

    const dot = document.createElement('span');
    dot.style.background = accentToCss(accent);
    dot.style.color = accentToCss(accent);

    const label = document.createElement('em');
    label.style.fontStyle = 'normal';
    label.textContent = i18n.t(`settings.accent.${accent}` as MessageKey);

    button.append(dot, label);
    button.addEventListener('click', () => void patch({ accent }));
    host.append(button);
  }
}

// --------------------------------------------------------------------- break

const STRICTNESS = ['gentle', 'standard', 'strict'] as const;

function renderStrictness(): void {
  const host = $id('strictness');
  host.replaceChildren();
  for (const level of STRICTNESS) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'card';
    card.setAttribute('aria-pressed', String(settings?.strictness === level));

    const title = document.createElement('strong');
    title.textContent = i18n.t(`settings.strictness.${level}` as MessageKey);
    const help = document.createElement('small');
    help.textContent = i18n.t(`settings.strictness.${level}.help` as MessageKey);

    card.append(title, help);
    card.addEventListener('click', () => void patch({ strictness: level }));
    host.append(card);
  }
  // The arm delay is meaningless unless a skip button exists at all.
  $id('skipArmField').hidden = settings?.strictness !== 'standard';
}

// ------------------------------------------------------------------ language

function renderLanguages(): void {
  const host = $id('languages');
  const query = $id<HTMLInputElement>('languageSearch').value.trim().toLowerCase();
  host.replaceChildren();

  const entries: Array<{ code: LocaleCode | 'system'; native: string; english: string }> = [
    {
      code: 'system',
      native: i18n.t('settings.language.system'),
      english: info?.systemLocale ?? '',
    },
    ...LOCALE_CODES.map((code) => ({
      code,
      native: LOCALES[code].nativeName,
      english: LOCALES[code].englishName,
    })),
  ];

  const matches = entries.filter(
    (entry) =>
      query.length === 0 ||
      entry.native.toLowerCase().includes(query) ||
      entry.english.toLowerCase().includes(query) ||
      String(entry.code).toLowerCase().includes(query),
  );

  $id('languageEmpty').hidden = matches.length > 0;

  for (const entry of matches) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'language';
    button.setAttribute('role', 'option');
    button.setAttribute('aria-selected', String(settings?.locale === entry.code));

    const names = document.createElement('span');
    names.className = 'language-names';

    const native = document.createElement('span');
    native.className = 'language-native';
    native.textContent = entry.native;
    // Each name renders in its own script direction, so Arabic reads correctly
    // even while the rest of the window is left-to-right.
    if (entry.code !== 'system') native.dir = LOCALES[entry.code as LocaleCode].direction;

    const english = document.createElement('span');
    english.className = 'language-english';
    english.textContent = entry.english;

    const check = document.createElement('span');
    check.className = 'language-check';
    check.textContent = '✓';

    names.append(native, english);
    button.append(names, check);
    button.addEventListener('click', () => void patch({ locale: entry.code }));
    host.append(button);
  }
}

// --------------------------------------------------------------------- about

function renderAbout(): void {
  if (!info) return;
  $id('aboutVersion').textContent = i18n.t('about.version', {
    version: `${info.version}${info.channel === 'stable' ? '' : ` · ${info.channel}`}`,
  });
  $id('aboutPlatform').textContent = i18n.t('about.platform', { platform: info.platform });
}

function setupAbout(): void {
  const docs: Record<string, string> = {
    repository: () => info.repository,
    releases: () => info.releasesUrl,
    privacy: () => `${info.repository}/blob/main/docs/legal/PRIVACY.md`,
    terms: () => `${info.repository}/blob/main/docs/legal/TERMS.md`,
    licence: () => `${info.repository}/blob/main/LICENSE`,
  } as unknown as Record<string, string>;

  for (const link of document.querySelectorAll<HTMLAnchorElement>('[data-link]')) {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      const resolver = docs[link.dataset.link!] as unknown as () => string;
      void api.app.openExternal(resolver());
    });
  }

  $id('checkUpdates').addEventListener('click', async () => {
    const status = $id('updateStatus');
    status.textContent = i18n.t('about.checking');
    const result = await api.app.checkUpdates();
    status.textContent =
      result.status === 'available'
        ? i18n.t('about.updateAvailable', { version: result.version ?? '' })
        : result.status === 'current'
          ? i18n.t('about.upToDate')
          : '—';
  });
}

// ------------------------------------------------------------------ bindings

const SLIDERS = [
  { id: 'workMinutes', unit: 'settings.minutes' },
  { id: 'breakMinutes', unit: 'settings.minutes' },
  { id: 'warningMinutes', unit: 'settings.minutes' },
  { id: 'skipArmSeconds', unit: 'settings.seconds' },
] as const;

/**
 * Sliders whose value is a bare multiplier or an angle rather than a duration.
 * They share one binding path: update the readout live, redraw the preview
 * immediately, and persist on release.
 */
const EFFECT_SLIDERS = [
  { id: 'bloom', format: (v: number) => `${Math.round(v * 100)} %` },
  { id: 'discBrightness', format: (v: number) => `${Math.round(v * 100)} %` },
  { id: 'discSpeed', format: (v: number) => `${v.toFixed(1)}×` },
  { id: 'inclination', format: (v: number) => `${v.toFixed(1)}°` },
  { id: 'doppler', format: (v: number) => `${Math.round(v * 100)} %` },
  { id: 'starDensity', format: (v: number) => `${Math.round(v * 100)} %` },
  { id: 'nebula', format: (v: number) => `${Math.round(v * 100)} %` },
] as const;

const SWITCHES = [
  'autoContinue',
  'autoStartOnLaunch',
  'screenLensing',
  'reducedMotion',
  'soundEnabled',
  'notifyBeforeBreak',
  'launchAtLogin',
  'checkForUpdates',
] as const;

function setupControls(): void {
  for (const slider of SLIDERS) {
    const input = $id<HTMLInputElement>(slider.id);
    input.addEventListener('input', () => {
      // Update the label immediately for a live feel; persist on release.
      writeSliderOutput(slider.id, Number(input.value), slider.unit);
      if (slider.id !== 'skipArmSeconds') previewTimeline();
    });
    input.addEventListener('change', () =>
      void patch({ [slider.id]: Number(input.value) } as Partial<Settings>),
    );
  }

  for (const name of SWITCHES) {
    const input = $id<HTMLInputElement>(name);
    input.addEventListener('change', () =>
      void patch({ [name]: input.checked } as Partial<Settings>),
    );
  }

  for (const slider of EFFECT_SLIDERS) {
    const input = $id<HTMLInputElement>(slider.id);
    input.addEventListener('input', () => {
      const value = Number(input.value);
      $id(`${slider.id}Out`).textContent = slider.format(value);
      // Update the working copy so the preview reacts on the same frame,
      // without waiting for the round trip to the main process.
      if (settings) (settings as unknown as Record<string, number>)[slider.id] = value;
      refreshPreview();
    });
    input.addEventListener('change', () =>
      void patch({ [slider.id]: Number(input.value) } as Partial<Settings>),
    );
  }

  $id('resetEffect').addEventListener('click', () => {
    void patch({
      bloom: 1, discBrightness: 1, discSpeed: 1,
      inclination: 3.2, doppler: 0.12, starDensity: 1, nebula: 1,
    });
  });

  const intensity = $id<HTMLInputElement>('intensity');
  intensity.addEventListener('input', () => {
    $id('intensityOut').textContent = `${Math.round(Number(intensity.value) * 100)} %`;
  });
  intensity.addEventListener('change', () => void patch({ intensity: Number(intensity.value) }));

  const fps = $id<HTMLInputElement>('maxFps');
  fps.addEventListener('input', () => writeFpsOutput(Number(fps.value)));
  fps.addEventListener('change', () => void patch({ maxFps: Number(fps.value) }));

  $id<HTMLInputElement>('languageSearch').addEventListener('input', renderLanguages);

  $id('reset').addEventListener('click', async () => {
    if (!confirm(i18n.t('settings.resetConfirm'))) return;
    settings = await api.settings.reset();
    await syncLocale();
    applyTranslations();
    toast(i18n.t('settings.saved'));
  });
}

function writeSliderOutput(id: string, value: number, unitKey: string): void {
  $id(`${id}Out`).textContent = `${value} ${i18n.t(unitKey as MessageKey)}`;
}

function writeFpsOutput(value: number): void {
  $id('maxFpsOut').textContent = value === 0 ? i18n.t('settings.maxFps.auto') : `${value} Hz`;
}

/** Redraws the timeline from the raw slider positions, before saving. */
function previewTimeline(): void {
  const work = Number($id<HTMLInputElement>('workMinutes').value);
  const brk = Number($id<HTMLInputElement>('breakMinutes').value);
  const warn = Math.min(Number($id<HTMLInputElement>('warningMinutes').value), work);

  $id('segFocus').style.flexGrow = String(Math.max(work - warn, 0));
  $id('segWarning').style.flexGrow = String(warn);
  $id('segBreak').style.flexGrow = String(brk);
  $id('timelineCaption').textContent = i18n.t('settings.timelinePreview', {
    work: formatDuration((work - warn) * 60),
    warning: formatDuration(warn * 60),
    break: formatDuration(brk * 60),
  });
}

/** Pushes the stored settings back into every control. */
function syncControls(): void {
  if (!settings) return;

  for (const slider of SLIDERS) {
    const input = $id<HTMLInputElement>(slider.id);
    const value = settings[slider.id as keyof Settings] as number;
    input.value = String(value);
    writeSliderOutput(slider.id, value, slider.unit);
  }
  for (const name of SWITCHES) {
    $id<HTMLInputElement>(name).checked = settings[name] as boolean;
  }

  $id<HTMLInputElement>('intensity').value = String(settings.intensity);
  $id('intensityOut').textContent = `${Math.round(settings.intensity * 100)} %`;

  $id<HTMLInputElement>('maxFps').value = String(settings.maxFps);
  writeFpsOutput(settings.maxFps);

  for (const slider of EFFECT_SLIDERS) {
    const value = settings[slider.id as keyof Settings] as number;
    $id<HTMLInputElement>(slider.id).value = String(value);
    $id(`${slider.id}Out`).textContent = slider.format(value);
  }
  refreshPreview();

  renderTimeline();
}

// ------------------------------------------------------------- live preview

/**
 * A miniature of the real thing.
 *
 * It instantiates the same `EffectRenderer` the overlay uses and feeds it the
 * settings currently in the panel, so nothing here can drift from what will
 * actually appear on screen. Every slider redraws it on `input`, before the
 * value is even saved, which is what makes the controls feel direct.
 *
 * The renderer is left running only while the Appearance panel is visible.
 */
let preview: EffectRenderer | null = null;
let previewSize = 0.55;
let previewRunning = false;

/**
 * Creates the preview lazily and only ever runs it while the Appearance panel
 * is actually visible.
 *
 * The first version started at boot and never stopped, so the full ray-traced
 * shader and the bloom chain kept running behind the Timing, Language and
 * About panels, on top of whatever the overlay was already doing. That is the
 * single biggest reason the window felt slow.
 */
function startPreview(): void {
  const canvas = document.getElementById('previewCanvas') as HTMLCanvasElement | null;
  if (!canvas) return;
  if (preview) {
    if (!previewRunning) {
      previewRunning = true;
      preview.start(previewFrame);
    }
    return;
  }

  preview = new EffectRenderer(canvas, {
    // Deliberately small. This is a thumbnail beside a slider, not the
    // overlay: at 900 px the difference is invisible and the pixel count is
    // roughly a third of what it was.
    maxRenderEdge: 900,
    bloom: settings?.bloom ?? 1,
  });
  if (!preview.isAvailable) return;

  // 30 fps is ample for judging a slider. Halving the frame rate halves the
  // GPU cost outright, and nothing here needs to be smooth to the millisecond.
  preview.setFpsCap(30);

  const sizeInput = document.getElementById('previewSize') as HTMLInputElement | null;
  sizeInput?.addEventListener('input', () => {
    previewSize = Number(sizeInput.value);
  });

  preview.setEffect(getEffect(settings?.effectId ?? 'gargantua'));
  previewRunning = true;

  if (info?.isDev) {
    // Proves the panel's preview is genuinely rendering, and at what cost.
    window.setInterval(() => {
      const s = preview?.getStats();
      if (s) console.info(`preview fps=${s.fps} gpu=${s.gpuMs}ms cpu=${s.frameMs}ms ${s.renderWidth}x${s.renderHeight}`);
    }, 2500);
  }

  preview.start(previewFrame);
}

/** Stops the preview and releases the GPU while another panel is showing. */
function stopPreview(): void {
  if (preview && previewRunning) {
    previewRunning = false;
    preview.stop();
  }
}

function previewFrame() {
  {
    if (!preview || !settings) return null;
    const dpr = window.devicePixelRatio || 1;
    const rect = (canvas.parentElement as HTMLElement).getBoundingClientRect();
    const [w, h] = preview.resize(rect.width, rect.height, dpr);

    const minEdge = Math.min(w, h);
    const diagonal = Math.hypot(w, h);
    const eased = 0.15 * previewSize + 0.85 * previewSize ** 3;
    const radius = Math.max(4, minEdge * 0.005) + (diagonal * 0.55 - 4) * eased;

    return {
      time: performance.now() / 1000,
      resolution: [w, h],
      center: [w / 2, h / 2],
      radius,
      growth: previewSize,
      intensity: settings.intensity,
      blackout: 0,
      hasScreenTexture: false,
      accent: accentToRgb(settings.accent),
      reducedMotion: settings.reducedMotion,
      params: settingsToEffectParams(settings),
    };
  }
}

/** Pushes changes that the renderer holds outside the per-frame context. */
function refreshPreview(): void {
  if (!preview || !settings) return;
  preview.setEffect(getEffect(settings.effectId));
  preview.setBloom(settings.bloom);
}

// ------------------------------------------------------------------ plumbing

let toastTimer: number | undefined;

function toast(message: string): void {
  const el = $id('toast');
  el.textContent = message;
  el.classList.add('visible');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove('visible'), 1600);
}

/**
 * Persists a change and refreshes only what that change can affect.
 *
 * This used to rebuild every list in the window — presets, effect cards,
 * accent swatches, strictness cards and the whole twelve-entry language
 * picker — on every slider release. Dragging a slider therefore queued dozens
 * of full DOM rebuilds, which is what made buttons feel dead: the main thread
 * was busy re-creating elements that had not changed.
 */
async function patch(update: Partial<Settings>): Promise<void> {
  settings = await api.settings.set(update);
  const changed = new Set(Object.keys(update));

  if (changed.has('locale')) {
    await syncLocale();
    applyTranslations();
    toast(i18n.t('settings.saved'));
    return;
  }

  if (changed.has('workMinutes') || changed.has('breakMinutes') || changed.has('warningMinutes')) {
    renderPresets();
  }
  if (changed.has('effectId')) renderEffects();
  if (changed.has('accent')) renderAccents();
  if (changed.has('strictness')) renderStrictness();

  syncControls();
  toast(i18n.t('settings.saved'));
}

async function syncLocale(): Promise<void> {
  const resolved = await api.app.resolveLocale(settings.locale);
  i18n.setLocale(resolved);
}

async function boot(): Promise<void> {
  [settings, info] = await Promise.all([api.settings.get(), api.app.info()]);
  await syncLocale();

  setupNav();
  setupControls();
  setupAbout();
  applyTranslations();

  api.settings.onChanged(async (next) => {
    settings = next;
    await syncLocale();
    applyTranslations();
  });
}

void boot();
