import { _electron as electron } from 'playwright-core';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import http from 'node:http';
import fs from 'node:fs';
const APP = 'C:/Users/joshu/OneDrive/Desktop/Software/Projects/Northstar';
const PROFILE = 'C:/Users/joshu/AppData/Local/Temp/ns-test-find';
const DIR = 'C:/Users/joshu/AppData/Local/Temp/ns-test-find-files';
const SHOTS = 'C:/Users/joshu/AppData/Local/Temp/claude/C--Users-joshu-OneDrive-Desktop-Software-Projects-Northstar/97c5df21-e30d-4d5c-9aae-3694f6fb7359/scratchpad/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (const d of [PROFILE, DIR]) { fs.rmSync(d, { recursive: true, force: true }); fs.mkdirSync(d, { recursive: true }); }

// ---- a page with known text
const TEXT = ['Cat tales', 'The cat sat. A Cat and a CAT; concatenate catalog cat.', 'Second line with category, scat and cat_ 9cat cat.', 'pre cat\ncat'];
const html = '<html><head><title>Cats</title></head><body style="font:18px sans-serif;padding:30px"><h1>' + TEXT[0] + '</h1><p>' + TEXT[1] + '</p><div style="height:1500px"></div><p>' + TEXT[2] + '</p><pre>' + TEXT[3] + '</pre></body></html>';
const server = http.createServer((_q, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(html); });
await new Promise((r) => server.listen(8771, 'localhost', r));
const plain = TEXT.join('\n');
const count = (re) => (plain.match(re) ?? []).length;
const expect = { insens: count(/cat/gi), sens: count(/cat/g), word: count(/(?<!\w)cat(?!\w)/gi), regex: count(/\bC\w+/gi) };
console.log('expected counts:', expect);

// ---- a PDF with the word on several pages
const pdfDoc = await PDFDocument.create();
const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
const perPage = [2, 0, 3];
perPage.forEach((n, i) => { const p = pdfDoc.addPage([400, 500]); for (let k = 0; k < n; k++) p.drawText(`alpha beta ${k} alpha-free line`, { x: 30, y: 450 - k * 60, size: 18, font }); p.drawText(`page ${i + 1}`, { x: 30, y: 30, size: 12, font }); });
fs.writeFileSync(DIR + '/Doc.pdf', await pdfDoc.save());
const pdfPath = (DIR + '/Doc.pdf').replace(/\//g, '\\');
fs.writeFileSync(PROFILE + '/bookmarks.json', JSON.stringify([{ id: 'f', title: 'Doc', url: 'file:///d', kind: 'pdf', path: pdfPath }]));

const app = await electron.launch({ executablePath: APP + '/node_modules/electron/dist/electron.exe', args: [APP, '--user-data-dir=' + PROFILE] });
app.process().stderr?.on('data', (d) => console.log('[main stderr]', String(d).slice(0, 300)));
await sleep(3000);
const chrome = app.windows().find((w) => w.url().includes('/index.html')) ?? (await app.firstWindow());
const state = () => chrome.evaluate(async () => (await window.northstar.getState()).data);
const menu = (accel) => app.evaluate(({ Menu }, accel) => { const find = (items) => { for (const i of items) { if (i.accelerator === accel) return i; if (i.submenu) { const r = find(i.submenu.items); if (r) return r; } } }; find(Menu.getApplicationMenu().items)?.click(); }, accel);
const pages = () => app.context().pages();
const bar = () => pages().find((w) => w.url().includes('find.html'));
const barState = () => bar().evaluate(() => ({ input: document.querySelector('.find-bar__input').value, num: document.querySelector('.find-bar__numerator')?.value, total: document.querySelector('.find-bar__total')?.textContent, count: document.querySelector('.find-bar__count').textContent, invalid: document.querySelector('.find-bar__input').getAttribute('aria-invalid'), pressed: [...document.querySelectorAll('.find-bar__switch')].map((b) => b.getAttribute('aria-pressed')) }));
const overlayBounds = () => app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find((x) => x.isVisible()); return w.contentView.children.filter((c) => c.webContents && c.webContents.getURL().includes('find.html')).map((c) => c.getBounds()); });

await chrome.evaluate(() => window.northstar.createTab('http://localhost:8771/'));
await sleep(2000);
const tab = pages().find((w) => w.url().startsWith('http://localhost:8771'));
const hl = (name) => tab.evaluate((name) => CSS.highlights.get(name)?.size ?? 0, name);

// ---- button / tooltip / state
console.log('find button:', await chrome.evaluate(() => { const b = document.querySelector('.page-actions__button[aria-label="Find"]'); return b && { tip: b.getAttribute('data-tooltip'), prev: b.previousElementSibling.getAttribute('aria-label'), disabled: b.disabled }; }));

// ---- open with the accelerator
await menu('CmdOrCtrl+F');
await sleep(900);
console.log('bar open:', !!bar(), '| findOpen state:', (await state()).findOpen, '| bounds:', await overlayBounds());
console.log('bar input has the keyboard:', await bar().evaluate(() => document.activeElement === document.querySelector('.find-bar__input')));
const win = await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find((x) => x.isVisible()); return w.getContentSize(); });
console.log('window content size:', win);

// ---- type, count, highlight
await bar().keyboard.type('cat');
await sleep(700);
let s = await barState();
console.log('after typing "cat":', s.num, '/', s.total, '| expected total', expect.insens, '| page highlights:', await hl('northstar-find'), 'current:', await hl('northstar-find-current'));
// ---- stepping: Enter, Shift+Enter, wrap
await bar().keyboard.press('Enter'); await sleep(250);
console.log('Enter ->', (await barState()).num);
await bar().keyboard.press('Shift+Enter'); await sleep(250);
await bar().keyboard.press('Shift+Enter'); await sleep(250);
console.log('Shift+Enter twice from 2 ->', (await barState()).num, '(wraps to last =', expect.insens + ')');
await bar().keyboard.press('Enter'); await sleep(250);
console.log('Enter from last ->', (await barState()).num, '(wraps to 1)');
// ---- arrows
await bar().click('.find-bar__step[aria-label^="Next"]'); await sleep(250);
await bar().click('.find-bar__step[aria-label^="Next"]'); await sleep(250);
await bar().click('.find-bar__step[aria-label^="Previous"]'); await sleep(250);
console.log('down, down, up arrows from 1 ->', (await barState()).num);
// ---- numerator
await bar().click('.find-bar__numerator');
await bar().keyboard.type('5');
await bar().keyboard.press('Enter'); await sleep(300);
console.log('typed 5 + Enter ->', (await barState()).num, '| keyboard back on the query:', await bar().evaluate(() => document.activeElement === document.querySelector('.find-bar__input')));
await bar().click('.find-bar__numerator');
await bar().keyboard.type('999');
await bar().keyboard.press('Enter'); await sleep(300);
console.log('typed 999 -> clamps to', (await barState()).num);
const inView = await tab.evaluate(() => { const h = CSS.highlights.get('northstar-find-current'); const r = [...h][0].getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), viewport: innerHeight }; });
console.log('current match scrolled into view:', inView);
await app.evaluate(({ BrowserWindow }) => 0);
await chrome.screenshot({ path: SHOTS + 'find-browser.png' });

// ---- switches
await bar().click('.find-bar__switch[aria-label^="Match Case"]'); await sleep(500);
s = await barState(); console.log('Match Case ->', s.total, '| expected', expect.sens, '| pressed', s.pressed);
await bar().click('.find-bar__switch[aria-label^="Match Case"]');
await bar().click('.find-bar__switch[aria-label^="Match Whole Word"]'); await sleep(500);
s = await barState(); console.log('Whole Word ->', s.total, '| expected', expect.word);
await bar().click('.find-bar__switch[aria-label^="Match Whole Word"]');
await bar().click('.find-bar__switch[aria-label^="Use Regular"]');
await bar().fill('.find-bar__input', '\\bC\\w+'); await sleep(600);
s = await barState(); console.log('Regex \\bC\\w+ ->', s.total, '| expected', expect.regex);
await bar().fill('.find-bar__input', '('); await sleep(600);
s = await barState(); console.log('Regex "(" ->', JSON.stringify(s.count), 'invalid:', s.invalid, '| page highlights cleared:', (await hl('northstar-find')) === 0);
await bar().fill('.find-bar__input', ''); await sleep(500);
console.log('empty query ->', (await barState()).count, '| highlights', await hl('northstar-find'));
await bar().click('.find-bar__switch[aria-label^="Use Regular"]');
// ---- alt shortcuts
await bar().fill('.find-bar__input', 'cat'); await sleep(400);
await bar().keyboard.press('Alt+c'); await sleep(500);
console.log('Alt+C toggled match case ->', (await barState()).pressed[0], '/', (await barState()).total);
await bar().keyboard.press('Alt+c');

// ---- close with Escape
await bar().keyboard.press('Escape'); await sleep(500);
console.log('after Escape: bar mounted:', (await overlayBounds()).length > 0, '| findOpen:', (await state()).findOpen, '| highlights cleared:', (await hl('northstar-find')) === 0);

// ---- terminal
await chrome.evaluate(() => window.northstar.createTerminalTab());
await sleep(2500);
const termPage = pages().find((w) => w.url().includes('terminal.html'));
await termPage.click('.xterm');
await termPage.keyboard.type('echo cat cat cat');
await termPage.keyboard.press('Enter');
await sleep(1800);
await menu('CmdOrCtrl+F'); await sleep(800);
await bar().fill('.find-bar__input', 'cat'); await sleep(900);
const term = pages().find((w) => w.url().includes('terminal.html'));
s = await barState();
console.log('TERMINAL "cat":', s.num, '/', s.total, '| decorations on screen:', await term.evaluate(() => document.querySelectorAll('.xterm-decoration').length));
await bar().keyboard.press('Enter'); await sleep(300);
console.log('   Enter ->', (await barState()).num);
await chrome.screenshot({ path: SHOTS + 'find-terminal.png' });

// ---- switching tabs with the bar open re-runs the search there
await chrome.evaluate((id) => window.northstar.activateTab(id), (await state()).tabs.find((t) => t.kind === 'browser' && t.title === 'Cats').id);
await sleep(1200);
s = await barState();
console.log('switched back to the page with the bar open: ', s.num, '/', s.total, '(page again; expected', expect.insens + ')');

// ---- PDF
await chrome.evaluate(() => window.northstar.createPdfTab());
await sleep(1500);
console.log('find disabled on an empty PDF tab:', await chrome.evaluate(() => document.querySelector('.page-actions__button[aria-label="Find"], .page-actions__button[aria-label="Close find"]').disabled), '| bar closed by the switch:', (await state()).findOpen === false);
await menu('CmdOrCtrl+F'); await sleep(300);
console.log('   Ctrl+F on an empty PDF opens nothing:', (await state()).findOpen === false);
await chrome.click('.pdf-search__input');
await chrome.keyboard.type('doc'); await sleep(500); await chrome.keyboard.press('Enter'); await sleep(2500);
await menu('CmdOrCtrl+F'); await sleep(900);
await bar().fill('.find-bar__input', 'alpha'); await sleep(1500);
const pdf = pages().find((w) => w.url().includes('pdf.html') && w.url().includes('id='));
s = await barState();
const expectPdf = perPage.reduce((a, n) => a + n * 2, 0);
console.log('PDF "alpha":', s.num, '/', s.total, '| expected', expectPdf, '| painted highlights on drawn pages:', await pdf.evaluate(() => CSS.highlights.get('northstar-pdf-find')?.size ?? 0));
await bar().fill('.find-bar__numerator', '9'); await bar().keyboard.press('Enter'); await sleep(1500);
console.log('   jumped to 9 ->', (await barState()).num, '| current match inside the visible scroll area:', await pdf.evaluate(() => { const c = document.querySelector('.pdf-viewer__scroll').getBoundingClientRect(); const h = CSS.highlights.get('northstar-pdf-find-current'); const r = h && [...h][0].getBoundingClientRect(); return !!r && r.top >= c.top && r.bottom <= c.bottom; }), '| on page', await pdf.evaluate(() => { const h = CSS.highlights.get('northstar-pdf-find-current'); return [...h][0].startContainer.parentElement.closest('[data-page-number]')?.dataset.pageNumber; }));
await chrome.screenshot({ path: SHOTS + 'find-pdf.png' });
await bar().keyboard.press('Escape'); await sleep(400);

// ---- History tab
await chrome.evaluate(() => window.northstar.createHistoryTab());
await sleep(1500);
console.log('History tab: find button disabled:', await chrome.evaluate(() => document.querySelector('.page-actions__button[aria-label="Find"]').disabled));
await menu('CmdOrCtrl+F'); await sleep(300);
console.log('   Ctrl+F opens nothing:', (await state()).findOpen === false);

// ---- tab search: ten rows, then a scrollbar
for (let i = 0; i < 6; i++) { await chrome.evaluate(() => window.northstar.createTab('about:blank')).catch(() => {}); }
await chrome.evaluate(() => window.northstar.createWorkspace('Second'));
for (let i = 0; i < 7; i++) { await chrome.evaluate(() => window.northstar.createTab('about:blank')).catch(() => {}); }
await sleep(1500);
const total = (await state()).tabs.length;
await menu('CmdOrCtrl+K'); await sleep(900);
console.log('TAB SEARCH with', total, 'tabs:', await chrome.evaluate(() => { const l = document.querySelector('.tab-search__results'); const row = l.querySelector('.tab-search__result').getBoundingClientRect().height; return { rows: l.querySelectorAll('.tab-search__result').length, listHeight: Math.round(l.clientHeight), rowHeight: row, scrollable: l.scrollHeight > l.clientHeight, visibleRows: Math.round(l.clientHeight / row) }; }));
for (let i = 0; i < 12; i++) await chrome.keyboard.press('ArrowDown');
await sleep(200);
console.log('   after 12 Down presses the highlighted row is in view:', await chrome.evaluate(() => { const l = document.querySelector('.tab-search__results').getBoundingClientRect(); const r = document.querySelector('.tab-search__result--selected').getBoundingClientRect(); return r.top >= l.top - 1 && r.bottom <= l.bottom + 1; }));
await chrome.screenshot({ path: SHOTS + 'tabsearch-10.png' });
await app.close().catch(() => {});
server.close();
