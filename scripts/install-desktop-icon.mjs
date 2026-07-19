#!/usr/bin/env node
/**
 * Puts BlackHolock on the Desktop.
 *
 * On macOS a "desktop icon" is an alias to the application bundle. A Finder
 * alias survives the app being moved or updated in place, which a plain
 * symlink does not, so one is created with AppleScript when possible and a
 * symlink is used only as a fallback.
 *
 * The app is looked for in the usual places, newest first, so this works
 * whether it was installed to /Applications or is still sitting in the
 * project's release folder.
 *
 *   npm run icon:desktop
 */

import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readdirSync, rmSync, symlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const APP_NAME = 'BlackHolock.app';

// /Applications first on purpose: an alias into the repo's release folder
// breaks the moment that folder is rebuilt or cleaned, which is exactly how
// the Desktop ended up pointing at a stale build.
const candidates = [
  join('/Applications', APP_NAME),
  join(homedir(), 'Applications', APP_NAME),
  join(repoRoot, 'packages/desktop/release/mac-arm64', APP_NAME),
  join(repoRoot, 'packages/desktop/release/mac', APP_NAME),
  join(repoRoot, 'packages/desktop/release/mac-universal', APP_NAME),
];

function findApp() {
  return candidates.find((path) => existsSync(path)) ?? null;
}

function main() {
  if (process.platform !== 'darwin') {
    console.log('Desktop icons are handled by the installer on this platform.');
    return;
  }

  const appPath = findApp();
  if (!appPath) {
    console.error('BlackHolock.app not found. Build it first:\n  npm run dist');
    console.error('Looked in:');
    for (const path of candidates) console.error(`  ${path}`);
    process.exitCode = 1;
    return;
  }

  const desktop = join(homedir(), 'Desktop');
  const target = join(desktop, 'BlackHolock');

  // Remove every previous alias before making a new one.
  //
  // The first version of this only checked three exact names, so Finder's
  // automatic de-duplication ("BlackHolock alias 2") slipped past it and the
  // Desktop accumulated aliases — each one pointing at whichever build existed
  // when it was made. Opening the wrong one launched a stale app that looked
  // like the project had regressed. Anything matching the name is cleared now.
  for (const entry of readdirSync(desktop)) {
    if (!entry.startsWith('BlackHolock')) continue;
    const path = join(desktop, entry);
    try {
      // Only ever remove aliases and links, never a real directory — the
      // source checkout itself lives on the Desktop and must survive this.
      const stat = lstatSync(path);
      if (stat.isDirectory() && !entry.endsWith('.app')) continue;
      rmSync(path, { recursive: true, force: true });
      console.log(`  removed stale ${entry}`);
    } catch {
      /* not ours to delete */
    }
  }

  // A symlink named BlackHolock.app, not a Finder alias.
  //
  // Finder names aliases itself and appends a number when it believes the name
  // is taken — and it always is here, because the source checkout on this
  // Desktop is a folder called BlackHolock. Renaming the result afterwards
  // fails for the same reason. A symlink takes the name it is given, shows the
  // app's own icon in Finder, and opens the app when double-clicked, so there
  // is nothing to gain from the alias and a collision to lose.
  const link = join(desktop, APP_NAME);
  symlinkSync(appPath, link);
  console.log(`✓ Desktop icon → ${appPath}`);
}

main();
