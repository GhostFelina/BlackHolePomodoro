/**
 * Loads the built preview page in Electron and saves a PNG of it.
 * Verifies the shipped shader visually, with no screen permission needed.
 *
 *   npx electron scripts/capture-preview.mjs <out.png> [query]
 */
import { app, BrowserWindow } from 'electron';
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const outFile = resolve(process.argv[2] ?? 'preview.png');
const query = process.argv[3] ?? 'effect=gargantua&lensing=1';

app.commandLine.appendSwitch('enable-unsafe-swiftshader');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1960, height: 840, show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });
  win.webContents.on('console-message', (_e, _l, m) => console.log('[page]', m));

  await win.loadFile(join(import.meta.dirname, '../out/renderer/preview.html'), {
    search: query,
  });
  await new Promise((r) => setTimeout(r, 1500));

  const image = await win.webContents.capturePage();
  writeFileSync(outFile, image.toPNG());
  console.log('saved', outFile);
  app.quit();
});
