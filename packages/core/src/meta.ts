/**
 * Product identity and version, in one place.
 *
 * `APP_VERSION` is the single source of truth: the desktop package reads it at
 * build time, the About panel shows it, and the update check compares against
 * it. Bump it here and nowhere else.
 */

export const APP_VERSION = '1.0.0';

export type BuildChannel = 'stable' | 'beta' | 'dev';
export const BUILD_CHANNEL: BuildChannel = 'stable';

export const PRODUCT = Object.freeze({
  name: 'BlackHolock',
  /** Reverse-DNS id used by macOS bundles, Windows installers and stores. */
  appId: 'com.ghostfelina.blackholock',
  version: APP_VERSION,
  channel: BUILD_CHANNEL,
  repository: 'https://github.com/GhostFelina/BlackHolePomodoro',
  releasesUrl: 'https://github.com/GhostFelina/BlackHolePomodoro/releases',
  latestReleaseApi:
    'https://api.github.com/repos/GhostFelina/BlackHolePomodoro/releases/latest',
  licence: 'MIT',
});

/**
 * Compares two semantic versions. Returns a positive number when `a` is newer.
 * Tolerates a leading `v` and pre-release suffixes (`1.2.0-beta.1`).
 */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) =>
    v
      .replace(/^v/i, '')
      .split('-')[0]!
      .split('.')
      .map((part) => Number.parseInt(part, 10) || 0);

  const left = parse(a);
  const right = parse(b);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}
