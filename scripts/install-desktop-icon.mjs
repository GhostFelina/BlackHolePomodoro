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
import { existsSync, lstatSync, symlinkSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const APP_NAME = 'BlackHolock.app';

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

  // Remove any previous alias or link so this is idempotent.
  for (const path of [target, `${target}.app`, join(desktop, APP_NAME)]) {
    try {
      if (existsSync(path) || lstatSync(path)) unlinkSync(path);
    } catch {
      /* nothing there, or a real directory we should not touch */
    }
  }

  try {
    // A Finder alias: keeps working if the app is later moved or replaced.
    execFileSync('osascript', [
      '-e',
      `tell application "Finder" to make alias file to POSIX file "${appPath}" at POSIX file "${desktop}"`,
    ]);
    console.log(`✓ Alias created on the Desktop → ${appPath}`);
  } catch {
    symlinkSync(appPath, join(desktop, APP_NAME));
    console.log(`✓ Symlink created on the Desktop → ${appPath}`);
  }
}

main();
