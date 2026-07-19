/**
 * Opens the live effect preview in a real window.
 *
 *   npm run preview
 *   npm run preview -- "effect=eclipse&lensing=0"
 */
import { app, BrowserWindow } from 'electron';
import { join } from 'node:path';

const query = process.argv[2] ?? 'effect=gargantua&lensing=1&growth=0.5';

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    backgroundColor: '#000000',
    title: 'BlackHolock — live effect preview',
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });
  win.webContents.on('console-message', (_e, _l, m) => console.log('[preview]', m));
  await win.loadFile(join(import.meta.dirname, '../out/renderer/preview.html'), {
    search: query,
  });
});

app.on('window-all-closed', () => app.quit());
