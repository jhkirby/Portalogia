// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-09-12

import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app, BrowserWindow, WebContentsView, dialog, type WebContents } from 'electron';
import {
  CHROME_HEIGHT_FOCUSED_PX,
  CHROME_HEIGHT_PX,
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
} from '@shared/constants';
import { escapeHtml } from '@shared/html';
import {
  IpcChannel,
  type AddressSuggestionsSyncPayload,
  type ColorPickerSyncPayload,
  type TooltipSyncPayload,
} from '@shared/ipc-contract';
import { isNavigableUrl, normalizeUrlOrSearch } from '@shared/url';
import type { BrowserState, BrowserTabState, SplitViewState, TabState, WorkspaceState } from '@shared/tab-state';
import type { BookmarkStore } from './BookmarkStore';
import { ColorPickerOverlay } from './ColorPickerOverlay';
import { trackPageSelectionAccent } from './pageSelectionAccent';
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
  private activeTabId: string | null = null;
  private activeWorkspaceId: string;
  private splitView: SplitViewState | null = null;
  private focusMode = false;
  private sidebarVisible = true;
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
   */
  public constructor(
    private readonly window: BrowserWindow,
    private readonly onStateChange: (state: BrowserState) => void,
    private readonly bookmarkStore: BookmarkStore,
    private readonly sessionStore: SessionStore,
    private readonly registry: SharedTabRegistry,
    terminals: TerminalManager,
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
      this.onStateChange(this.getState());
      this.sessionStore.scheduleSave(this.buildSessionSnapshot());
    });

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
   * Creates a new tab, loads it, and makes it the active tab.
   * @param url Address to load; defaults to `DEFAULT_TAB_URL` when omitted.
   * @param workspaceId Workspace to create it in; defaults to the active
   *   workspace. Callers that pass this explicitly always do so with the
   *   value already equal to `activeWorkspaceId` (see `switchWorkspace`),
   *   so the newly created tab is always the one about to become visible.
   * @returns The full browser state after the tab is created.
   */
  public createTab(url?: string, workspaceId?: string): BrowserState {
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
      workspaceId: workspaceId ?? this.activeWorkspaceId,
    });

    this.wireEvents(id, view);
    this.activateTab(id);

    const target = normalizeUrlOrSearch(url ?? DEFAULT_TAB_URL);
    void view.webContents.loadURL(target).catch(() => {
      // Load failures surface to the UI via the 'did-fail-load' listener
      // wired in wireEvents; the rejection itself carries nothing new.
    });

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
  public moveTab(id: string, beforeId: string | null): BrowserState {
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
  public moveTabToWorkspace(id: string, workspaceId: string): BrowserState {
    const state = this.states.get(id);
    if (!state || !this.workspaces.has(workspaceId) || state.workspaceId === workspaceId) {
      return this.getState();
    }

    const owner = this.registry.mountOwners.get(id);
    if (owner && owner !== this) {
      return owner.moveTabToWorkspace(id, workspaceId);
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
    } else {
      this.createTab(undefined, oldWorkspaceId);
    }

    return this.getState();
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

    if (this.grabbedTabId === id) {
      this.grabbedTabId = null;
    }

    if (closedState.kind === 'terminal') {
      this.terminals.dispose(id);
    } else if (options.recordClosed ?? true) {
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
   * plain Ctrl+W repeatedly.
   * @returns The full browser state after the reset.
   */
  public closeAllTabs(): BrowserState {
    const workspaceId = this.activeWorkspaceId;
    const idsToClose = Array.from(this.states.entries())
      .filter(([, state]) => state.workspaceId === workspaceId)
      .map(([tabId]) => tabId);

    for (const id of idsToClose) {
      this.closeTab(id);
    }

    return this.getState();
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
  public activateTab(id: string): BrowserState {
    if (!this.states.has(id)) {
      return this.getState();
    }

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
    if (this.states.get(id)?.kind === 'browser') {
      this.views.get(id)?.webContents.navigationHistory.goBack();
    }
    return this.getState();
  }

  /** Navigates a tab forward one entry in its history, if possible. A no-op for a terminal tab; see `navigate`. */
  public goForward(id: string): BrowserState {
    if (this.states.get(id)?.kind === 'browser') {
      this.views.get(id)?.webContents.navigationHistory.goForward();
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
    const closed = this.closedTabs.pop();
    if (!closed) {
      return this.getState();
    }
    const workspaceId = this.workspaces.has(closed.workspaceId)
      ? closed.workspaceId
      : this.activeWorkspaceId;
    return this.createTab(closed.url, workspaceId);
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
    if (!view || !state) {
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
    if (!this.states.has(tabId)) {
      return this.getState();
    }
    const id = randomUUID();
    const color = WORKSPACE_COLORS[this.workspaces.size % WORKSPACE_COLORS.length]!;
    this.workspaces.set(id, {
      id,
      name: `Workspace ${this.workspaces.size + 1}`,
      color,
    });
    this.moveTabToWorkspace(tabId, id);
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
    if (!this.states.has(tabId)) {
      return null;
    }
    const id = randomUUID();
    const color = WORKSPACE_COLORS[this.workspaces.size % WORKSPACE_COLORS.length]!;
    this.workspaces.set(id, {
      id,
      name: `Workspace ${this.workspaces.size + 1}`,
      color,
    });
    this.moveTabToWorkspace(tabId, id);
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
    this.focusWorkspaceDefaultTab(id);
    return this.getState();
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
    this.bookmarkStore.add(title, url);
    this.emitState();
    return this.getState();
  }

  /** Removes a bookmark by id. */
  public removeBookmark(id: string): BrowserState {
    this.bookmarkStore.remove(id);
    this.emitState();
    return this.getState();
  }

  /**
   * Bookmarks the given tab's current page, or un-bookmarks it if it's
   * already saved. A no-op if the tab doesn't exist (e.g. a stale
   * accelerator firing after the tab closed).
   * @param id The tab whose page to bookmark or un-bookmark.
   * @returns The full browser state after the change.
   */
  public toggleBookmark(id: string): BrowserState {
    const state = this.states.get(id);
    if (!state || state.kind !== 'browser') {
      return this.getState();
    }
    this.bookmarkStore.toggle(state.title, state.url);
    this.emitState();
    return this.getState();
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
   * but the active browser tab.
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
    if (!view || !state || state.kind !== 'browser' || id !== this.activeTabId) {
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
    if (this.activeTabId) {
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
    if (this.activeTabId) {
      this.setZoomPercent(this.activeTabId, clampZoomPercent(percent));
    }
    return this.getState();
  }

  /**
   * @param deltaPercent `±ZOOM_PERCENT_STEP`.
   */
  private adjustZoom(deltaPercent: number): void {
    if (!this.activeTabId) {
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
   * either end. A no-op with zero or one tab in the workspace.
   * @param direction `1` for the next tab, `-1` for the previous one.
   * @returns The full browser state after the change.
   */
  public cycleTab(direction: 1 | -1): BrowserState {
    const workspaceTabIds = Array.from(this.states.entries())
      .filter(([, state]) => state.workspaceId === this.activeWorkspaceId)
      .map(([tabId]) => tabId);
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
      tabs: Array.from(this.states.values()),
      activeTabId: this.activeTabId,
      workspaces: Array.from(this.workspaces.values()),
      activeWorkspaceId: this.activeWorkspaceId,
      bookmarks: this.bookmarkStore.list(),
      splitView: this.splitView,
      focusMode: this.focusMode,
      sidebarVisible: this.sidebarVisible,
      grabbedTabId: this.grabbedTabId,
      zoomPercent: this.activeTabId
        ? (this.registry.zoomPercentByTabId.get(this.activeTabId) ?? ZOOM_PERCENT_DEFAULT)
        : ZOOM_PERCENT_DEFAULT,
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
      tabs: Array.from(this.states.values()).map((state) => ({
        kind: state.kind,
        url: state.kind === 'browser' ? state.url : '',
        workspaceId: state.workspaceId,
        active: state.id === this.activeTabId,
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

    wc.on('page-title-updated', (_event, title) => this.patchState(id, { title }));
    wc.on('page-favicon-updated', (_event, favicons) => {
      this.patchState(id, { favicon: favicons[0] ?? null });
    });
    wc.on('did-start-loading', () => this.patchState(id, { isLoading: true }));
    wc.on('did-stop-loading', () => this.patchState(id, { isLoading: false, ...historyFlags() }));
    wc.on('did-navigate', (_event, url) => this.patchState(id, { url, ...historyFlags() }));
    wc.on('did-navigate-in-page', (_event, url) => this.patchState(id, { url }));
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

      // No modifier, so it falls outside the `cmdOrCtrl`-gated switch
      // below — Escape only ever does one thing here anyway, exit Focus
      // Mode, and only while it's actually on.
      if (key === 'escape' && owner.focusMode) {
        event.preventDefault();
        owner.setFocusMode(false);
        return;
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
          owner.removeWorkspace(owner.activeWorkspaceId);
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
        case 'w':
          event.preventDefault();
          owner.closeTab(id);
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
