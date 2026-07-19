/**
 * Renders the built preview page and saves a PNG.
 *
 * Used to review the shipped shader without a screen-recording permission and
 * without waiting for a real cycle. The delay argument lets two captures be
 * taken at different points in the animation, which is how disc rotation is
 * verified.
 *
 *   npx electron scripts/capture-preview.mjs out.png "effect=gargantua" 2500
 */
import { app, BrowserWindow } from 'electron';
import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outFile = resolve(process.argv[2] ?? 'preview.png');
const query = process.argv[3] ?? 'effect=gargantua&lensing=1&growth=0.5';
const delayMs = Number(process.argv[4] ?? 2000);

app.commandLine.appendSwitch('enable-unsafe-swiftshader');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1400, height: 880, show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });
  win.webContents.on('console-message', (_e, _l, m) => console.log('[page]', m));

  await win.loadFile(join(here, '../out/renderer/preview.html'), { search: query });
  await new Promise((r) => setTimeout(r, delayMs));

  writeFileSync(outFile, (await win.webContents.capturePage()).toPNG());
  console.log('saved', outFile);
  setTimeout(() => app.exit(0), 200);
});

app.on('window-all-closed', () => app.exit(0));
