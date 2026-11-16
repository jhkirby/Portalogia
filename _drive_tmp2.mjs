import { _electron as electron } from 'playwright-core';
import * as fs from 'node:fs';

const APP_DIR = 'C:\\Users\\joshu\\OneDrive\\Desktop\\Software\\Projects\\Portalogia';
const SHOT_DIR = 'C:\\Users\\joshu\\AppData\\Local\\Temp\\claude\\C--Users-joshu-OneDrive-Desktop-Software-Projects-Portalogia\\cf081228-a0fe-4875-a0ea-5b591f1f51bc\\scratchpad\\shots';
fs.mkdirSync(SHOT_DIR, { recursive: true });

const app = await electron.launch({
  executablePath: APP_DIR + '\\node_modules\\electron\\dist\\electron.exe',
  args: [APP_DIR],
  timeout: 30000,
});

await new Promise((r) => setTimeout(r, 3000));

const page = app.windows().find((w) => w.url().includes('/index.html')) ?? (await app.firstWindow());
page.on('console', (msg) => console.log('[chrome console]', msg.type(), msg.text()));
page.on('pageerror', (err) => console.log('[chrome pageerror]', err));

const isCollapsed = await page.evaluate(() => document.querySelector('.sidebar')?.classList.contains('sidebar--hidden'));
console.log('was collapsed already?', isCollapsed);
if (!isCollapsed) {
  await page.evaluate(() => document.querySelector('.sidebar__toggle')?.click());
}
await new Promise((r) => setTimeout(r, 400));

// Directly drive the API, bypassing hover timing, to isolate the overlay
// mechanism itself from the hook's event wiring.
const directResult = await page.evaluate(() => {
  const el = document.querySelector('.sidebar__toggle');
  const r = el.getBoundingClientRect();
  window.portalogia.syncTooltip({
    visible: true,
    text: 'Show sidebar (L)',
    rect: { top: r.top - 6 - 24, left: r.left, width: 140, height: 24 },
  });
  return { hasPortalogia: typeof window.portalogia, hasSyncTooltip: typeof window.portalogia?.syncTooltip, rect: r };
});
console.log('direct call result:', directResult);

await new Promise((r) => setTimeout(r, 500));

// Check what webContents exist and their bounds/visibility via the main process.
const wcInfo = await app.evaluate(({ webContents }) =>
  webContents.getAllWebContents().map((w) => ({ id: w.id, type: w.getType(), url: w.getURL() })),
);
console.log('webContents:', wcInfo);

await page.screenshot({ path: SHOT_DIR + '\\04-direct-sync.png' });

await app.close();
console.log('done');
