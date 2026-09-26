// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-09-24

import { join } from 'node:path';
import { app, BrowserWindow, ipcMain, protocol, session } from 'electron';
import { NORTHSTAR_SCHEME } from '@shared/constants';
import { IpcChannel } from '@shared/ipc-contract';
import { tearOffTabRequestSchema } from '@shared/ipc-schemas';
import { BookmarkStore } from './browser/BookmarkStore';
import { HighlighterController } from './browser/HighlighterController';
import { HighlightStore } from './browser/HighlightStore';
import { SessionStore } from './browser/SessionStore';
import { SharedTabRegistry } from './browser/SharedTabRegistry';
import { TabManager } from './browser/TabManager';
import { registerAccentColorIpc } from './ipc/registerAccentColorIpc';
import { registerTabIpc } from './ipc/registerTabIpc';
import { registerThemeIpc } from './ipc/registerThemeIpc';
import { registerWindowIpc } from './ipc/registerWindowIpc';
import { buildMenu } from './menu/buildMenu';
import { buildHomePageHtml } from './protocol/homePage';
import { TerminalManager } from './terminal/TerminalManager';
import { createMainWindow } from './windows/MainWindow';

// Electron requires this to be set before `app.whenReady()`.
app.setName('Northstar');

// Custom schemes must be registered as privileged before the app is ready.
// `standard: true` gives it normal URL parsing (host, path); `secure: true`
// treats it like https for mixed-content purposes; script isn't needed
// since the home page is pure server-rendered markup, so fetch/CORS stay off.
protocol.registerSchemesAsPrivileged([
  {
    scheme: NORTHSTAR_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: false, corsEnabled: false },
  },
]);

// Tracks whichever window is currently frontmost, so the application menu
// (accelerators like Ctrl+T act on whichever window is actually focused,
// the correct behavior for a native app menu — unlike `registerTabIpc`'s
// channels, see its own doc comment for why those resolve per-request
// instead) always acts on the right window.
let activeTabManager: TabManager | null = null;

// Every open window's own `TabManager`, keyed by `BrowserWindow.id` —
// resolves a *specific* window regardless of focus, which `registerTabIpc`
// and `tearOffTab` need: a request's sending window
// (`BrowserWindow.fromWebContents(event.sender)`) isn't necessarily
// whichever window last had OS focus (clicking into a background window is
// ordinary, not a focus-stealing gesture).
const tabManagersByWindowId = new Map<number, TabManager>();

// Bookmarks aren't scoped to a window — one store, shared by every
// `TabManager` and by the `northstar://home` page each of them can show.
const bookmarkStore = new BookmarkStore(join(app.getPath('userData'), 'bookmarks.json'));

// Same reasoning as `bookmarkStore` — not scoped to a window. In the
// ordinary case there's only ever one window open anyway; the `activate`
// relaunch path below (macOS's "reopen from the dock") is the same
// situation a plain restart is, just without the process itself exiting
// first.
const sessionStore = new SessionStore(join(app.getPath('userData'), 'session.json'));

// The tabs, workspaces, and their native views — one set, shared by every
// window's `TabManager` rather than each owning its own independent copy.
// See its own class doc comment for why: without this, every window got
// its own separate "Home" workspace, a new workspace created in one window
// never showed up in another's sidebar, and a tab created in one window
// was invisible — and unreachable — from any other.
const sharedRegistry = new SharedTabRegistry();

// Web-tab highlights aren't scoped to a window either — same reasoning as
// `bookmarkStore`, and shared with every `TabManager` the same way
// `sharedRegistry` is, since a tab (and its highlights) can move between
// windows. See `HighlighterController`'s own class doc comment.
const highlightStore = new HighlightStore(join(app.getPath('userData'), 'highlights.json'));
const highlighterController = new HighlighterController(sharedRegistry, highlightStore);

// Every open terminal tab's own pty process — one instance shared the same
// way `sharedRegistry` is, since a terminal tab can now move between
// windows the same as a browser tab can (dragged into another window's tab
// bar, or dragged out to tear off into a new one), and its shell process
// has to stay reachable regardless of which window currently displays it.
const sharedTerminalManager = new TerminalManager(
  // Pushed to the terminal tab's own `WebContentsView`, not any chrome
  // window — each terminal renders in its own page (see
  // `TabManager.createTerminalTab`), so that's the only webContents
  // actually listening for it, and it's reachable through
  // `sharedRegistry.views` regardless of which window currently has that
  // view mounted.
  (id, data) => sharedRegistry.views.get(id)?.webContents.send(IpcChannel.TerminalData, { id, data }),
  (id) => {
    const state = sharedRegistry.states.get(id);
    if (state?.kind === 'terminal') {
      sharedRegistry.states.set(id, { ...state, exited: true });
    }
    sharedRegistry.views.get(id)?.webContents.send(IpcChannel.TerminalExited, { id });
    sharedRegistry.notifyAll();
  },
);

void app.whenReady().then(() => {
  // Deny every site permission request (camera, mic, geolocation, ...) by
  // default. A future version should replace this with a per-origin
  // prompt; refusing everything is the safe default until that exists.
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });

  protocol.handle(NORTHSTAR_SCHEME, (request) => {
    const url = new URL(request.url);
    if (url.hostname !== 'home') {
      return new Response('Not found', { status: 404 });
    }
    return new Response(buildHomePageHtml(), {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        // No script runs on this page at all, so this is defense in depth
        // rather than a load-bearing protection — but it's free, and it's
        // the delivery method the rest of the app's chrome CSP also uses.
        'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action https:;",
      },
    });
  });

  registerTabIpc(resolveTabManagerForEvent, resolveTabManagerForTab);
  registerWindowIpc();
  registerThemeIpc();
  registerAccentColorIpc();
  registerTearOffIpc();
  buildMenu(
    () => activeTabManager,
    () => activeTabManager?.getState().activeTabId ?? null,
    // A new workspace (and its fresh home tab) rather than the restored
    // session `launchWindow`'s default `onReady` gives the ordinary
    // launch path — this window is meant to start empty, not replay
    // whatever was already open elsewhere.
    () => launchWindow((tabManager) => tabManager.createWorkspace()),
  );

  launchWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      launchWindow();
    }
  });
});

app.on('window-all-closed', () => {
  // Every terminal's shell process is shared app-wide now (`sharedTerminalManager`),
  // not owned by any one window — killed here, once, rather than by
  // whichever window happens to close (which might not even be the last
  // one, and might not be the window that originally spawned a given
  // shell).
  sharedTerminalManager.disposeAll();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

/**
 * Resolves the `TabManager` owning whichever window actually sent a
 * request — see `registerTabIpc`'s own doc comment for why this has to be
 * `event.sender`-based rather than "whichever window is focused" (the old
 * behavior, back when only one window could ever exist). Throws rather
 * than returning `undefined` so every `registerTabIpc` handler's own
 * try/catch turns this into an ordinary `IpcResult` failure the same way
 * it already handles any other main-process error.
 * @param event An IPC event carrying the sending `webContents`.
 */
function resolveTabManagerForEvent(event: { sender: Electron.WebContents }): TabManager {
  const window = BrowserWindow.fromWebContents(event.sender);
  const manager = window ? tabManagersByWindowId.get(window.id) : undefined;
  if (!manager) {
    throw new Error('No window is open for this request');
  }
  return manager;
}

/**
 * Resolves whichever `TabManager` currently owns a specific tab id —
 * `registerTabIpc`'s terminal channels need this instead of
 * `resolveTabManagerForEvent`, since they're sent from a terminal tab's
 * own child `WebContentsView`, not the chrome's top-level one. Any
 * manager that knows about the tab works equally well here (they all
 * share the same `sharedTerminalManager`) — this just needs *a* valid one
 * to call through.
 * @param tabId The tab to find an owning window for.
 */
function resolveTabManagerForTab(tabId: string): TabManager | undefined {
  for (const manager of tabManagersByWindowId.values()) {
    if (manager.hasTab(tabId)) {
      return manager;
    }
  }
  return undefined;
}

/**
 * Creates a window and its `TabManager`, and makes it the active one.
 * @param onReady What the window's first tab(s) should be, once its own
 *   chrome page has finished loading — defaults to restoring the last
 *   saved session (the ordinary launch path). `tearOffTab` below passes
 *   something that seeds it with one specific tab instead.
 * @param position Screen position to open the window at. Omitted for the
 *   ordinary launch path, which lets the OS place it; `tearOffTab` passes
 *   the drag's release point, so the new window lands where the tab was
 *   actually dropped instead of wherever the OS would otherwise put it.
 */
function launchWindow(
  onReady: (tabManager: TabManager) => void = (tabManager) => tabManager.restoreSession(),
  position?: { x: number; y: number },
): void {
  const window = createMainWindow();
  if (position) {
    window.setPosition(Math.round(position.x), Math.round(position.y));
  }
  const tabManager = new TabManager(
    window,
    (state) => window.webContents.send(IpcChannel.TabsStateChanged, state),
    bookmarkStore,
    sessionStore,
    sharedRegistry,
    sharedTerminalManager,
    highlighterController,
  );

  tabManagersByWindowId.set(window.id, tabManager);

  window.on('focus', () => {
    activeTabManager = tabManager;
  });
  activeTabManager = tabManager;

  window.on('resize', () => tabManager.updateBounds());
  window.on('closed', () => {
    tabManager.dispose();
    tabManagersByWindowId.delete(window.id);
    // `SessionStore.scheduleSave` debounces its actual disk write — flush
    // it immediately here rather than let a just-scheduled write get cut
    // off by the process exiting before its timer fires.
    sessionStore.flush();
  });
  window.webContents.once('did-finish-load', () => onReady(tabManager));

  // Drives WindowControls' maximize/restore icon — the frameless window has
  // no native titlebar to show that state itself (see MainWindow.ts).
  window.on('maximize', () => window.webContents.send(IpcChannel.WindowStateChanged, { isMaximized: true }));
  window.on('unmaximize', () => window.webContents.send(IpcChannel.WindowStateChanged, { isMaximized: false }));
}

/**
 * Registers the tab-bar's drag-out-of-the-window gesture (`tearOffTab` in
 * `NorthstarApi`): fire-and-forget, like `terminal:input`, since the only
 * meaningful result is a brand new window appearing, not a reply to the
 * window the drag started in. Lives here rather than in `registerTabIpc`
 * because it doesn't act on "whichever `TabManager` is active" like every
 * other tab channel — it needs the *specific* window the drag came from
 * (`tabManagersByWindowId`, keyed off the sending `webContents`) and the
 * ability to spin up a brand new one, neither of which `registerTabIpc`'s
 * single-`TabManager` handlers have reason to know about.
 */
function registerTearOffIpc(): void {
  ipcMain.on(IpcChannel.TabsTearOff, (event, rawRequest: unknown) => {
    const parsed = tearOffTabRequestSchema.safeParse(rawRequest);
    if (!parsed.success) {
      return;
    }
    const sourceWindow = BrowserWindow.fromWebContents(event.sender);
    const sourceManager = sourceWindow ? tabManagersByWindowId.get(sourceWindow.id) : undefined;
    if (!sourceWindow || !sourceManager) {
      return;
    }

    const { id, screenX, screenY } = parsed.data;
    const bounds = sourceWindow.getBounds();
    const droppedOutsideWindow =
      screenX < bounds.x ||
      screenX > bounds.x + bounds.width ||
      screenY < bounds.y ||
      screenY > bounds.y + bounds.height;
    // A release inside the window's own bounds isn't a tear-off — it's a
    // drag that simply missed every drop target this chrome recognizes
    // (e.g. released over the page's own native view), which should just
    // leave the tab where it was, same as `TabBar`'s existing "dropped in
    // the dead space past the last tab" handling.
    if (!droppedOutsideWindow) {
      return;
    }

    // Gives the tab its own brand-new, standalone workspace rather than
    // dumping it into a new "Home" — tabs/workspaces are shared across
    // every window now (`sharedRegistry`), so the new window's own
    // "Home" would be the *same* Home every other window already shows,
    // not a fresh one to redecorate. `createStandaloneWorkspaceFor` also
    // releases the tab from wherever it's currently mounted; a no-op
    // `null` return means the tab's already gone.
    const newWorkspaceId = sourceManager.createStandaloneWorkspaceFor(id);
    if (!newWorkspaceId) {
      return;
    }

    launchWindow(
      // Mounts the tab's own already-existing view into the new window —
      // its live page, navigation history, everything, survives the
      // move intact, unlike the URL-only recreate this used to need
      // before tabs were shared across windows.
      (tabManager) => tabManager.activateTab(id),
      { x: screenX - 150, y: screenY - 20 },
    );
  });
}
