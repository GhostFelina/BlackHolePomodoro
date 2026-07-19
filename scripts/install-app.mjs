#!/usr/bin/env node
/**
 * Copies the freshly built app into /Applications.
 *
 * This exists because the Desktop alias used to point straight into the repo's
 * release folder. That folder is rebuilt and cleaned constantly, so the alias
 * ended up referring to whatever build happened to be there when it was made —
 * and launching it ran an app that was hours out of date while the source had
 * moved on. Installing to a stable location and pointing the alias there makes
 * "the icon on my Desktop" mean "the current build", always.
 */
import { cpSync, existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const built = join(here, '..', 'packages/desktop/release/mac-arm64/BlackHolock.app');
const installed = '/Applications/BlackHolock.app';

if (process.platform !== 'darwin') {
  console.log('Installation is handled by the installer on this platform.');
  process.exit(0);
}
if (!existsSync(built)) {
  console.error(`Not built yet: ${built}\nRun: npm run install`);
  process.exit(1);
}

rmSync(installed, { recursive: true, force: true });
cpSync(built, installed, { recursive: true });
console.log(`✓ Installed → ${installed}`);
