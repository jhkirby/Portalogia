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
console.log('windows:', app.windows().map((w) => w.url()));

// Collapse the sidebar by clicking its own toggle button (DOM click, not a
// synthetic keyboard accelerator, which may not route through Chromium's
// native menu accelerator table from CDP-injected key events) if it isn't
// already collapsed.
const isCollapsed = await page.evaluate(() => document.querySelector('.sidebar')?.classList.contains('sidebar--hidden'));
console.log('was collapsed already?', isCollapsed);
if (!isCollapsed) {
  await page.evaluate(() => document.querySelector('.sidebar__toggle')?.click());
}
await new Promise((r) => setTimeout(r, 400));

await page.screenshot({ path: SHOT_DIR + '\\01-collapsed.png' });

const toggleBox = await page.evaluate(() => {
  const el = document.querySelector('.sidebar__toggle');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
});
console.log('toggle box:', toggleBox);

if (toggleBox) {
  await page.mouse.move(toggleBox.x, toggleBox.y);
  await new Promise((r) => setTimeout(r, 700)); // hover delay (400ms) + settle
  await page.screenshot({ path: SHOT_DIR + '\\02-toggle-hover.png' });
}

const newWsBox = await page.evaluate(() => {
  const el = document.querySelector('.workspace-bar__new');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
});
console.log('new-workspace box:', newWsBox);

if (newWsBox) {
  await page.mouse.move(0, 0);
  await new Promise((r) => setTimeout(r, 200));
  await page.mouse.move(newWsBox.x, newWsBox.y);
  await new Promise((r) => setTimeout(r, 700));
  await page.screenshot({ path: SHOT_DIR + '\\03-newworkspace-hover.png' });
}

await app.close();
console.log('done');
