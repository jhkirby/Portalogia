import { _electron as electron } from 'playwright-core';
import * as fs from 'node:fs';

const APP_DIR = 'C:\\Users\\joshu\\OneDrive\\Desktop\\Software\\Projects\\Northstar';
const SHOT_DIR = 'C:\\Users\\joshu\\AppData\\Local\\Temp\\claude\\C--Users-joshu-OneDrive-Desktop-Software-Projects-Northstar\\cf081228-a0fe-4875-a0ea-5b591f1f51bc\\scratchpad\\shots';

const app = await electron.launch({
  executablePath: APP_DIR + '\\node_modules\\electron\\dist\\electron.exe',
  args: [APP_DIR],
  timeout: 30000,
});

await new Promise((r) => setTimeout(r, 3000));

const page = app.windows().find((w) => w.url().includes('/index.html')) ?? (await app.firstWindow());

await page.evaluate(() => {
  window.northstar.syncTooltip({
    visible: true,
    text: 'Show sidebar (L)',
    rect: { top: 200, left: 200, width: 140, height: 24 },
  });
});

await new Promise((r) => setTimeout(r, 800));

const tooltipPage = app.windows().find((w) => w.url().includes('tooltip.html'));
console.log('found tooltip page?', !!tooltipPage);
if (tooltipPage) {
  tooltipPage.on('console', (msg) => console.log('[tooltip console]', msg.type(), msg.text()));
  tooltipPage.on('pageerror', (err) => console.log('[tooltip pageerror]', String(err)));
  const html = await tooltipPage.evaluate(() => document.body.innerHTML);
  console.log('tooltip body innerHTML:', html);
  const style = await tooltipPage.evaluate(() => {
    const el = document.querySelector('.tooltip-overlay');
    if (!el) return null;
    const cs = getComputedStyle(el);
    return { background: cs.backgroundColor, color: cs.color, display: cs.display, text: el.textContent };
  });
  console.log('tooltip-overlay computed style:', style);
  await tooltipPage.screenshot({ path: SHOT_DIR + '\\05-tooltip-page-itself.png' });
}

await page.screenshot({ path: SHOT_DIR + '\\06-fullwindow-after-sync.png' });

console.log('holding window open for OS-level screenshot...');
await new Promise((r) => setTimeout(r, 6000));

await app.close();
console.log('done');
