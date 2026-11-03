// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-29

import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test as base, expect } from '@playwright/test';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright';

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * Static pages for navigation tests, served locally so they never depend on
 * (or get flaked by) real internet access. Each has its own `<title>` so
 * tests can assert the chrome picked up a real page-title-updated event,
 * and so tab search has more than one distinct title to filter between.
 */
const PAGES: Record<string, string> = {
  '/widgets': '<!doctype html><title>Widgets Catalog</title><h1>Widgets</h1>',
  '/gadgets': '<!doctype html><title>Gadgets Catalog</title><h1>Gadgets</h1>',
  // A text box, and an editor that takes its typing inside a same-origin frame whose whole document is editable —
  // the way Google Docs does. Every keydown the page itself sees is recorded in `window.seenKeys`.
  '/editor':
    '<!doctype html><title>Editor</title><input id="box" value="one two three">' +
    '<iframe id="frame" style="width:400px;height:120px"></iframe>' +
    '<script>window.seenKeys=[];addEventListener("keydown",e=>seenKeys.push((e.ctrlKey?"Ctrl+":"")+e.key),true);' +
    'const d=document.getElementById("frame").contentDocument;d.open();d.write("<body>alpha beta gamma</body>");' +
    'd.close();d.designMode="on";</script>',
  // Much bigger than any window both ways, with a link to (not) follow while panning.
  '/tall':
    '<!doctype html><title>Tall Page</title><style>body{margin:0}</style>' +
    '<div style="width:4000px;height:6000px;background:linear-gradient(135deg,#fff,#888)"></div>' +
    '<a id="link" href="/widgets" style="position:absolute;top:150px;left:150px;font-size:40px">a link</a>',
  // Things a click acts on — a text box, a link, a button that reacts to every stage of a press — plus the same
  // inside a same-origin frame and a cross-origin one (127.0.0.1 is another origin than localhost). Everything that
  // reacts is recorded in `window.hits`; the frames report theirs by `postMessage`.
  '/controls':
    '<!doctype html><title>Controls</title><style>body{margin:0;font-size:24px}' +
    'input,button,a{display:block;margin:20px;font-size:24px}iframe{width:420px;height:200px;margin:20px}</style>' +
    '<input id="field" value="text"><a id="link" href="/widgets">a link</a><button id="button">a button</button>' +
    '<iframe id="same"></iframe><iframe id="cross"></iframe>' +
    '<script>window.hits=[];addEventListener("message",e=>hits.push(e.data));' +
    'const b=document.getElementById("button");for(const t of ["pointerdown","pointerup","mousedown","mouseup","click"])' +
    'b.addEventListener(t,()=>hits.push("button:"+t));' +
    'document.getElementById("field").addEventListener("focus",()=>hits.push("field:focus"));' +
    'document.getElementById("same").src="/frame-controls?same";' +
    'document.getElementById("cross").src=location.protocol+"//127.0.0.1:"+location.port+"/frame-controls?cross";</script>',
  '/frame-controls':
    '<!doctype html><style>body{margin:0}button,input{display:block;margin:10px;font-size:24px}</style>' +
    '<button id="button">frame button</button><input id="field" value="frame text">' +
    '<script>const who=location.search.slice(1);' +
    'document.getElementById("button").addEventListener("click",()=>parent.postMessage(who+":click","*"));' +
    'document.getElementById("field").addEventListener("focus",()=>parent.postMessage(who+":focus","*"));</script>',
};

/**
 * A tab's own page (its `WebContentsView`), found by part of its URL, once it is there.
 * @param app The launched app.
 * @param urlPart Text the page's URL contains.
 */
export async function findTabPage(app: ElectronApplication, urlPart: string): Promise<Page> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const found = app.windows().find((page) => !page.isClosed() && page.url().includes(urlPart));
    if (found) {
      return found;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`No tab page at a URL containing "${urlPart}"`);
}

/**
 * Loads a URL in the active tab through the address bar, and returns that tab's page once it has loaded.
 * @param app The launched app.
 * @param window The chrome window.
 * @param url Where to go.
 */
export async function openInActiveTab(app: ElectronApplication, window: Page, url: string): Promise<Page> {
  const addressBar = window.getByLabel('Search the internet...');
  await addressBar.fill(url);
  await addressBar.press('Enter');
  const page = await findTabPage(app, url);
  await page.waitForLoadState('load');
  return page;
}

/**
 * The chrome window's page (`index.html`). `electronApp.firstWindow()` can't be
 * used for this: Playwright counts every `WebContents` as a "window", including
 * the overlay views (tooltip, color picker, suggestions, laser pointer) a
 * window creates alongside its chrome page, so which one is "first" is a race —
 * and a test that got an overlay page waited 30s for a tab bar it doesn't have.
 */
export async function findChromeWindow(app: ElectronApplication): Promise<Page> {
  const isChromePage = (page: Page): boolean => /\/index\.html(?:[?#].*)?$/.test(page.url());
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    const found = app.windows().find(isChromePage);
    if (found) {
      return found;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('The chrome window (index.html) never opened');
}

/**
 * Runs an application-menu item by its label, as if its accelerator had been
 * pressed. Playwright's keyboard drives the page, not the OS menu, so it can't
 * trigger accelerators like Ctrl+W or Ctrl+Alt+W itself.
 */
export async function clickMenuItem(app: ElectronApplication, label: string): Promise<void> {
  await app.evaluate(({ Menu }, wanted) => {
    const search = (items: Electron.MenuItem[]): Electron.MenuItem | undefined => {
      for (const item of items) {
        if (item.label === wanted) {
          return item;
        }
        const nested = item.submenu ? search(item.submenu.items) : undefined;
        if (nested) {
          return nested;
        }
      }
      return undefined;
    };
    const item = search(Menu.getApplicationMenu()?.items ?? []);
    if (!item) {
      throw new Error(`No menu item labelled "${wanted}"`);
    }
    item.click();
  }, label);
}

/**
 * Presses a key in a tab's page the way a physical key press arrives: through
 * Electron's input pipeline, so main's `before-input-event` (every tab
 * shortcut, Shift+Escape, edit mode) sees it before the page does.
 * Playwright's `page.keyboard` dispatches straight into the renderer and
 * skips that handler, so a test of an app shortcut pressed from a page must
 * use this instead.
 * @param app The launched app.
 * @param urlPart Text the tab page's URL contains.
 * @param chord The key, Playwright style: `Escape`, `Shift+Escape`, `Control+ArrowLeft`, `Control+Alt+Shift+E`.
 */
export async function pressInTab(app: ElectronApplication, urlPart: string, chord: string): Promise<void> {
  const parts = chord.split('+');
  const key = parts.pop()!;
  const names: Record<string, 'control' | 'alt' | 'shift' | 'meta'> = { Control: 'control', Alt: 'alt', Shift: 'shift', Meta: 'meta' };
  const modifiers = parts.map((part) => names[part]!).filter(Boolean);
  // Electron's key codes for the named keys differ from the DOM's; letters and digits are themselves.
  const keyCodes: Record<string, string> = { ArrowLeft: 'Left', ArrowRight: 'Right', ArrowUp: 'Up', ArrowDown: 'Down' };
  const keyCode = keyCodes[key] ?? (key.length === 1 ? key.toUpperCase() : key);
  await app.evaluate(
    ({ webContents }, { urlPart: wanted, keyCode: code, modifiers: mods }) => {
      const contents = webContents.getAllWebContents().find((candidate) => candidate.getURL().includes(wanted));
      if (!contents) {
        throw new Error(`No tab page at a URL containing "${wanted}"`);
      }
      contents.sendInputEvent({ type: 'keyDown', keyCode: code, modifiers: mods });
      contents.sendInputEvent({ type: 'keyUp', keyCode: code, modifiers: mods });
    },
    { urlPart, keyCode, modifiers },
  );
}

/**
 * Presses a key in the chrome the way a physical key press arrives there, through the chrome window's own input
 * pipeline — as with the keyboard out of the page (after Shift+Escape), where the keys between tabs and the tools'
 * keys work. See `pressInTab` for the page's side.
 * @param app The launched app.
 * @param chord The key, Playwright style: `Control+ArrowLeft`, `Control+j`, `Control+Alt+Shift+E`.
 */
export async function pressInChrome(app: ElectronApplication, chord: string): Promise<void> {
  const parts = chord.split('+');
  const key = parts.pop()!;
  const names: Record<string, 'control' | 'alt' | 'shift' | 'meta'> = { Control: 'control', Alt: 'alt', Shift: 'shift', Meta: 'meta' };
  const modifiers = parts.map((part) => names[part]!).filter(Boolean);
  const keyCodes: Record<string, string> = { ArrowLeft: 'Left', ArrowRight: 'Right', ArrowUp: 'Up', ArrowDown: 'Down' };
  const keyCode = keyCodes[key] ?? (key.length === 1 ? key.toUpperCase() : key);
  await app.evaluate(
    ({ BrowserWindow }, { keyCode: code, modifiers: mods }) => {
      const win = BrowserWindow.getAllWindows().find((candidate) => candidate.isVisible());
      if (!win) {
        throw new Error('No chrome window is showing');
      }
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: code, modifiers: mods });
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: code, modifiers: mods });
    },
    { keyCode, modifiers },
  );
}

/**
 * Opens a Markdown note in a new note tab, the way a person does (the toolbar's Open button and its file dialog),
 * and returns that tab's page. The dialog is answered with `path` instead of being shown. Opening by path over IPC
 * isn't an option: main opens only notes already in the history there, so a page can't name any file on disk.
 * @param app The launched app.
 * @param window The chrome window.
 * @param path The note's path on disk.
 */
export async function openNote(app: ElectronApplication, window: Page, path: string): Promise<Page> {
  await app.evaluate(({ dialog }, notePath) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [notePath] })) as typeof dialog.showOpenDialog;
  }, path);
  await window.evaluate(() => window.portalogia.createMarkdownTab());
  await window.getByRole('complementary', { name: 'Tools' }).getByRole('button', { name: 'Open', exact: true }).click();
  return findTabPage(app, 'markdown.html');
}

interface TestFixtures {
  /** A local HTTP server hosting `PAGES`, torn down after the test. */
  server: { url: (path: string) => string };
  /** The launched app, using a fresh, isolated `userData` dir per test. */
  electronApp: ElectronApplication;
  /** The chrome window's page, already past its first render. */
  window: Page;
}

export const test = base.extend<TestFixtures>({
  // eslint-disable-next-line no-empty-pattern -- Playwright fixture signature requires the destructure even with no dependencies.
  server: async ({}, use) => {
    const httpServer: Server = createServer((request, response) => {
      // By path alone: a page may tell its copies apart by query string (see `/frame-controls`).
      const body = PAGES[(request.url ?? '').split('?')[0] ?? ''];
      if (!body) {
        response.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
        return;
      }
      response.writeHead(200, { 'content-type': 'text/html' }).end(body);
    });
    // No explicit host: binds the unspecified address so both the "::1"
    // and "127.0.0.1" a client resolves "localhost" to (Windows tries
    // "::1" first) actually reach it — binding to "127.0.0.1" alone left
    // an "::1" connection attempt hanging until the test timed out.
    await new Promise<void>((resolvePromise) => httpServer.listen(0, resolvePromise));
    const { port } = httpServer.address() as AddressInfo;

    // `looksLikeUrl` (src/shared/url.ts) only special-cases the literal
    // hostname "localhost", not "127.0.0.1" — use that name in generated
    // URLs even though the socket is bound to the loopback address.
    await use({ url: (path: string) => `http://localhost:${port}${path}` });

    await new Promise<void>((resolvePromise) => httpServer.close(() => resolvePromise()));
  },

  // eslint-disable-next-line no-empty-pattern -- Playwright fixture signature requires the destructure even with no dependencies.
  electronApp: async ({}, use) => {
    const userDataDir = mkdtempSync(join(tmpdir(), 'portalogia-e2e-'));
    const app = await electron.launch({
      args: [join(ROOT_DIR, 'out/main/index.js'), `--user-data-dir=${userDataDir}`],
      cwd: ROOT_DIR,
    });

    await use(app);

    await app.close();
    rmSync(userDataDir, { recursive: true, force: true });
  },

  window: async ({ electronApp }, use) => {
    const window = await findChromeWindow(electronApp);
    await window.waitForLoadState('domcontentloaded');
    // The main process creates the first tab asynchronously after
    // `did-finish-load`; wait for it so every test starts from one settled
    // home tab instead of racing the initial state push.
    await window.getByRole('tablist', { name: 'Open tabs' }).getByRole('tab').first().waitFor();
    // Also wait for that first load to actually finish (spinner gone).
    // Firing a second navigation while the first is still pending aborts
    // it before it commits, so it never becomes a back/forward history
    // entry — a real Electron race, not just test flakiness.
    await expect(window.locator('.tab-bar__spinner')).toHaveCount(0);

    await use(window);
  },
});

export { expect };
