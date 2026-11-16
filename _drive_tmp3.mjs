import { _electron as electron } from 'playwright-core';

const APP_DIR = 'C:\\Users\\joshu\\OneDrive\\Desktop\\Software\\Projects\\Portalogia';

const app = await electron.launch({
  executablePath: APP_DIR + '\\node_modules\\electron\\dist\\electron.exe',
  args: [APP_DIR],
  timeout: 30000,
});

await new Promise((r) => setTimeout(r, 3000));

const page = app.windows().find((w) => w.url().includes('/index.html')) ?? (await app.firstWindow());
page.on('console', (msg) => console.log('[chrome console]', msg.type(), msg.text()));
page.on('pageerror', (err) => console.log('[chrome pageerror]', String(err)));

await page.evaluate(() => {
  const el = document.querySelector('.sidebar__toggle');
  const r = el.getBoundingClientRect();
  window.portalogia.syncTooltip({
    visible: true,
    text: 'Show sidebar (L)',
    rect: { top: 200, left: 200, width: 140, height: 24 },
  });
});

await new Promise((r) => setTimeout(r, 500));

const childViewInfo = await app.evaluate(({ BrowserWindow }) => {
  const win = BrowserWindow.getAllWindows()[0];
  return win.contentView.children.map((child, i) => {
    let bounds = null;
    try {
      bounds = child.getBounds();
    } catch (e) {
      bounds = 'ERR: ' + e.message;
    }
    let url = null;
    try {
      url = child.webContents?.getURL();
    } catch (e) {
      url = 'ERR: ' + e.message;
    }
    return { i, bounds, url };
  });
});
console.log('child views:', JSON.stringify(childViewInfo, null, 2));

await app.close();
console.log('done');
