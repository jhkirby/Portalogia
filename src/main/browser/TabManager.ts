// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-05

import { createHash, randomUUID } from 'node:crypto';
import { readFile, rename, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { app, BrowserWindow, WebContentsView, dialog, screen, type WebContents } from 'electron';
import {
  CHROME_HEIGHT_FOCUSED_PX,
  CHROME_HEIGHT_PX,
  MAX_TABS_PER_WORKSPACE,
  MAX_WORKSPACES,
  TAB_STRIP_HEIGHT_PX,
  DEFAULT_TAB_URL,
  DEFAULT_WORKSPACE_ID,
  DEFAULT_WORKSPACE_NAME,
  HOME_URL,
  SIDEBAR_COLLAPSED_WIDTH_PX,
  SIDEBAR_TOGGLE_DURATION_MS,
  SIDEBAR_WIDTH_PX,
  TERMINAL_PREPARE_PRINT_GLOBAL,
  WORKSPACE_COLORS,
  ZOOM_PERCENT_DEFAULT,
  ZOOM_PERCENT_MAX,
  ZOOM_PERCENT_MIN,
  ZOOM_PERCENT_WHEEL_STEP,
} from '@shared/constants';
import { escapeHtml } from '@shared/html';
import {
  IpcChannel,
  type AddressSuggestionsSyncPayload,
  type ColorPickerSyncPayload,
  type ExportMenuAction,
  type ExportMenuSyncPayload,
  type HistoryClearRange,
  type HistoryEntry,
  type HistorySuggestion,
  type PdfOpenResult,
  type TooltipSyncPayload,
} from '@shared/ipc-contract';
import { isNavigableUrl, normalizeUrlOrSearch } from '@shared/url';
import type { BrowserState, BrowserTabState, SplitViewState, TabState, WorkspaceState } from '@shared/tab-state';
import { pdfAnnotationStore } from './PdfAnnotationStore';
import { PdfCropExporter } from './PdfCropExporter';
import type { BookmarkStore } from './BookmarkStore';
import type { CommentController } from './CommentController';
import type { TextBoxController } from './TextBoxController';
import type { HistoryController } from './HistoryController';
import { ColorPickerOverlay } from './ColorPickerOverlay';
import { ExportMenuOverlay } from './ExportMenuOverlay';
import type { HighlighterController } from './HighlighterController';
import { LaserPointerOverlay } from './LaserPointerOverlay';
import { PageDocumentExporter } from './PageDocumentExporter';
import type { PenController } from './PenController';
import { getCurrentAccent, trackPageSelectionAccent } from './pageSelectionAccent';
import type { SessionSnapshot, SessionStore } from './SessionStore';
import type { SharedTabRegistry } from './SharedTabRegistry';
import { SuggestionsOverlay } from './SuggestionsOverlay';
import { TooltipOverlay } from './TooltipOverlay';
import type { TerminalManager } from '../terminal/TerminalManager';

interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** A closed tab's minimal recreatable state — enough to reopen it, not to replay its full history. */
interface ClosedTab {
  readonly url: string;
  readonly workspaceId: string;
}

/** How many closed tabs `restoreLastClosedTab` can reach back through. */
const CLOSED_TAB_HISTORY_LIMIT = 20;

/**
 * How long to wait for another Space auto-repeat before treating it as
 * released — see `armSpaceHoldTimeout`. Comfortably longer than even a
 * slow OS key-repeat interval, so it never fires while Space is still
 * actually held.
 */
const SPACE_HOLD_GRACE_MS = 600;

/**
 * Absolute ceiling on a single keyboard-grab, regardless of any repeat or
 * key-up signal — a last-resort net under `armSpaceHoldTimeout` and the
 * Control-release path, in case both somehow miss (e.g. focus lost to
 * something that swallows input entirely). No legitimate reorder needs
 * anywhere near this long.
 */
const GRAB_MAX_DURATION_MS = 15_000;

/** How many percentage points `zoomIn`/`zoomOut` (buttons, Ctrl+=/-, menu) move per press — `ZOOM_PERCENT_MIN`/`MAX`/`DEFAULT` themselves live in `@shared/constants`, shared with the renderer's `ZoomPercentInput`. */
const ZOOM_PERCENT_STEP = 10;

/** Largest PDF `openPdfFile` will read into memory and push over IPC. */
const MAX_PDF_BYTES = 512 * 1024 * 1024;

/** True while `moveTabToWorkspace` is relocating the rest of a linked group, so those nested calls don't expand the group again. */
let relocatingLinkGroup = false;

/** On-disk path of the file each PDF tab has open, by tab id. Module-level so it survives a tab moving between windows' managers. */
const pdfFilePaths = new Map<string, string>();

/**
 * Owns every tab's `WebContentsView`, keeps a `TabState` snapshot per tab,
 * groups tabs into workspaces, and positions the on-screen view(s) beneath
 * the chrome (one full-width view normally, or two side by side in split
 * view). This is the only place in the app that touches tab `WebContents`
 * directly — the IPC layer and the menu both go through this class instead
 * of reaching into Electron themselves.
 *
 * Invariant kept throughout: whichever tab is `activeTabId` always has its
 * view mounted (full width normally, the left/primary half during split
 * view) — split view only ever adds a second, "secondary" view alongside
 * it, never replaces the active-tab invariant.
 */
export class TabManager {
  // Aliases onto `SharedTabRegistry`'s own maps (see its class doc comment)
  // rather than each window's own copy — every existing method below that
  // reads/writes `this.views`/`this.states`/`this.workspaces` keeps working
  // completely unchanged, now operating on data every window shares.
  private readonly views: Map<string, WebContentsView>;
  private readonly states: Map<string, TabState>;
  private readonly workspaces: Map<string, WorkspaceState>;
  private readonly lastActiveTabIdByWorkspace = new Map<string, string>();
  private readonly closedTabs: ClosedTab[] = [];
  /** The search text each History tab's table is filtered by — typed in the chrome's toolbar, so kept here to hand to a page that loads after it was typed. */
  private readonly historyQueries = new Map<string, string>();
  private activeTabId: string | null = null;
  private activeWorkspaceId: string;
  private splitView: SplitViewState | null = null;
  private focusMode = false;
  private sidebarVisible = true;
  private laserPointerActive = false;
  /** While true, `handleWorkspaceRemoved` doesn't mount a fallback tab — set on a window that's being dragged around as a whole and may be closed on release. */
  private suppressWorkspaceFallback = false;
  /** Tabs multi-selected (Ctrl/Shift+click), active tab included. Read through `currentTabSelection`, which prunes stale entries. */
  private selectedTabIds = new Set<string>();
  /** Workspaces multi-selected (Ctrl/Shift+click), active one included. Read through `currentWorkspaceSelection`. */
  private selectedWorkspaceIds = new Set<string>();
  private dropRegions: readonly { x: number; y: number; width: number; height: number }[] = [];
  private highlighterActive = false;
  private commentToolActive = false;
  private textToolActive = false;
  private penActive = false;
  private cropActive = false;
  /** The tab grabbed for keyboard reordering (Ctrl+Space held); see `grabTabForReorder`. */
  private grabbedTabId: string | null = null;
  /** Armed while a tab is grabbed; see `armSpaceHoldTimeout`. */
  private spaceHoldTimeout: ReturnType<typeof setTimeout> | null = null;
  /** Set once per grab, never reset by repeats; see `GRAB_MAX_DURATION_MS`. */
  private grabMaxDurationTimeout: ReturnType<typeof setTimeout> | null = null;
  /** Bumped on every `toggleSidebar`/`setFocusMode` call so an in-flight bounds animation can tell it's been superseded and stop early. */
  private boundsAnimationToken = 0;
  /** Set for the duration of an in-flight bounds animation (see `animateBoundsInset`) — lets `updateBounds` defer to the animation's own frames instead of fighting them with a one-off instant jump, e.g. from the native 'resize' event `setFullScreen` fires when Focus Mode toggles. */
  private isAnimatingBounds = false;
  private readonly terminals: TerminalManager;
  private readonly suggestionsOverlay: SuggestionsOverlay;
  private readonly tooltipOverlay: TooltipOverlay;
  private readonly colorPickerOverlay: ColorPickerOverlay;
  private readonly exportMenuOverlay: ExportMenuOverlay;
  private readonly laserPointerOverlay: LaserPointerOverlay;
  /** Unregisters this window from `registry` — call once, when the window closes (see `dispose`). */
  private readonly unregisterFromRegistry: () => void;

  /**
   * @param window The window whose `contentView` hosts each tab's view.
   * @param onStateChange Called with the full state after any change, so
   *   the caller can push it to the renderer over IPC.
   * @param bookmarkStore Persisted bookmark list this window's chrome reads and writes.
   * @param sessionStore Persisted tabs/workspaces this window's chrome
   *   restores from on launch (see `restoreSession`) and keeps up to date
   *   on every change (see `emitState`).
   * @param registry The tabs/workspaces/views every open window shares —
   *   see its own class doc comment. Not scoped to this window at all;
   *   `main/index.ts` constructs exactly one and passes the same instance
   *   to every `TabManager`.
   * @param terminals Every open terminal tab's own pty process — like
   *   `registry`, one shared instance passed to every `TabManager` rather
   *   than each owning its own, since a terminal tab (and the shell
   *   process behind it) can now move between windows the same as a
   *   browser tab can.
   * @param highlighter Every browser tab's highlights, undo/redo stack, and
   *   on-disk persistence — shared the same way `registry`/`terminals` are,
   *   for the same reason (a tab's highlights move with it between
   *   windows). This `TabManager` only owns the per-window on/off toggle;
   *   see `HighlighterController`'s own class doc comment.
   * @param commentController Every browser tab's dropped comments and
   *   on-disk persistence, shared the same way `highlighter` is and for the
   *   same reason. This `TabManager` only owns the per-window on/off toggle;
   *   see `CommentController`'s own class doc comment.
   * @param penController Every browser tab's freehand pen strokes,
   *   undo/redo stack, and on-disk persistence, shared the same way
   *   `highlighter` is and for the same reason. This `TabManager` only owns
   *   the per-window on/off toggle; see `PenController`'s own class doc
   *   comment.
   * @param textBoxController Every browser tab's text boxes and on-disk
   *   persistence, shared the same way `commentController` is. This
   *   `TabManager` only owns the per-window on/off toggle; see
   *   `TextBoxController`'s own class doc comment.
   * @param historyController The browsing history — recording, serving and
   *   clearing it — shared the same way, since a History tab can move
   *   between windows. See `HistoryController`'s own class doc comment.
   */
  public constructor(
    private readonly window: BrowserWindow,
    private readonly onStateChange: (state: BrowserState) => void,
    private readonly bookmarkStore: BookmarkStore,
    private readonly sessionStore: SessionStore,
    private readonly registry: SharedTabRegistry,
    terminals: TerminalManager,
    private readonly highlighter: HighlighterController,
    private readonly commentController: CommentController,
    private readonly penController: PenController,
    private readonly textBoxController: TextBoxController,
    private readonly historyController: HistoryController,
  ) {
    this.views = registry.views;
    this.states = registry.states;
    this.workspaces = registry.workspaces;
    this.terminals = terminals;

    // Only seed the default workspace the very first time — every
    // `TabManager` after the first constructs against a `registry` that
    // already has one (and possibly already renamed/recolored by the
    // user), which a second unconditional `.set()` here would silently
    // stomp back to its defaults.
    if (this.workspaces.size === 0) {
      this.workspaces.set(DEFAULT_WORKSPACE_ID, {
        id: DEFAULT_WORKSPACE_ID,
        name: DEFAULT_WORKSPACE_NAME,
        color: WORKSPACE_COLORS[0],
      });
    }
    // A transient default — whatever `main/index.ts` passes as this
    // window's `onReady` (`restoreSession`, or `tearOffTab`'s own
    // `activateTab` callback) always immediately sets this to the
    // correct value before the window is ever shown.
    this.activeWorkspaceId = DEFAULT_WORKSPACE_ID;

    this.unregisterFromRegistry = registry.registerWindow(window, () => {
      // A window mid-close is still registered until its `closed` event.
      if (window.isDestroyed()) {
        return;
      }
      this.onStateChange(this.getState());
      // A hidden window (the spare, or a torn-off one mid-drag) has no active
      // tab of its own worth recording — its snapshot would clobber the real one.
      if (window.isVisible()) {
        this.sessionStore.scheduleSave(this.buildSessionSnapshot());
      }
    }, (workspaceId) => this.handleWorkspaceRemoved(workspaceId), () => this.currentTabSelection());

    this.suggestionsOverlay = new SuggestionsOverlay(
      this.window,
      // A row clicked in the overlay's own view only makes sense to
      // whichever chrome renderer synced the list it's an index into — the
      // chrome window's own webContents, same target `requestFocusAddressBar`
      // and friends already push to.
      (index) => this.window.webContents.send(IpcChannel.AddressSuggestionsSelect, index),
    );
    this.tooltipOverlay = new TooltipOverlay(this.window);
    this.colorPickerOverlay = new ColorPickerOverlay(
      this.window,
      (payload) => this.window.webContents.send(IpcChannel.ColorPickerColorChanged, payload),
      () => this.window.webContents.send(IpcChannel.ColorPickerCloseRequested),
    );
    this.exportMenuOverlay = new ExportMenuOverlay(
      this.window,
      (action) => this.runExportAction(action),
      () => this.window.webContents.send(IpcChannel.ExportMenuCloseRequested),
    );
    this.laserPointerOverlay = new LaserPointerOverlay(
      this.window,
      () => this.exitPointerTools(),
      (wheel) => {
        if (this.activeTabId === null) {
          return;
        }
        // `sendInputEvent`'s wheel deltas use the opposite sign to the DOM's
        // `deltaY` (positive = content moves down, i.e. scroll up).
        this.views.get(this.activeTabId)?.webContents.sendInputEvent({
          type: 'mouseWheel',
          x: Math.round(wheel.x),
          y: Math.round(wheel.y),
          deltaX: -wheel.deltaX,
          deltaY: -wheel.deltaY,
        });
      },
    );

    // The Ctrl+Space reorder gesture also needs to work when OS keyboard
    // focus is on the chrome itself rather than a tab's own webContents
    // (e.g. right after a mouse drag-and-drop of a tab, or a click on a
    // workspace pill) — every other per-tab shortcut's fallback for that
    // case is a menu accelerator, which this stateful, held-key gesture
    // can't be expressed as (see `handleReorderGestureInput`).
    //
    // Ctrl+` rides along here too, for the reverse direction of
    // `wireSharedInputHandling`'s own Ctrl+`: that one moves focus *out*
    // of a terminal tab into the chrome; this one moves it back *in*,
    // whenever the chrome has OS focus and the active tab happens to be a
    // terminal. Not a menu accelerator for the same reason the reorder
    // gesture isn't — it needs to check the active tab's kind, which a
    // static accelerator can't express.
    this.window.webContents.on('before-input-event', (event, input) => {
      if (this.handleReorderGestureInput(event, input)) {
        return;
      }
      if (
        input.type === 'keyDown' &&
        !input.isAutoRepeat &&
        (input.control || input.meta) &&
        !input.alt &&
        !input.shift &&
        input.key.toLowerCase() === '`'
      ) {
        event.preventDefault();
        this.focusActiveTerminal();
      }
    });
  }

  /**
   * Whether this `TabManager` owns a tab with this id — used to resolve a
   * cross-window tab drag's *source* window (main/index.ts's
   * `registerCrossWindowTabMoveIpc`): the window a drop lands in only
   * knows the dragged tab's id, not which window (itself or another one)
   * currently owns it.
   */
  public hasTab(id: string): boolean {
    return this.states.has(id);
  }

  // ── Session restore ──────────────────────────────────────────────────

  /**
   * Recreates whatever tabs/workspaces were open when the app last closed
   * (see `SessionStore`), or opens a single fresh home tab if there's no
   * saved session yet (first launch) or it was empty. Call this once,
   * right after the chrome page itself finishes loading.
   *
   * Each tab is recreated via `createTab`/`createTerminalTab` rather than
   * restored in place — a terminal's actual shell process is long gone by
   * the next launch regardless, and a browser tab's own navigation history
   * was never persisted either (`SessionSnapshot` only keeps its current
   * URL, same as `ClosedTab` does for "reopen last closed tab") — so this
   * is a fresh tab that happens to load the same page, not a resurrection
   * of the old one. Both creators call `activateTab` internally, which
   * would otherwise leave whichever tab was created last active; the
   * explicit `activateTab`/`switchWorkspace` call at the end corrects that
   * to whichever tab/workspace the snapshot actually says was active.
   * @returns The full browser state after restoring (or starting fresh).
   */
  public restoreSession(): BrowserState {
    const snapshot = this.sessionStore.get();
    if (!snapshot || snapshot.tabs.length === 0) {
      return this.createTab();
    }

    this.workspaces.clear();
    for (const workspace of snapshot.workspaces) {
      this.workspaces.set(workspace.id, workspace);
    }
    if (this.workspaces.size === 0) {
      // Every tab below needs a workspace to land in — falls back to the
      // same single default workspace a first launch gets.
      this.workspaces.set(DEFAULT_WORKSPACE_ID, {
        id: DEFAULT_WORKSPACE_ID,
        name: DEFAULT_WORKSPACE_NAME,
        color: WORKSPACE_COLORS[0]!,
      });
    }

    let activeId: string | null = null;
    for (const tab of snapshot.tabs) {
      const workspaceId = this.workspaces.has(tab.workspaceId)
        ? tab.workspaceId
        : (this.workspaces.keys().next().value as string);
      const state =
        tab.kind === 'terminal'
          ? this.createTerminalTab(workspaceId)
          : tab.kind === 'pdf'
            ? this.createPdfTab(workspaceId)
            : tab.kind === 'history'
              ? this.createHistoryTab(workspaceId)
              : this.createTab(isNavigableUrl(tab.url) ? tab.url : undefined, workspaceId);
      if (tab.active) {
        activeId = state.activeTabId;
      }
    }

    if (activeId) {
      this.activateTab(activeId);
    } else {
      this.switchWorkspace(snapshot.activeWorkspaceId);
    }

    return this.getState();
  }

  // ── Tabs ─────────────────────────────────────────────────────────────

  /**
   * Whether a workspace already holds `MAX_TABS_PER_WORKSPACE` tabs. A tab
   * shown from several windows (a link group) counts once.
   * @param workspaceId The workspace to check.
   * @param excludingTabId A tab (and its link group) to leave out of the
   *   count — for a tab that's about to move *into* this workspace, so it
   *   (or a sibling already moved) doesn't count against itself.
   */
  private isWorkspaceFull(workspaceId: string, excludingTabId?: string): boolean {
    const keyOf = (tabId: string): string => this.registry.getLinkGroup(tabId)?.[0] ?? tabId;
    const excludedKey = excludingTabId === undefined ? null : keyOf(excludingTabId);
    const keys = new Set<string>();
    for (const [tabId, state] of this.states) {
      if (state.workspaceId === workspaceId && keyOf(tabId) !== excludedKey) {
        keys.add(keyOf(tabId));
      }
    }
    return keys.size >= MAX_TABS_PER_WORKSPACE;
  }

  /**
   * Creates a browser tab's view/state/wiring and starts it loading, without
   * activating (mounting) it anywhere — the shared half of `createTab`
   * (which activates it in this window right after) and `createLinkedTwin`
   * (which deliberately doesn't, so a twin meant for a *different* window
   * never disrupts this one's currently active tab, even for a moment).
   * @param url Address to load; defaults to `DEFAULT_TAB_URL` when omitted.
   * @param workspaceId Workspace the new tab belongs to.
   * @returns The new tab's id.
   */
  private createBrowserTabState(url: string | undefined, workspaceId: string): string {
    const id = randomUUID();
    const view = new WebContentsView({
      webPreferences: {
        // Exposes nothing to the page itself (no `contextBridge` call in
        // it at all) — its only job is applying a main-process-pushed
        // zoom level to this specific view. See `applyZoom`'s own comment
        // for why that has to go through a preload rather than
        // `contents.zoomLevel` set directly from here.
        preload: join(__dirname, '../preload/tabZoom.cjs'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
        experimentalFeatures: false,
      },
    });

    this.views.set(id, view);
    this.states.set(id, {
      kind: 'browser',
      id,
      title: 'New Tab',
      url: DEFAULT_TAB_URL,
      isLoading: true,
      canGoBack: false,
      canGoForward: false,
      favicon: null,
      workspaceId,
    });

    this.wireEvents(id, view);

    const target = normalizeUrlOrSearch(url ?? DEFAULT_TAB_URL);
    void view.webContents.loadURL(target).catch(() => {
      // Load failures surface to the UI via the 'did-fail-load' listener
      // wired in wireEvents; the rejection itself carries nothing new.
    });

    return id;
  }

  /**
   * Creates a new tab, loads it, and makes it the active tab.
   * @param url Address to load; defaults to `DEFAULT_TAB_URL` when omitted.
   * @param workspaceId Workspace to create it in; defaults to the active
   *   workspace. Callers that pass this explicitly always do so with the
   *   value already equal to `activeWorkspaceId` (see `switchWorkspace`),
   *   so the newly created tab is always the one about to become visible.
   * @returns The full browser state after the tab is created.
   */
  public createTab(url?: string, workspaceId?: string): BrowserState {
    if (this.isWorkspaceFull(workspaceId ?? this.activeWorkspaceId)) {
      return this.getState();
    }
    const id = this.createBrowserTabState(url, workspaceId ?? this.activeWorkspaceId);
    this.activateTab(id);
    return this.getState();
  }

  /**
   * Creates a new tab exactly like `createTab`, then focuses the address
   * bar — the "New Tab" action a person explicitly asks for (the + button,
   * Ctrl+N) implies they're about to type somewhere, so it should land
   * ready for that. Deliberately separate from `createTab` itself, which
   * is also used internally for tab restoration and closed-tab/workspace
   * fallbacks — cases where stealing focus into the address bar would be
   * surprising rather than helpful.
   * @param url Address to load; defaults to `DEFAULT_TAB_URL` when omitted.
   * @param workspaceId Workspace to create it in; defaults to the active workspace.
   * @returns The full browser state after the tab is created.
   */
  public createTabAndFocusAddressBar(url?: string, workspaceId?: string): BrowserState {
    if (this.isWorkspaceFull(workspaceId ?? this.activeWorkspaceId)) {
      return this.getState();
    }
    const state = this.createTab(url, workspaceId);
    this.focusAddressBarPastTabLoad(state.activeTabId);
    return state;
  }

  /**
   * Opens a new terminal tab (Ctrl+>, the toolbar button, or File > New
   * Terminal) and makes it active. Like `createTab`, it gets its own
   * `WebContentsView` — loading `terminal.html` (its own small bundle,
   * bridged by its own narrower preload, `src/preload/terminal.ts`)
   * instead of an arbitrary URL — so it gets exactly the same native
   * mount/focus handling `activateTab` already gives a browser tab, rather
   * than needing its own special case for either. Focus lands in the
   * terminal itself rather than the address bar — `Terminal.tsx` focuses
   * its own xterm instance as soon as it mounts, so no
   * `focusAddressBarPastTabLoad`-style handoff is needed here.
   *
   * The shell itself isn't spawned until this view's `did-finish-load`
   * fires, deliberately — spawning it any earlier risks the pty's first
   * output (worst case, the shell's very first prompt) arriving before
   * `terminal.html` has loaded and subscribed to it, which `webContents.send`
   * would then simply drop (Electron doesn't queue IPC for a not-yet-
   * listening page). A real shell taking its own OS-level time to spawn
   * and print that first prompt keeps this comfortably ahead of it.
   * @param workspaceId Workspace to create it in; defaults to the active workspace.
   * @returns The full browser state after the tab is created.
   */
  public createTerminalTab(workspaceId?: string): BrowserState {
    if (this.isWorkspaceFull(workspaceId ?? this.activeWorkspaceId)) {
      return this.getState();
    }
    const id = randomUUID();
    const view = new WebContentsView({
      webPreferences: {
        preload: join(__dirname, '../preload/terminal.cjs'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
        experimentalFeatures: false,
      },
    });

    // Trusted, app-owned content (unlike a browser tab's arbitrary page) —
    // it should never navigate away from itself or spawn a bare OS window,
    // same reasoning as the chrome window itself (see MainWindow.ts).
    view.webContents.on('will-navigate', (event) => event.preventDefault());
    view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    this.wireSharedInputHandling(id, view.webContents);
    view.webContents.once('did-finish-load', () => {
      // The tab could already have been closed again by the time this
      // fires (e.g. opened then immediately closed) — `states` no longer
      // having it is that signal, and spawning a shell for a tab that's
      // already gone would leak the process.
      if (this.states.has(id)) {
        this.terminals.create(id);
        // Same reasoning as `wireEvents`' `dom-ready` push for a browser
        // tab: `activateTab` (below) fires before this view has loaded
        // anything, so its own push lands before `terminal.html`'s preload
        // has registered a listener and is silently dropped. This is the
        // first point that page is guaranteed ready to receive it.
        this.pushHighlighterStateTo(id);
      }
    });

    this.views.set(id, view);
    this.states.set(id, {
      kind: 'terminal',
      id,
      title: 'Terminal',
      exited: false,
      workspaceId: workspaceId ?? this.activeWorkspaceId,
    });
    this.activateTab(id);

    const devServerUrl = process.env['ELECTRON_RENDERER_URL'];
    if (!app.isPackaged && devServerUrl) {
      void view.webContents.loadURL(`${devServerUrl}/terminal.html?id=${id}`);
    } else {
      void view.webContents.loadFile(join(__dirname, '../renderer/terminal.html'), { query: { id } });
    }

    return this.getState();
  }

  /**
   * Opens a new PDF viewer tab (the toolbar's PDF button) and makes it
   * active. Structured like `createTerminalTab`: its own `WebContentsView`
   * loading `pdf.html?id=` through its own narrow preload. No file is open
   * at first — the page offers an "Open PDF" button, which comes back
   * through `openPdfFile`. Input handling is the default (browser-tab)
   * shortcut flow: nothing in a PDF page needs raw keys the way a shell does.
   * @param workspaceId Workspace to create it in; defaults to the active workspace.
   * @returns The full browser state after the tab is created.
   */
  public createPdfTab(workspaceId?: string): BrowserState {
    if (this.isWorkspaceFull(workspaceId ?? this.activeWorkspaceId)) {
      return this.getState();
    }
    const id = randomUUID();
    const view = new WebContentsView({
      webPreferences: {
        preload: join(__dirname, '../preload/pdf.cjs'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
        experimentalFeatures: false,
      },
    });

    // Trusted, app-owned content — same reasoning as `createTerminalTab`.
    view.webContents.on('will-navigate', (event) => event.preventDefault());
    view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    this.wireSharedInputHandling(id, view.webContents);
    // A fresh document starts at 100%; re-send whatever zoom this tab holds
    // (a restored/torn-off tab may already have one).
    view.webContents.on('did-finish-load', () => {
      this.applyZoom(id);
      // A fresh document has a fresh preload that's never been told which
      // annotation tool (if any) is on — same reason as a browser tab's `dom-ready` push.
      this.pushPenStateTo(id);
      this.pushCommentToolStateTo(id);
      this.pushTextToolStateTo(id);
      this.pushHighlighterStateTo(id);
      this.pushCropStateTo(id);
      // An empty PDF page lists the bookmarked files; any that have since been moved or deleted are dropped first.
      void this.refreshPdfBookmarks();
    });

    this.views.set(id, view);
    this.states.set(id, {
      kind: 'pdf',
      id,
      title: 'PDF',
      fileName: null,
      filePath: null,
      page: 1,
      pageCount: 0,
      workspaceId: workspaceId ?? this.activeWorkspaceId,
    });
    this.activateTab(id);

    const devServerUrl = process.env['ELECTRON_RENDERER_URL'];
    if (!app.isPackaged && devServerUrl) {
      void view.webContents.loadURL(`${devServerUrl}/pdf.html?id=${id}`);
    } else {
      void view.webContents.loadFile(join(__dirname, '../renderer/pdf.html'), { query: { id } });
    }

    return this.getState();
  }

  /**
   * Opens a new History tab (the toolbar's history button, Ctrl+Shift+H, or
   * File > New History Tab) and makes it active. Structured like
   * `createPdfTab`: its own `WebContentsView` loading `history.html?id=`
   * through its own narrow preload, which only carries the history list in
   * and delete/clear requests out. Input handling is the default
   * (browser-tab) shortcut flow.
   * @param workspaceId Workspace to create it in; defaults to the active workspace.
   * @returns The full browser state after the tab is created.
   */
  public createHistoryTab(workspaceId?: string): BrowserState {
    if (this.isWorkspaceFull(workspaceId ?? this.activeWorkspaceId)) {
      return this.getState();
    }
    const id = randomUUID();
    const view = new WebContentsView({
      webPreferences: {
        preload: join(__dirname, '../preload/history.cjs'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
        experimentalFeatures: false,
      },
    });

    // Trusted, app-owned content — same reasoning as `createTerminalTab`.
    view.webContents.on('will-navigate', (event) => event.preventDefault());
    view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    this.wireSharedInputHandling(id, view.webContents);
    // A fresh page has never been sent the history or its search text. (It's never zoomed either: see `isZoomable`.)
    view.webContents.on('did-finish-load', () => {
      this.historyController.pushTo(id);
      view.webContents.send(IpcChannel.HistoryQuery, this.historyQueries.get(id) ?? '');
    });

    this.views.set(id, view);
    this.states.set(id, {
      kind: 'history',
      id,
      title: 'History',
      workspaceId: workspaceId ?? this.activeWorkspaceId,
    });
    this.activateTab(id);

    const devServerUrl = process.env['ELECTRON_RENDERER_URL'];
    if (!app.isPackaged && devServerUrl) {
      void view.webContents.loadURL(`${devServerUrl}/history.html?id=${id}`);
    } else {
      void view.webContents.loadFile(join(__dirname, '../renderer/history.html'), { query: { id } });
    }

    return this.getState();
  }

  /**
   * Sets the search text a History tab's table filters by. The box is in the
   * chrome's toolbar and the table in the tab's own page, so it travels
   * through here.
   * @param id The History tab. A no-op if it isn't one.
   * @param query The text to filter by; empty shows everything.
   * @returns The full browser state (unchanged).
   */
  public setHistoryQuery(id: string, query: string): BrowserState {
    if (this.states.get(id)?.kind === 'history') {
      this.historyQueries.set(id, query);
      const view = this.views.get(id);
      if (view && !view.webContents.isDestroyed()) {
        view.webContents.send(IpcChannel.HistoryQuery, query);
      }
    }
    return this.getState();
  }

  /** The most recent distinct pages or PDFs from the history matching a search — see `HistoryController.search`. */
  public searchHistory(type: HistoryEntry['type'], query: string): Promise<HistorySuggestion[]> {
    return this.historyController.search(type, query);
  }

  /**
   * Opens, in a PDF tab, a PDF the history has seen — picked from the PDF
   * search's dropdown. Only paths the history already holds are accepted, so
   * this can't be turned into a way to open an arbitrary file.
   * @param id The PDF tab.
   * @param path The file's path on disk.
   */
  public async openPdfFromHistory(id: string, path: string): Promise<void> {
    if (this.states.get(id)?.kind !== 'pdf' || !this.historyController.hasPdfAccess(path)) {
      return;
    }
    await this.loadPdfFromPath(id, path);
  }

  /**
   * Clears the browsing history within a range — the toolbar's "Clear History".
   * @param range The last N of a unit, or everything (already validated).
   * @returns The full browser state (unchanged; open History tabs are re-sent the list).
   */
  public clearHistory(range: HistoryClearRange): BrowserState {
    this.historyController.clear(range);
    return this.getState();
  }

  /**
   * Lets the user pick a PDF from disk for a PDF tab, sends its bytes to the
   * tab's page, and renames the tab to the file's name. Failures to read the
   * file are reported in a native error box rather than thrown, since this
   * is also reached from a keyboard shortcut that has nowhere else to show them.
   * @param id The PDF tab to open the file in. A no-op if it isn't a PDF tab.
   */
  public async openPdfFile(id: string): Promise<void> {
    const state = this.states.get(id);
    const view = this.views.get(id);
    if (!state || state.kind !== 'pdf' || !view) {
      return;
    }
    const window = (this.registry.mountOwners.get(id) ?? this).window;
    const { canceled, filePaths } = await dialog.showOpenDialog(window, {
      title: 'Open PDF',
      properties: ['openFile'],
      filters: [{ name: 'PDF Document', extensions: ['pdf'] }],
    });
    const [filePath] = filePaths;
    if (canceled || !filePath) {
      return;
    }
    await this.loadPdfFromPath(id, filePath);
  }

  /**
   * Reads a PDF from disk into a PDF tab: sends its bytes to the tab's page,
   * and retitles the tab to the file's name. Failures are reported in a
   * native error box, not thrown — see `openPdfFile`.
   * @param id The PDF tab. A no-op if it isn't one.
   * @param filePath The file to open.
   */
  private async loadPdfFromPath(id: string, filePath: string): Promise<void> {
    const view = this.views.get(id);
    if (this.states.get(id)?.kind !== 'pdf' || !view) {
      return;
    }
    let data: Buffer;
    try {
      if ((await stat(filePath)).size > MAX_PDF_BYTES) {
        throw new Error('That PDF is too large to open (limit 512 MB).');
      }
      data = await readFile(filePath);
    } catch (error) {
      dialog.showErrorBox('Could not open PDF', error instanceof Error ? error.message : String(error));
      return;
    }
    pdfFilePaths.set(id, filePath);
    this.historyController.recordPdfAccess(filePath);

    const current = this.states.get(id);
    if (current?.kind === 'pdf') {
      this.states.set(id, {
        ...current,
        title: this.pdfTabTitle(filePath),
        fileName: basename(filePath),
        filePath,
      });
      this.emitState();
    }
    if (!view.webContents.isDestroyed()) {
      const key = createHash('sha256').update(data).digest('hex');
      view.webContents.send(IpcChannel.PdfFile, {
        name: basename(filePath),
        data,
        key,
        annotations: pdfAnnotationStore.get(key),
      } satisfies PdfOpenResult);
    }
  }

  /**
   * Closes a PDF tab's open file: the tab stays but goes back to empty, as
   * if nothing had been opened. The file on disk and its saved marks are untouched.
   * @param id The PDF tab. A no-op if it isn't one or has no file open.
   */
  public closePdfFile(id: string): void {
    const current = this.states.get(id);
    if (current?.kind !== 'pdf' || !pdfFilePaths.has(id)) {
      return;
    }
    pdfFilePaths.delete(id);
    this.states.set(id, { ...current, title: 'PDF', fileName: null, filePath: null, page: 1, pageCount: 0 });
    this.releaseUnavailableTools();
    this.emitState();
    this.views.get(id)?.webContents.send(IpcChannel.PdfClosed);
    // Back to the empty page: re-check the bookmarked files before it lists them.
    void this.refreshPdfBookmarks();
  }

  /**
   * Saves a copy of a PDF tab's file with its crops, pen strokes and highlights applied, to a
   * location the user picks. The original file is left alone. Failures are
   * shown in a native error box (this is also reached from a toolbar button
   * with nowhere else to show them).
   * @param id The PDF tab. A no-op if it isn't one or has no file open.
   */
  public async exportPdfFile(id: string): Promise<void> {
    const state = this.states.get(id);
    const sourcePath = pdfFilePaths.get(id);
    if (state?.kind !== 'pdf' || !sourcePath) {
      return;
    }
    const window = (this.registry.mountOwners.get(id) ?? this).window;
    const stem = basename(sourcePath).replace(/\.pdf$/i, '');
    const { canceled, filePath } = await dialog.showSaveDialog(window, {
      title: 'Export PDF',
      defaultPath: join(dirname(sourcePath), `${sanitizeFileName(stem)} - exported.pdf`),
      filters: [{ name: 'PDF Document', extensions: ['pdf'] }],
    });
    if (canceled || !filePath) {
      return;
    }
    try {
      const data = await readFile(sourcePath);
      // The key is the hash of the file's bytes, same as `openPdfFile`, so this reads the marks saved for exactly this document.
      const key = createHash('sha256').update(data).digest('hex');
      const exported = await new PdfCropExporter().export(data, pdfAnnotationStore.get(key), getCurrentAccent());
      await writeFile(filePath, exported);
    } catch (error) {
      dialog.showErrorBox('Could not export PDF', error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Records which page a PDF tab's viewer reports in view, for the toolbar.
   * @param id The PDF tab. A no-op if it isn't one or nothing changed.
   */
  public setPdfPageInfo(id: string, page: number, pageCount: number): void {
    const current = this.states.get(id);
    if (current?.kind !== 'pdf' || (current.page === page && current.pageCount === pageCount)) {
      return;
    }
    this.states.set(id, { ...current, page, pageCount });
    this.emitState();
  }

  /**
   * Asks a PDF tab's viewer to scroll to a page.
   * @param id The PDF tab. A no-op if it isn't one.
   * @param page 1-based; the viewer clamps it to the document.
   */
  public goToPdfPage(id: string, page: number): void {
    if (this.states.get(id)?.kind === 'pdf') {
      this.views.get(id)?.webContents.send(IpcChannel.PdfScrollToPage, page);
    }
  }

  /**
   * Renames a PDF tab's file on disk (in its own folder) and retitles the tab.
   * @param id The PDF tab.
   * @param name The new file name, already validated to end in `.pdf`.
   * @throws If no file is open, the name has path separators, or the target exists.
   */
  public async renamePdfTab(id: string, name: string): Promise<void> {
    const current = this.states.get(id);
    const oldPath = pdfFilePaths.get(id);
    if (current?.kind !== 'pdf' || !oldPath) {
      throw new Error('Open a PDF before renaming it.');
    }
    // A bare file name only: anything else could move the file elsewhere.
    if (basename(name) !== name || name.includes('/') || name.includes('\\')) {
      throw new Error('File name cannot contain a folder path.');
    }
    const newPath = join(dirname(oldPath), name);
    if (newPath !== oldPath) {
      // Windows paths are case-insensitive, so a case-only rename is allowed
      // through; anything else that already exists is never overwritten.
      const caseOnly = newPath.toLowerCase() === oldPath.toLowerCase();
      if (!caseOnly && (await stat(newPath).then(() => true, () => false))) {
        throw new Error('A file with that name already exists.');
      }
      await rename(oldPath, newPath);
      pdfFilePaths.set(id, newPath);
      this.bookmarkStore.renamePdf(oldPath, newPath);
      this.historyController.pushBookmarksToAll();
    }
    this.states.set(id, { ...current, title: this.pdfTabTitle(newPath), fileName: name, filePath: newPath });
    this.emitState();
  }

  /** Forwards a terminal tab's keystroke/paste bytes to its pty. A no-op if `id` isn't a live terminal tab. */
  public sendTerminalInput(id: string, data: string): void {
    this.terminals.write(id, data);
  }

  /** Resizes a terminal tab's pty to match its xterm instance's current grid. A no-op if `id` isn't a live terminal tab. */
  public resizeTerminal(id: string, cols: number, rows: number): void {
    this.terminals.resize(id, cols, rows);
  }

  /** Applies the address bar's latest suggestions-dropdown sync — see `SuggestionsOverlay.sync`. */
  public syncAddressSuggestions(payload: AddressSuggestionsSyncPayload): void {
    this.suggestionsOverlay.sync(payload);
  }

  /** Applies a collapsed-sidebar tooltip's latest hover sync — see `TooltipOverlay.sync`. */
  public syncTooltip(payload: TooltipSyncPayload): void {
    this.tooltipOverlay.sync(payload);
  }

  /** Applies `ColorPicker`'s latest sync — see `ColorPickerOverlay.sync`. */
  public syncColorPicker(payload: ColorPickerSyncPayload): void {
    const activeTabView = this.activeTabId ? (this.views.get(this.activeTabId) ?? null) : null;
    this.colorPickerOverlay.sync(payload, activeTabView);
  }

  /** Applies `ExportMenu`'s latest sync — see `ExportMenuOverlay.sync`. */
  public syncExportMenu(payload: ExportMenuSyncPayload): void {
    const activeTabView = this.activeTabId ? (this.views.get(this.activeTabId) ?? null) : null;
    this.exportMenuOverlay.sync(payload, activeTabView);
  }

  /** Runs a row chosen in the export dropdown against the active tab, then has the chrome close the menu. Failures are logged — the menu is already gone, so there's no UI left to report to. */
  private runExportAction(action: ExportMenuAction): void {
    this.window.webContents.send(IpcChannel.ExportMenuCloseRequested);
    const id = this.activeTabId;
    if (!id) {
      return;
    }
    const run = action === 'pdf' ? this.exportToPdf(id) : this.exportDocuments(id);
    run.catch((error: unknown) => console.error(`[export] ${action} failed:`, error));
  }

  /**
   * Releases this window's own resources — call this when the window
   * itself closes. Deliberately does *not* touch shared tabs/workspaces or
   * kill any terminal's shell process: those are shared with every other
   * open window now (see `SharedTabRegistry`, and `terminals`'s own class
   * doc comment) and survive this window closing, same as a tab surviving
   * `moveTabToWorkspace` taking it elsewhere. Terminal processes are only
   * ever killed by `closeTab` (that specific tab closing) or
   * `TerminalManager.disposeAll` (the whole app quitting — see
   * `main/index.ts`'s `window-all-closed` handler).
   */
  public dispose(): void {
    this.suggestionsOverlay.dispose();
    this.tooltipOverlay.dispose();
    this.colorPickerOverlay.dispose();
    this.exportMenuOverlay.dispose();
    this.laserPointerOverlay.dispose();
    this.unregisterFromRegistry();
  }

  /**
   * Reorders a tab (the tab bar's drag-and-drop) by moving it to just
   * before `beforeId` in tab order. A no-op if `id` doesn't exist, if
   * `beforeId` doesn't exist or belongs to a different workspace than `id`
   * (dragging never moves a tab between workspaces, only reorders within
   * one), or if the two ids are the same. `states` is a `Map`, whose
   * insertion order is what `getState().tabs` iterates in and the tab bar
   * renders — reordering means rebuilding it in the new order rather than
   * mutating any one entry, since a `Map` has no "move to position"
   * primitive of its own.
   * @param id The tab being dragged.
   * @param beforeId The tab it should land before, or `null` to move it to the end of its workspace's tabs.
   * @returns The full browser state after the reorder.
   */
  public moveTab(requestedId: string, requestedBeforeId: string | null): BrowserState {
    // A linked group sits at its canonical member's position (`listedTabIds`),
    // so reordering any member reorders that one.
    const id = this.registry.getLinkGroup(requestedId)?.[0] ?? requestedId;
    const beforeId =
      requestedBeforeId === null ? null : (this.registry.getLinkGroup(requestedBeforeId)?.[0] ?? requestedBeforeId);
    const moving = this.states.get(id);
    if (!moving || id === beforeId) {
      return this.getState();
    }
    if (beforeId !== null) {
      const target = this.states.get(beforeId);
      if (!target || target.workspaceId !== moving.workspaceId) {
        return this.getState();
      }
    }

    const entries = Array.from(this.states.entries()).filter(([tabId]) => tabId !== id);
    const insertAt = beforeId === null ? entries.length : entries.findIndex(([tabId]) => tabId === beforeId);
    entries.splice(insertAt === -1 ? entries.length : insertAt, 0, [id, moving]);

    this.states.clear();
    for (const [tabId, state] of entries) {
      this.states.set(tabId, state);
    }

    this.emitState();
    return this.getState();
  }

  /**
   * Moves a tab into a different workspace (dragging it onto one of
   * `WorkspaceBar`'s pills) — the tab, its view, and its history all
   * survive; only which workspace's row it belongs to changes. A no-op if
   * the tab or workspace doesn't exist, or it's already there.
   *
   * If the moved tab was mounted (the active tab, or either half of split
   * view), it's unmounted first: leaving it on screen would make the tab
   * strip (always filtered to `activeWorkspaceId`) and the visible page
   * disagree about what's actually in the current workspace. Whatever
   * `closeTab` would activate next in its place — the same
   * neighbor-in-this-workspace-else-fresh-tab fallback — becomes active
   * instead, exactly as if the tab had been closed rather than relocated;
   * dragging a tab to another workspace shouldn't also switch you into it.
   * Delegates entirely to the tab's actual owner (`SharedTabRegistry.mountOwners`)
   * if that isn't `this` — a workspace pill can be clicked from *any*
   * window now that workspaces are shared, but only the window actually
   * showing the dragged tab can correctly answer "was this my active tab"
   * and unmount it from the right place.
   * @param id The tab to move.
   * @param workspaceId The workspace to move it into.
   * @returns The full browser state after the move.
   */
  public moveTabToWorkspace(id: string, workspaceId: string, discardEmptyWorkspace = true): BrowserState {
    const state = this.states.get(id);
    if (!state || !this.workspaces.has(workspaceId) || state.workspaceId === workspaceId) {
      return this.getState();
    }
    // A full workspace takes no more tabs: the dragged tab stays where it is.
    if (this.isWorkspaceFull(workspaceId, id)) {
      return this.getState();
    }

    // Every window's view of a linked tab belongs to the same workspace, so
    // relocate the whole group (the guard stops the recursion re-expanding it).
    const group = this.registry.getLinkGroup(id);
    if (group && !relocatingLinkGroup) {
      relocatingLinkGroup = true;
      try {
        for (const memberId of group.filter((memberId) => memberId !== id)) {
          this.moveTabToWorkspace(memberId, workspaceId, discardEmptyWorkspace);
        }
      } finally {
        relocatingLinkGroup = false;
      }
    }

    const owner = this.registry.mountOwners.get(id);
    if (owner && owner !== this) {
      return owner.moveTabToWorkspace(id, workspaceId, discardEmptyWorkspace);
    }

    const oldWorkspaceId = state.workspaceId;
    const view = this.views.get(id);
    this.registry.mountOwners.delete(id);

    // Delete-then-set rather than a plain `set` on the existing key: a
    // `Map` keeps an updated key at its *original* insertion position,
    // which would leave the tab wherever it happened to fall among every
    // workspace's tabs (interleaved by creation order across all of them)
    // instead of at the end of its new row — re-inserting moves it to the
    // end of `states`' own iteration order, which is the end of *every*
    // workspace's filtered tab list, the target one included, since
    // nothing belonging to it was inserted after this point.
    const relocate = (): void => {
      this.states.delete(id);
      this.states.set(id, { ...state, workspaceId });
    };

    if (this.grabbedTabId === id) {
      this.grabbedTabId = null;
    }

    if (this.splitView?.secondaryTabId === id) {
      if (view) {
        this.window.contentView.removeChildView(view);
      }
      this.splitView = null;
      relocate();
      this.updateBounds();
      this.emitState();
      return this.getState();
    }

    if (this.splitView?.primaryTabId === id) {
      const secondaryId = this.splitView.secondaryTabId;
      this.splitView = null;
      if (view) {
        this.window.contentView.removeChildView(view);
      }
      relocate();
      this.activeTabId = null;
      if (this.states.has(secondaryId)) {
        this.activateTab(secondaryId);
      } else {
        this.createTab(undefined, oldWorkspaceId);
      }
      return this.getState();
    }

    const wasActive = this.activeTabId === id;
    relocate();

    if (!wasActive) {
      if (discardEmptyWorkspace) {
        this.discardWorkspaceIfEmpty(oldWorkspaceId);
      }
      this.emitState();
      return this.getState();
    }

    if (view) {
      this.window.contentView.removeChildView(view);
    }
    this.activeTabId = null;

    const remainingInOldWorkspace = Array.from(this.states.entries())
      .filter(([tabId, tabState]) => tabId !== id && tabState.workspaceId === oldWorkspaceId)
      .map(([tabId]) => tabId);
    const next = remainingInOldWorkspace[remainingInOldWorkspace.length - 1];
    if (next) {
      this.activateTab(next);
    } else if (!(discardEmptyWorkspace && this.discardWorkspaceIfEmpty(oldWorkspaceId))) {
      this.createTab(undefined, oldWorkspaceId);
    }
    // Every window's tab list and workspace list may have changed (the moved
    // tab, a deleted workspace) — not just the one that owned the tab.
    this.emitState();

    return this.getState();
  }

  /**
   * Deletes a workspace whose last tab was just *moved out* (not closed —
   * closing a workspace's last tab leaves the workspace with a fresh home
   * tab). Every window showing it falls back to another workspace. Never
   * deletes the only remaining workspace.
   * @returns Whether the workspace was deleted.
   */
  private discardWorkspaceIfEmpty(workspaceId: string): boolean {
    if (this.workspaces.size <= 1 || !this.workspaces.has(workspaceId)) {
      return false;
    }
    if (Array.from(this.states.values()).some((state) => state.workspaceId === workspaceId)) {
      return false;
    }
    this.workspaces.delete(workspaceId);
    this.registry.notifyWorkspaceRemoved(workspaceId);
    return true;
  }

  /** A workspace was deleted by some window: forget it, and if this window was showing it, switch to the first remaining one. */
  private handleWorkspaceRemoved(workspaceId: string): void {
    this.lastActiveTabIdByWorkspace.delete(workspaceId);
    if (this.window.isDestroyed()) {
      return;
    }
    if (this.activeWorkspaceId !== workspaceId) {
      return;
    }
    const fallbackId = this.workspaces.keys().next().value as string | undefined;
    if (!fallbackId) {
      return;
    }
    this.activeWorkspaceId = fallbackId;
    this.activeTabId = null;
    // A hidden window is a torn-off one about to be discarded (see
    // `followCursor`) — don't mount anything in it just to throw it away.
    if (this.window.isVisible() && !this.suppressWorkspaceFallback) {
      this.focusWorkspaceDefaultTab(fallbackId);
    }
  }

  /**
   * Closes a tab. If it was the active tab, activates a neighbor in the
   * same workspace; if none remain there, opens a fresh home tab in that
   * workspace instead of jumping to an unrelated one. If the tab was part
   * of an active split view, the other pane simply takes over full width.
   * @param id The tab to close.
   * @param options.recordClosed Whether a closed browser tab goes into
   *   `closedTabs` for `restoreLastClosedTab` (Ctrl+Shift+T) to find.
   *   Defaults to `true`; `tearOffTab` (main/index.ts) passes `false` — a
   *   torn-off tab isn't gone, just relocated to a new window, so it
   *   shouldn't be resurrectable as a duplicate back in this one.
   * @returns The full browser state after the tab is closed.
   */
  public closeTab(id: string, options: { recordClosed?: boolean } = {}): BrowserState {
    if (!this.states.has(id)) {
      return this.getState();
    }
    // A tab shown from several windows is one tab (see `SharedTabRegistry`'s
    // link groups): closing it closes every window's view of it. Left alone,
    // the surviving views would simply be listed in its place and the tab
    // would reappear the moment it was closed. The other windows pick a
    // fallback only after this close is done, so none lands back on `id`.
    const affected = this.discardOtherLinkedMembers(id);
    const result = this.closeSingleTab(id, options);
    for (const { manager, workspaceId } of affected) {
      manager.recoverActiveTab(workspaceId);
    }
    return affected.length > 0 ? this.getState() : result;
  }

  /**
   * Silently removes every other member of `id`'s link group — state, view,
   * ownership, and per-tab controllers — without activating a fallback.
   * @returns The windows that were showing one of them, to be given a
   *   fallback tab (`recoverActiveTab`) once the caller's own close is done.
   */
  private discardOtherLinkedMembers(id: string): { manager: TabManager; workspaceId: string }[] {
    const affected: { manager: TabManager; workspaceId: string }[] = [];
    for (const memberId of [...(this.registry.getLinkGroup(id) ?? [])]) {
      if (memberId === id) {
        continue;
      }
      const memberState = this.states.get(memberId);
      const showingWindow = this.registry.mountOwners.get(memberId);
      const view = this.views.get(memberId);
      if (view) {
        (showingWindow ?? this).window.contentView.removeChildView(view);
        this.views.delete(memberId);
      }
      this.states.delete(memberId);
      this.registry.mountOwners.delete(memberId);
      this.registry.zoomPercentByTabId.delete(memberId);
      this.highlighter.disposeTab(memberId);
      this.historyQueries.delete(memberId);
      this.commentController.disposeTab(memberId);
      this.textBoxController.disposeTab(memberId);
      this.penController.disposeTab(memberId);
      this.registry.removeFromLinkGroup(memberId);
      if (showingWindow && memberState && showingWindow !== this && showingWindow.activeTabId === memberId) {
        showingWindow.activeTabId = null;
        affected.push({ manager: showingWindow, workspaceId: memberState.workspaceId });
      }
    }
    return affected;
  }

  /** Gives a window that lost its active tab (see `discardOtherLinkedMembers`) a neighbor in its workspace, or a fresh home tab. */
  private recoverActiveTab(workspaceId: string): void {
    if (this.activeTabId !== null) {
      return;
    }
    const remaining = Array.from(this.states.entries())
      .filter(([, state]) => state.workspaceId === workspaceId)
      .map(([tabId]) => tabId);
    const next = remaining[remaining.length - 1];
    if (next) {
      this.activateTab(next);
    } else {
      this.createTab(undefined, workspaceId);
    }
  }

  /** `closeTab` for exactly one tab id — the original single-tab close, without the link-group handling above. */
  private closeSingleTab(id: string, options: { recordClosed?: boolean } = {}): BrowserState {
    const closedState = this.states.get(id);
    if (!closedState) {
      return this.getState();
    }

    // Delegates to the tab's actual owner first — same reasoning as
    // `moveTabToWorkspace`'s identical check: a tab's own close button
    // renders in every window showing its (now-shared) workspace, not
    // just whichever window happens to have it mounted right now.
    const owner = this.registry.mountOwners.get(id);
    if (owner && owner !== this) {
      return owner.closeTab(id, options);
    }
    this.registry.mountOwners.delete(id);
    this.registry.zoomPercentByTabId.delete(id);
    this.highlighter.disposeTab(id);
    this.historyQueries.delete(id);
    this.commentController.disposeTab(id);
    this.textBoxController.disposeTab(id);
    this.penController.disposeTab(id);
    this.unlinkTab(id);

    if (this.grabbedTabId === id) {
      this.grabbedTabId = null;
    }

    if (closedState.kind === 'terminal') {
      this.terminals.dispose(id);
    } else if (closedState.kind === 'browser' && (options.recordClosed ?? true)) {
      this.closedTabs.push({ url: closedState.url, workspaceId: closedState.workspaceId });
      if (this.closedTabs.length > CLOSED_TAB_HISTORY_LIMIT) {
        this.closedTabs.shift();
      }
    }

    const view = this.views.get(id);
    const closedWorkspaceId = closedState.workspaceId;

    if (this.splitView?.secondaryTabId === id) {
      if (view) {
        this.window.contentView.removeChildView(view);
      }
      this.views.delete(id);
      this.states.delete(id);
      this.splitView = null;
      this.updateBounds();
      this.emitState();
      return this.getState();
    }

    if (this.splitView?.primaryTabId === id) {
      const secondaryId = this.splitView.secondaryTabId;
      this.splitView = null;
      if (view) {
        this.window.contentView.removeChildView(view);
      }
      this.views.delete(id);
      this.states.delete(id);
      this.activeTabId = null;
      if (this.states.has(secondaryId)) {
        this.activateTab(secondaryId);
      } else if (closedWorkspaceId) {
        this.createTab(undefined, closedWorkspaceId);
      } else {
        this.createTab();
      }
      return this.getState();
    }

    const remainingIds = Array.from(this.states.keys()).filter((tabId) => tabId !== id);
    const wasActive = this.activeTabId === id;

    if (view) {
      this.window.contentView.removeChildView(view);
      this.views.delete(id);
    }
    this.states.delete(id);

    if (wasActive) {
      this.activeTabId = null;
      const sameWorkspaceRemaining = remainingIds.filter(
        (tabId) => this.states.get(tabId)?.workspaceId === closedWorkspaceId,
      );
      const next = sameWorkspaceRemaining[sameWorkspaceRemaining.length - 1];
      if (next) {
        this.activateTab(next);
      } else if (closedWorkspaceId) {
        this.createTab(undefined, closedWorkspaceId);
      } else {
        this.createTab();
      }
    } else {
      this.emitState();
    }

    return this.getState();
  }

  /**
   * Closes every tab in the active workspace (Ctrl+Shift+W), routing each
   * one through `closeTab` so it inherits that method's own closed-tab
   * history and split-view handling. Closing the last of them trips
   * `closeTab`'s own last-tab reset, so this always ends with exactly one
   * fresh home tab in the workspace — the same place you'd land pressing
   * plain Ctrl+W repeatedly. Only closes tabs this window's own tab bar
   * actually lists (see `shouldListTabForThisWindow`) — a linked twin (see
   * `createLinkedTwin`) that this window doesn't own is a different
   * window's tab as far as "close all *my* tabs" is concerned, even though
   * it shares this workspace.
   * @returns The full browser state after the reset.
   */
  public closeAllTabs(): BrowserState {
    const workspaceId = this.activeWorkspaceId;
    const idsToClose = this.listedTabIds(workspaceId);

    for (const id of idsToClose) {
      this.closeTab(id);
    }

    return this.getState();
  }

  /**
   * Picks which actual view this window should show for a requested tab.
   * A `WebContentsView` can only be attached to one window, so when a tab
   * is already live in another window this window gets its own *twin*: a
   * separate view loaded to the same URL (see `SharedTabRegistry`'s link
   * groups) — any number of windows can show the same tab at once, each
   * with its own scroll position, and navigation is kept in sync. Order of
   * preference: a member this window already shows, then one nobody is
   * showing (reusing a twin left behind when a window switched away), then
   * a brand-new twin. A tab nobody else shows, and a terminal (whose
   * process can't be duplicated), is used directly — the latter is
   * relocated here, as before.
   * @param id The tab the user asked for.
   * @returns The tab id whose view to mount in this window.
   */
  private resolveViewForThisWindow(id: string): string {
    const owners = this.registry.mountOwners;
    const group = this.registry.getLinkGroup(id);
    if (group) {
      if (owners.get(id) === this) {
        return id;
      }
      const mine = group.find((memberId) => owners.get(memberId) === this);
      if (mine) {
        return mine;
      }
      if (!owners.has(id)) {
        return id;
      }
      return group.find((memberId) => !owners.has(memberId)) ?? this.createLinkedTwin(id) ?? id;
    }
    const owner = owners.get(id);
    if (owner && owner !== this && this.states.get(id)?.kind === 'browser') {
      return this.createLinkedTwin(id) ?? id;
    }
    return id;
  }

  /**
   * Makes a tab the visible one, swapping it into the window's content
   * view in place of whichever tab was previously active. Also switches
   * the active workspace to whichever one this tab belongs to — so
   * activating a tab found via cross-workspace tab search lands the chrome
   * on a consistent workspace instead of showing a tab no visible pill
   * claims — and always exits split view first: a tab-bar click is treated
   * as "show exactly this tab," never as "keep the other split pane too."
   * Also steals `id` away from whichever *other* window currently has it
   * mounted, if any (`SharedTabRegistry.mountOwners`) — a `WebContentsView`
   * can only ever be attached to one window's `contentView` at a time, so
   * with tabs shared across every open window now, clicking a tab that's
   * currently live in a different window has to relocate it here rather
   * than mount a second copy. That other window falls back to a neighbor
   * exactly as if the tab had been closed on it (`releaseTab`), without
   * actually removing the tab anywhere.
   * @param id The tab to bring to the front.
   * @returns The full browser state after the switch.
   */
  public activateTab(requestedId: string): BrowserState {
    if (!this.states.has(requestedId)) {
      return this.getState();
    }
    const id = this.resolveViewForThisWindow(requestedId);

    const owner = this.registry.mountOwners.get(id);
    if (owner && owner !== this) {
      owner.releaseTab(id);
    }

    if (this.splitView) {
      this.teardownSplitView();
    }

    if (this.activeTabId && this.activeTabId !== id) {
      const previous = this.views.get(this.activeTabId);
      if (previous) {
        this.window.contentView.removeChildView(previous);
      }
      this.registry.mountOwners.delete(this.activeTabId);
    }

    // Every tab, browser or terminal, has its own `WebContentsView` (see
    // `createTab`/`createTerminalTab`) — mounting it and explicitly asking
    // for native OS keyboard focus is what makes it actually receive
    // keystrokes rather than them going nowhere (or to whatever view last
    // held focus, even after it's been removed above). Explicit rather
    // than relying on mounting alone to grab focus: true the first time a
    // fresh view loads content, but not reliably true for a view that's
    // simply being reattached after being hidden, which is what every tab
    // switch after the first is.
    //
    // Always inserted at index 0 (the bottom of the child-view stack)
    // rather than appended (the default, which would make it the topmost)
    // — `SuggestionsOverlay`'s own view relies on tab views never
    // outranking it so its dropdown can sit above the live page without
    // that page ever needing to be hidden; see its class doc comment.
    const view = this.views.get(id);
    if (view) {
      this.registry.detachViewFromAllWindows(view);
      this.window.contentView.addChildView(view, 0);
      view.setBounds(this.computeMainBounds(this.targetLeftInset(), this.targetTopInset()));
      view.webContents.focus();
      this.registry.mountOwners.set(id, this);
    }
    this.activeTabId = id;
    // Showing a different tab (a plain click, a shortcut, a fallback after a
    // close) ends a multi-selection; Ctrl/Shift+click never reach here.
    this.selectedTabIds.clear();
    this.releaseUnavailableTools();
    const shown = this.states.get(id);
    if (shown?.kind === 'pdf' && shown.fileName === null) {
      void this.refreshPdfBookmarks();
    }
    this.pushHighlighterState();
    this.pushCommentToolState();
    this.pushTextToolState();
    this.pushPenState();
    this.pushCropState();

    const workspaceId = this.states.get(id)?.workspaceId;
    if (workspaceId) {
      this.activeWorkspaceId = workspaceId;
      this.lastActiveTabIdByWorkspace.set(workspaceId, id);
    }

    this.emitState();
    return this.getState();
  }

  /**
   * Unmounts a tab from this window if it's currently the one showing it
   * (the active tab, or either half of split view), activating a
   * fallback in its place exactly as `closeTab` would — without removing
   * the tab itself from the shared registry, since it isn't gone, just
   * being taken over by a different window. Called on whichever window's
   * `TabManager` actually owns a tab (`SharedTabRegistry.mountOwners`)
   * right before a *different* window claims it via `activateTab`. A
   * no-op if this window isn't currently displaying `id` anywhere.
   * @param id The tab being taken over by a different window.
   */
  public releaseTab(id: string): void {
    if (this.splitView?.secondaryTabId === id) {
      const view = this.views.get(id);
      if (view) {
        this.window.contentView.removeChildView(view);
      }
      this.registry.mountOwners.delete(id);
      this.splitView = null;
      this.updateBounds();
      this.emitState();
      return;
    }

    if (this.splitView?.primaryTabId === id) {
      const secondaryId = this.splitView.secondaryTabId;
      const view = this.views.get(id);
      if (view) {
        this.window.contentView.removeChildView(view);
      }
      this.registry.mountOwners.delete(id);
      this.splitView = null;
      this.activeTabId = null;
      if (this.states.has(secondaryId)) {
        this.activateTab(secondaryId);
      } else {
        this.createTab(undefined, this.states.get(id)?.workspaceId);
      }
      return;
    }

    if (this.activeTabId !== id) {
      return;
    }

    const view = this.views.get(id);
    if (view) {
      this.window.contentView.removeChildView(view);
    }
    this.registry.mountOwners.delete(id);
    this.activeTabId = null;

    const workspaceId = this.states.get(id)?.workspaceId;
    const remaining = Array.from(this.states.entries())
      .filter(([tabId, tabState]) => tabId !== id && tabState.workspaceId === workspaceId)
      .map(([tabId]) => tabId);
    const next = remaining[remaining.length - 1];
    if (next) {
      this.activateTab(next);
    } else if (workspaceId) {
      this.createTab(undefined, workspaceId);
    } else {
      this.emitState();
    }
  }

  /**
   * Navigates a tab. Re-validates and re-normalizes the URL on this side
   * of the IPC boundary rather than trusting the renderer's normalization.
   * A no-op for a terminal tab — it has a real `WebContentsView` like a
   * browser tab now (see `createTerminalTab`), but navigating it would
   * blow away its `terminal.html` page (and the live xterm instance on
   * it) rather than doing anything meaningful.
   * @param id The tab to navigate.
   * @param url Raw address bar text or a URL.
   * @returns The full browser state (loading flags update asynchronously).
   */
  public navigate(id: string, url: string): BrowserState {
    const view = this.views.get(id);
    if (!view || this.states.get(id)?.kind !== 'browser') {
      return this.getState();
    }

    const target = normalizeUrlOrSearch(url);
    if (!isNavigableUrl(target)) {
      throw new Error(`Refusing to navigate to disallowed URL: ${target}`);
    }

    void view.webContents.loadURL(target).catch(() => {});
    return this.getState();
  }

  /** Navigates a tab to the home page — the same destination the toolbar's Home button uses. A no-op for a terminal tab; see `navigate`. */
  public goHome(id: string): BrowserState {
    return this.navigate(id, HOME_URL);
  }

  /** Navigates a tab back one entry in its history, if possible. A no-op for a terminal tab; see `navigate`. */
  public goBack(id: string): BrowserState {
    const history = this.states.get(id)?.kind === 'browser' ? this.views.get(id)?.webContents.navigationHistory : undefined;
    if (history?.canGoBack()) {
      history.goBack();
    }
    return this.getState();
  }

  /** Navigates a tab forward one entry in its history, if possible. A no-op for a terminal tab; see `navigate`. */
  public goForward(id: string): BrowserState {
    const history = this.states.get(id)?.kind === 'browser' ? this.views.get(id)?.webContents.navigationHistory : undefined;
    if (history?.canGoForward()) {
      history.goForward();
    }
    return this.getState();
  }

  /** Reloads a tab's current page. A no-op for a terminal tab — reloading its `terminal.html` page would kill the live xterm instance on it (its pty survives; a fresh page would just never reattach to it). */
  public reload(id: string): BrowserState {
    if (this.states.get(id)?.kind === 'browser') {
      this.views.get(id)?.webContents.reload();
    }
    return this.getState();
  }

  /** Stops a tab's in-flight navigation. A no-op for a terminal tab; see `navigate`. */
  public stop(id: string): BrowserState {
    if (this.states.get(id)?.kind === 'browser') {
      this.views.get(id)?.webContents.stop();
    }
    return this.getState();
  }

  /**
   * Reopens the most recently closed tab at its last URL — its own
   * navigation history isn't preserved, only where it was. A no-op if
   * nothing has been closed yet (or everything closed has since been
   * pushed out of `CLOSED_TAB_HISTORY_LIMIT`). Recreated in its original
   * workspace, unless that workspace was itself removed since, in which
   * case it falls back to the current one rather than resurrecting a
   * tab nothing can show.
   * @returns The full browser state after the tab is reopened.
   */
  public restoreLastClosedTab(): BrowserState {
    const closed = this.closedTabs[this.closedTabs.length - 1];
    if (!closed) {
      return this.getState();
    }
    const workspaceId = this.workspaces.has(closed.workspaceId)
      ? closed.workspaceId
      : this.activeWorkspaceId;
    // Checked before popping, so a full workspace doesn't swallow the entry.
    if (this.isWorkspaceFull(workspaceId)) {
      return this.getState();
    }
    this.closedTabs.pop();
    return this.createTab(closed.url, workspaceId);
  }

  /**
   * Duplicates a tab (Ctrl+Shift+D) and places the copy immediately to its
   * right within the same workspace, activating it — matching the
   * conventional browser "Duplicate Tab" behavior. A browser tab's copy
   * loads the same URL (not its navigation history — same limitation
   * `restoreLastClosedTab`/`SessionSnapshot` already accept for recreating a
   * tab); a terminal tab's "copy" is a fresh shell session, since a live pty
   * can't itself be duplicated. A no-op if `id` doesn't exist.
   * @param id The tab to duplicate.
   * @returns The full browser state after the duplicate is created.
   */
  public duplicateTab(id: string): BrowserState {
    const state = this.states.get(id);
    if (!state || this.isWorkspaceFull(state.workspaceId)) {
      return this.getState();
    }

    // Captured before creating the new tab, so "the tab right after this
    // one" reflects the workspace's order as it was, not as it becomes once
    // the new tab is appended at the end of it.
    const workspaceTabIds = Array.from(this.states.entries())
      .filter(([, tabState]) => tabState.workspaceId === state.workspaceId)
      .map(([tabId]) => tabId);
    const beforeId = workspaceTabIds[workspaceTabIds.indexOf(id) + 1] ?? null;

    const newState =
      state.kind === 'terminal'
        ? this.createTerminalTab(state.workspaceId)
        : state.kind === 'pdf'
          ? this.createPdfTab(state.workspaceId)
          : state.kind === 'history'
            ? this.createHistoryTab(state.workspaceId)
            : this.createTab(state.url, state.workspaceId);
    if (newState.activeTabId) {
      // `createTab`/`createTerminalTab` both append at the end of the
      // workspace's own tabs and activate it; this repositions it next to
      // the original without touching which tab is active.
      this.moveTab(newState.activeTabId, beforeId);
    }
    return this.getState();
  }

  /**
   * Renders a tab's current page to a PDF, prompting the user for a save
   * location via a native dialog parented to this window. Works for a
   * terminal tab too — `terminal.html` is a real page in its own
   * `WebContentsView` (see `createTerminalTab`) — but not by directly
   * `printToPDF`-ing the live xterm canvas the way a browser tab's own page
   * is: that canvas only ever paints one viewport's worth of rows, so it'd
   * capture whatever single page of scrollback happened to be scrolled to
   * rather than the whole thing. `executeJavaScript` here instead fills
   * `Terminal.tsx`'s hidden `.terminal__print-view` with every row currently
   * in the buffer (see its own `PREPARE_PRINT_GLOBAL` effect) — terminal.css
   * swaps that in for the canvas, and lets the page grow past one viewport's
   * height, only under `printToPDF`'s own `print` media pass, so the result
   * paginates across as many pages as the scrollback actually needs.
   * @param id The tab to export.
   * @returns The path it was saved to, or `null` if the tab is gone or the
   *   user canceled the save dialog.
   */
  public async exportToPdf(id: string): Promise<string | null> {
    const view = this.views.get(id);
    const state = this.states.get(id);
    // Mirrors the toolbar's export menu: not offered on a PDF tab (see `exportPdfFile`) or the blank home page.
    if (
      !view ||
      !state ||
      state.kind === 'pdf' ||
      state.kind === 'history' ||
      (state.kind === 'browser' && state.url === HOME_URL)
    ) {
      return null;
    }

    const { canceled, filePath } = await dialog.showSaveDialog(this.window, {
      title: 'Export to PDF',
      defaultPath: `${sanitizeFileName(state.title)}.pdf`,
      filters: [{ name: 'PDF Document', extensions: ['pdf'] }],
    });
    if (canceled || !filePath) {
      return null;
    }

    if (state.kind === 'terminal') {
      await view.webContents.executeJavaScript(`window.${TERMINAL_PREPARE_PRINT_GLOBAL}?.();`);
    }

    const pdfData = await view.webContents.printToPDF({});
    await writeFile(filePath, pdfData);
    return filePath;
  }

  /**
   * Saves a browser tab's HTML plus its external CSS and JS into a new
   * folder (named after the page title) inside one the user picks.
   * @returns The folder written, or `null` if the tab is gone, is a
   *   terminal, or the user canceled.
   */
  public async exportDocuments(id: string): Promise<string | null> {
    const view = this.views.get(id);
    const state = this.states.get(id);
    if (!view || !state || state.kind !== 'browser' || state.url === HOME_URL) {
      return null;
    }

    const { canceled, filePaths } = await dialog.showOpenDialog(this.window, {
      title: 'Choose where to save the web documents',
      properties: ['openDirectory', 'createDirectory'],
    });
    const [parentDirectory] = filePaths;
    if (canceled || !parentDirectory) {
      return null;
    }

    const target = join(parentDirectory, sanitizeFileName(state.title));
    await new PageDocumentExporter().export(view.webContents, target);
    return target;
  }

  /**
   * Whether a screen point is over this window's tab strip or workspace
   * sidebar — the two places a dragged-out tab can be dropped back in. Used
   * by the torn-off window (`main/index.ts`'s `followCursor`) to get out of
   * the way, so the OS drag reaches this window's own drop handlers.
   */
  public isOverTabDropRegion(screenX: number, screenY: number): boolean {
    if (this.window.isDestroyed() || !this.window.isVisible() || this.window.isMinimized()) {
      return false;
    }
    const content = this.window.getContentBounds();
    const x = screenX - content.x;
    const y = screenY - content.y;
    if (x < 0 || y < 0 || x >= content.width || y >= content.height) {
      return false;
    }
    return (
      y < TAB_STRIP_HEIGHT_PX ||
      this.dropRegions.some((r) => x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height)
    );
  }

  /**
   * Takes a tab's view off this window without activating anything in its
   * place (unlike `releaseTab`, which falls back to a neighbor or a fresh
   * home tab). For a window that's about to be closed while its tab lives
   * on elsewhere — see `main/index.ts`'s `closeTearOffWindow`.
   */
  public unmountTabWithoutFallback(tabId: string): void {
    const view = this.views.get(tabId);
    if (view) {
      this.window.contentView.removeChildView(view);
    }
    if (this.registry.mountOwners.get(tabId) === this) {
      this.registry.mountOwners.delete(tabId);
    }
    if (this.activeTabId === tabId) {
      this.activeTabId = null;
    }
  }

  /** Marks this window as one being dragged around whole (see `suppressWorkspaceFallback`). */
  public setSuppressWorkspaceFallback(suppress: boolean): void {
    this.suppressWorkspaceFallback = suppress;
  }

  /** Whether `tabId` is the only tab this window lists in its workspace — dragging it out then moves the whole window instead of spawning another. */
  public isOnlyTabInItsWorkspace(tabId: string): boolean {
    const workspaceId = this.states.get(tabId)?.workspaceId;
    if (workspaceId === undefined) {
      return false;
    }
    const dragged = this.registry.selectionContainingTab(tabId) ?? [tabId];
    const listed = this.listedTabIds(workspaceId);
    return listed.length === dragged.length && listed.every((listedId) => dragged.includes(listedId));
  }

  /** Records where this window's tab drop targets are (client coordinates) — see `isOverTabDropRegion`. */
  public setDropRegions(rects: readonly { x: number; y: number; width: number; height: number }[]): void {
    this.dropRegions = rects;
  }

  /** @returns The workspace a tab currently belongs to, or `undefined` if it no longer exists. */
  public getTabWorkspaceId(tabId: string): string | undefined {
    return this.states.get(tabId)?.workspaceId;
  }

  // ── Multi-selection ──────────────────────────────────────────────────

  /**
   * The multi-selected tabs, in tab-strip order, active tab included — empty
   * unless two or more of this window's currently listed tabs are selected
   * (entries for tabs that were closed, moved to another workspace, or are
   * no longer listed here are dropped, so the selection can never go stale).
   */
  private currentTabSelection(): string[] {
    if (this.selectedTabIds.size === 0) {
      return [];
    }
    const selected = this.listedTabIds(this.activeWorkspaceId).filter((tabId) => this.selectedTabIds.has(tabId));
    return selected.length >= 2 ? selected : [];
  }

  /** The multi-selected workspaces, in sidebar order, active one included — empty unless two or more still exist. */
  private currentWorkspaceSelection(): string[] {
    if (this.selectedWorkspaceIds.size === 0) {
      return [];
    }
    const selected = Array.from(this.workspaces.keys()).filter((id) => this.selectedWorkspaceIds.has(id));
    return selected.length >= 2 ? selected : [];
  }

  /**
   * Ctrl+click on a tab: adds it to (or removes it from) the selection,
   * together with the active tab, and does *not* switch to it. Ctrl+clicking
   * the active tab itself does nothing — it stays selected as long as any
   * selection exists.
   */
  public toggleTabSelection(id: string): BrowserState {
    const listed = this.listedTabIds(this.activeWorkspaceId);
    const active = this.activeTabId;
    if (!active || id === active || !listed.includes(id) || !listed.includes(active)) {
      return this.getState();
    }
    const selection = new Set(this.currentTabSelection());
    if (selection.size === 0) {
      selection.add(active);
      selection.add(id);
    } else if (selection.has(id)) {
      selection.delete(id);
    } else {
      selection.add(id);
    }
    this.selectedTabIds = selection.size >= 2 ? selection : new Set();
    this.emitState();
    return this.getState();
  }

  /** Shift+click on a tab: selects every tab from the active one to this one, inclusive. */
  public selectTabRange(id: string): BrowserState {
    const listed = this.listedTabIds(this.activeWorkspaceId);
    const from = this.activeTabId ? listed.indexOf(this.activeTabId) : -1;
    const to = listed.indexOf(id);
    if (from === -1 || to === -1) {
      return this.getState();
    }
    const range = listed.slice(Math.min(from, to), Math.max(from, to) + 1);
    this.selectedTabIds = range.length >= 2 ? new Set(range) : new Set();
    this.emitState();
    return this.getState();
  }

  /** Ctrl+click on a workspace: adds it to (or removes it from) the selection, with the active one, without switching to it. */
  public toggleWorkspaceSelection(id: string): BrowserState {
    if (!this.workspaces.has(id) || id === this.activeWorkspaceId) {
      return this.getState();
    }
    const selection = new Set(this.currentWorkspaceSelection());
    if (selection.size === 0) {
      selection.add(this.activeWorkspaceId);
      selection.add(id);
    } else if (selection.has(id)) {
      selection.delete(id);
    } else {
      selection.add(id);
    }
    this.selectedWorkspaceIds = selection.size >= 2 ? selection : new Set();
    this.emitState();
    return this.getState();
  }

  /** Shift+click on a workspace: selects every workspace from the active one to this one, inclusive. */
  public selectWorkspaceRange(id: string): BrowserState {
    const order = Array.from(this.workspaces.keys());
    const from = order.indexOf(this.activeWorkspaceId);
    const to = order.indexOf(id);
    if (from === -1 || to === -1) {
      return this.getState();
    }
    const range = order.slice(Math.min(from, to), Math.max(from, to) + 1);
    this.selectedWorkspaceIds = range.length >= 2 ? new Set(range) : new Set();
    this.emitState();
    return this.getState();
  }

  /**
   * Ctrl+W: closes every selected tab if `id` is one of a multi-selection,
   * otherwise just `id`. The active tab goes last, so the fallback it
   * triggers can't land on a tab that's about to close anyway.
   */
  public closeSelectionOrTab(id: string): BrowserState {
    const selection = this.currentTabSelection();
    if (selection.length < 2 || !selection.includes(id)) {
      return this.closeTab(id);
    }
    const active = this.activeTabId;
    const ordered = [...selection.filter((tabId) => tabId !== active), ...selection.filter((tabId) => tabId === active)];
    for (const tabId of ordered) {
      this.closeTab(tabId);
    }
    this.selectedTabIds.clear();
    return this.getState();
  }

  /**
   * Ctrl+Alt+W: removes every selected workspace if there's a multi-selection,
   * otherwise just the active one. The active workspace is removed last (one
   * fallback switch, not several), and `removeWorkspace` itself refuses to
   * remove the last workspace left, so this can never remove them all.
   */
  public removeSelectionOrActiveWorkspace(): BrowserState {
    const selection = this.currentWorkspaceSelection();
    if (selection.length < 2) {
      return this.removeWorkspace(this.activeWorkspaceId);
    }
    for (const id of selection.filter((workspaceId) => workspaceId !== this.activeWorkspaceId)) {
      this.removeWorkspace(id);
    }
    this.removeWorkspace(this.activeWorkspaceId);
    this.selectedWorkspaceIds.clear();
    return this.getState();
  }

  /** Whether moving `tabIds` into `workspaceId` would push it past `MAX_TABS_PER_WORKSPACE` (link groups count once). */
  private wouldExceedTabLimit(workspaceId: string, tabIds: readonly string[]): boolean {
    const keyOf = (tabId: string): string => this.registry.getLinkGroup(tabId)?.[0] ?? tabId;
    const keys = new Set<string>();
    for (const [tabId, state] of this.states) {
      if (state.workspaceId === workspaceId) {
        keys.add(keyOf(tabId));
      }
    }
    for (const tabId of tabIds) {
      keys.add(keyOf(tabId));
    }
    return keys.size > MAX_TABS_PER_WORKSPACE;
  }

  /**
   * Drops a tab (and its whole multi-selection, if it's part of one — in
   * whichever window it was selected) onto a workspace. All of them move or
   * none do: a workspace without room for the lot takes nothing.
   */
  public moveTabsToWorkspace(id: string, workspaceId: string): BrowserState {
    const selection = this.registry.selectionContainingTab(id);
    if (!selection) {
      return this.moveTabToWorkspace(id, workspaceId);
    }
    const toMove = selection.filter((tabId) => this.states.get(tabId)?.workspaceId !== workspaceId);
    if (toMove.length === 0 || this.wouldExceedTabLimit(workspaceId, toMove)) {
      return this.getState();
    }
    for (const tabId of toMove) {
      this.moveTabToWorkspace(tabId, workspaceId);
    }
    return this.getState();
  }

  /**
   * Drops a tab (and its whole multi-selection) into this window's active
   * workspace, just before `beforeId` (`null` = the end), keeping the tabs'
   * relative order — the tab strip's drag-and-drop, also across windows.
   */
  public moveTabsBefore(id: string, beforeId: string | null): BrowserState {
    const destinationWorkspaceId = this.activeWorkspaceId;
    const dragged = this.registry.selectionContainingTab(id) ?? [id];
    const foreign = dragged.filter((tabId) => {
      const workspaceId = this.states.get(tabId)?.workspaceId;
      return workspaceId !== undefined && workspaceId !== destinationWorkspaceId;
    });
    if (foreign.length > 0 && this.wouldExceedTabLimit(destinationWorkspaceId, foreign)) {
      return this.getState();
    }
    for (const tabId of foreign) {
      this.moveTabToWorkspace(tabId, destinationWorkspaceId);
    }

    // Dropping onto one of the dragged tabs themselves: land before the next tab that isn't.
    let anchor = beforeId;
    if (anchor !== null && dragged.includes(anchor)) {
      const order = this.listedTabIds(destinationWorkspaceId);
      anchor = order.slice(order.indexOf(anchor) + 1).find((tabId) => !dragged.includes(tabId)) ?? null;
    }
    for (const tabId of dragged) {
      this.moveTab(tabId, anchor);
    }
    return this.getState();
  }

  // ── Workspaces ───────────────────────────────────────────────────────

  /**
   * Creates a new workspace, switches to it, and (since it starts with no
   * tabs) opens a home tab in it — then focuses the address bar, same as
   * `createTabAndFocusAddressBar`: a brand new workspace's fresh home tab
   * implies the person is about to type somewhere, just like a brand new
   * tab does. Plain `switchWorkspace` (an existing workspace) deliberately
   * leaves focus alone, since that's just navigating back to work already
   * in progress there.
   * @param name Display name; defaults to "Workspace N".
   * @returns The full browser state after the workspace is created.
   */
  public createWorkspace(name?: string): BrowserState {
    if (this.workspaces.size >= MAX_WORKSPACES) {
      // A brand-new, tabless window (File > New Window) has nothing else to
      // show, so it lands on the first existing workspace instead.
      if (this.activeTabId === null) {
        const firstId = this.workspaces.keys().next().value as string;
        this.activeWorkspaceId = firstId;
        this.focusWorkspaceDefaultTab(firstId);
      }
      return this.getState();
    }
    const id = randomUUID();
    const color = WORKSPACE_COLORS[this.workspaces.size % WORKSPACE_COLORS.length]!;
    this.workspaces.set(id, {
      id,
      name: name?.trim() || `Workspace ${this.workspaces.size + 1}`,
      color,
    });
    const state = this.switchWorkspace(id);
    this.focusAddressBarPastTabLoad(state.activeTabId);
    return state;
  }

  /**
   * Creates a new workspace containing exactly one tab — moved there as
   * its first (and only) tab — and switches to it: `WorkspaceBar`'s
   * drag-onto-"+ New workspace" gesture. Builds the workspace directly
   * rather than via `createWorkspace` followed by `moveTabToWorkspace`:
   * `createWorkspace`'s own `switchWorkspace` call would open a fresh home
   * tab in it first (its usual empty-workspace fallback), leaving the
   * dragged tab second rather than first. Doesn't steal address-bar focus
   * the way `createWorkspace` does either — that tab already has real
   * content, unlike a brand-new empty one. A no-op if `tabId` doesn't exist.
   * @param tabId The tab to move into the new workspace.
   * @returns The full browser state after the change.
   */
  public createWorkspaceWithTab(tabId: string): BrowserState {
    if (!this.states.has(tabId) || this.workspaces.size >= MAX_WORKSPACES) {
      return this.getState();
    }
    const id = randomUUID();
    const color = WORKSPACE_COLORS[this.workspaces.size % WORKSPACE_COLORS.length]!;
    this.workspaces.set(id, {
      id,
      name: `Workspace ${this.workspaces.size + 1}`,
      color,
    });
    for (const memberId of this.registry.selectionContainingTab(tabId) ?? [tabId]) {
      this.moveTabToWorkspace(memberId, id);
    }
    return this.switchWorkspace(id);
  }

  /**
   * Creates a new workspace and reassigns one tab into it, like
   * `createWorkspaceWithTab`, but doesn't switch *this* window to it or
   * activate anything here — `tearOffTab`'s (main/index.ts) own
   * workspace half. The tab is about to be shown in a brand-new window
   * that doesn't exist yet, not this one, so this only needs to (a) give
   * it a fresh, standalone workspace of its own rather than colliding
   * with the real, now-shared "Home" (see `SharedTabRegistry`'s own doc
   * comment for why tearing off used to create a second, unrelated "Home"
   * before workspaces were shared), and (b) release it from wherever it's
   * currently mounted (`moveTabToWorkspace` already does this) — the new
   * window's own `activateTab` call handles actually mounting it once it
   * exists.
   * @param tabId The tab to give its own new workspace.
   * @returns The new workspace's id, or `null` if `tabId` doesn't exist.
   */
  public createStandaloneWorkspaceFor(tabId: string): string | null {
    if (!this.states.has(tabId) || this.workspaces.size >= MAX_WORKSPACES) {
      return null;
    }
    // A multi-selection is torn off together. Each one's view is detached
    // from its linked group first: the torn-off tabs become independent, and
    // the other windows' views of them stay where they are.
    const tornIds = this.registry.selectionContainingTab(tabId) ?? [tabId];
    for (const memberId of tornIds) {
      this.unlinkTab(memberId);
    }
    const id = randomUUID();
    const color = WORKSPACE_COLORS[this.workspaces.size % WORKSPACE_COLORS.length]!;
    this.workspaces.set(id, {
      id,
      name: `Workspace ${this.workspaces.size + 1}`,
      color,
    });
    // The source workspace keeps a fresh home tab if this was its last, rather
    // than being deleted: the tab is still mid-drag and has no window yet.
    this.moveTabToWorkspace(tabId, id, false);
    for (const memberId of tornIds.filter((memberId) => memberId !== tabId)) {
      this.moveTabToWorkspace(memberId, id, false);
    }
    return id;
  }

  /**
   * Switches which workspace's tabs are visible, restoring whichever tab
   * was last active there (or its first tab, or a fresh home tab if it has
   * none).
   * @param id The workspace to switch to.
   * @returns The full browser state after the switch.
   */
  public switchWorkspace(id: string): BrowserState {
    if (!this.workspaces.has(id) || id === this.activeWorkspaceId) {
      return this.getState();
    }
    this.activeWorkspaceId = id;
    this.selectedWorkspaceIds.clear();
    this.focusWorkspaceDefaultTab(id);
    return this.getState();
  }

  /**
   * Creates an independent "linked twin" of a browser tab — a brand-new
   * `WebContentsView` loaded to the same URL, in the same (shared, not
   * duplicated) workspace, but with its own separate scroll position, DOM
   * state, and navigation history from this point forward. This is what
   * "Open Workspace in New Window" (Ctrl+Shift+O) actually creates for
   * whichever tab is active: rather than relocating that tab's own view
   * (impossible for *every* tab in a workspace at once without leaving this
   * window's workspace empty — a `WebContentsView` can only ever be mounted
   * in one window at a time) or duplicating the whole workspace into a
   * separate one, this lets the very same page be viewed from two windows
   * simultaneously, each independently scrollable/interactive.
   *
   * The two stay *linked* on one axis only: navigating either one (typing a
   * new address, following a link) also navigates the other to match — see
   * `propagateLinkedNavigation`, wired into `wireEvents`'s own
   * `did-navigate`/`did-navigate-in-page` handlers — so they always agree on
   * *which page* even though each can be scrolled to a different part of
   * it. Highlights and comments need no extra wiring at all for this: both
   * already synchronize between any two tabs open to the same URL regardless
   * of any link (`HighlighterController`/`CommentController` key their sync
   * by URL string, not tab id).
   *
   * Deliberately does not activate the new tab in this window — it's meant
   * to be picked up by a *different* one via the ordinary cross-window
   * `activateTab` steal, so leaving it unmounted here means this window's
   * own currently active tab is never disrupted, not even for a moment.
   * @param tabId The browser tab to create a linked twin of.
   * @returns The new tab's id, or `null` if `tabId` isn't a live browser tab.
   */
  public createLinkedTwin(tabId: string): string | null {
    const state = this.states.get(tabId);
    if (!state || state.kind !== 'browser') {
      return null;
    }
    const twinId = this.createBrowserTabState(state.url, state.workspaceId);
    this.registry.addToLinkGroup(tabId, twinId);
    this.emitState();
    return twinId;
  }

  /**
   * Navigates a tab's linked twin (see `createLinkedTwin`) to match, if it
   * has one and isn't already there — called from every place a browser
   * tab's own URL actually changes (`wireEvents`'s `did-navigate`/
   * `did-navigate-in-page`). The "isn't already there" check is what stops
   * this from ping-ponging forever: navigating the twin triggers its own
   * `did-navigate`, which calls back in here for the *original* tab, but by
   * then the original's own state was already patched to the same URL
   * (synchronously, before this runs), so that second call is a no-op.
   * `navigate()` itself needs no window-ownership resolution to call
   * here — it only touches the shared `views`/`states` maps, so it works
   * identically regardless of which window currently has the twin mounted,
   * same as calling it on `this` always would for any tab id.
   * @param tabId The tab whose URL just changed.
   * @param url Its new URL.
   */
  private propagateLinkedNavigation(tabId: string, url: string): void {
    for (const memberId of this.registry.getLinkGroup(tabId) ?? []) {
      const memberState = this.states.get(memberId);
      if (memberId === tabId || !memberState || memberState.kind !== 'browser' || memberState.url === url) {
        continue;
      }
      this.navigate(memberId, url);
    }
  }

  /** Removes a tab's link to its twin (see `createLinkedTwin`), if it has one — call when either tab closes, so the survivor goes back to being an ordinary, unlinked tab rather than pointing at a partner that no longer exists. */
  private unlinkTab(tabId: string): void {
    this.registry.removeFromLinkGroup(tabId);
  }

  /**
   * Whether a tab belongs in *this* window's own tab bar — `getState`'s own
   * per-window filter. An ordinary (unlinked) tab always does; a linked pair
   * (see `createLinkedTwin`) is meant to read as a single tab, so only one
   * half of it is ever listed for a given window: whichever half this
   * window actually owns (`registry.mountOwners`), so each window's tab bar
   * reflects its own live view rather than always showing the original.
   * Neither half owned by this window at all (both currently backgrounded
   * elsewhere) falls back to always listing the original — the one
   * `createLinkedTwin` was called *on*, not the one it created — so the pair
   * never both vanish from a window's tab bar and never show two rows for
   * what only ever reads as one tab. This only ever hides at most one entry
   * per window; every other window still lists whichever half it owns.
   */
  private shouldListTabForThisWindow(tabId: string): boolean {
    const group = this.registry.getLinkGroup(tabId);
    if (!group) {
      return true;
    }
    if (this.registry.mountOwners.get(tabId) === this) {
      return true;
    }
    if (group.some((memberId) => memberId !== tabId && this.registry.mountOwners.get(memberId) === this)) {
      return false;
    }
    return group[0] === tabId;
  }

  /**
   * Ids of the tabs this window's tab bar lists, in tab-strip order. A
   * linked group sits where its canonical (original) member is, no matter
   * which member this window actually shows, so switching between windows
   * never makes a tab jump to the end of the strip.
   * @param workspaceId Restrict to one workspace, or omit for every workspace.
   */
  private listedTabIds(workspaceId?: string): string[] {
    const order = new Map<string, number>();
    Array.from(this.states.keys()).forEach((tabId, index) => order.set(tabId, index));
    const position = (tabId: string): number => order.get(this.registry.getLinkGroup(tabId)?.[0] ?? tabId) ?? 0;
    return Array.from(this.states.entries())
      .filter(([tabId, state]) => (workspaceId === undefined || state.workspaceId === workspaceId) && this.shouldListTabForThisWindow(tabId))
      .map(([tabId]) => tabId)
      .sort((a, b) => position(a) - position(b));
  }

  /**
   * Renames a workspace. A no-op if it doesn't exist or the name is blank.
   * @param id The workspace to rename.
   * @param name The new display name.
   * @returns The full browser state after the change.
   */
  public renameWorkspace(id: string, name: string): BrowserState {
    const workspace = this.workspaces.get(id);
    const trimmed = name.trim();
    if (!workspace || !trimmed) {
      return this.getState();
    }
    this.workspaces.set(id, { ...workspace, name: trimmed });
    this.emitState();
    return this.getState();
  }

  /**
   * Removes a workspace and closes every tab in it. Refuses to remove the
   * last remaining workspace — there must always be at least one.
   * @param id The workspace to remove.
   * @returns The full browser state after the change.
   */
  public removeWorkspace(id: string): BrowserState {
    if (this.workspaces.size <= 1 || !this.workspaces.has(id)) {
      return this.getState();
    }

    for (const [tabId, state] of Array.from(this.states.entries())) {
      if (state.workspaceId !== id) {
        continue;
      }
      if (state.kind === 'terminal') {
        this.terminals.dispose(tabId);
      }
      const view = this.views.get(tabId);
      if (view) {
        this.window.contentView.removeChildView(view);
      }
      this.views.delete(tabId);
      this.states.delete(tabId);
      this.registry.zoomPercentByTabId.delete(tabId);
      this.highlighter.disposeTab(tabId);
      this.commentController.disposeTab(tabId);
      this.textBoxController.disposeTab(tabId);
      this.penController.disposeTab(tabId);
      this.unlinkTab(tabId);
      if (this.grabbedTabId === tabId) {
        this.grabbedTabId = null;
      }
    }
    this.workspaces.delete(id);
    this.lastActiveTabIdByWorkspace.delete(id);

    if (this.activeWorkspaceId === id) {
      const fallbackId = this.workspaces.keys().next().value as string;
      this.activeWorkspaceId = fallbackId;
      this.activeTabId = null;
      this.focusWorkspaceDefaultTab(fallbackId);
    } else {
      this.emitState();
    }
    return this.getState();
  }

  /**
   * Closes every workspace except the active one (Ctrl+Shift+Alt+W), then
   * resets that survivor's own tabs via `closeAllTabs` — the workspace
   * equivalent of `closeAllTabs` itself, and routed through the same two
   * methods so it inherits their tab/workspace teardown instead of
   * duplicating it. Always ends with exactly one workspace containing
   * exactly one fresh home tab, same as pressing Ctrl+Alt+W repeatedly
   * until only one workspace is left, then Ctrl+Shift+W.
   * @returns The full browser state after the reset.
   */
  public closeAllWorkspaces(): BrowserState {
    const idsToRemove = Array.from(this.workspaces.keys()).filter(
      (id) => id !== this.activeWorkspaceId,
    );
    for (const id of idsToRemove) {
      this.removeWorkspace(id);
    }
    return this.closeAllTabs();
  }

  // ── Bookmarks ────────────────────────────────────────────────────────

  /** Saves a bookmark (a no-op if the URL is already saved). */
  public addBookmark(title: string, url: string): BrowserState {
    // The blank default page has no address worth saving.
    if (url === HOME_URL) {
      return this.getState();
    }
    this.bookmarkStore.add(title, url);
    this.historyController.pushBookmarksToAll();
    this.emitState();
    return this.getState();
  }

  /** Removes a bookmark by id. */
  public removeBookmark(id: string): BrowserState {
    this.bookmarkStore.remove(id);
    this.historyController.pushBookmarksToAll();
    this.syncPdfTabTitles();
    this.emitState();
    return this.getState();
  }

  /**
   * Bookmarks the given tab's current page, or un-bookmarks it if it's
   * already saved. A no-op if the tab doesn't exist (e.g. a stale
   * accelerator firing after the tab closed), or if it's showing the blank
   * default page (`HOME_URL`), which can't be bookmarked.
   * @param id The tab whose page to bookmark or un-bookmark.
   * @returns The full browser state after the change.
   */
  public toggleBookmark(id: string): BrowserState {
    const state = this.states.get(id);
    if (state?.kind === 'pdf') {
      // A PDF is bookmarked by its path on disk, and only once a file is open.
      const path = pdfFilePaths.get(id);
      if (!path) {
        return this.getState();
      }
      this.bookmarkStore.togglePdf(path);
      this.historyController.pushBookmarksToAll();
      this.syncPdfTabTitles();
      this.emitState();
      return this.getState();
    }
    if (!state || state.kind !== 'browser' || state.url === HOME_URL) {
      return this.getState();
    }
    this.bookmarkStore.toggle(state.title, state.url);
    this.historyController.pushBookmarksToAll();
    this.emitState();
    return this.getState();
  }

  /**
   * Bookmarks a PDF tab's open file under a name the user chose (the
   * bookmark popup's Save). The tab then goes by that name too.
   * @param id The PDF tab. A no-op if it isn't one or has no file open.
   * @param name What to call the bookmark.
   * @returns The full browser state after the change.
   */
  public addPdfBookmark(id: string, name: string): BrowserState {
    const path = this.states.get(id)?.kind === 'pdf' ? pdfFilePaths.get(id) : undefined;
    if (!path) {
      return this.getState();
    }
    this.bookmarkStore.addPdf(name, path);
    this.historyController.pushBookmarksToAll();
    this.syncPdfTabTitles();
    this.emitState();
    return this.getState();
  }

  /** What a PDF tab with this file open is titled: its bookmark's name if it has one, else the file's own name. */
  private pdfTabTitle(path: string): string {
    return this.bookmarkStore.findPdf(path)?.title ?? basename(path);
  }

  /** Re-titles every PDF tab from its file's bookmark (or lack of one) — call after bookmarks change. Doesn't emit; the caller does. */
  private syncPdfTabTitles(): void {
    for (const [id, state] of this.states) {
      if (state.kind !== 'pdf' || !state.filePath) {
        continue;
      }
      const title = this.pdfTabTitle(state.filePath);
      if (title !== state.title) {
        this.states.set(id, { ...state, title });
      }
    }
  }

  /**
   * Drops every PDF bookmark whose file no longer exists (moved, renamed
   * outside the app, or deleted) — the bookmark is disconnected from
   * anything — Run whenever an
   * empty PDF page loads or comes back (a new PDF tab, a closed file).
   */
  private async refreshPdfBookmarks(): Promise<void> {
    const paths = this.bookmarkStore.listPdfs().flatMap((bookmark) => (bookmark.path ? [bookmark.path] : []));
    const missing = (
      await Promise.all(paths.map(async (path) => ((await stat(path).then(() => true, () => false)) ? null : path)))
    ).filter((path): path is string => path !== null);
    if (this.bookmarkStore.removePdfPaths(missing)) {
      this.historyController.pushBookmarksToAll();
      this.syncPdfTabTitles();
      this.emitState();
    }
  }

  /**
   * Opens a bookmarked PDF in a PDF tab. If the file has gone missing since
   * the list was shown, its bookmark is dropped instead.
   * @param id The PDF tab to open it in.
   * @param bookmarkId The bookmark picked from the empty page's list.
   */
  public async openPdfBookmark(id: string, bookmarkId: string): Promise<void> {
    const bookmark = this.bookmarkStore.listPdfs().find((candidate) => candidate.id === bookmarkId);
    if (!bookmark?.path || this.states.get(id)?.kind !== 'pdf') {
      return;
    }
    if (!(await stat(bookmark.path).then(() => true, () => false))) {
      this.bookmarkStore.remove(bookmark.id);
      this.historyController.pushBookmarksToAll();
      this.syncPdfTabTitles();
      this.emitState();
      return;
    }
    await this.loadPdfFromPath(id, bookmark.path);
  }

  /**
   * Captures the active browser tab's current frame and hides its native
   * `WebContentsView` — what `BookmarkPopup` shows blurred behind itself
   * instead of the live page, since it's a true modal. The view has to
   * actually come off the window, not just be covered by chrome-drawn UI,
   * since it's a separate native surface layered above the chrome (same
   * reason `activateTab` needs `webContents.focus()` — see there) that
   * would otherwise render on top of the popup and swallow every click
   * meant for it. A no-op (returns `null`, nothing hidden) for anything
   * but the active browser or PDF tab.
   *
   * Not used by the address bar's suggestions dropdown or `ColorPicker` —
   * both have their own dedicated overlay `WebContentsView`s instead
   * (`SuggestionsOverlay`, `ColorPickerOverlay`), specifically so the page
   * never has to stop being live just because their dropdown is open.
   * @param id The tab to preview and hide.
   * @returns A data URL of the tab's last-painted frame, or `null` if it
   *   couldn't be captured — the view is hidden either way, and the popup
   *   falls back to a plain scrim.
   */
  public async beginTabPreview(id: string): Promise<string | null> {
    const view = this.views.get(id);
    const state = this.states.get(id);
    if (!view || !state || (state.kind !== 'browser' && state.kind !== 'pdf') || id !== this.activeTabId) {
      return null;
    }

    let dataUrl: string | null = null;
    try {
      const image = await view.webContents.capturePage();
      dataUrl = image.toDataURL();
    } catch {
      // Falls back to a plain scrim behind the popup — still fully
      // functional, just without the blurred page behind it.
    }

    this.window.contentView.removeChildView(view);
    return dataUrl;
  }

  /**
   * Re-shows the view `beginTabPreview` hid — called once whatever overlay
   * was using it closes, however it closed. A no-op if the tab closed or
   * stopped being active while the overlay was open.
   * @param id The tab to re-show.
   * @returns The full browser state after re-mounting it.
   */
  public restoreTabPreview(id: string): BrowserState {
    const view = this.views.get(id);
    if (view && id === this.activeTabId) {
      // Index 0 — see `activateTab`'s own `addChildView` call for why.
      this.window.contentView.addChildView(view, 0);
      view.setBounds(this.computeMainBounds(this.targetLeftInset(), this.targetTopInset()));
      view.webContents.focus();
    }
    return this.getState();
  }

  // ── Split view ───────────────────────────────────────────────────────

  /**
   * Puts the active tab and one other tab side by side. A no-op if either
   * id is invalid, they're the same tab, or either is a terminal tab —
   * split view is browser-tab-only by product decision (the renderer's own
   * tab/split pickers already exclude terminal tabs; this is the same rule
   * enforced on the main-process side too).
   * @param secondaryId The tab to show alongside the current active tab —
   *   stolen from whichever other window currently has it mounted, if
   *   any, same as `activateTab`.
   * @returns The full browser state after the change.
   */
  public enterSplitView(secondaryId: string): BrowserState {
    const primaryId = this.activeTabId;
    if (!primaryId || primaryId === secondaryId) {
      return this.getState();
    }
    const secondaryView = this.views.get(secondaryId);
    if (!secondaryView || !this.views.has(primaryId)) {
      return this.getState();
    }
    if (this.states.get(primaryId)?.kind !== 'browser' || this.states.get(secondaryId)?.kind !== 'browser') {
      return this.getState();
    }

    const owner = this.registry.mountOwners.get(secondaryId);
    if (owner && owner !== this) {
      owner.releaseTab(secondaryId);
    }

    this.teardownSplitView();
    this.splitView = { primaryTabId: primaryId, secondaryTabId: secondaryId };
    this.registry.detachViewFromAllWindows(secondaryView);
    // Index 0 — see `activateTab`'s own `addChildView` call for why.
    this.window.contentView.addChildView(secondaryView, 0);
    this.registry.mountOwners.set(secondaryId, this);
    this.updateBounds();
    this.emitState();
    return this.getState();
  }

  /** Exits split view, leaving the primary tab shown at full width. */
  public exitSplitView(): BrowserState {
    if (!this.splitView) {
      return this.getState();
    }
    this.teardownSplitView();
    this.updateBounds();
    this.emitState();
    return this.getState();
  }

  // ── Focus mode ───────────────────────────────────────────────────────

  /**
   * Toggles Focus Mode: puts the window into true OS fullscreen (covering
   * the taskbar too) and slides away every bit of chrome — titlebar, tab
   * strip, toolbar, sidebar — so only the page fills the screen, animating
   * the native content's bounds in step with the chrome's own CSS
   * transition the same way `toggleSidebar` already does (see
   * `animateBoundsInset`). Exits the same way, back to the window's prior
   * (non-fullscreen) bounds.
   * @param enabled Whether Focus Mode should be on.
   * @returns The full browser state after the change.
   */
  public setFocusMode(enabled: boolean): BrowserState {
    const fromLeft = this.targetLeftInset();
    const fromTop = this.targetTopInset();
    this.focusMode = enabled;
    this.window.setFullScreen(enabled);
    this.emitState();
    this.animateBoundsInset(fromLeft, this.targetLeftInset(), fromTop, this.targetTopInset());
    return this.getState();
  }

  /** Toggles Focus Mode to whichever state it isn't currently in. */
  public toggleFocusMode(): BrowserState {
    return this.setFocusMode(!this.focusMode);
  }

  // ── Annotation tool availability ─────────────────────────────────────

  /**
   * Whether a pointer tool may be switched on right now: the single rule
   * behind each toolbar button's `disabled` state (`PageActions`), enforced
   * here so no other path to the same toggle — the menu accelerators, the
   * tab views' own key handling, a direct IPC call — can turn on a tool its
   * button shows as disabled.
   *
   * Every tool needs an active tab, and none works on a History tab. Beyond the
   * laser pointer, none can mark a terminal or a PDF tab with no file open, and the crop tool only exists
   * for a PDF.
   * @param tool Which tool is being switched on.
   * @returns Whether it may be.
   */
  private canEnableTool(tool: 'laser' | 'highlighter' | 'pen' | 'comment' | 'text' | 'crop'): boolean {
    const active = this.activeTabId ? this.states.get(this.activeTabId) : undefined;
    if (!active) {
      return false;
    }
    if (tool === 'laser') {
      return active.kind !== 'history';
    }
    if (active.kind === 'terminal' || active.kind === 'history' || (active.kind === 'pdf' && active.fileName === null)) {
      return false;
    }
    return tool !== 'crop' || active.kind === 'pdf';
  }

  /** Turns off any tool that's on but unavailable on the now-active tab (`canEnableTool`) — call when a tab is activated or a PDF is closed, since a tool left on would mark nothing and its button would sit pressed and disabled. */
  private releaseUnavailableTools(): void {
    if (this.highlighterActive && !this.canEnableTool('highlighter')) {
      this.setHighlighter(false);
    }
    if (this.commentToolActive && !this.canEnableTool('comment')) {
      this.setCommentTool(false);
    }
    if (this.textToolActive && !this.canEnableTool('text')) {
      this.setTextTool(false);
    }
    if (this.penActive && !this.canEnableTool('pen')) {
      this.setPen(false);
    }
    if (this.cropActive && !this.canEnableTool('crop')) {
      this.setCrop(false);
    }
  }

  // ── Laser pointer ────────────────────────────────────────────────────

  /**
   * Turns the laser pointer overlay on or off (Ctrl+I, or `PageActions`'
   * toolbar button) — see `LaserPointerOverlay`. Unlike Focus Mode, this
   * never changes the window's own bounds, so there's no animation here:
   * `syncLaserPointerOverlay` just (un)mounts the overlay view in place.
   * @param enabled Whether the laser pointer should be on.
   * @returns The full browser state after the change.
   */
  public setLaserPointer(enabled: boolean): BrowserState {
    // Same rule as the toolbar button's disabled state — see `canEnableTool`.
    if (enabled && !this.canEnableTool('laser')) {
      return this.getState();
    }
    // Mutually exclusive with the highlighter, the comment tool, and the pen
    // — all four are full-window "the pointer does something else now"
    // modes, and having more than one on at once made no sense (each one's
    // own cursor/click-suppression would think it alone owns the pointer).
    if (enabled && this.highlighterActive) {
      this.setHighlighter(false);
    }
    if (enabled && this.commentToolActive) {
      this.setCommentTool(false);
    }
    if (enabled && this.textToolActive) {
      this.setTextTool(false);
    }
    if (enabled && this.penActive) {
      this.setPen(false);
    }
    if (enabled && this.cropActive) {
      this.setCrop(false);
    }
    this.laserPointerActive = enabled;
    this.syncLaserPointerOverlay();
    this.emitState();
    return this.getState();
  }

  /** Toggles the laser pointer to whichever state it isn't currently in. */
  public toggleLaserPointer(): BrowserState {
    return this.setLaserPointer(!this.laserPointerActive);
  }

  /**
   * Turns off the laser pointer, highlighter, comment tool, and/or pen,
   * whichever is on — Escape's own "back to the plain pointer" behavior
   * (`wireSharedInputHandling`), alongside its existing Focus Mode exit.
   * Turns off all four together rather than one press per tool, if more
   * than one somehow ended up on at once.
   * @returns Whether any tool was actually on (and is now off) — callers use
   *   this to decide whether Escape should be treated as handled.
   */
  private exitPointerTools(): boolean {
    const wasOn =
      this.laserPointerActive ||
      this.highlighterActive ||
      this.commentToolActive ||
      this.textToolActive ||
      this.penActive ||
      this.cropActive;
    if (this.laserPointerActive) {
      this.setLaserPointer(false);
    }
    if (this.highlighterActive) {
      this.setHighlighter(false);
    }
    if (this.commentToolActive) {
      this.setCommentTool(false);
    }
    if (this.textToolActive) {
      this.setTextTool(false);
    }
    if (this.penActive) {
      this.setPen(false);
    }
    if (this.cropActive) {
      this.setCrop(false);
    }
    return wasOn;
  }

  /**
   * Applies the laser pointer's current on/off state to its overlay,
   * sized to whatever the active tab's own view currently occupies. Called
   * whenever that could have changed: `setLaserPointer` itself, and every
   * `applyBounds` call (resize, sidebar toggle, Focus Mode's bounds
   * animation) — so the overlay never drifts out of alignment with the tab
   * view beneath it. Off entirely when there's no active tab, same as the
   * tab view itself would be.
   */
  private syncLaserPointerOverlay(): void {
    const left = this.targetLeftInset();
    const top = this.targetTopInset();
    this.laserPointerOverlay.setActive(
      this.laserPointerActive && this.activeTabId !== null,
      this.computeMainBounds(left, top),
    );
  }

  // ── Highlighter ──────────────────────────────────────────────────────

  /**
   * Turns the highlighter tool on or off (Ctrl+J, or `PageActions`' toolbar
   * button) for this window. Unlike the laser pointer, there's no separate
   * overlay to (un)mount — the active tab's own preload
   * (`src/preload/tabHighlighter.ts`) does the cursor/selection/mark work
   * directly in the page, so this just pushes the new state down to it (see
   * `HighlighterController.syncState`).
   * @param enabled Whether the highlighter tool should be on.
   * @returns The full browser state after the change.
   */
  public setHighlighter(enabled: boolean): BrowserState {
    // Same rule as the toolbar button's disabled state — see `canEnableTool`.
    if (enabled && !this.canEnableTool('highlighter')) {
      return this.getState();
    }
    // Mutually exclusive with the laser pointer, the comment tool, and the
    // pen — see `setLaserPointer`'s own comment.
    if (enabled && this.laserPointerActive) {
      this.setLaserPointer(false);
    }
    if (enabled && this.commentToolActive) {
      this.setCommentTool(false);
    }
    if (enabled && this.textToolActive) {
      this.setTextTool(false);
    }
    if (enabled && this.penActive) {
      this.setPen(false);
    }
    if (enabled && this.cropActive) {
      this.setCrop(false);
    }
    this.highlighterActive = enabled;
    this.pushHighlighterState();
    this.nudgeActiveTabCursor();
    this.emitState();
    return this.getState();
  }

  /** Toggles the highlighter tool to whichever state it isn't currently in. */
  public toggleHighlighter(): BrowserState {
    return this.setHighlighter(!this.highlighterActive);
  }

  /** Whether this window currently has the highlighter tool on — read by `main/index.ts`'s accent-color broadcast to tell a tab's preload the right cursor/selection state alongside its repainted highlight color, for whichever window currently has that specific tab mounted. */
  public isHighlighterActive(): boolean {
    return this.highlighterActive;
  }

  // ── Comment tool ─────────────────────────────────────────────────────

  /**
   * Turns the comment tool on or off (Ctrl+M, or `PageActions`' toolbar
   * button) for this window — see `CommentController`. Like the highlighter,
   * there's no separate overlay to (un)mount; the active tab's own preload
   * (`src/preload/tabComments.ts`) does the drop/edit/pin work directly in
   * the page, so this just pushes the new state down to it.
   * @param enabled Whether the comment tool should be on.
   * @returns The full browser state after the change.
   */
  public setCommentTool(enabled: boolean): BrowserState {
    // Same rule as the toolbar button's disabled state — see `canEnableTool`.
    if (enabled && !this.canEnableTool('comment')) {
      return this.getState();
    }
    // Mutually exclusive with the laser pointer, the highlighter, and the
    // pen — see `setLaserPointer`'s own comment.
    if (enabled && this.laserPointerActive) {
      this.setLaserPointer(false);
    }
    if (enabled && this.highlighterActive) {
      this.setHighlighter(false);
    }
    if (enabled && this.penActive) {
      this.setPen(false);
    }
    if (enabled && this.cropActive) {
      this.setCrop(false);
    }
    if (enabled && this.textToolActive) {
      this.setTextTool(false);
    }
    this.commentToolActive = enabled;
    this.pushCommentToolState();
    this.nudgeActiveTabCursor();
    this.emitState();
    return this.getState();
  }

  /** Toggles the comment tool to whichever state it isn't currently in. */
  public toggleCommentTool(): BrowserState {
    return this.setCommentTool(!this.commentToolActive);
  }

  /** Pushes this window's current comment-tool on/off state to whichever tab is active — call whenever that could have changed: `setCommentTool` itself and `activateTab`. */
  private pushCommentToolState(): void {
    if (this.activeTabId) {
      this.commentController.syncState(this.activeTabId, this.commentToolActive);
    }
  }

  /** Pushes this window's current comment-tool on/off state to a specific tab, active or not — `wireEvents`'s own `dom-ready` handler uses this directly, same reasoning as `pushHighlighterStateTo`. */
  private pushCommentToolStateTo(tabId: string): void {
    this.commentController.syncState(tabId, this.commentToolActive);
  }

  /** Whether this window currently has the comment tool on — read by `main/index.ts`'s accent-color broadcast, same reasoning as `isHighlighterActive`. */
  public isCommentToolActive(): boolean {
    return this.commentToolActive;
  }

  // ── Text box tool ────────────────────────────────────────────────────

  /**
   * Turns the text box tool on or off (Ctrl+E, or `PageActions`' toolbar
   * button) for this window — see `TextBoxController`. A browser tab's
   * preload (`src/preload/tabTextBoxes.ts`) and a PDF tab's page both do the
   * drop/edit work themselves; this just pushes the new state down.
   * @param enabled Whether the text box tool should be on.
   * @returns The full browser state after the change.
   */
  public setTextTool(enabled: boolean): BrowserState {
    // Same rule as the toolbar button's disabled state — see `canEnableTool`.
    if (enabled && !this.canEnableTool('text')) {
      return this.getState();
    }
    // Mutually exclusive with the other pointer tools — see `setLaserPointer`'s own comment.
    if (enabled && this.laserPointerActive) {
      this.setLaserPointer(false);
    }
    if (enabled && this.highlighterActive) {
      this.setHighlighter(false);
    }
    if (enabled && this.commentToolActive) {
      this.setCommentTool(false);
    }
    if (enabled && this.penActive) {
      this.setPen(false);
    }
    if (enabled && this.cropActive) {
      this.setCrop(false);
    }
    this.textToolActive = enabled;
    this.pushTextToolState();
    this.nudgeActiveTabCursor();
    this.emitState();
    return this.getState();
  }

  /** Toggles the text box tool; does nothing on a terminal tab, where the shortcut mustn't switch on an invisible tool. */
  public toggleTextTool(): BrowserState {
    const active = this.activeTabId ? this.states.get(this.activeTabId) : undefined;
    if (!this.textToolActive && active?.kind === 'terminal') {
      return this.getState();
    }
    return this.setTextTool(!this.textToolActive);
  }

  /** Pushes this window's text-tool on/off state to whichever tab is active — call on `setTextTool` and `activateTab`. */
  private pushTextToolState(): void {
    if (this.activeTabId) {
      this.pushTextToolStateTo(this.activeTabId);
    }
  }

  /** Pushes this window's text-tool on/off state to a specific tab, active or not — a fresh document's preload has never been told. */
  private pushTextToolStateTo(tabId: string): void {
    this.textBoxController.syncState(tabId, this.textToolActive);
  }

  /** Whether this window currently has the text box tool on — read by `main/index.ts`'s accent-color broadcast. */
  public isTextToolActive(): boolean {
    return this.textToolActive;
  }

  // ── Pen ──────────────────────────────────────────────────────────────

  /**
   * Turns the pen tool on or off (Ctrl+P, or `PageActions`' toolbar button)
   * for this window. Like the highlighter/comment tool, there's no separate
   * overlay to (un)mount; the active tab's own preload
   * (`src/preload/tabPen.ts`) does the draw/hover/delete work directly in
   * the page, so this just pushes the new state down to it.
   * @param enabled Whether the pen tool should be on.
   * @returns The full browser state after the change.
   */
  public setPen(enabled: boolean): BrowserState {
    // Same rule as the toolbar button's disabled state — see `canEnableTool`.
    if (enabled && !this.canEnableTool('pen')) {
      return this.getState();
    }
    // Mutually exclusive with the laser pointer, the highlighter, and the
    // comment tool — see `setLaserPointer`'s own comment.
    if (enabled && this.laserPointerActive) {
      this.setLaserPointer(false);
    }
    if (enabled && this.highlighterActive) {
      this.setHighlighter(false);
    }
    if (enabled && this.commentToolActive) {
      this.setCommentTool(false);
    }
    if (enabled && this.textToolActive) {
      this.setTextTool(false);
    }
    if (enabled && this.cropActive) {
      this.setCrop(false);
    }
    this.penActive = enabled;
    this.pushPenState();
    this.nudgeActiveTabCursor();
    this.emitState();
    return this.getState();
  }

  /** Toggles the pen tool to whichever state it isn't currently in. */
  public togglePen(): BrowserState {
    return this.setPen(!this.penActive);
  }

  /** Whether this window currently has the pen tool on — read by `main/index.ts`'s accent-color broadcast, same reasoning as `isHighlighterActive`. */
  public isPenActive(): boolean {
    return this.penActive;
  }

  /** Pushes this window's current pen on/off state to whichever tab is active — call whenever that could have changed: `setPen` itself and `activateTab`. */
  private pushPenState(): void {
    if (this.activeTabId) {
      this.pushPenStateTo(this.activeTabId);
    }
  }

  /** Pushes this window's current pen on/off state to a specific tab, active or not — `wireEvents`'s own `dom-ready` handler uses this directly, same reasoning as `pushHighlighterStateTo`. */
  private pushPenStateTo(tabId: string): void {
    this.penController.syncState(tabId, this.penActive);
  }

  // ── Crop ─────────────────────────────────────────────────────────────

  /**
   * Turns the PDF crop tool on or off (Ctrl+Shift+X, or `PageActions`' toolbar
   * button) for this window. Only a PDF tab's page draws anything for it; the
   * boxes themselves are edited in the page and persisted with the document's
   * other marks (see `PdfAnnotationStore`).
   * @param enabled Whether the crop tool should be on.
   * @returns The full browser state after the change.
   */
  public setCrop(enabled: boolean): BrowserState {
    // Same rule as the toolbar button's disabled state — see `canEnableTool`.
    if (enabled && !this.canEnableTool('crop')) {
      return this.getState();
    }
    // Mutually exclusive with the other pointer tools — see `setLaserPointer`'s own comment.
    if (enabled && this.laserPointerActive) {
      this.setLaserPointer(false);
    }
    if (enabled && this.highlighterActive) {
      this.setHighlighter(false);
    }
    if (enabled && this.commentToolActive) {
      this.setCommentTool(false);
    }
    if (enabled && this.textToolActive) {
      this.setTextTool(false);
    }
    if (enabled && this.penActive) {
      this.setPen(false);
    }
    this.cropActive = enabled;
    this.pushCropState();
    // The page needs keyboard focus to see Shift (multi-crop) and Ctrl+Z; a toolbar click leaves it with the chrome.
    const activeView = enabled && this.activeTabId ? this.views.get(this.activeTabId) : undefined;
    if (activeView && this.states.get(this.activeTabId!)?.kind === 'pdf' && !activeView.webContents.isDestroyed()) {
      activeView.webContents.focus();
    }
    this.emitState();
    return this.getState();
  }

  /** Toggles the crop tool; does nothing unless the active tab is a PDF (there is nothing to crop elsewhere, and the shortcut mustn't switch on an invisible tool). */
  public toggleCrop(): BrowserState {
    const active = this.activeTabId ? this.states.get(this.activeTabId) : undefined;
    if (!this.cropActive && active?.kind !== 'pdf') {
      return this.getState();
    }
    return this.setCrop(!this.cropActive);
  }

  /** Pushes the crop tool's on/off state to whichever tab is active — call on `setCrop` and `activateTab`. */
  private pushCropState(): void {
    if (this.activeTabId) {
      this.pushCropStateTo(this.activeTabId);
    }
  }

  /** Pushes the crop tool's on/off state to one PDF tab (others have no crop tool, so they're never told). */
  private pushCropStateTo(tabId: string): void {
    const view = this.views.get(tabId);
    if (view && !view.webContents.isDestroyed() && this.states.get(tabId)?.kind === 'pdf') {
      view.webContents.send(IpcChannel.PdfCropState, { active: this.cropActive });
    }
  }

  // ── Revert page ──────────────────────────────────────────────────────

  /**
   * Reverts a tab's page back to how it looked before any highlighting,
   * drawing, or commenting on it — Ctrl+Shift+R, or `PageActions`' toolbar
   * button. Unlike the laser pointer/highlighter/comment tool/pen, this
   * isn't a toggle: it's a single one-shot action with no on/off state of
   * its own, so it doesn't touch
   * `laserPointerActive`/`highlighterActive`/`commentToolActive`/`penActive`
   * at all. A no-op for a tab that doesn't exist or isn't a browser tab — a
   * terminal has none of the three to revert.
   * @param id The tab to revert.
   * @returns The full browser state (unchanged by this action beyond
   *   whatever `HighlighterController`/`CommentController`/`PenController`
   *   push to the tab's own preload).
   */
  public revertPage(id: string): BrowserState {
    if (this.states.get(id)?.kind === 'browser') {
      this.highlighter.clearTab(id);
      this.commentController.clearTab(id);
      this.textBoxController.clearTab(id);
      this.penController.clearTab(id);
    } else if (this.states.get(id)?.kind === 'pdf') {
      // The page clears its own marks and reports the empty set back, which removes them from the store too.
      this.views.get(id)?.webContents.send(IpcChannel.PdfClear);
    }
    return this.getState();
  }

  /** Pushes this window's current highlighter on/off state to whichever tab is active — call whenever that could have changed: `setHighlighter` itself and `activateTab` (a different tab is now the one showing it). */
  private pushHighlighterState(): void {
    if (this.activeTabId) {
      this.pushHighlighterStateTo(this.activeTabId);
    }
  }

  /** Pushes this window's current highlighter on/off state to a specific tab, active or not — `wireEvents`' own `dom-ready` handler uses this directly (rather than `pushHighlighterState`) since a fresh document has a fresh preload that's never been told anything, whether or not that tab happens to be the active one right now. */
  private pushHighlighterStateTo(tabId: string): void {
    // Terminal tabs have no highlighter; never tell one it's on.
    this.highlighter.syncState(tabId, this.highlighterActive && this.states.get(tabId)?.kind !== 'terminal');
  }

  /**
   * Forces Chromium to immediately re-evaluate the active tab's cursor at
   * its current position, rather than leaving the old pointer shape on
   * screen until the next time the mouse actually moves. A CSS `cursor`
   * change alone doesn't repaint on its own — Chromium only calls the OS's
   * `SetCursor` while processing a real input event, never as a side effect
   * of style recalculation — so toggling the highlighter tool while the
   * mouse sits still left the pointer showing whatever it was already
   * showing. Synthesizes a zero-distance `mouseMove` through
   * `sendInputEvent` (a real input event injected into Chromium's own
   * pipeline, unlike a DOM-dispatched `MouseEvent`, which never reaches the
   * OS cursor at all) at the cursor's actual current screen position,
   * translated into the active tab's own view-local coordinates. A no-op if
   * there's no active tab or the cursor isn't currently over its content
   * area (e.g. it's sitting over the toolbar when Ctrl+J is pressed) —
   * nothing to nudge in either case.
   */
  private nudgeActiveTabCursor(): void {
    if (!this.activeTabId) {
      return;
    }
    const view = this.views.get(this.activeTabId);
    if (!view) {
      return;
    }
    const main = this.computeMainBounds(this.targetLeftInset(), this.targetTopInset());
    // `activeTabId` is always the primary (left) pane during split view —
    // see this class's own doc comment — so there's no case where it's
    // showing in the secondary pane instead.
    const bounds = this.splitView ? this.computeSplitBoundsFor(main).primary : main;
    const cursor = screen.getCursorScreenPoint();
    const contentBounds = this.window.getContentBounds();
    const x = cursor.x - contentBounds.x - bounds.x;
    const y = cursor.y - contentBounds.y - bounds.y;
    if (x < 0 || y < 0 || x > bounds.width || y > bounds.height) {
      return;
    }
    view.webContents.sendInputEvent({ type: 'mouseMove', x, y });
  }

  // ── Zoom ─────────────────────────────────────────────────────────────

  /**
   * Zooms in on the active tab's own content — its `WebContentsView` only,
   * never `this.window.webContents` (the chrome's sidebar, tab strip, and
   * toolbar), which is what Electron's built-in `zoomIn` menu role would
   * otherwise zoom instead. Works identically for a terminal tab, since
   * it's just as much its own `WebContentsView` as a browser tab's page.
   * @returns The full browser state after the change, including the new
   *   `zoomPercent` (`ZoomPercentInput` reads it from there).
   */
  public zoomIn(): BrowserState {
    this.adjustZoom(ZOOM_PERCENT_STEP);
    return this.getState();
  }

  /** Zooms out on the active tab's own content. See `zoomIn`. */
  public zoomOut(): BrowserState {
    this.adjustZoom(-ZOOM_PERCENT_STEP);
    return this.getState();
  }

  /** Resets the active tab's own content back to its native 100% zoom. */
  public resetZoom(): BrowserState {
    if (this.activeTabId && this.isZoomable(this.activeTabId)) {
      this.setZoomPercent(this.activeTabId, ZOOM_PERCENT_DEFAULT);
    }
    return this.getState();
  }

  /**
   * Sets the active tab's zoom to an exact percent — `ZoomPercentInput`,
   * typing a number directly rather than stepping by `ZOOM_PERCENT_STEP`.
   * Clamped and rounded to a whole number regardless of what's passed; the
   * input itself already restricts what a person can type to digits within
   * range (see that component), but this is the actual enforcement point.
   * @param percent The requested zoom percent.
   * @returns The full browser state after the change.
   */
  public setZoom(percent: number): BrowserState {
    if (this.activeTabId && this.isZoomable(this.activeTabId)) {
      this.setZoomPercent(this.activeTabId, clampZoomPercent(percent));
    }
    return this.getState();
  }

  /**
   * One Ctrl+mouse-wheel tick on a tab's own view: steps that tab's zoom by
   * `ZOOM_PERCENT_WHEEL_STEP`. Resolved from the sender's `webContents`
   * (a tab's preload doesn't know its own id), and acts on that tab rather
   * than `activeTabId` — wheel events only reach a visible view, but in
   * split view the one under the pointer needn't be the active one.
   * @param sender The `webContents` the wheel event came from.
   * @param direction `1` to zoom in, `-1` to zoom out.
   */
  public wheelZoom(sender: WebContents, direction: 1 | -1): void {
    for (const [id, view] of this.views) {
      if (view.webContents === sender) {
        if (!this.isZoomable(id)) {
          return;
        }
        const current = this.registry.zoomPercentByTabId.get(id) ?? ZOOM_PERCENT_DEFAULT;
        this.setZoomPercent(id, clampZoomPercent(current + direction * ZOOM_PERCENT_WHEEL_STEP));
        return;
      }
    }
  }

  /**
   * @param deltaPercent `±ZOOM_PERCENT_STEP`.
   */
  /** Whether a tab can be zoomed: every kind but the History tab, whose page is a fixed-size table with no zoom control. */
  private isZoomable(id: string): boolean {
    return this.states.get(id)?.kind !== 'history';
  }

  private adjustZoom(deltaPercent: number): void {
    if (!this.activeTabId || !this.isZoomable(this.activeTabId)) {
      return;
    }
    const current = this.registry.zoomPercentByTabId.get(this.activeTabId) ?? ZOOM_PERCENT_DEFAULT;
    this.setZoomPercent(this.activeTabId, clampZoomPercent(current + deltaPercent));
  }

  /**
   * Records `id`'s zoom percent, pushes it to that tab's own view (see
   * `applyZoom`), and pushes the change to every window's own renderer —
   * unlike `applyZoom` alone (also called after a fresh navigation, where
   * nothing about the zoom itself changed), this is the entry point that
   * actually changes what `zoomPercent` a person reading `BrowserState`
   * sees.
   * @param id The tab to zoom.
   * @param percent The new zoom percent (already clamped by the caller).
   */
  private setZoomPercent(id: string, percent: number): void {
    this.registry.zoomPercentByTabId.set(id, percent);
    this.applyZoom(id);
    this.emitState();
  }

  /**
   * Re-sends `id`'s current stored zoom percent to its own view — via its
   * preload's `zoom:apply` listener (`webFrame.setZoomLevel`, converting
   * from percent to Chromium's own logarithmic units right at the point of
   * sending), not `view.webContents.zoomLevel` set directly from here.
   * That setter applies **per origin**, shared by every `webContents`
   * currently showing (or later loading) the same origin — which, since a
   * terminal tab's `terminal.html` and the chrome's own page are typically
   * served from the very same origin (the dev server in development; a
   * `file:`/custom-protocol origin in a packaged build too, depending on
   * how the chrome and a tab happen to be loaded), meant zooming a
   * terminal tab also silently zoomed the sidebar and toolbar right along
   * with it. `webFrame.setZoomLevel`, called from inside that specific
   * renderer instead, is scoped to that one frame only.
   *
   * Called both by `setZoomPercent` (something actually changed) and by
   * `wireEvents`'s `did-finish-load` (nothing changed, but a fresh
   * navigation is a fresh document, which resets `webFrame`'s own
   * frame-local zoom back to 0 unless this reapplies whatever the tab's
   * own zoom actually is). A no-op if the tab was never zoomed (nothing
   * stored, native 100% is already correct) or no longer exists.
   * @param id The tab whose stored zoom percent to (re)apply.
   */
  private applyZoom(id: string): void {
    const percent = this.registry.zoomPercentByTabId.get(id);
    if (percent === undefined) {
      return;
    }
    const zoomLevel = Math.log(percent / 100) / Math.log(1.2);
    this.views.get(id)?.webContents.send(IpcChannel.ZoomApply, zoomLevel);
  }

  // ── Sidebar ──────────────────────────────────────────────────────────

  /**
   * Shows or hides the workspace sidebar, animating both the native tab
   * content's bounds and (via the pushed `sidebarVisible` state) the
   * sidebar's own CSS transition together, so the content edge and the
   * sliding sidebar move in step instead of one snapping ahead of the
   * other. The top inset doesn't move — `fromTop`/`toTop` are both
   * whatever Focus Mode currently has it at.
   * @returns The full browser state after the change (the animation
   *   itself keeps running past this point; bounds settle asynchronously).
   */
  public toggleSidebar(): BrowserState {
    // Captured before flipping the flag below, same reasoning as
    // `setFocusMode`'s own `fromLeft` — whatever the sidebar is actually
    // showing right now (which, mid-Focus-Mode, is 0 regardless of
    // `sidebarVisible` — see `targetLeftInset`), not assumed from the old
    // `sidebarVisible` value alone the way this used to (wrongly animating
    // from `SIDEBAR_WIDTH_PX`/0 even while Focus Mode already had it at 0).
    const fromLeft = this.targetLeftInset();
    this.sidebarVisible = !this.sidebarVisible;
    this.emitState();
    const top = this.targetTopInset();
    this.animateBoundsInset(fromLeft, this.targetLeftInset(), top, top);
    return this.getState();
  }

  /**
   * Drives the sidebar's and/or chrome's show/hide transition frame by
   * frame, since a native `WebContentsView`'s bounds — unlike a CSS
   * `width`/`height` — don't animate on their own. Used by both
   * `toggleSidebar` (left inset only) and `setFocusMode` (left and top
   * together, since entering Focus Mode hides the sidebar too). Cancels
   * itself if superseded by a newer call (`boundsAnimationToken` changes)
   * so rapid toggles don't fight over the view's bounds.
   * @param fromLeft Left inset at the start of the animation.
   * @param toLeft Left inset the animation settles on.
   * @param fromTop Top inset at the start of the animation.
   * @param toTop Top inset the animation settles on.
   */
  private animateBoundsInset(fromLeft: number, toLeft: number, fromTop: number, toTop: number): void {
    const token = ++this.boundsAnimationToken;
    this.isAnimatingBounds = true;
    const start = Date.now();
    const step = (): void => {
      if (token !== this.boundsAnimationToken) {
        return;
      }
      const t = Math.min(1, (Date.now() - start) / SIDEBAR_TOGGLE_DURATION_MS);
      // Ease-out cubic — matches the `cubic-bezier(0.33, 1, 0.68, 1)` timing
      // function on the sidebar's and chrome's own CSS transitions (see
      // workspace-bar.css and app.css).
      const eased = 1 - (1 - t) ** 3;
      this.applyBounds(fromLeft + (toLeft - fromLeft) * eased, fromTop + (toTop - fromTop) * eased);
      if (t < 1) {
        setTimeout(step, 16);
      } else {
        this.isAnimatingBounds = false;
      }
    };
    step();
  }

  // ── Navigation shortcuts ─────────────────────────────────────────────

  /**
   * Cycles the active tab within the active workspace, wrapping around at
   * either end. A no-op with zero or one tab in the workspace. Only cycles
   * through tabs this window's own tab bar actually lists (see
   * `shouldListTabForThisWindow`) — otherwise Ctrl+Right/Left could land on
   * a linked twin (see `createLinkedTwin`) this window doesn't even show a
   * row for, stealing it away from wherever it's actually mounted.
   * @param direction `1` for the next tab, `-1` for the previous one.
   * @returns The full browser state after the change.
   */
  public cycleTab(direction: 1 | -1): BrowserState {
    const workspaceTabIds = this.listedTabIds(this.activeWorkspaceId);
    const currentIndex = this.activeTabId ? workspaceTabIds.indexOf(this.activeTabId) : -1;
    if (workspaceTabIds.length <= 1 || currentIndex === -1) {
      return this.getState();
    }
    const nextIndex = (currentIndex + direction + workspaceTabIds.length) % workspaceTabIds.length;
    return this.activateTab(workspaceTabIds[nextIndex]!);
  }

  /**
   * Cycles the active workspace, wrapping around at either end. A no-op
   * with only one workspace.
   * @param direction `1` for the next workspace, `-1` for the previous one.
   * @returns The full browser state after the change.
   */
  public cycleWorkspace(direction: 1 | -1): BrowserState {
    const workspaceIds = Array.from(this.workspaces.keys());
    if (workspaceIds.length <= 1) {
      return this.getState();
    }
    const currentIndex = workspaceIds.indexOf(this.activeWorkspaceId);
    const nextIndex = (currentIndex + direction + workspaceIds.length) % workspaceIds.length;
    return this.switchWorkspace(workspaceIds[nextIndex]!);
  }

  /**
   * Grabs a tab for keyboard reordering (Ctrl+Space held) — the keyboard
   * equivalent of picking it up with the mouse, down to sharing the same
   * `--dragging` blue highlight in the tab bar (see `TabBar.tsx`, which
   * reads `grabbedTabId` off this state the same way it reads a live
   * mouse-drag's `draggedId`). `nudgeTab` moves it while held; releasing
   * Ctrl or Space (`releaseGrabbedTab`) drops it in place.
   * @param id The tab to grab. A no-op if it doesn't exist.
   */
  public grabTabForReorder(id: string): void {
    if (!this.states.has(id)) {
      return;
    }
    this.grabbedTabId = id;
    if (this.grabMaxDurationTimeout !== null) {
      clearTimeout(this.grabMaxDurationTimeout);
    }
    this.grabMaxDurationTimeout = setTimeout(() => this.releaseGrabbedTab(), GRAB_MAX_DURATION_MS);
    this.emitState();
  }

  /** Ends keyboard reorder mode, if it's active — dropping the grabbed tab wherever `nudgeTab` last left it. */
  public releaseGrabbedTab(): void {
    this.disarmSpaceHoldTimeout();
    if (this.grabMaxDurationTimeout !== null) {
      clearTimeout(this.grabMaxDurationTimeout);
      this.grabMaxDurationTimeout = null;
    }
    if (this.grabbedTabId === null) {
      return;
    }
    this.grabbedTabId = null;
    this.emitState();
  }

  /**
   * (Re)starts the grace-period timer that stands in for Space's own
   * `keyUp`. Electron's `before-input-event` doesn't reliably deliver a
   * `keyUp` for a key whose `keyDown` was `preventDefault`-ed — which every
   * Space keydown is, while grabbed — so waiting for that event to release
   * the grab left it stuck blue with no way out. Control has no such
   * problem (its own keydown is never prevented, so its keyup is trustworthy
   * and still handled directly), but Space needs this instead: called on
   * the initial grab and on every subsequent Space repeat, so it only ever
   * fires once repeats actually stop, i.e. once Space is physically let go.
   */
  private armSpaceHoldTimeout(): void {
    this.disarmSpaceHoldTimeout();
    this.spaceHoldTimeout = setTimeout(() => this.releaseGrabbedTab(), SPACE_HOLD_GRACE_MS);
  }

  /** Cancels the pending timer from `armSpaceHoldTimeout`, if any. */
  private disarmSpaceHoldTimeout(): void {
    if (this.spaceHoldTimeout !== null) {
      clearTimeout(this.spaceHoldTimeout);
      this.spaceHoldTimeout = null;
    }
  }

  /**
   * Moves the grabbed tab one position left or right within its own
   * workspace — each Left/Right arrow press while Ctrl+Space is held. A
   * no-op past either end of its workspace's tabs. Expressed as a call to
   * `moveTab` (itself "insert before this id"), so it inherits that
   * method's own same-workspace guard and `states` rebuild rather than
   * duplicating them.
   * @param id The grabbed tab.
   * @param direction `1` to move it right (later), `-1` to move it left (earlier).
   */
  public nudgeTab(id: string, direction: 1 | -1): void {
    const workspaceId = this.states.get(id)?.workspaceId;
    const workspaceTabIds = Array.from(this.states.entries())
      .filter(([, state]) => state.workspaceId === workspaceId)
      .map(([tabId]) => tabId);
    const currentIndex = workspaceTabIds.indexOf(id);
    const targetIndex = currentIndex + direction;
    if (currentIndex === -1 || targetIndex < 0 || targetIndex >= workspaceTabIds.length) {
      return;
    }
    const beforeId = direction === 1 ? (workspaceTabIds[targetIndex + 1] ?? null) : workspaceTabIds[targetIndex]!;
    this.moveTab(id, beforeId);
  }

  /**
   * The Ctrl+Space keyboard-reorder gesture's input handling — grab,
   * nudge, release — shared between every tab's own `before-input-event`
   * (`wireEvents`) and the chrome window's own (wired in the constructor).
   * Both are needed: a mouse drag-and-drop, a click on a workspace pill,
   * or Tab-navigating into the tab bar can all leave OS keyboard focus on
   * the chrome instead of tab content, and unlike the tab-scoped shortcuts
   * below (which have a menu-accelerator fallback for exactly that case),
   * this gesture has no accelerator equivalent — accelerators fire once
   * per press, with no notion of "held" or a matching key-up.
   * @param event The input event, so a handled key can `preventDefault`.
   * @param input Electron's parsed key info.
   * @returns Whether this event belonged to the gesture and was fully
   *   handled — callers should stop processing it themselves when `true`.
   */
  private handleReorderGestureInput(event: Electron.Event, input: Electron.Input): boolean {
    const key = input.key.toLowerCase();

    if (input.type === 'keyUp') {
      if (key === 'control' || key === ' ') {
        this.releaseGrabbedTab();
        return true;
      }
      return false;
    }

    if (input.type !== 'keyDown') {
      return false;
    }

    // While a tab is grabbed, every key involved in the gesture is fully
    // consumed here — Left/Right nudges it (auto-repeat deliberately
    // allowed, unlike every other shortcut in this app, so holding an
    // arrow keeps nudging). Space's own repeats (not just the very first
    // press) re-arm the grace-period timer that stands in for its
    // unreliable `keyUp` — see `armSpaceHoldTimeout`. Control's repeats
    // are left alone entirely (not even `preventDefault`-ed): unlike
    // Space, its keydown is never prevented in the first place, so its
    // own keyUp stays a trustworthy release signal.
    if (this.grabbedTabId !== null) {
      if (key === 'arrowleft' || key === 'arrowright') {
        event.preventDefault();
        this.nudgeTab(this.grabbedTabId, key === 'arrowright' ? 1 : -1);
        // The OS only auto-repeats whichever key was pressed most
        // recently, so a Left/Right press while Space is held stops
        // Space's own repeats from arriving at all — without this, only
        // `armSpaceHoldTimeout`'s Space-repeat branch below would ever
        // re-arm the grace timer, which would then fire (and drop the
        // grab) mid-nudge even though both keys are still physically
        // held. Nudging is itself proof the gesture is still active, so
        // it re-arms the same timer Space's own repeats do.
        this.armSpaceHoldTimeout();
        return true;
      }
      if (key === ' ') {
        event.preventDefault();
        // A brand-new (non-repeat) Ctrl+Space while something's already
        // grabbed resets the grab onto whatever tab is active *now*,
        // instead of just extending the existing hold. This is also the
        // escape hatch if a grab ever gets stuck (its release signal
        // missed for whatever reason): pressing Ctrl+Space again always
        // breaks out of it rather than silently doing nothing forever.
        if (input.control && !input.isAutoRepeat && this.activeTabId) {
          this.grabTabForReorder(this.activeTabId);
        }
        this.armSpaceHoldTimeout();
      }
      return true;
    }

    // Ctrl+Space grabs the active tab for keyboard reordering; see
    // `grabTabForReorder` and the grabbed-mode branch just above.
    if (input.control && key === ' ' && !input.isAutoRepeat) {
      if (this.activeTabId) {
        event.preventDefault();
        this.grabTabForReorder(this.activeTabId);
        this.armSpaceHoldTimeout();
      }
      return true;
    }

    return false;
  }

  // ── Cross-window UI requests ─────────────────────────────────────────

  /**
   * Asks this window's chrome to open the tab search overlay
   * (menu/accelerator-driven). Explicitly hands native OS keyboard focus
   * to the chrome's own `webContents` first — it and a tab's content are
   * separate native surfaces, so without this, the overlay's input would
   * render but the tab still catch the keystrokes typed into it.
   */
  public requestTabSearch(): void {
    this.window.webContents.focus();
    this.window.webContents.send(IpcChannel.UiOpenTabSearch);
  }

  /**
   * Asks this window's chrome to focus the address bar
   * (menu/accelerator-driven, Ctrl+/). See `requestTabSearch` for why
   * `webContents.focus()` has to happen here too.
   */
  public requestFocusAddressBar(): void {
    this.window.webContents.focus();
    this.window.webContents.send(IpcChannel.UiFocusAddressBar);
  }

  /**
   * Asks this window's chrome to focus (and select) `ZoomControl`'s
   * percent field (menu/accelerator-driven, Ctrl+Shift+0). See
   * `requestTabSearch` for why `webContents.focus()` has to happen here
   * too.
   */
  public requestFocusZoom(): void {
    if (this.activeTabId && !this.isZoomable(this.activeTabId)) {
      return;
    }
    this.window.webContents.focus();
    this.window.webContents.send(IpcChannel.UiFocusZoom);
  }

  /**
   * Hands native OS keyboard focus back to this window's own chrome
   * `webContents` — the Ctrl+` escape hatch out of a terminal tab (see
   * `wireSharedInputHandling`), so every other chrome shortcut (which is
   * otherwise deliberately left alone while a terminal tab holds the
   * keyboard, to avoid stealing keys the shell itself binds) starts
   * working again. Unlike `requestFocusAddressBar`/`requestTabSearch`,
   * there's no specific control to focus afterward — a terminal tab has no
   * address bar — so this is just the bare `webContents.focus()` half.
   */
  public focusChrome(): void {
    this.window.webContents.focus();
  }

  /**
   * Hands native OS keyboard focus into the active tab's own view, if it's
   * a terminal — the constructor's chrome-wide Ctrl+` handler's other
   * half, for whenever that's pressed while the chrome (rather than a
   * terminal tab) currently has OS focus. A no-op if the active tab is a
   * browser tab or there isn't one — Ctrl+` only ever means "move the
   * cursor into the terminal," never "activate one."
   */
  private focusActiveTerminal(): void {
    if (!this.activeTabId || this.states.get(this.activeTabId)?.kind !== 'terminal') {
      return;
    }
    this.views.get(this.activeTabId)?.webContents.focus();
  }

  /**
   * Asks this window's chrome to toggle its light/dark theme
   * (menu/accelerator-driven, Ctrl+D). A purely client-local UI
   * preference (see `useTheme`), not a text input — unlike
   * `requestTabSearch`/`requestFocusAddressBar`, there's no keyboard
   * focus to hand back to the chrome first.
   */
  public requestToggleTheme(): void {
    this.window.webContents.send(IpcChannel.UiToggleTheme);
  }

  /**
   * Focuses the address bar now, and again the next time `tabId`'s own
   * `WebContentsView` grabs native OS focus for itself — which a freshly
   * created tab does on its own once it's attached and showing content
   * (even the near-instant local `northstar://home` page), stealing focus
   * back from the address bar a tick after we set it. The reassertion is
   * deferred a tick past that `focus` event rather than made from directly
   * inside its callback: Electron silently drops a same-tick re-entrant
   * `webContents.focus()` call made while it's still mid-transition into
   * focusing the view that's newly stealing it. Used by
   * `createTabAndFocusAddressBar` and `createWorkspace`, whose fresh tab
   * this races with; a plain `requestFocusAddressBar()` (e.g. Ctrl+/) has
   * no such race since it never creates or loads a tab.
   * @param tabId The tab whose native focus grab this request would otherwise race.
   */
  private focusAddressBarPastTabLoad(tabId: string | null): void {
    const view = tabId ? this.views.get(tabId) : undefined;
    view?.webContents.once('focus', () => setImmediate(() => this.requestFocusAddressBar()));
    this.requestFocusAddressBar();
  }

  // ── State & bounds ───────────────────────────────────────────────────

  /** @returns The current tabs, workspaces, bookmarks, and view mode. */
  public getState(): BrowserState {
    return {
      tabs: this.listedTabIds().map((tabId) => this.states.get(tabId)!),
      activeTabId: this.activeTabId,
      workspaces: Array.from(this.workspaces.values()),
      activeWorkspaceId: this.activeWorkspaceId,
      bookmarks: this.bookmarkStore.list(),
      splitView: this.splitView,
      focusMode: this.focusMode,
      sidebarVisible: this.sidebarVisible,
      grabbedTabId: this.grabbedTabId,
      selectedTabIds: this.currentTabSelection(),
      selectedWorkspaceIds: this.currentWorkspaceSelection(),
      zoomPercent: this.activeTabId
        ? (this.registry.zoomPercentByTabId.get(this.activeTabId) ?? ZOOM_PERCENT_DEFAULT)
        : ZOOM_PERCENT_DEFAULT,
      laserPointerActive: this.laserPointerActive,
      highlighterActive: this.highlighterActive,
      commentToolActive: this.commentToolActive,
      textToolActive: this.textToolActive,
      penActive: this.penActive,
      cropActive: this.cropActive,
    };
  }

  /**
   * Re-fits the mounted view(s) to the window; call this on resize. A
   * no-op while `animateBoundsInset` is running (see `isAnimatingBounds`)
   * — that includes the native 'resize' event `setFullScreen` fires when
   * Focus Mode toggles, which would otherwise jump straight to the
   * animation's final bounds one frame early instead of animating there.
   */
  public updateBounds(): void {
    if (this.isAnimatingBounds) {
      return;
    }
    this.applyBounds(this.targetLeftInset(), this.targetTopInset());
  }

  /**
   * Activates whichever tab a workspace should show when it becomes
   * active: its last-active tab if that still exists, else its first
   * remaining tab, else a fresh home tab.
   * @param workspaceId The workspace to focus a tab within.
   */
  private focusWorkspaceDefaultTab(workspaceId: string): void {
    const lastActive = this.lastActiveTabIdByWorkspace.get(workspaceId);
    // Also checks the recorded tab's *current* workspace, not just that it
    // still exists — `moveTabToWorkspace` can leave a workspace's
    // last-active entry pointing at a tab that's since relocated
    // elsewhere, which would otherwise resurrect it in the wrong
    // workspace's tab strip.
    if (lastActive && this.states.get(lastActive)?.workspaceId === workspaceId) {
      this.activateTab(lastActive);
      return;
    }
    const anyTab = Array.from(this.states.entries()).find(
      ([, state]) => state.workspaceId === workspaceId,
    )?.[0];
    if (anyTab) {
      this.activateTab(anyTab);
    } else {
      this.createTab(undefined, workspaceId);
    }
  }

  /** Unmounts the secondary split-view pane, if any, and clears split state. The primary pane is left mounted. */
  private teardownSplitView(): void {
    if (!this.splitView) {
      return;
    }
    const secondaryView = this.views.get(this.splitView.secondaryTabId);
    if (secondaryView) {
      this.window.contentView.removeChildView(secondaryView);
    }
    this.registry.mountOwners.delete(this.splitView.secondaryTabId);
    this.splitView = null;
  }

  /**
   * The sidebar's resting horizontal inset: `SIDEBAR_WIDTH_PX` while
   * shown, 0 in Focus Mode (nothing left to clear — full immersion, no
   * lingering nub), or `SIDEBAR_COLLAPSED_WIDTH_PX` when toggled off
   * (`toggleSidebar`) but Focus Mode isn't on — just enough room for
   * `WorkspaceBar`'s own `.sidebar__toggle` button to stay clear of the
   * tab's native content instead of being covered by it. Mid-toggle,
   * `applyBounds` is driven by the animation loop instead — this is only
   * the value things settle back to.
   */
  private targetLeftInset(): number {
    if (this.focusMode) {
      return 0;
    }
    return this.sidebarVisible ? SIDEBAR_WIDTH_PX : SIDEBAR_COLLAPSED_WIDTH_PX;
  }

  /**
   * The chrome's resting vertical inset: `CHROME_HEIGHT_FOCUSED_PX` (the
   * whole titlebar/tab-strip/toolbar slid away) in Focus Mode, else
   * `CHROME_HEIGHT_PX`. Mid-toggle, `applyBounds` is driven by
   * `animateBoundsInset` instead — this is only the value things settle
   * back to, same relationship `targetLeftInset` has with the sidebar.
   */
  private targetTopInset(): number {
    return this.focusMode ? CHROME_HEIGHT_FOCUSED_PX : CHROME_HEIGHT_PX;
  }

  /** @returns The bounds a single full-width tab view should occupy for a given sidebar/chrome inset. */
  private computeMainBounds(left: number, top: number): Rect {
    // Electron types getContentSize() as number[], not a fixed tuple, so
    // noUncheckedIndexedAccess sees each element as possibly undefined.
    const [width = 0, height = 0] = this.window.getContentSize();
    return { x: left, y: top, width: Math.max(0, width - left), height: Math.max(0, height - top) };
  }

  /** @returns The bounds the primary (left) and secondary (right) split-view panes should occupy, for a single-view `main` rect. */
  private computeSplitBoundsFor(main: Rect): { primary: Rect; secondary: Rect } {
    const dividerPx = 1;
    const leftWidth = Math.floor(main.width / 2);
    return {
      primary: {
        x: main.x,
        y: main.y,
        width: Math.max(0, leftWidth - dividerPx),
        height: main.height,
      },
      secondary: {
        x: main.x + leftWidth,
        y: main.y,
        width: Math.max(0, main.width - leftWidth),
        height: main.height,
      },
    };
  }

  /**
   * Applies bounds for a given sidebar/chrome inset to whichever view(s)
   * are currently mounted — the single shared code path for both the
   * settled state (`updateBounds`) and every frame of
   * `animateBoundsInset`'s animation.
   * @param left Horizontal inset to clear, in CSS pixels.
   * @param top Vertical inset to clear, in CSS pixels.
   */
  private applyBounds(left: number, top: number): void {
    const main = this.computeMainBounds(left, top);
    this.laserPointerOverlay.setActive(this.laserPointerActive && this.activeTabId !== null, main);
    if (this.splitView) {
      const { primary, secondary } = this.computeSplitBoundsFor(main);
      this.views.get(this.splitView.primaryTabId)?.setBounds(primary);
      this.views.get(this.splitView.secondaryTabId)?.setBounds(secondary);
      return;
    }
    if (this.activeTabId) {
      this.views.get(this.activeTabId)?.setBounds(main);
    }
  }

  /**
   * Merges a partial update into one tab's state and notifies the caller.
   * @param id Tab to update.
   * @param patch Fields to overwrite.
   */
  private patchState(id: string, patch: Partial<Omit<BrowserTabState, 'kind' | 'id' | 'workspaceId'>>): void {
    const current = this.states.get(id);
    if (!current || current.kind !== 'browser') {
      return;
    }
    this.states.set(id, { ...current, ...patch });
    this.emitState();
  }

  /**
   * Notifies every open window (this one included) that shared tab/
   * workspace data changed — each pushes its own fresh `BrowserState` to
   * its own renderer and reschedules a session save (see
   * `SharedTabRegistry.registerWindow`, where that per-window push is
   * actually registered). Every existing call site of this method
   * (unchanged from before tabs/workspaces were shared) still means
   * exactly what it always did: "something changed, tell whoever's
   * listening" — it just has more listeners now.
   */
  private emitState(): void {
    this.registry.notifyAll();
  }

  /** @returns The current tabs/workspaces reduced to `SessionStore`'s minimal recreatable shape — see `restoreSession` for why it's not the full `TabState`. */
  private buildSessionSnapshot(): SessionSnapshot {
    return {
      workspaces: Array.from(this.workspaces.values()),
      // Twins are per-window views of a tab that's already saved via its
      // canonical member; persisting them too would restore duplicates.
      tabs: Array.from(this.states.values())
        .filter((state) => (this.registry.getLinkGroup(state.id)?.[0] ?? state.id) === state.id)
        .map((state) => ({
          kind: state.kind,
          url: state.kind === 'browser' ? state.url : '',
          workspaceId: state.workspaceId,
          active: (this.registry.getLinkGroup(state.id) ?? [state.id]).includes(this.activeTabId ?? ''),
        })),
      activeWorkspaceId: this.activeWorkspaceId,
    };
  }

  /**
   * Wires every `WebContents` event that keeps a tab's `TabState` (and,
   * for navigation, its actual destination) in sync with reality.
   * @param id Tab the events belong to.
   * @param view The tab's view.
   */
  private wireEvents(id: string, view: WebContentsView): void {
    const wc = view.webContents;
    const historyFlags = (): Pick<BrowserTabState, 'canGoBack' | 'canGoForward'> => ({
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward(),
    });

    this.wireSharedInputHandling(id, wc);
    trackPageSelectionAccent(wc);

    // A fresh document — the initial load or any later navigation/reload —
    // has none of the previous one's highlights, undo/redo history, or
    // preload-side highlighter state (a brand new preload instance that's
    // never been told anything). `did-navigate`'s own listener below has
    // already updated `this.states.get(id)?.url` to the new URL by the time
    // `dom-ready` fires (navigation commit precedes DOM parsing), so it's
    // safe to read here.
    wc.on('dom-ready', () => {
      this.highlighter.resetTab(id);
      this.pushHighlighterStateTo(id);
      this.commentController.resetTab(id);
      this.pushCommentToolStateTo(id);
      this.textBoxController.resetTab(id);
      this.pushTextToolStateTo(id);
      this.penController.resetTab(id);
      this.pushPenStateTo(id);
      const state = this.states.get(id);
      if (state?.kind === 'browser') {
        this.highlighter.restoreFor(id, state.url);
        this.commentController.restoreFor(id, state.url);
        this.textBoxController.restoreFor(id, state.url);
        this.penController.restoreFor(id, state.url);
      }
    });

    wc.on('page-title-updated', (_event, title) => this.patchState(id, { title }));
    wc.on('page-favicon-updated', (_event, favicons) => {
      this.patchState(id, { favicon: favicons[0] ?? null });
    });
    wc.on('did-start-loading', () => this.patchState(id, { isLoading: true }));
    wc.on('did-stop-loading', () => this.patchState(id, { isLoading: false, ...historyFlags() }));
    wc.on('did-navigate', (_event, url) => {
      this.patchState(id, { url, ...historyFlags() });
      this.propagateLinkedNavigation(id, url);
    });
    wc.on('did-navigate-in-page', (_event, url) => {
      this.patchState(id, { url });
      this.propagateLinkedNavigation(id, url);
    });
    // A fresh navigation is a fresh document, which resets `webFrame`'s own
    // frame-local zoom back to 0 — reapply whatever this tab's own zoom
    // actually is (a no-op if it was never zoomed) so it survives clicking
    // a link or typing a new address, not just page reloads.
    wc.on('did-finish-load', () => this.applyZoom(id));

    wc.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      // -3 is ERR_ABORTED, which fires on ordinary cancelled/redirected
      // loads (e.g. a download, or a second navigation superseding this
      // one) — not a real failure, so it shouldn't show an error page.
      if (!isMainFrame || errorCode === -3) {
        return;
      }
      void wc.loadURL(this.buildErrorPageUrl(errorDescription, validatedURL));
    });

    // Links that would open a new OS window (target="_blank", window.open)
    // become a new tab instead — this is a browser, not an app shell.
    wc.setWindowOpenHandler(({ url }) => {
      if (isNavigableUrl(url)) {
        this.createTab(url);
      }
      return { action: 'deny' };
    });

    // A compromised or malicious page can request navigation to a
    // disallowed scheme (e.g. `file:`); refuse it here as well as at the
    // IPC boundary, since this path doesn't go through IPC at all.
    wc.on('will-navigate', (event, url) => {
      if (!isNavigableUrl(url)) {
        event.preventDefault();
      }
    });
  }

  /**
   * Wires the OS-focus/keyboard-shortcut handling every tab's own
   * `WebContentsView` needs, regardless of kind — shared by `wireEvents`
   * (browser tabs) and `createTerminalTab`, since a terminal's own view is
   * just as capable of holding OS keyboard focus (in fact holds it most of
   * the time, same as a browser tab's page) and needs the exact same
   * safety nets.
   *
   * The blur handler is a safety net for the Ctrl+Space keyboard-reorder
   * gesture: if this view loses OS focus mid-hold (e.g. a click elsewhere,
   * or the tab being nudged out from under the cursor), its `keyUp` for
   * Space might never arrive here at all, since keyup goes to whichever
   * surface has focus at release time, not necessarily this one. Blurring
   * is treated the same as releasing the keys, so the grab can't get stuck.
   *
   * The `before-input-event` handler is belt-and-suspenders for the
   * chrome-wide shortcuts also bound as menu accelerators in buildMenu.ts
   * (close/new/reopen tab, bookmark, close all tabs, toggle sidebar, cycle
   * tabs/workspaces, home, back/forward): Electron's menu accelerators are
   * unreliable once a WebContentsView (as opposed to the chrome window's
   * own webContents) has OS focus — which, for a tab's content, is almost
   * all the time — so a page could otherwise swallow Ctrl+W etc. or the
   * accelerator could simply not fire. Handling it here too, directly on
   * the tab's own webContents, means it fires regardless of the menu's
   * focus quirks and beats the page's own keydown handling since
   * `before-input-event` runs first.
   *
   * A terminal tab is the one exception, and deliberately skips this
   * switch entirely rather than "just no-op[ping] on the browser-only
   * ones" the way it used to: a shell's own readline bindings overlap
   * these letters for real (Ctrl+L clears the screen, Ctrl+W deletes a
   * word, Ctrl+T transposes two characters, Ctrl+Space sets the mark,
   * Ctrl+Left/Right jumps by word — all live keys the person is actively
   * relying on), so stealing them here wouldn't no-op, it would silently
   * eat shell input. While a terminal tab actually holds OS keyboard
   * focus, every one of these chrome shortcuts is left alone and passed
   * straight through untouched; the only exceptions are Ctrl+` (the
   * escape hatch back to the chrome) and zoom in/out/reset (no shell binds
   * those either, and — unlike every other shortcut here — zoom is
   * something a terminal tab needs just as much as a browser one).
   * @param id The tab this view belongs to.
   * @param wc The view's own webContents.
   */
  private wireSharedInputHandling(id: string, wc: WebContents): void {
    // Resolved fresh on every event rather than captured as `this` — this
    // listener is attached once, at tab-creation time, but the tab itself
    // can outlive that: `activateTab` lets any window steal it away (a
    // shared-workspace tab click, or `tearOffTab` mounting it into a brand
    // new window) without ever re-wiring its input handling. Without this,
    // every shortcut below would keep acting on whichever window happened
    // to create the tab, even after a different window is the one actually
    // showing it and holding OS focus on it — e.g. Ctrl+L toggling the
    // *origin* window's sidebar while the torn-off window's own content
    // fills the screen. Falls back to `this` for a tab that's currently
    // unmounted everywhere (`mountOwners` has no entry), which can't
    // actually receive input anyway but keeps this total.
    const owningManager = (): TabManager => this.registry.mountOwners.get(id) ?? this;

    wc.on('blur', () => owningManager().releaseGrabbedTab());

    wc.on('before-input-event', (event, input) => {
      const owner = owningManager();

      if (this.states.get(id)?.kind === 'terminal') {
        if (input.type !== 'keyDown' || input.isAutoRepeat) {
          return;
        }
        // Checked before the `cmdOrCtrl` gate below, since Escape carries no
        // modifier — unlike every other shortcut in this branch, only acted
        // on here when the laser pointer/highlighter is actually on (a
        // deliberate, uncommon, user-initiated state), so plain Escape still
        // reaches the shell untouched the rest of the time — a vi-mode
        // readline binds it to leave insert mode, a real use this app must
        // not shadow by default.
        if (
          input.key.toLowerCase() === 'escape' &&
          !input.control &&
          !input.meta &&
          !input.alt &&
          !input.shift &&
          owner.exitPointerTools()
        ) {
          event.preventDefault();
          return;
        }
        const cmdOrCtrl = input.control || input.meta;
        if (!cmdOrCtrl || input.alt) {
          return;
        }
        // Ctrl+` (no shell or readline binding uses backtick) hands OS
        // keyboard focus back to the chrome, so every other shortcut works
        // normally again. See this method's own doc comment for why
        // nothing else here runs while a terminal tab has the keyboard.
        if (!input.shift && input.key.toLowerCase() === '`') {
          event.preventDefault();
          owner.focusChrome();
          return;
        }
        // Zoom, unlike every other chrome shortcut, isn't suppressed here
        // — a terminal tab's text needs to be resizable exactly as much as
        // a page's does, and no shell binds these either. Matched on
        // `input.code` (the physical key, e.g. "Equal") rather than
        // `input.key` (the character it produces): that keeps Shift out of
        // it entirely — no separate "Shift produces '+' on this layout"
        // case needed — and numpad +/-/0 report their own distinct codes
        // that still mean the same thing here.
        if (input.code === 'Equal' || input.code === 'NumpadAdd') {
          event.preventDefault();
          owner.zoomIn();
        } else if (input.code === 'Minus' || input.code === 'NumpadSubtract') {
          event.preventDefault();
          owner.zoomOut();
        } else if (input.code === 'Digit0' || input.code === 'Numpad0') {
          event.preventDefault();
          // Shift is the one thing that *does* still matter for this one
          // key — Ctrl+0 resets the zoom, Ctrl+Shift+0 jumps the cursor to
          // `ZoomControl`'s own percent field instead of touching zoom at
          // all, same pairing as the browser-tab switch below.
          if (input.shift) {
            owner.requestFocusZoom();
          } else {
            owner.resetZoom();
          }
        }
        return;
      }

      if (owner.handleReorderGestureInput(event, input)) {
        return;
      }
      if (input.type !== 'keyDown') {
        return;
      }
      const key = input.key.toLowerCase();

      if (input.isAutoRepeat) {
        return;
      }

      // No modifier, so it falls outside the `cmdOrCtrl`-gated switch below
      // — Escape exits Focus Mode if it's on, and/or turns off the laser
      // pointer/highlighter if either is on; a no-op (falls through
      // untouched to the page) if none of the three are active.
      if (key === 'escape') {
        if (owner.focusMode) {
          event.preventDefault();
          owner.setFocusMode(false);
          owner.exitPointerTools();
          return;
        }
        if (owner.exitPointerTools()) {
          event.preventDefault();
          return;
        }
      }

      const cmdOrCtrl = input.control || input.meta;

      if (input.alt && !cmdOrCtrl && !input.shift) {
        if (key === 'arrowleft') {
          event.preventDefault();
          owner.goBack(id);
        } else if (key === 'arrowright') {
          event.preventDefault();
          owner.goForward(id);
        }
        return;
      }

      if (cmdOrCtrl && input.alt && key === 'w') {
        event.preventDefault();
        if (input.shift) {
          // Ctrl+Shift+Alt+W — the workspace equivalent of Ctrl+Shift+W:
          // closes every workspace and resets the last one, same as
          // repeating the combo below until only one is left.
          owner.closeAllWorkspaces();
        } else {
          // The deliberately-harder-to-hit combo for closing the whole
          // workspace — plain Ctrl+W (below) only ever closes a tab.
          // `removeWorkspace` itself refuses to act when this is the last
          // remaining workspace, so this can never close the window.
          owner.removeSelectionOrActiveWorkspace();
        }
        return;
      }

      if (!cmdOrCtrl || input.alt) {
        return;
      }

      // Zoom, checked by physical key (`input.code`) rather than the
      // character it produces (`key`, used by every case below) — that
      // way it fires the same whether or not Shift is held (some layouts
      // need it to actually produce '+'), and ahead of the Shift/non-Shift
      // switches below so neither needs its own copy of this check. Same
      // reasoning as the terminal branch's own version above.
      if (input.code === 'Equal' || input.code === 'NumpadAdd') {
        event.preventDefault();
        owner.zoomIn();
        return;
      }
      if (input.code === 'Minus' || input.code === 'NumpadSubtract') {
        event.preventDefault();
        owner.zoomOut();
        return;
      }
      if (input.code === 'Digit0' || input.code === 'Numpad0') {
        event.preventDefault();
        // Ctrl+Shift+0 jumps the cursor to `ZoomControl`'s own percent
        // field instead of resetting the zoom — Shift is the one thing
        // that still distinguishes this key, since every other zoom key
        // above deliberately ignores it.
        if (input.shift) {
          owner.requestFocusZoom();
        } else {
          owner.resetZoom();
        }
        return;
      }

      if (input.shift) {
        switch (key) {
          case 't':
            event.preventDefault();
            owner.restoreLastClosedTab();
            return;
          case 'w':
            event.preventDefault();
            owner.closeAllTabs();
            return;
          case 'f':
            event.preventDefault();
            owner.toggleFocusMode();
            return;
          case 'd':
            event.preventDefault();
            owner.duplicateTab(id);
            return;
          case 'p':
            // Same as buildMenu.ts's `CmdOrCtrl+Shift+P` ("New PDF Viewer").
            event.preventDefault();
            owner.createPdfTab();
            return;
          case 'r':
            event.preventDefault();
            owner.revertPage(id);
            return;
          case 'h':
            // Same as buildMenu.ts's `CmdOrCtrl+Shift+H` ("New History Tab").
            event.preventDefault();
            owner.createHistoryTab();
            return;
          case 'x':
            // Same as buildMenu.ts's `CmdOrCtrl+Shift+X` ("Toggle Crop"); a no-op off a PDF tab.
            event.preventDefault();
            owner.toggleCrop();
            return;
          case '>':
            // Shift is what actually produces '>' (it's Shift+Period on a
            // US layout) — this is Ctrl+> from a key-event's perspective,
            // not a separate Ctrl+Shift+> binding, same as buildMenu.ts's
            // `CmdOrCtrl+>` accelerator for the same action.
            event.preventDefault();
            owner.createTerminalTab();
            return;
          default:
            return;
        }
      }

      switch (key) {
        case 'o':
          // Same as buildMenu.ts's `CmdOrCtrl+O` ("Open PDF"); a no-op on non-PDF tabs.
          event.preventDefault();
          void owner.openPdfFile(id);
          return;
        case 'w':
          event.preventDefault();
          owner.closeSelectionOrTab(id);
          return;
        case 'n':
          event.preventDefault();
          owner.createTabAndFocusAddressBar();
          return;
        case 'q':
          // Same action as Ctrl+Shift+N, under a second accelerator — see
          // buildMenu.ts's hidden "New Workspace" (Ctrl+Q) entry for why.
          event.preventDefault();
          owner.createWorkspace();
          return;
        case 't':
          event.preventDefault();
          owner.restoreLastClosedTab();
          return;
        case 'b':
          event.preventDefault();
          owner.toggleBookmark(id);
          return;
        case 'z':
          // Only intercepted while the highlighter or pen tool is on —
          // otherwise this falls through untouched, so a page's own undo (a
          // text field, a rich editor) and Electron's native `role: 'undo'`
          // menu item both keep working exactly as before. Never stolen on a
          // terminal tab at all (see this method's own doc comment): this
          // `case` only exists in the browser-tab branch of the switch, and
          // Ctrl+Z suspends a Unix shell's foreground process — a binding
          // this app must never shadow. The two tools are mutually
          // exclusive (`setHighlighter`/`setPen`), so at most one branch
          // below ever actually runs.
          if (owner.states.get(id)?.kind === 'pdf') {
            // A PDF page keeps its own history (marks and crops); it undoes when told to.
            if (owner.highlighterActive || owner.penActive || owner.cropActive) {
              event.preventDefault();
              owner.views.get(id)?.webContents.send(IpcChannel.PdfUndo);
            }
          } else if (owner.highlighterActive) {
            event.preventDefault();
            owner.highlighter.undo(id);
          } else if (owner.penActive) {
            event.preventDefault();
            owner.penController.undo(id);
          }
          return;
        case 'y':
          if (owner.states.get(id)?.kind === 'pdf') {
            if (owner.highlighterActive || owner.penActive || owner.cropActive) {
              event.preventDefault();
              owner.views.get(id)?.webContents.send(IpcChannel.PdfRedo);
            }
          } else if (owner.highlighterActive) {
            event.preventDefault();
            owner.highlighter.redo(id);
          } else if (owner.penActive) {
            event.preventDefault();
            owner.penController.redo(id);
          }
          return;
        case 'e':
          // Same as buildMenu.ts's `CmdOrCtrl+E` ("Toggle Text Box"); a no-op on a terminal tab.
          event.preventDefault();
          owner.toggleTextTool();
          return;
        case 'm':
          // Never intercepted on a terminal tab at all (see this method's
          // own doc comment): this `case` only exists in the browser-tab
          // branch of the switch, and Ctrl+M is literally carriage return
          // (Enter) in a terminal — a binding this app must never shadow.
          event.preventDefault();
          owner.toggleCommentTool();
          return;
        case 'h':
          event.preventDefault();
          owner.goHome(id);
          return;
        case 'l':
          event.preventDefault();
          owner.toggleSidebar();
          return;
        case '/':
          event.preventDefault();
          owner.requestFocusAddressBar();
          return;
        case 'arrowleft':
          event.preventDefault();
          owner.cycleTab(-1);
          return;
        case 'arrowright':
          event.preventDefault();
          owner.cycleTab(1);
          return;
        case 'arrowup':
          event.preventDefault();
          owner.cycleWorkspace(-1);
          return;
        case 'arrowdown':
          event.preventDefault();
          owner.cycleWorkspace(1);
          return;
        default:
          return;
      }
    });
  }

  /**
   * Builds a minimal, self-contained error page for a failed navigation.
   * @param description Chromium's human-readable error description.
   * @param failedUrl The URL that failed to load.
   * @returns A `data:` URL the tab can load in place of the failed page.
   */
  private buildErrorPageUrl(description: string, failedUrl: string): string {
    const html =
      '<!doctype html><meta charset="utf-8">' +
      '<title>Cannot reach page</title>' +
      '<style>body{font:15px system-ui;color:#333;padding:3rem;max-width:36rem;margin:auto}' +
      'code{background:#f1f1f1;padding:.15em .4em;border-radius:.25em;word-break:break-all}</style>' +
      `<h1>This page couldn't load</h1><p>${escapeHtml(description)}</p>` +
      `<p><code>${escapeHtml(failedUrl)}</code></p>`;
    return `data:text/html,${encodeURIComponent(html)}`;
  }
}

/**
 * Strips characters that aren't valid in a filename and caps the length, so
 * a page's title (attacker-controlled text, for a malicious page) can be
 * used as a suggested PDF filename without producing an invalid or
 * absurdly long path.
 * @param title The tab's title.
 * @returns A filename-safe string, never empty.
 */
function sanitizeFileName(title: string): string {
  const cleaned = title.replace(/[\\/:*?"<>|]+/g, '_').trim().slice(0, 80);
  return cleaned || 'page';
}

/**
 * Clamps and rounds a requested zoom percent to `ZOOM_PERCENT_MIN`–`ZOOM_PERCENT_MAX`.
 * @param percent The requested percent — `NaN`-safe: `Math.max`/`Math.min`
 *   propagate a `NaN` input straight through rather than clamping it, so an
 *   invalid value (in practice, `ZoomPercentInput` never sends one) falls
 *   back to `ZOOM_PERCENT_DEFAULT` instead of setting an actual `NaN` zoom.
 * @returns A whole number within range.
 */
function clampZoomPercent(percent: number): number {
  if (!Number.isFinite(percent)) {
    return ZOOM_PERCENT_DEFAULT;
  }
  return Math.min(ZOOM_PERCENT_MAX, Math.max(ZOOM_PERCENT_MIN, Math.round(percent)));
}
