// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-09-12

import { join } from 'node:path';
import { app, BrowserWindow, ipcMain, protocol, session } from 'electron';
import { NORTHSTAR_SCHEME } from '@shared/constants';
import { IpcChannel, type IpcResult } from '@shared/ipc-contract';
import { moveTabRequestSchema, tearOffTabRequestSchema } from '@shared/ipc-schemas';
import type { BrowserState } from '@shared/tab-state';
import { BookmarkStore } from './browser/BookmarkStore';
import { SessionStore } from './browser/SessionStore';
import { TabManager } from './browser/TabManager';
import { registerTabIpc } from './ipc/registerTabIpc';
import { registerThemeIpc } from './ipc/registerThemeIpc';
import { registerWindowIpc } from './ipc/registerWindowIpc';
import { buildMenu } from './menu/buildMenu';
import { buildHomePageHtml } from './protocol/homePage';
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

// Tracks whichever window is currently frontmost, so the one set of
// `ipcMain.handle` registrations (below) and the application menu always
// act on the right window's tabs even if more than one is ever opened.
let activeTabManager: TabManager | null = null;

// Every open window's own `TabManager`, keyed by `BrowserWindow.id` —
// unlike `activeTabManager`, this resolves a *specific* window regardless
// of focus, which `tearOffTab` needs: the drag's source window is whichever
// one sent the IPC message (`BrowserWindow.fromWebContents(event.sender)`),
// not necessarily whichever window last had OS focus.
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
  registerTearOffIpc();
  registerCrossWindowTabMoveIpc();
  buildMenu(
    () => activeTabManager,
    () => activeTabManager?.getState().activeTabId ?? null,
  );

  launchWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      launchWindow();
    }
  });
});

app.on('window-all-closed', () => {
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
 * own child `WebContentsView`, not the chrome's top-level one.
 * @param tabId The tab to find the owning window for.
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
  );

  tabManagersByWindowId.set(window.id, tabManager);

  window.on('focus', () => {
    activeTabManager = tabManager;
  });
  activeTabManager = tabManager;

  window.on('resize', () => tabManager.updateBounds());
  window.on('closed', () => {
    tabManager.disposeAllTerminals();
    tabManager.disposeSuggestionsOverlay();
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

    const tornTab = sourceManager.getState().tabs.find((tab) => tab.id === id);
    if (!tornTab) {
      return;
    }

    // Removes it from the source window first, with the same fallback
    // bookkeeping an ordinary close would use (activates a neighbor,
    // exits split view, etc.) — but not recorded in `closedTabs`: it isn't
    // gone, just moving to a new window, so Ctrl+Shift+T back in the
    // source window shouldn't be able to resurrect a duplicate of it.
    sourceManager.closeTab(id, { recordClosed: false });

    launchWindow(
      (tabManager) =>
        tornTab.kind === 'terminal' ? tabManager.createTerminalTab() : tabManager.createTab(tornTab.url),
      // Only the URL/kind survive into the new window, not the live page
      // itself — same tradeoff `SessionStore`/`restoreLastClosedTab`
      // already make ("enough to reopen it, not to replay its history"),
      // and it sidesteps actually having to transplant a `WebContentsView`
      // (and every listener `wireEvents` attached to it) from one
      // `TabManager` to another.
      { x: screenX - 150, y: screenY - 20 },
    );
  });
}

/**
 * Registers `TabsMove` (`moveTab` in `NorthstarApi`) — `TabBar`'s
 * drag-and-drop reorder gesture. Unlike `registerTabIpc`'s other channels,
 * this one can't assume the request should act on "whichever window is
 * currently active": a drop lands in whichever window's own `TabBar` the
 * drag was released over, which doesn't require that window to have OS
 * focus first (the same reasoning `registerTearOffIpc` already applies to
 * resolving a tear-off's source window). So this resolves the
 * *destination* window directly from `event.sender` instead, and — new
 * since cross-window dragging exists — searches every other open window
 * for whichever one currently owns the dragged tab, exactly when it isn't
 * this window's own: same-window reorder and cross-window move are, from
 * here, the same gesture with a different source.
 */
function registerCrossWindowTabMoveIpc(): void {
  ipcMain.handle(IpcChannel.TabsMove, (event, rawRequest: unknown): IpcResult<BrowserState> => {
    const parsed = moveTabRequestSchema.safeParse(rawRequest);
    if (!parsed.success) {
      return { ok: false, code: 'invalid-request', message: parsed.error.message };
    }

    const destWindow = BrowserWindow.fromWebContents(event.sender);
    const destManager = destWindow ? tabManagersByWindowId.get(destWindow.id) : undefined;
    if (!destManager) {
      return { ok: false, code: 'no-window', message: 'No window is open for this request' };
    }

    const { id, beforeId } = parsed.data;

    if (destManager.hasTab(id)) {
      // The common case — reordering within a single window's own tab
      // bar — is unchanged: `TabManager.moveTab` just repositions it
      // within its own tab list.
      return { ok: true, data: destManager.moveTab(id, beforeId) };
    }

    let sourceManager: TabManager | undefined;
    for (const manager of tabManagersByWindowId.values()) {
      if (manager !== destManager && manager.hasTab(id)) {
        sourceManager = manager;
        break;
      }
    }
    if (!sourceManager) {
      // The dragged tab closed (or belonged to a window that's since
      // closed) before this drop landed — nothing left to insert.
      return { ok: true, data: destManager.getState() };
    }

    const tornTab = sourceManager.getState().tabs.find((tab) => tab.id === id);
    if (!tornTab) {
      return { ok: true, data: destManager.getState() };
    }

    // Same trade-off `tearOffTab` makes, and for the same reason: only the
    // URL/kind survive into the destination window, not the live page
    // itself, rather than transplanting a `WebContentsView` (and every
    // listener `wireEvents` attached to it) between two `TabManager`s.
    // Removed from the source first, with the same fallback bookkeeping
    // an ordinary close would use, and not recorded in `closedTabs` — it
    // isn't gone, just relocating, so Ctrl+Shift+T in the source window
    // shouldn't resurrect a duplicate of it.
    sourceManager.closeTab(id, { recordClosed: false });

    // Lands in whichever workspace is currently visible in the
    // destination window — the same workspace `beforeId`'s own tab
    // belongs to, since that's the row the drop actually landed in.
    // Unlike `moveTabToWorkspace`'s drag-onto-a-pill gesture, this one
    // *does* become the active tab: dropping a tab directly into a
    // window's own visible tab strip reads as "bring this here and look
    // at it now," the same way it does dragging a tab between two
    // windows in Chrome, not "file this away in the background."
    const destWorkspaceId = destManager.getState().activeWorkspaceId;
    const created =
      tornTab.kind === 'terminal'
        ? destManager.createTerminalTab(destWorkspaceId)
        : destManager.createTab(tornTab.url, destWorkspaceId);

    // `createTab`/`createTerminalTab` always activate the tab they create
    // (see their own doc comments), so `activeTabId` is always the new
    // tab's id here — reposition it from wherever it landed (appended at
    // the end) to the exact boundary the drop was released on.
    const newId = created.activeTabId;
    return { ok: true, data: newId ? destManager.moveTab(newId, beforeId) : created };
  });
}
