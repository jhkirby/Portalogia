// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-06

import { join } from 'node:path';
import { app, BrowserWindow, ipcMain, protocol, screen, session } from 'electron';
import { NORTHSTAR_SCHEME } from '@shared/constants';
import { IpcChannel } from '@shared/ipc-contract';
import { dropRegionsRequestSchema, tearOffTabEndRequestSchema, tearOffTabRequestSchema } from '@shared/ipc-schemas';
import { AdBlocker } from './adblock/AdBlocker';
import { AdBlockStore } from './adblock/AdBlockStore';
import { BookmarkStore } from './browser/BookmarkStore';
import { CommentController } from './browser/CommentController';
import { CommentStore } from './browser/CommentStore';
import { HighlighterController } from './browser/HighlighterController';
import { HighlightStore } from './browser/HighlightStore';
import { PenController } from './browser/PenController';
import { TextBoxController } from './browser/TextBoxController';
import { HistoryController } from './browser/HistoryController';
import { HistoryStore } from './browser/HistoryStore';
import { TextBoxStore } from './browser/TextBoxStore';
import { trackEditableFocus } from './browser/editableFocus';
import { WorkspaceImageStore } from './browser/WorkspaceImageStore';
import { markdownAnnotationStore } from './browser/MarkdownAnnotationStore';
import { pdfAnnotationStore } from './browser/PdfAnnotationStore';
import { PenStore } from './browser/PenStore';
import { SessionStore } from './browser/SessionStore';
import { SharedTabRegistry } from './browser/SharedTabRegistry';
import { TabManager } from './browser/TabManager';
import { registerAdBlockIpc } from './ipc/registerAdBlockIpc';
import { registerAccentColorIpc } from './ipc/registerAccentColorIpc';
import { registerMarkdownIpc } from './ipc/registerMarkdownIpc';
import { registerTabIpc } from './ipc/registerTabIpc';
import { registerThemeIpc } from './ipc/registerThemeIpc';
import { registerWindowIpc } from './ipc/registerWindowIpc';
import { chromeWindowOf } from './ipc/senderGuards';
import { buildMenu } from './menu/buildMenu';
import { buildHomePageHtml } from './protocol/homePage';
import { TerminalManager } from './terminal/TerminalManager';
import { createMainWindow } from './windows/MainWindow';
import { GripHoverWatcher } from './windows/GripHoverWatcher';

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
// Saved workspace images, shared by every window like `bookmarkStore`.
const workspaceImageStore = new WorkspaceImageStore(join(app.getPath('userData'), 'workspace-images.json'));
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

// Dropped comments aren't scoped to a window either — same reasoning as
// `highlightStore`/`highlighterController` just above.
const commentStore = new CommentStore(join(app.getPath('userData'), 'comments.json'));
const commentController = new CommentController(sharedRegistry, commentStore);

// Text boxes aren't scoped to a window either — same reasoning as `commentStore`/
// `commentController` just above.
const textBoxStore = new TextBoxStore(join(app.getPath('userData'), 'text-boxes.json'));
const textBoxController = new TextBoxController(sharedRegistry, textBoxStore);
app.on('before-quit', () => textBoxController.flush());

// The browsing history isn't scoped to a window either, and a History tab can move between them — same
// reasoning as `commentStore`/`commentController` above. Recording starts once the app is ready (see below).
const historyStore = new HistoryStore(join(app.getPath('userData'), 'history.json'));
const historyController = new HistoryController(sharedRegistry, historyStore, () => bookmarkStore.list());
app.on('before-quit', () => historyController.flush());

// Pen strokes aren't scoped to a window either — same reasoning as
// `highlightStore`/`highlighterController` just above.
const penStore = new PenStore(join(app.getPath('userData'), 'pen-strokes.json'));
const penController = new PenController(sharedRegistry, penStore);

// Marks drawn on PDFs live here, not in the PDFs — see `PdfAnnotationStore`.
pdfAnnotationStore.init(join(app.getPath('userData'), 'pdf-annotations.json'));
app.on('before-quit', () => pdfAnnotationStore.flush());
// Marks drawn on Markdown notes live here, not in the notes — see `MarkdownAnnotationStore`.
markdownAnnotationStore.init(join(app.getPath('userData'), 'markdown-annotations.json'));
app.on('before-quit', () => markdownAnnotationStore.flush());

// Ad blocking is app-wide too: every tab shares the default session it hooks into.
const adBlockStore = new AdBlockStore(join(app.getPath('userData'), 'adblock.json'));
app.on('before-quit', () => adBlockStore.flush());
const adBlocker = new AdBlocker(
  adBlockStore,
  join(app.getPath('userData'), 'adblock-engine.bin'),
  (contentsId) => {
    for (const [tabId, view] of sharedRegistry.views) {
      if (!view.webContents.isDestroyed() && view.webContents.id === contentsId) {
        return tabId;
      }
    }
    return undefined;
  },
  () => {
    const state = adBlocker.getState();
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send(IpcChannel.AdBlockState, state);
      }
    }
  },
);

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

/**
 * Pointer lock is the one permission granted, and only to the app's own PDF
 * viewer page: it lets a grab-drag keep going past the screen edge (see
 * `PdfViewer`). A web page asking for it is still refused.
 * @param url The URL of the page making the request.
 */
function isOwnPdfViewerUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const isOwnOrigin =
      parsed.protocol === 'file:' || (!app.isPackaged && parsed.origin === new URL(process.env['ELECTRON_RENDERER_URL'] ?? 'about:blank').origin);
    return isOwnOrigin && parsed.pathname.endsWith('/pdf.html');
  } catch {
    return false;
  }
}

void app.whenReady().then(() => {
  // First, so the headers hook the chrome's CSP registers through exists before any window does.
  void adBlocker.start(session.defaultSession);
  historyController.attachTo(session.defaultSession);

  // Deny every site permission request (camera, mic, geolocation, ...) by
  // default. A future version should replace this with a per-origin
  // prompt; refusing everything is the safe default until that exists.
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    // Fullscreen is what a video's fullscreen button asks for; granted to web pages only.
    const isWebPage = /^https?:/i.test(details.requestingUrl);
    callback(
      (permission === 'pointerLock' && isOwnPdfViewerUrl(details.requestingUrl)) ||
        (permission === 'fullscreen' && isWebPage),
    );
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

  trackEditableFocus();
  registerTabIpc(resolveTabManagerForEvent, resolveTabManagerForTab, resolveTabForContents);
  registerMarkdownIpc(resolveTabManagerForEvent, resolveTabManagerForTab);
  registerWindowIpc();
  registerThemeIpc();
  registerAdBlockIpc(adBlocker);
  registerAccentColorIpc(() => {
    highlighterController.broadcastColor((tabId) => sharedRegistry.mountOwners.get(tabId)?.isHighlighterActive() ?? false);
    commentController.broadcastColor((tabId) => sharedRegistry.mountOwners.get(tabId)?.isCommentToolActive() ?? false);
    textBoxController.broadcastColor((tabId) => sharedRegistry.mountOwners.get(tabId)?.isTextToolActive() ?? false);
    penController.broadcastColor((tabId) => sharedRegistry.mountOwners.get(tabId)?.isPenActive() ?? false);
  });
  registerTearOffIpc();
  registerOpenWorkspaceInNewWindowIpc();
  buildMenu(
    () => activeTabManager,
    () => activeTabManager?.getState().activeTabId ?? null,
    // A new workspace (and its fresh home tab) rather than the restored
    // session `launchWindow`'s default `onReady` gives the ordinary
    // launch path — this window is meant to start empty, not replay
    // whatever was already open elsewhere.
    () => launchWindow((tabManager) => tabManager.createWorkspace()),
    () => openWorkspaceInNewWindow(activeTabManager),
    adBlocker,
  );

  launchWindow();
  // A little after startup, so it doesn't compete with the first window's load.
  setTimeout(prepareSpareWindow, 3000);

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
 * behavior, back when only one window could ever exist). Only a window's
 * own chrome page resolves (`chromeWindowOf`); a tab's page is refused, so
 * it can't reach the chrome's channels. Throws rather than returning
 * `undefined` so every `registerTabIpc` handler's own try/catch turns this
 * into an ordinary `IpcResult` failure the same way it already handles any
 * other main-process error.
 * @param event An IPC event carrying the sending `webContents`.
 */
function resolveTabManagerForEvent(event: { sender: Electron.WebContents }): TabManager {
  const window = chromeWindowOf(event.sender);
  const manager = window ? tabManagersByWindowId.get(window.id) : undefined;
  if (!manager) {
    throw new Error('No window is open for this request');
  }
  return manager;
}

/**
 * Resolves the tab whose own page is `contents`, and a `TabManager` that
 * owns it — for the channels a tab's page sends about itself (Ctrl+wheel
 * zoom, a terminal's keystrokes, a PDF's marks), which must act on that
 * tab and no other.
 * @param contents The `event.sender` of the message.
 */
function resolveTabForContents(contents: Electron.WebContents): { tabId: string; manager: TabManager } | undefined {
  for (const [tabId, view] of sharedRegistry.views) {
    if (view.webContents === contents) {
      const manager = resolveTabManagerForTab(tabId);
      return manager ? { tabId, manager } : undefined;
    }
  }
  return undefined;
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
  options: { hidden?: boolean } = {},
): BrowserWindow {
  const window = createMainWindow(adBlocker, { showWhenReady: !options.hidden });
  if (position) {
    window.setPosition(Math.round(position.x), Math.round(position.y));
  }
  const tabManager = new TabManager(
    window,
    (state) => {
      if (!window.isDestroyed()) {
        window.webContents.send(IpcChannel.TabsStateChanged, state);
      }
    },
    bookmarkStore,
    sessionStore,
    sharedRegistry,
    sharedTerminalManager,
    highlighterController,
    commentController,
    penController,
    textBoxController,
    historyController,
    adBlocker,
    workspaceImageStore,
  );

  tabManagersByWindowId.set(window.id, tabManager);

  window.on('focus', () => {
    activeTabManager = tabManager;
  });
  // A hidden spare window must not become "the" active window: the menu
  // accelerators (Ctrl+W, Ctrl+Alt+W, ...) act on `activeTabManager`, and the
  // user's own window — already focused, so it fires no new `focus` event —
  // would never take it back, leaving every shortcut aimed at an empty window.
  if (!options.hidden) {
    activeTabManager = tabManager;
  }

  window.on('resize', () => tabManager.updateBounds());
  window.on('closed', () => {
    tabManager.dispose();
    tabManagersByWindowId.delete(window.id);
    // `SessionStore.scheduleSave` debounces its actual disk write — flush
    // it immediately here rather than let a just-scheduled write get cut
    // off by the process exiting before its timer fires.
    sessionStore.flush();
    closeSpareWindowIfAlone();
  });
  window.webContents.once('did-finish-load', () => onReady(tabManager));

  // Drives WindowControls' maximize/restore icon — the frameless window has
  // no native titlebar to show that state itself (see MainWindow.ts).
  new GripHoverWatcher(window);
  window.on('maximize', () => window.webContents.send(IpcChannel.WindowStateChanged, { isMaximized: true }));
  window.on('unmaximize', () => window.webContents.send(IpcChannel.WindowStateChanged, { isMaximized: false }));
  return window;
}

/** Offset that keeps the cursor on a torn-off window's tab strip, as in Chrome. */
const TEAR_OFF_GRAB_OFFSET = { x: 150, y: 20 };
/** Safety cap so a lost end-of-drag message can't leave a window chasing the cursor forever. */
const TEAR_OFF_FOLLOW_MAX_MS = 60_000;
/** Where a source window is parked, out of every other window's way, while it hovers a drop target. */
const PARKED_WINDOW_POSITION = -30_000;

/** How long after a drag ends to wait before checking whether the tab really moved — the target window's drop handler reports over its own IPC channel, which can land just after this one. */
const TEAR_OFF_SETTLE_MS = 150;

/**
 * A live tear-off in progress, for the length of one drag. The torn-off
 * window chases the cursor, but only while the cursor is somewhere a tab
 * *can't* be dropped: over another window's tab strip or sidebar it's
 * hidden (so the drag reaches that window's own drop handlers) and shown
 * again when the cursor leaves. It is only destroyed once the drag ends
 * with the tab dropped somewhere — never mid-drag.
 */
interface LiveTearOff {
  window: BrowserWindow | null;
  readonly tabId: string;
  /** The standalone workspace the tab was given for the move; removed once the tab is dropped elsewhere. */
  readonly workspaceId: string;
  readonly manager: TabManager;
  /**
   * True when the tab's own (source) window is the one being dragged —
   * the tab was its window's only tab, so there's nothing to leave behind
   * and no new window to spawn. It's parked off-screen rather than hidden
   * while over a drop target, since hiding the window an OS drag started
   * from risks cancelling that drag.
   */
  readonly movesSourceWindow: boolean;
  readonly stop: () => void;
}
let liveTearOff: LiveTearOff | null = null;

/**
 * A fully loaded, hidden chrome window kept ready so a torn-off tab gets a
 * window the instant it's dragged out. Creating one from scratch means
 * loading the whole chrome page (hundreds of ms), which is far too slow
 * for a window that has to appear under the cursor mid-drag.
 */
interface SpareWindow {
  readonly window: BrowserWindow;
  readonly manager: TabManager;
  loaded: boolean;
}
let spareWindow: SpareWindow | null = null;

/** Creates the hidden spare window, if there isn't one. */
function prepareSpareWindow(): void {
  if (spareWindow && !spareWindow.window.isDestroyed()) {
    return;
  }
  // Nothing left to tear a tab out of (app is quitting).
  if (BrowserWindow.getAllWindows().length === 0) {
    return;
  }
  const window = launchWindow(
    () => {
      if (spareWindow?.window === window) {
        spareWindow.loaded = true;
      }
    },
    undefined,
    { hidden: true },
  );
  const manager = tabManagersByWindowId.get(window.id);
  if (!manager) {
    return;
  }
  spareWindow = { window, manager, loaded: false };
  window.once('closed', () => {
    if (spareWindow?.window === window) {
      spareWindow = null;
    }
  });
}

/**
 * Destroys the hidden spare once it's the only window left — otherwise it
 * alone would keep the app running after the last real window closes.
 */
function closeSpareWindowIfAlone(): void {
  const spare = spareWindow;
  if (!spare || spare.window.isDestroyed()) {
    return;
  }
  const others = BrowserWindow.getAllWindows().filter((window) => window !== spare.window && !window.isDestroyed());
  if (others.length === 0) {
    spareWindow = null;
    spare.window.destroy();
  }
}

/**
 * Opens a window onto an existing tab at `position` — the spare if it's
 * ready (instant), otherwise a freshly created one.
 */
function openWindowOnTab(tabId: string, position: { x: number; y: number }): BrowserWindow {
  const spare = spareWindow;
  if (spare?.loaded && !spare.window.isDestroyed()) {
    spareWindow = null;
    spare.window.setPosition(Math.round(position.x), Math.round(position.y));
    spare.manager.activateTab(tabId);
    activeTabManager = spare.manager;
    spare.window.show();
    setTimeout(prepareSpareWindow, 500);
    return spare.window;
  }
  const window = launchWindow((tabManager) => tabManager.activateTab(tabId), position);
  setTimeout(prepareSpareWindow, 1500);
  return window;
}

/** Opens the torn-off window onto the tab at (just under) the cursor, if it isn't already. */
function spawnTearOffWindow(current: LiveTearOff, cursor: { x: number; y: number }): void {
  if (current.window && !current.window.isDestroyed()) {
    return;
  }
  const tabId = current.tabId;
  current.window = openWindowOnTab(tabId, {
    x: cursor.x - TEAR_OFF_GRAB_OFFSET.x,
    y: cursor.y - TEAR_OFF_GRAB_OFFSET.y,
  });
}

/**
 * Starts a live tear-off for a tab that was just given its scratch
 * workspace and window. The OS drag in progress owns the mouse, so the
 * window can't be dragged natively — it's repositioned by polling the
 * cursor instead.
 */
function followCursor(
  window: BrowserWindow,
  tabId: string,
  workspaceId: string,
  manager: TabManager,
  movesSourceWindow = false,
): void {
  liveTearOff?.stop();
  const started = Date.now();
  const timer = setInterval(() => {
    if (Date.now() - started > TEAR_OFF_FOLLOW_MAX_MS) {
      finishLiveTearOff(tabId);
      return;
    }
    const cursor = screen.getCursorScreenPoint();
    const tornWindow = current.window && !current.window.isDestroyed() ? current.window : null;
    const overDropTarget = Array.from(tabManagersByWindowId.entries()).some(
      ([windowId, other]) => windowId !== tornWindow?.id && other.isOverTabDropRegion(cursor.x, cursor.y),
    );
    if (!tornWindow) {
      spawnTearOffWindow(current, cursor);
    } else if (overDropTarget) {
      if (movesSourceWindow) {
        tornWindow.setPosition(PARKED_WINDOW_POSITION, PARKED_WINDOW_POSITION);
      } else if (tornWindow.isVisible()) {
        tornWindow.hide();
      }
    } else {
      tornWindow.setPosition(cursor.x - TEAR_OFF_GRAB_OFFSET.x, cursor.y - TEAR_OFF_GRAB_OFFSET.y);
      if (!tornWindow.isVisible()) {
        tornWindow.showInactive();
      }
    }
  }, 8);
  const stop = (): void => {
    clearInterval(timer);
    if (liveTearOff === current) {
      liveTearOff = null;
    }
  };
  const current: LiveTearOff = { window, tabId, workspaceId, manager, movesSourceWindow, stop };
  liveTearOff = current;
}

/**
 * Finishes a live tear-off when the drag is released (reported by the
 * dragged tab's own `dragend`, or by whichever window received the drop —
 * whichever arrives first wins). Judged by where the tab actually ended up:
 * if it left its scratch workspace it was dropped somewhere, so the
 * torn-off window (if one is up) is discarded along with the scratch
 * workspace; if not, the tab stays in a window — recreated at the cursor if
 * the release happened while it was closed. Checked a few times because
 * the target window reports its drop on its own IPC channel, which can
 * land just after this call.
 */
function finishLiveTearOff(tabId: string): void {
  const current = liveTearOff;
  if (!current || current.tabId !== tabId) {
    return;
  }
  current.stop();
  const settle = (attemptsLeft: number): void => {
    if (current.manager.getTabWorkspaceId(tabId) !== current.workspaceId) {
      // The tab went elsewhere, so the (hidden) torn-off window is empty.
      // Its workspace is usually already gone (`discardWorkspaceIfEmpty`);
      // this covers the case where it isn't.
      current.manager.removeWorkspace(current.workspaceId);
      if (current.window && !current.window.isDestroyed()) {
        current.window.close();
      }
      return;
    }
    if (attemptsLeft > 0) {
      setTimeout(() => settle(attemptsLeft - 1), TEAR_OFF_SETTLE_MS * 2);
      return;
    }
    // Nothing took the tab: it stays in its own window, wherever the drag ended.
    if (current.movesSourceWindow) {
      current.manager.setSuppressWorkspaceFallback(false);
      const cursor = screen.getCursorScreenPoint();
      current.window?.setPosition(cursor.x - TEAR_OFF_GRAB_OFFSET.x, cursor.y - TEAR_OFF_GRAB_OFFSET.y);
    } else if (current.window && !current.window.isDestroyed()) {
      current.window.show();
    } else {
      spawnTearOffWindow(current, screen.getCursorScreenPoint());
    }
  };
  setTimeout(() => settle(2), TEAR_OFF_SETTLE_MS);
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
    const sourceWindow = chromeWindowOf(event.sender);
    const sourceManager = sourceWindow ? tabManagersByWindowId.get(sourceWindow.id) : undefined;
    if (!sourceWindow || !sourceManager) {
      return;
    }

    const { id, screenX, screenY, live } = parsed.data;
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
    if (!droppedOutsideWindow && !live) {
      return;
    }

    // A window's only tab dragged out moves the window itself (as in Chrome)
    // instead of leaving an empty window behind and spawning another.
    if (live && sourceManager.isOnlyTabInItsWorkspace(id)) {
      const ownWorkspaceId = sourceManager.getTabWorkspaceId(id);
      if (ownWorkspaceId) {
        sourceManager.setSuppressWorkspaceFallback(true);
        followCursor(sourceWindow, id, ownWorkspaceId, sourceManager, true);
        return;
      }
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

    // Mounts the tab's own already-existing view into the new window — its
    // live page, navigation history, everything, survives the move intact.
    const newWindow = openWindowOnTab(id, {
      x: screenX - TEAR_OFF_GRAB_OFFSET.x,
      y: screenY - TEAR_OFF_GRAB_OFFSET.y,
    });
    if (live) {
      followCursor(newWindow, id, newWorkspaceId, sourceManager);
    }
  });
  ipcMain.on(IpcChannel.TabsDropRegions, (event, rawRequest: unknown) => {
    const parsed = dropRegionsRequestSchema.safeParse(rawRequest);
    const sender = chromeWindowOf(event.sender);
    if (parsed.success && sender) {
      tabManagersByWindowId.get(sender.id)?.setDropRegions(parsed.data.rects);
    }
  });
  ipcMain.on(IpcChannel.TabsTearOffEnd, (event, rawRequest: unknown) => {
    const parsed = tearOffTabEndRequestSchema.safeParse(rawRequest);
    if (parsed.success && chromeWindowOf(event.sender)) {
      finishLiveTearOff(parsed.data.id);
    }
  });
}

/**
 * Opens a brand-new window onto a window's active tab — the actual work
 * behind `NorthstarApi.openWorkspaceInNewWindow` (via
 * `registerOpenWorkspaceInNewWindowIpc`, below) and the "Open Workspace in
 * New Window" menu accelerator (`buildMenu`'s own callback), which need the
 * same thing done from two different starting points: a specific window
 * (resolved from the IPC sender) versus whichever window is currently
 * frontmost (`activeTabManager`, the same resolution `getActiveTabId`
 * already uses for other menu actions). See
 * `TabManager.createLinkedTwin`'s own doc comment for what actually gets
 * created (an independent, navigation-linked twin of the active tab, in the
 * same shared workspace) and why — `sourceManager`'s own active tab,
 * workspace, and every other tab are left completely untouched either way.
 * A no-op if `sourceManager` is `null`, has no active tab, or that tab isn't
 * a browser tab (a terminal has no URL for a twin to share).
 * @param sourceManager The window whose active tab to open a linked twin of.
 */
function openWorkspaceInNewWindow(sourceManager: TabManager | null): void {
  const activeTabId = sourceManager?.getState().activeTabId;
  if (!sourceManager || !activeTabId) {
    return;
  }
  const twinId = sourceManager.createLinkedTwin(activeTabId);
  if (!twinId) {
    return;
  }
  launchWindow((tabManager) => tabManager.activateTab(twinId));
}

/**
 * Registers the renderer-facing half of `openWorkspaceInNewWindow` — see its
 * own doc comment. Fire-and-forget, like `registerTearOffIpc`'s channel: the
 * only meaningful result is a brand new window appearing — unlike
 * `tearOffTab`, the sending window's own state never changes, so there's no
 * `onStateChanged` push to wait for on this side either.
 */
function registerOpenWorkspaceInNewWindowIpc(): void {
  ipcMain.on(IpcChannel.WorkspaceOpenInNewWindow, (event) => {
    const sourceWindow = chromeWindowOf(event.sender);
    const sourceManager = sourceWindow ? tabManagersByWindowId.get(sourceWindow.id) : undefined;
    openWorkspaceInNewWindow(sourceManager ?? null);
  });
}
