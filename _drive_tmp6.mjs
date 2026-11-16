import { _electron as electron } from 'playwright-core';

const APP_DIR = 'C:\\Users\\joshu\\OneDrive\\Desktop\\Software\\Projects\\Portalogia';

const app = await electron.launch({
  executablePath: APP_DIR + '\\node_modules\\electron\\dist\\electron.exe',
  args: [APP_DIR],
  timeout: 30000,
});

const proc = app.process();
proc.stdout?.on('data', (d) => process.stdout.write('[main stdout] ' + d));
proc.stderr?.on('data', (d) => process.stdout.write('[main stderr] ' + d));

await new Promise((r) => setTimeout(r, 3000));

const page = app.windows().find((w) => w.url().includes('/index.html')) ?? (await app.firstWindow());

await page.evaluate(() => {
  window.portalogia.syncTooltip({
    visible: true,
    text: 'Show sidebar (L)',
    rect: { top: 200, left: 200, width: 140, height: 24 },
  });
});

await new Promise((r) => setTimeout(r, 3000));

await app.close().catch((e) => console.log('close error (expected if crashed):', e.message));
console.log('done');
