// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-27

import { clipboard, ipcMain, type WebContents } from 'electron';
import { IpcChannel, type BookmarkUpdateResult } from '@shared/ipc-contract';
import { bookmarkIdRequestSchema, bookmarkUpdateRequestSchema } from '@shared/ipc-schemas';
import type { BookmarkStore } from './BookmarkStore';
import type { SharedTabRegistry } from './SharedTabRegistry';

/**
 * Owns the Bookmarks tab's cross-process wiring — one instance shared by
 * every window's `TabManager`, since a Bookmarks tab (like any tab) can move
 * between windows. It does two things:
 *
 * - **Serves** the bookmark list to every open Bookmarks tab, pushed
 *   whenever a bookmark is added, removed, renamed or re-pointed.
 * - **Obeys** edits, deletes, opens and copies from the Bookmarks page — only from a
 *   Bookmarks tab's own view, and only in edit mode for a change — handing
 *   each to the `TabManager` of the window showing that tab, which checks
 *   the edit, re-titles the file tabs it names and tells every view.
 */
export class BookmarksController {
  /**
   * @param registry The shared tabs/views, used to tell which `webContents` are Bookmarks tabs.
   * @param store Where bookmarks are kept.
   */
  public constructor(
    private readonly registry: SharedTabRegistry,
    private readonly store: BookmarkStore,
  ) {
    ipcMain.handle(IpcChannel.BookmarksPageUpdate, async (event, rawRequest: unknown): Promise<BookmarkUpdateResult> => {
      const parsed = bookmarkUpdateRequestSchema.safeParse(rawRequest);
      const tabId = parsed.success ? this.editingTabIdOf(event.sender) : null;
      const owner = tabId ? this.registry.mountOwners.get(tabId) : undefined;
      if (!parsed.success || !owner) {
        return { ok: false, field: 'title', message: 'That change could not be made' };
      }
      return owner.updateBookmark(parsed.data.id, parsed.data.title, parsed.data.reference);
    });
    ipcMain.on(IpcChannel.BookmarksPageDelete, (event, rawRequest: unknown) => {
      const parsed = bookmarkIdRequestSchema.safeParse(rawRequest);
      const tabId = parsed.success ? this.editingTabIdOf(event.sender) : null;
      if (parsed.success && tabId) {
        this.registry.mountOwners.get(tabId)?.removeBookmark(parsed.data.id);
      }
    });
    // Opened from where main's own record says the bookmark points, never from anything the page sends.
    ipcMain.on(IpcChannel.BookmarksPageOpen, (event, rawRequest: unknown) => {
      const parsed = bookmarkIdRequestSchema.safeParse(rawRequest);
      const tabId = parsed.success ? this.bookmarksTabIdOf(event.sender) : null;
      if (parsed.success && tabId) {
        this.registry.mountOwners.get(tabId)?.openBookmarkInNewTab(parsed.data.id);
      }
    });
    // Copies what main has stored for this id, never text the page sends — as the History page's copy does.
    ipcMain.on(IpcChannel.BookmarksPageCopy, (event, rawRequest: unknown) => {
      const parsed = bookmarkIdRequestSchema.safeParse(rawRequest);
      const bookmark = parsed.success && this.bookmarksTabIdOf(event.sender) ? this.store.find(parsed.data.id) : undefined;
      if (bookmark) {
        clipboard.writeText(bookmark.kind === 'page' ? bookmark.url : (bookmark.path ?? bookmark.url));
      }
    });
  }

  /** Sends the current list to one Bookmarks tab — call once its page has loaded, since a fresh page has never been sent anything. */
  public pushTo(tabId: string): void {
    const view = this.registry.views.get(tabId);
    if (view && !view.webContents.isDestroyed() && this.registry.states.get(tabId)?.kind === 'bookmarks') {
      view.webContents.send(IpcChannel.BookmarksPageList, this.store.list());
    }
  }

  /** Re-sends the list to every open Bookmarks tab — call whenever a bookmark changes. Small, so it goes at once. */
  public pushToAll(): void {
    for (const [tabId, state] of this.registry.states) {
      if (state.kind === 'bookmarks') {
        this.pushTo(tabId);
      }
    }
  }

  /**
   * The Bookmarks tab whose page sent a message.
   * @param sender The sending `webContents`.
   * @returns The tab's id, or `null` if the sender isn't a Bookmarks tab's page.
   */
  private bookmarksTabIdOf(sender: WebContents): string | null {
    for (const [tabId, view] of this.registry.views) {
      if (view.webContents === sender) {
        return this.registry.states.get(tabId)?.kind === 'bookmarks' ? tabId : null;
      }
    }
    return null;
  }

  /** As `bookmarksTabIdOf`, but only for a tab in edit mode: a viewed table offers no way to change anything. */
  private editingTabIdOf(sender: WebContents): string | null {
    const tabId = this.bookmarksTabIdOf(sender);
    const state = tabId ? this.registry.states.get(tabId) : undefined;
    return state?.kind === 'bookmarks' && state.mode === 'edit' ? tabId : null;
  }
}
