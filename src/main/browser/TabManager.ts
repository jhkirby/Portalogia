// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-09-12

import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { BrowserWindow, WebContentsView, dialog } from 'electron';
import {
  CHROME_HEIGHT_FOCUSED_PX,
  CHROME_HEIGHT_PX,
  DEFAULT_TAB_URL,
  DEFAULT_WORKSPACE_ID,
  DEFAULT_WORKSPACE_NAME,
  HOME_URL,
  SIDEBAR_TOGGLE_DURATION_MS,
  SIDEBAR_WIDTH_PX,
  WORKSPACE_COLORS,
} from '@shared/constants';
import { escapeHtml } from '@shared/html';
import { IpcChannel } from '@shared/ipc-contract';
import { isNavigableUrl, normalizeUrlOrSearch } from '@shared/url';
import type {
  BrowserState,
  BrowserTabState,
  SplitViewState,
  TabState,
  TerminalTabState,
  WorkspaceState,
} from '@shared/tab-state';
import type { BookmarkStore } from './BookmarkStore';
import { TerminalManager } from '../terminal/TerminalManager';

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
  private readonly views = new Map<string, WebContentsView>();
  private readonly states = new Map<string, TabState>();
  private readonly workspaces = new Map<string, WorkspaceState>();
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
  /** Bumped on every `toggleSidebar` call so an in-flight animation can tell it's been superseded and stop early. */
  private sidebarAnimationToken = 0;
  private readonly terminals: TerminalManager;

  /**
   * @param window The window whose `contentView` hosts each tab's view.
   * @param onStateChange Called with the full state after any change, so
   *   the caller can push it to the renderer over IPC.
   * @param bookmarkStore Persisted bookmark list this window's chrome reads and writes.
   */
  public constructor(
    private readonly window: BrowserWindow,
    private readonly onStateChange: (state: BrowserState) => void,
    private readonly bookmarkStore: BookmarkStore,
  ) {
    this.workspaces.set(DEFAULT_WORKSPACE_ID, {
      id: DEFAULT_WORKSPACE_ID,
      name: DEFAULT_WORKSPACE_NAME,
      color: WORKSPACE_COLORS[0],
    });
    this.activeWorkspaceId = DEFAULT_WORKSPACE_ID;
    this.terminals = new TerminalManager(
      (id, data) => {
        console.log('[DEBUG] sending TerminalData to renderer', id, data.length, 'destroyed=', this.window.webContents.isDestroyed());
        this.window.webContents.send(IpcChannel.TerminalData, { id, data });
      },
      (id) => this.patchTerminalState(id, { exited: true }),
    );

    // The Ctrl+Space reorder gesture also needs to work when OS keyboard
    // focus is on the chrome itself rather than a tab's own webContents
    // (e.g. right after a mouse drag-and-drop of a tab, or a click on a
    // workspace pill) — every other per-tab shortcut's fallback for that
    // case is a menu accelerator, which this stateful, held-key gesture
    // can't be expressed as (see `handleReorderGestureInput`).
    this.window.webContents.on('before-input-event', (event, input) => {
      this.handleReorderGestureInput(event, input);
    });
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
   * Opens a new terminal tab (Ctrl+S, the toolbar button, or File > New
   * Terminal) and makes it active. Unlike `createTab`, there's no
   * `WebContentsView` or URL — `activateTab` already treats a tab with no
   * view as "nothing to mount," and the renderer's `Terminal` component
   * (rendered directly in the chrome's own DOM, not a separate native
   * view) picks it up as soon as `activeTabId` matches its own tab id.
   * Focus lands in the terminal itself rather than the address bar — that
   * component focuses its own xterm instance whenever it becomes active,
   * so no `focusAddressBarPastTabLoad`-style handoff is needed here.
   * @param workspaceId Workspace to create it in; defaults to the active workspace.
   * @returns The full browser state after the tab is created.
   */
  public createTerminalTab(workspaceId?: string): BrowserState {
    const id = randomUUID();
    this.states.set(id, {
      kind: 'terminal',
      id,
      title: 'Terminal',
      exited: false,
      workspaceId: workspaceId ?? this.activeWorkspaceId,
    });
    this.terminals.create(id);
    return this.activateTab(id);
  }

  /** Forwards a terminal tab's keystroke/paste bytes to its pty. A no-op if `id` isn't a live terminal tab. */
  public sendTerminalInput(id: string, data: string): void {
    this.terminals.write(id, data);
  }

  /** Resizes a terminal tab's pty to match its xterm instance's current grid. A no-op if `id` isn't a live terminal tab. */
  public resizeTerminal(id: string, cols: number, rows: number): void {
    this.terminals.resize(id, cols, rows);
  }

  /** Kills every terminal tab's shell process — call this when the window itself closes. */
  public disposeAllTerminals(): void {
    this.terminals.disposeAll();
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
   * Closes a tab. If it was the active tab, activates a neighbor in the
   * same workspace; if none remain there, opens a fresh home tab in that
   * workspace instead of jumping to an unrelated one. If the tab was part
   * of an active split view, the other pane simply takes over full width.
   * @param id The tab to close.
   * @returns The full browser state after the tab is closed.
   */
  public closeTab(id: string): BrowserState {
    const closedState = this.states.get(id);
    if (!closedState) {
      return this.getState();
    }
    if (this.grabbedTabId === id) {
      this.grabbedTabId = null;
    }

    if (closedState.kind === 'terminal') {
      this.terminals.dispose(id);
    } else {
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
   * @param id The tab to bring to the front.
   * @returns The full browser state after the switch.
   */
  public activateTab(id: string): BrowserState {
    if (!this.states.has(id)) {
      return this.getState();
    }

    if (this.splitView) {
      this.teardownSplitView();
    }

    if (this.activeTabId && this.activeTabId !== id) {
      const previous = this.views.get(this.activeTabId);
      if (previous) {
        this.window.contentView.removeChildView(previous);
      }
    }

    // A terminal tab has no `WebContentsView` — nothing to mount here.
    // Leaving the content area clear is exactly what it needs: the
    // renderer's `Terminal` component, always mounted in the chrome's own
    // DOM, shows through as soon as `activeTabId` matches its tab id.
    const view = this.views.get(id);
    if (view) {
      this.window.contentView.addChildView(view);
      view.setBounds(this.computeMainBoundsForLeftInset(this.targetLeftInset()));
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
   * Navigates a tab. Re-validates and re-normalizes the URL on this side
   * of the IPC boundary rather than trusting the renderer's normalization.
   * @param id The tab to navigate.
   * @param url Raw address bar text or a URL.
   * @returns The full browser state (loading flags update asynchronously).
   */
  public navigate(id: string, url: string): BrowserState {
    const view = this.views.get(id);
    if (!view) {
      return this.getState();
    }

    const target = normalizeUrlOrSearch(url);
    if (!isNavigableUrl(target)) {
      throw new Error(`Refusing to navigate to disallowed URL: ${target}`);
    }

    void view.webContents.loadURL(target).catch(() => {});
    return this.getState();
  }

  /** Navigates a tab to the home page — the same destination the toolbar's Home button uses. */
  public goHome(id: string): BrowserState {
    return this.navigate(id, HOME_URL);
  }

  /** Navigates a tab back one entry in its history, if possible. */
  public goBack(id: string): BrowserState {
    this.views.get(id)?.webContents.navigationHistory.goBack();
    return this.getState();
  }

  /** Navigates a tab forward one entry in its history, if possible. */
  public goForward(id: string): BrowserState {
    this.views.get(id)?.webContents.navigationHistory.goForward();
    return this.getState();
  }

  /** Reloads a tab's current page. */
  public reload(id: string): BrowserState {
    this.views.get(id)?.webContents.reload();
    return this.getState();
  }

  /** Stops a tab's in-flight navigation. */
  public stop(id: string): BrowserState {
    this.views.get(id)?.webContents.stop();
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
   * location via a native dialog parented to this window.
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

  // ── Split view ───────────────────────────────────────────────────────

  /**
   * Puts the active tab and one other tab side by side. A no-op if either
   * id is invalid or they're the same tab.
   * @param secondaryId The tab to show alongside the current active tab.
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

    this.teardownSplitView();
    this.splitView = { primaryTabId: primaryId, secondaryTabId: secondaryId };
    this.window.contentView.addChildView(secondaryView);
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
   * Toggles Focus Mode: hides the workspace/tab row so only the toolbar
   * and page remain, and grows the page to fill the freed space.
   * @param enabled Whether Focus Mode should be on.
   * @returns The full browser state after the change.
   */
  public setFocusMode(enabled: boolean): BrowserState {
    this.focusMode = enabled;
    this.updateBounds();
    this.emitState();
    return this.getState();
  }

  /** Toggles Focus Mode to whichever state it isn't currently in. */
  public toggleFocusMode(): BrowserState {
    return this.setFocusMode(!this.focusMode);
  }

  // ── Sidebar ──────────────────────────────────────────────────────────

  /**
   * Shows or hides the workspace sidebar, animating both the native tab
   * content's bounds and (via the pushed `sidebarVisible` state) the
   * sidebar's own CSS transition together, so the content edge and the
   * sliding sidebar move in step instead of one snapping ahead of the
   * other.
   * @returns The full browser state after the change (the animation
   *   itself keeps running past this point; bounds settle asynchronously).
   */
  public toggleSidebar(): BrowserState {
    const wasVisible = this.sidebarVisible;
    this.sidebarVisible = !wasVisible;
    this.emitState();
    this.animateLeftInset(wasVisible ? SIDEBAR_WIDTH_PX : 0, this.targetLeftInset());
    return this.getState();
  }

  /**
   * Drives the sidebar's show/hide transition frame by frame, since a
   * native `WebContentsView`'s bounds — unlike a CSS `width` — don't
   * animate on their own. Cancels itself if superseded by a newer toggle
   * (`sidebarAnimationToken` changes) so rapid double-toggles don't fight
   * over the view's bounds.
   * @param fromLeft Inset at the start of the animation.
   * @param toLeft Inset the animation settles on.
   */
  private animateLeftInset(fromLeft: number, toLeft: number): void {
    const token = ++this.sidebarAnimationToken;
    const start = Date.now();
    const step = (): void => {
      if (token !== this.sidebarAnimationToken) {
        return;
      }
      const t = Math.min(1, (Date.now() - start) / SIDEBAR_TOGGLE_DURATION_MS);
      // Ease-out cubic — matches the `cubic-bezier(0.33, 1, 0.68, 1)` timing
      // function on the sidebar's own CSS transition (see workspace-bar.css).
      const eased = 1 - (1 - t) ** 3;
      this.applyBoundsForLeftInset(fromLeft + (toLeft - fromLeft) * eased);
      if (t < 1) {
        setTimeout(step, 16);
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
    };
  }

  /** Re-fits the mounted view(s) to the window; call this on resize. */
  public updateBounds(): void {
    this.applyBoundsForLeftInset(this.targetLeftInset());
  }

  /**
   * Activates whichever tab a workspace should show when it becomes
   * active: its last-active tab if that still exists, else its first
   * remaining tab, else a fresh home tab.
   * @param workspaceId The workspace to focus a tab within.
   */
  private focusWorkspaceDefaultTab(workspaceId: string): void {
    const lastActive = this.lastActiveTabIdByWorkspace.get(workspaceId);
    if (lastActive && this.states.has(lastActive)) {
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
    this.splitView = null;
  }

  /**
   * The sidebar's resting horizontal inset: 0 when there's no sidebar to
   * clear (Focus Mode, or the sidebar toggled hidden via `toggleSidebar`),
   * else `SIDEBAR_WIDTH_PX`. Mid-toggle, `applyBoundsForLeftInset` is
   * driven by the animation loop instead — this is only the value things
   * settle back to.
   */
  private targetLeftInset(): number {
    return this.focusMode || !this.sidebarVisible ? 0 : SIDEBAR_WIDTH_PX;
  }

  /** @returns The bounds a single full-width tab view should occupy for a given sidebar inset, below the chrome. */
  private computeMainBoundsForLeftInset(left: number): Rect {
    // Electron types getContentSize() as number[], not a fixed tuple, so
    // noUncheckedIndexedAccess sees each element as possibly undefined.
    const [width = 0, height = 0] = this.window.getContentSize();
    const top = this.focusMode ? CHROME_HEIGHT_FOCUSED_PX : CHROME_HEIGHT_PX;
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
   * Applies bounds for a given sidebar inset to whichever view(s) are
   * currently mounted — the single shared code path for both the settled
   * state (`updateBounds`) and every frame of `toggleSidebar`'s animation.
   * @param left Horizontal inset to clear, in CSS pixels.
   */
  private applyBoundsForLeftInset(left: number): void {
    const main = this.computeMainBoundsForLeftInset(left);
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
   * Merges a partial update into one terminal tab's state and notifies the
   * caller — `patchState`'s counterpart for the fields a terminal tab has
   * instead of a browser tab's (currently just `exited`).
   * @param id Terminal tab to update.
   * @param patch Fields to overwrite.
   */
  private patchTerminalState(
    id: string,
    patch: Partial<Omit<TerminalTabState, 'kind' | 'id' | 'workspaceId'>>,
  ): void {
    const current = this.states.get(id);
    if (!current || current.kind !== 'terminal') {
      return;
    }
    this.states.set(id, { ...current, ...patch });
    this.emitState();
  }

  /** Pushes the current state to the registered listener. */
  private emitState(): void {
    this.onStateChange(this.getState());
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

    // Safety net for the Ctrl+Space keyboard-reorder gesture below: if this
    // view loses OS focus mid-hold (e.g. a click elsewhere, or the tab
    // being nudged out from under the cursor), its `keyUp` for Space might
    // never arrive here at all, since keyup goes to whichever surface has
    // focus at release time, not necessarily this one. Blurring is treated
    // the same as releasing the keys, so the grab can't get stuck.
    wc.on('blur', () => this.releaseGrabbedTab());

    wc.on('page-title-updated', (_event, title) => this.patchState(id, { title }));
    wc.on('page-favicon-updated', (_event, favicons) => {
      this.patchState(id, { favicon: favicons[0] ?? null });
    });
    wc.on('did-start-loading', () => this.patchState(id, { isLoading: true }));
    wc.on('did-stop-loading', () => this.patchState(id, { isLoading: false, ...historyFlags() }));
    wc.on('did-navigate', (_event, url) => this.patchState(id, { url, ...historyFlags() }));
    wc.on('did-navigate-in-page', (_event, url) => this.patchState(id, { url }));

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

    // Belt-and-suspenders for the browser-chrome shortcuts also bound as
    // menu accelerators in buildMenu.ts (close/new/reopen tab, bookmark,
    // close all tabs, toggle sidebar, cycle tabs/workspaces, home,
    // back/forward): Electron's menu accelerators are unreliable once a
    // WebContentsView (as opposed to the chrome window's own webContents)
    // has OS focus — which, for a browser, tab content has almost all the
    // time — so a page could otherwise swallow Ctrl+W etc. or the
    // accelerator could simply not fire. Handling it here too, directly
    // on the tab's own webContents, means it fires regardless of the
    // menu's focus quirks and beats the page's own keydown handling since
    // `before-input-event` runs first.
    wc.on('before-input-event', (event, input) => {
      if (this.handleReorderGestureInput(event, input)) {
        return;
      }
      if (input.type !== 'keyDown') {
        return;
      }
      const key = input.key.toLowerCase();

      if (input.isAutoRepeat) {
        return;
      }
      const cmdOrCtrl = input.control || input.meta;

      if (input.alt && !cmdOrCtrl && !input.shift) {
        if (key === 'arrowleft') {
          event.preventDefault();
          this.goBack(id);
        } else if (key === 'arrowright') {
          event.preventDefault();
          this.goForward(id);
        }
        return;
      }

      if (cmdOrCtrl && input.alt && key === 'w') {
        event.preventDefault();
        if (input.shift) {
          // Ctrl+Shift+Alt+W — the workspace equivalent of Ctrl+Shift+W:
          // closes every workspace and resets the last one, same as
          // repeating the combo below until only one is left.
          this.closeAllWorkspaces();
        } else {
          // The deliberately-harder-to-hit combo for closing the whole
          // workspace — plain Ctrl+W (below) only ever closes a tab.
          // `removeWorkspace` itself refuses to act when this is the last
          // remaining workspace, so this can never close the window.
          this.removeWorkspace(this.activeWorkspaceId);
        }
        return;
      }

      if (!cmdOrCtrl || input.alt) {
        return;
      }

      if (input.shift) {
        switch (key) {
          case 't':
            event.preventDefault();
            this.restoreLastClosedTab();
            return;
          case 'w':
            event.preventDefault();
            this.closeAllTabs();
            return;
          default:
            return;
        }
      }

      switch (key) {
        case 'w':
          event.preventDefault();
          this.closeTab(id);
          return;
        case 'n':
          event.preventDefault();
          this.createTabAndFocusAddressBar();
          return;
        case 's':
          event.preventDefault();
          this.createTerminalTab();
          return;
        case 'q':
          // Same action as Ctrl+Shift+N, under a second accelerator — see
          // buildMenu.ts's hidden "New Workspace" (Ctrl+Q) entry for why.
          event.preventDefault();
          this.createWorkspace();
          return;
        case 't':
          event.preventDefault();
          this.restoreLastClosedTab();
          return;
        case 'b':
          event.preventDefault();
          this.toggleBookmark(id);
          return;
        case 'h':
          event.preventDefault();
          this.goHome(id);
          return;
        case 'l':
          event.preventDefault();
          this.toggleSidebar();
          return;
        case '/':
          event.preventDefault();
          this.requestFocusAddressBar();
          return;
        case 'arrowleft':
          event.preventDefault();
          this.cycleTab(-1);
          return;
        case 'arrowright':
          event.preventDefault();
          this.cycleTab(1);
          return;
        case 'arrowup':
          event.preventDefault();
          this.cycleWorkspace(-1);
          return;
        case 'arrowdown':
          event.preventDefault();
          this.cycleWorkspace(1);
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
