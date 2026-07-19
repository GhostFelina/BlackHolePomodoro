/**
 * The complete message contract.
 *
 * Every locale file is typed as `Messages`, so a missing or misspelled key is a
 * compile error rather than a blank label discovered by a user. `npm run
 * i18n:check` performs the same check at runtime for anyone editing the JSON by
 * hand.
 *
 * Placeholders use `{name}` and are substituted by `translate()`.
 */

export interface Messages {
  // -- brand ----------------------------------------------------------------
  'app.name': string;
  'app.motto': string;
  'app.tagline': string;

  // -- phases ---------------------------------------------------------------
  'phase.idle': string;
  'phase.focus': string;
  'phase.warning': string;
  'phase.break': string;

  // -- tray menu ------------------------------------------------------------
  'tray.start': string;
  'tray.stop': string;
  'tray.breakNow': string;
  'tray.skipBreak': string;
  'tray.settings': string;
  'tray.about': string;
  'tray.quit': string;
  'tray.statusIdle': string;
  'tray.statusFocus': string;
  'tray.statusWarning': string;
  'tray.statusBreak': string;
  'tray.cycleLabel': string;

  // -- break screen ---------------------------------------------------------
  'break.title': string;
  'break.subtitle': string;
  'break.remaining': string;
  'break.skip': string;
  'break.skipConfirm': string;
  'break.strictNotice': string;
  'break.returning': string;

  // -- warning notification -------------------------------------------------
  'notify.breakSoonTitle': string;
  'notify.breakSoonBody': string;
  'notify.breakOverTitle': string;
  'notify.breakOverBody': string;

  // -- settings: shell ------------------------------------------------------
  'settings.title': string;
  'settings.section.timing': string;
  'settings.section.appearance': string;
  'settings.section.break': string;
  'settings.section.language': string;
  'settings.section.system': string;
  'settings.section.about': string;
  'settings.save': string;
  'settings.saved': string;
  'settings.reset': string;
  'settings.resetConfirm': string;
  'settings.minutes': string;
  'settings.seconds': string;

  // -- settings: timing -----------------------------------------------------
  'settings.workMinutes': string;
  'settings.workMinutes.help': string;
  'settings.breakMinutes': string;
  'settings.breakMinutes.help': string;
  'settings.warningMinutes': string;
  'settings.warningMinutes.help': string;
  'settings.autoContinue': string;
  'settings.autoContinue.help': string;
  'settings.autoStartOnLaunch': string;
  'settings.autoStartOnLaunch.help': string;
  'settings.presets': string;
  'settings.preset.classic': string;
  'settings.preset.deep': string;
  'settings.preset.sprint': string;
  'settings.timelinePreview': string;

  // -- settings: appearance -------------------------------------------------
  'settings.effect': string;
  'settings.effect.help': string;
  'settings.screenLensing': string;
  'settings.screenLensing.help': string;
  'settings.screenLensing.permission': string;
  'settings.maxFps': string;
  'settings.maxFps.help': string;
  'settings.maxFps.auto': string;
  'settings.intensity': string;
  'settings.intensity.help': string;
  'settings.accent': string;
  'settings.accent.ember': string;
  'settings.accent.solar': string;
  'settings.accent.gold': string;
  'settings.accent.rust': string;
  'settings.accent.crimson': string;
  'settings.accent.violet': string;
  'settings.accent.ion': string;
  'settings.accent.aurora': string;
  'settings.accent.monochrome': string;
  'settings.reducedMotion': string;
  'settings.reducedMotion.help': string;

  // -- settings: black hole -------------------------------------------------
  'settings.preview': string;
  'settings.preview.help': string;
  'settings.blackHole': string;
  'settings.bloom': string;
  'settings.bloom.help': string;
  'settings.discBrightness': string;
  'settings.discSpeed': string;
  'settings.inclination': string;
  'settings.doppler': string;
  'settings.doppler.help': string;
  'settings.suction': string;
  'settings.suction.help': string;
  'settings.starDensity': string;
  'settings.nebula': string;
  'settings.resetEffect': string;

  // -- settings: break ------------------------------------------------------
  'settings.strictness': string;
  'settings.strictness.help': string;
  'settings.strictness.gentle': string;
  'settings.strictness.gentle.help': string;
  'settings.strictness.standard': string;
  'settings.strictness.standard.help': string;
  'settings.strictness.strict': string;
  'settings.strictness.strict.help': string;
  'settings.skipArmSeconds': string;
  'settings.skipArmSeconds.help': string;
  'settings.sound': string;
  'settings.sound.help': string;
  'settings.notifyBeforeBreak': string;
  'settings.notifyBeforeBreak.help': string;

  // -- settings: language ---------------------------------------------------
  'settings.language': string;
  'settings.language.help': string;
  'settings.language.system': string;
  'settings.language.search': string;
  'settings.language.noResults': string;

  // -- settings: system -----------------------------------------------------
  'settings.launchAtLogin': string;
  'settings.launchAtLogin.help': string;
  'settings.checkForUpdates': string;
  'settings.checkForUpdates.help': string;

  // -- about ----------------------------------------------------------------
  'about.version': string;
  'about.platform': string;
  'about.checkNow': string;
  'about.upToDate': string;
  'about.updateAvailable': string;
  'about.checking': string;
  'about.releaseNotes': string;
  'about.sourceCode': string;
  'about.privacy': string;
  'about.terms': string;
  'about.licence': string;
  'about.privacyPledge': string;

  // -- effects --------------------------------------------------------------
  'effect.gargantua.name': string;
  'effect.gargantua.description': string;
  'effect.inferno.name': string;
  'effect.inferno.description': string;
  'effect.halo.name': string;
  'effect.halo.description': string;
  'effect.prism.name': string;
  'effect.prism.description': string;
  'effect.eclipse.name': string;
  'effect.eclipse.description': string;
  'effect.voidfield.name': string;
  'effect.voidfield.description': string;

  // -- errors ---------------------------------------------------------------
  'error.webglUnavailable': string;
  'error.captureDenied': string;
  'error.settingsCorrupt': string;
}

export type MessageKey = keyof Messages;

/** Substitutes `{name}` placeholders. Unknown placeholders are left in place. */
export function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(params, key) ? String(params[key]) : match,
  );
}
