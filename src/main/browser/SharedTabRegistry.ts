// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-09-24

import type { BrowserWindow, WebContentsView } from 'electron';
import type { TabState, WorkspaceState } from '@shared/tab-state';
import type { TabManager } from './TabManager';

/**
 * The tabs, workspaces, and their native views — the one copy of each,
 * shared by every open window's `TabManager` rather than each owning its
 * own independent set. Before this existed, tearing a tab off into a new
 * window (`tearOffTab`) gave that window a brand-new, unrelated "Home"
 * workspace of its own; with tabs/workspaces shared here instead, every
 * window's sidebar shows the same workspace list, and a tab created in one
 * window is immediately a tab any other window can switch to — the whole
 * point being that a `WorkspaceState`/`TabState` describes something that
 * exists once, not once per window.
 *
 * What's deliberately *not* here, and stays a plain per-window field on
 * `TabManager` instead: `activeTabId`/`activeWorkspaceId` (which workspace
 * and tab a given window happens to be looking at right now),
 * `splitView`/`focusMode`/`sidebarVisible`/`grabbedTabId` (window-local
 * chrome UI state), and `closedTabs`/`lastActiveTabIdByWorkspace`
 * (per-window memory — which tab Ctrl+Shift+T reopens, or which tab a
 * workspace last showed in *this* window, both reasonably windows having
 * their own answer to).
 */
export class SharedTabRegistry {
  public readonly workspaces = new Map<string, WorkspaceState>();
  public readonly states = new Map<string, TabState>();
  public readonly views = new Map<string, WebContentsView>();
  /**
   * Which `TabManager` (i.e. window) currently has a given tab visually
   * mounted — the active tab, or a split view's secondary pane. Absent for
   * a background tab nobody's currently showing. Since a `WebContentsView`
   * can only ever be attached to one window's `contentView` at a time,
   * this is what lets `TabManager.activateTab` correctly steal a tab away
   * from whichever *other* window currently has it, and what lets
   * `closeTab`/`moveTabToWorkspace` correctly unmount it from wherever
   * that actually is rather than assuming it's always "this" window.
   */
  public readonly mountOwners = new Map<string, TabManager>();
  /**
   * Each tab's own zoom, as a whole percent (25–200, 100 = native size),
   * keyed by tab id. A property of the tab itself — like `states` — not of
   * whichever window happens to be showing it, so it lives here rather
   * than per-`TabManager`. Absent means never zoomed (100%). See
   * `TabManager.applyZoom` for why this is tracked here at all instead of
   * just reading a `WebContentsView`'s own `webContents.zoomLevel`: it's
   * now pushed to the view's own frame-local zoom (`webFrame.setZoomLevel`
   * via its preload) rather than set through `contents.zoomLevel`, which
   * doesn't persist across a browser tab's own navigations on its own the
   * way the per-origin `contents.zoomLevel` used to.
   */
  public readonly zoomPercentByTabId = new Map<string, number>();
  /**
   * Link groups: every browser tab that is "the same tab" shown from more
   * than one window at once. A `WebContentsView` can only be attached to
   * one window, so each window showing the tab gets its own independent
   * view (own scroll position and DOM state) loaded to the same URL — the
   * members of a group. Navigating any member navigates the rest
   * (`TabManager.propagateLinkedNavigation`), and the tab bar lists a group
   * as one tab per window (`TabManager.shouldListTabForThisWindow`).
   * `members[0]` is the canonical (original) tab: it keeps the group's
   * position in the tab strip, and is what a window not showing the group
   * lists. Every member id maps to the *same* array, so it's a plain
   * property of the tab itself, not of any window — same reasoning as
   * `zoomPercentByTabId`.
   */
  private readonly linkGroups = new Map<string, string[]>();

  /** The group `tabId` belongs to (canonical first), or `undefined` if it's an ordinary, unlinked tab. */
  public getLinkGroup(tabId: string): readonly string[] | undefined {
    return this.linkGroups.get(tabId);
  }

  /** Adds `newId` to `existingId`'s group, creating the group (with `existingId` canonical) if it has none yet. */
  public addToLinkGroup(existingId: string, newId: string): void {
    const group = this.linkGroups.get(existingId) ?? [existingId];
    group.push(newId);
    this.linkGroups.set(existingId, group);
    this.linkGroups.set(newId, group);
  }

  /** Removes `tabId` from its group; a group left with a single member dissolves, so that survivor is an ordinary tab again. */
  public removeFromLinkGroup(tabId: string): void {
    const group = this.linkGroups.get(tabId);
    if (!group) {
      return;
    }
    this.linkGroups.delete(tabId);
    group.splice(group.indexOf(tabId), 1);
    if (group.length <= 1) {
      for (const survivor of group) {
        this.linkGroups.delete(survivor);
      }
    }
  }

  private readonly windows = new Set<BrowserWindow>();
  private readonly listeners = new Set<() => void>();
  private readonly workspaceRemovedListeners = new Set<(workspaceId: string) => void>();
  private readonly selectionProviders = new Set<() => readonly string[]>();

  /**
   * Registers a window as one this registry's shared data is visible to.
   * @param window The window to track, so `detachViewFromAllWindows` knows
   *   to check it too.
   * @param onSharedChange Called after any change to this registry's data
   *   from *any* window — including this one's own — so every window can
   *   push its own fresh `BrowserState` (shared data plus its own
   *   window-local fields) to its own renderer.
   * @param onWorkspaceRemoved Called when any window deletes a workspace.
   * @returns A function that unregisters `window`/`onSharedChange` — call
   *   it when the window closes.
   */
  public registerWindow(
    window: BrowserWindow,
    onSharedChange: () => void,
    onWorkspaceRemoved: (workspaceId: string) => void,
    getSelectedTabIds: () => readonly string[],
  ): () => void {
    this.windows.add(window);
    this.listeners.add(onSharedChange);
    this.workspaceRemovedListeners.add(onWorkspaceRemoved);
    this.selectionProviders.add(getSelectedTabIds);
    return () => {
      this.windows.delete(window);
      this.listeners.delete(onSharedChange);
      this.workspaceRemovedListeners.delete(onWorkspaceRemoved);
      this.selectionProviders.delete(getSelectedTabIds);
    };
  }

  /**
   * The multi-selection of tabs (two or more) that includes `tabId`, in any
   * window — a drag that started in one window is dropped in another, whose
   * own handlers only learn the dragged tab's id, so the whole selection has
   * to be looked up here rather than carried through the drop.
   * @returns The selected ids (active tab included), or `null` if `tabId` isn't part of a multi-selection.
   */
  public selectionContainingTab(tabId: string): readonly string[] | null {
    for (const provider of this.selectionProviders) {
      const selection = provider();
      if (selection.length > 1 && selection.includes(tabId)) {
        return selection;
      }
    }
    return null;
  }

  /** Tells every window a workspace was deleted, so any showing it can fall back to another. */
  public notifyWorkspaceRemoved(workspaceId: string): void {
    for (const listener of Array.from(this.workspaceRemovedListeners)) {
      listener(workspaceId);
    }
  }

  /**
   * Removes a view from every registered window's `contentView` it might
   * currently be attached to — safe to call even if it isn't mounted
   * anywhere (`removeChildView` is a no-op for a view that isn't actually
   * one of that `contentView`'s children). Called before mounting a tab
   * into a *specific* window, so a tab already visible in one window can
   * be claimed by another without ending up attached to both at once.
   * @param view The tab's view to detach.
   */
  public detachViewFromAllWindows(view: WebContentsView): void {
    for (const window of this.windows) {
      window.contentView.removeChildView(view);
    }
  }

  /** Notifies every registered window that shared tab/workspace data changed, so each re-pushes its own full state. */
  public notifyAll(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}
