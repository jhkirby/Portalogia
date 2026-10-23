// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-22

import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { basename } from 'node:path';
import { BrowserWindow, clipboard, ipcMain, type Session, type WebContents } from 'electron';
import {
  IpcChannel,
  type HistoryBookmarkIndex,
  type HistoryClearRange,
  type HistoryEntry,
  type HistorySuggestion,
} from '@shared/ipc-contract';
import { SEARCH_SUGGESTIONS_LIMIT } from '@shared/constants';
import { historyCutoff } from '@shared/history';
import type { BookmarkState } from '@shared/tab-state';
import { historyDeleteRequestSchema } from '@shared/ipc-schemas';
import type { HistoryStore } from './HistoryStore';
import type { SharedTabRegistry } from './SharedTabRegistry';

/** Only these are pages a person reached; the app's own `northstar://` and `file:` pages aren't history. */
const RECORDED_URLS = ['http://*/*', 'https://*/*'];

/** Longest route kept: a URL can be arbitrarily long, and the table only has so much room. */
const MAX_URL_LENGTH = 2048;

/** How long to let a burst of visits settle before re-sending the list to open History tabs. */
const PUSH_DEBOUNCE_MS = 400;


/** The most routes a search returns: the dropdown scrolls back through all of them (`SEARCH_SUGGESTIONS_LIMIT`). */
const MAX_SEARCH_RESULTS = SEARCH_SUGGESTIONS_LIMIT;

/** How many PDF paths are checked for existence before giving up on finding enough: each check reads the disk. */
const MAX_PDF_EXISTENCE_CHECKS = 200;

/**
 * Owns the browsing history's cross-process wiring — one instance shared by
 * every window's `TabManager`, since a History tab (like any tab) can move
 * between windows. It does three things:
 *
 * - **Records** every PDF opened in a PDF tab (`recordPdfAccess`), every note opened in a Markdown tab
 *   (`recordMarkdownAccess`), and every main-frame request a *browser* tab makes, with the
 *   status code it came back with, by listening on the session's web
 *   requests (`attachTo`). A redirect hop is recorded too, under its own
 *   3xx — the history is of routes requested, not just where they ended up.
 *   The chrome, overlays, terminal/PDF/History pages and subframes are
 *   skipped: only the contents of a browser tab's own view count.
 * - **Serves** the list to every open History tab, pushed whenever it
 *   changes (debounced, so a page load's burst of requests is one push).
 * - **Obeys** deletes from the History page (only from a History tab's own
 *   view) and clears from the chrome's toolbar (see `clear`).
 */
export class HistoryController {
  private pushTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * @param registry The shared tabs/views, used to tell which `webContents` are browser or History tabs.
   * @param store Where visits are kept.
   * @param listBookmarks The current bookmarks — the table's Bookmark column shows a route's bookmark name.
   */
  public constructor(
    private readonly registry: SharedTabRegistry,
    private readonly store: HistoryStore,
    private readonly listBookmarks: () => readonly BookmarkState[],
  ) {
    ipcMain.on(IpcChannel.HistoryCopy, (event, rawRequest: unknown) => {
      const parsed = historyDeleteRequestSchema.safeParse(rawRequest);
      const entry = parsed.success && this.isHistoryView(event.sender) ? this.store.find(parsed.data.id) : undefined;
      if (entry) {
        clipboard.writeText(entry.url);
      }
    });
    // Opened from the route main has stored for this id, never one sent by the page, in the window showing the History tab.
    ipcMain.on(IpcChannel.HistoryOpenInNewTab, (event, rawRequest: unknown) => {
      const parsed = historyDeleteRequestSchema.safeParse(rawRequest);
      const historyTabId = parsed.success ? this.historyTabIdOf(event.sender) : null;
      const entry = parsed.success && historyTabId ? this.store.find(parsed.data.id) : undefined;
      if (historyTabId && entry) {
        this.registry.mountOwners.get(historyTabId)?.openHistoryEntryInNewTab(entry);
      }
    });
    ipcMain.on(IpcChannel.HistoryDelete, (event, rawRequest: unknown) => {
      const parsed = historyDeleteRequestSchema.safeParse(rawRequest);
      if (parsed.success && this.isHistoryView(event.sender) && this.store.remove(parsed.data.id)) {
        this.pushToAll(true);
      }
    });
  }

  /**
   * Starts recording from a session's web requests. The session allows one
   * listener per event, so nothing else may claim `onCompleted` or
   * `onBeforeRedirect` on it — which is why anything else that needs to
   * know a request finished hears it through `onRequestCompleted`.
   * @param ses The session browser tabs load their pages in.
   * @param onRequestCompleted Told of every finished request's page (the load progress estimate).
   */
  public attachTo(ses: Session, onRequestCompleted: (webContentsId: number | undefined) => void = () => {}): void {
    const filter = { urls: RECORDED_URLS };
    ses.webRequest.onCompleted(filter, (details) => {
      onRequestCompleted(details.webContentsId);
      this.record(details.resourceType, details.webContentsId, details.url, details.method, details.statusCode, details.timestamp);
    });
    ses.webRequest.onBeforeRedirect(filter, (details) => {
      this.record(details.resourceType, details.webContentsId, details.url, details.method, details.statusCode, details.timestamp);
    });
  }

  /**
   * Deletes the visits within a range. Called for the toolbar's "Clear
   * History", whose request `registerTabIpc` has already validated and
   * confirmed came from the chrome rather than a page.
   * @param range The last N of a unit, or everything.
   */
  /**
   * How many visits a range covers: what `clear` would delete, for its confirmation to say.
   * @param range The last N of a unit, or everything.
   */
  public count(range: HistoryClearRange): number {
    return this.store.countSince(HistoryController.cutoffFor(range, Date.now()));
  }

  public clear(range: HistoryClearRange): void {
    if (this.store.removeSince(HistoryController.cutoffFor(range, Date.now())) > 0) {
      this.pushToAll(true);
    }
  }

  /** Sends the current list (and the bookmark names) to one History tab — call once its page has loaded, since a fresh page has never been sent anything. */
  public pushTo(tabId: string): void {
    const view = this.registry.views.get(tabId);
    if (view && !view.webContents.isDestroyed() && this.registry.states.get(tabId)?.kind === 'history') {
      view.webContents.send(IpcChannel.HistoryEntries, this.store.listNewestFirst());
      view.webContents.send(IpcChannel.HistoryBookmarks, this.bookmarkIndex());
    }
  }

  /** Re-sends the bookmark names to every open History tab — call whenever a bookmark is added, removed or renamed. Small, so it goes at once. */
  public pushBookmarksToAll(): void {
    const index = this.bookmarkIndex();
    for (const [tabId, state] of this.registry.states) {
      const view = this.registry.views.get(tabId);
      if (state.kind === 'history' && view && !view.webContents.isDestroyed()) {
        view.webContents.send(IpcChannel.HistoryBookmarks, index);
      }
    }
  }

  private bookmarkIndex(): HistoryBookmarkIndex {
    const urls: Record<string, string> = {};
    const pdfs: Record<string, string> = {};
    for (const bookmark of this.listBookmarks()) {
      // Files of either kind go in one table: the page only looks a path up, and a path is one or the other.
      if ((bookmark.kind === 'pdf' || bookmark.kind === 'markdown') && bookmark.path) {
        pdfs[bookmark.path.toLowerCase()] = bookmark.title;
      } else if (bookmark.kind === 'page') {
        urls[bookmark.url] = bookmark.title;
      }
    }
    return { urls, pdfs };
  }

  /**
   * The most recent distinct pages or PDFs whose route contains the query —
   * what the address bar and the PDF search list after the bookmarks. A page
   * counts only if it loaded (2xx): a redirect hop's destination is its own
   * entry, and an error page isn't somewhere to suggest going. A PDF counts
   * only if its file is still there, so a suggestion never opens to an error.
   * @param type Pages, PDFs or notes.
   * @param query The typed text. Empty returns nothing for pages, and every file for PDFs and notes (their search
   *   boxes list them all as soon as they're focused).
   * @returns Up to `MAX_SEARCH_RESULTS` matches, newest first.
   */
  public async search(type: HistoryEntry['type'], query: string): Promise<HistorySuggestion[]> {
    const needle = query.trim().toLowerCase();
    if (!needle && type === 'url') {
      return [];
    }
    const matches = (entry: HistoryEntry): boolean => entry.url.toLowerCase().includes(needle);

    if (type === 'url') {
      return this.store
        .distinctRecent('url', (entry) => entry.status >= 200 && entry.status < 300 && matches(entry), MAX_SEARCH_RESULTS)
        .map((entry) => ({ title: HistoryController.hostOf(entry.url), url: entry.url }));
    }

    const candidates = this.store.distinctRecent(type, matches, MAX_PDF_EXISTENCE_CHECKS);
    const exists = await Promise.all(candidates.map((entry) => stat(entry.url).then(() => true, () => false)));
    return candidates
      .filter((_entry, index) => exists[index])
      .slice(0, MAX_SEARCH_RESULTS)
      .map((entry) => ({ title: basename(entry.url), url: entry.url }));
  }

  /** @returns Whether a PDF at this path is one the history has seen — the only paths a search suggestion can ask to open. */
  public hasPdfAccess(path: string): boolean {
    return this.store.hasPdfPath(path);
  }

  /** @returns Whether a Markdown note at this path is one the history has seen — the only paths a search suggestion can ask to open. */
  public hasMarkdownAccess(path: string): boolean {
    return this.store.hasFilePath('markdown', path);
  }

  private static hostOf(url: string): string {
    try {
      return new URL(url).hostname;
    } catch {
      return url;
    }
  }

  /** Writes any pending save now — call on quit. */
  public flush(): void {
    this.store.flush();
  }

  /**
   * The moment a clear reaches back to: everything made at or after it goes.
   * "Months" are calendar months, so "1 month" on the 31st lands on the
   * right day of the month before rather than a fixed 30 days back.
   * @param range What to clear.
   * @param now The current time, in milliseconds since the epoch.
   * @returns The cutoff, or `null` for everything.
   */
  public static cutoffFor(range: HistoryClearRange, now: number): number | null {
    return historyCutoff(range, now);
  }

  /** `webContentsId` is absent for a request no page made (e.g. one the main process issued itself), which is never history. */
  private record(
    resourceType: string,
    webContentsId: number | undefined,
    url: string,
    method: string,
    status: number,
    timestamp: number,
  ): void {
    if (resourceType !== 'mainFrame' || webContentsId === undefined || !this.isBrowserTabContents(webContentsId)) {
      return;
    }
    this.store.add({
      id: randomUUID(),
      timestamp: Math.round(timestamp),
      type: 'url',
      url: url.slice(0, MAX_URL_LENGTH),
      status,
      method: method.toUpperCase().slice(0, 16),
    });
    this.pushToAll();
  }

  /**
   * Records a PDF opened in a PDF tab — however it was picked (the open
   * dialog, the bookmark search). It has a path where a page has a URL and no
   * status code.
   * @param path The file's path on disk.
   */
  public recordPdfAccess(path: string): void {
    this.store.add({ id: randomUUID(), timestamp: Date.now(), type: 'pdf', url: path, status: 0, method: '' });
    this.pushToAll();
  }

  /**
   * Records a note opened in a Markdown tab — however it was picked (the open
   * dialog, a link, the bookmark search). Like a PDF, it has a path where a
   * page has a URL and no status code.
   * @param path The file's path on disk.
   */
  public recordMarkdownAccess(path: string): void {
    this.store.add({ id: randomUUID(), timestamp: Date.now(), type: 'markdown', url: path, status: 0, method: '' });
    this.pushToAll();
  }

  /**
   * Re-sends the list to every open History tab. A burst of recorded visits
   * waits for things to settle; a person's own delete or clear goes at once,
   * since they're watching the row.
   * @param immediate Skip the debounce.
   */
  private pushToAll(immediate = false): void {
    if (this.pushTimer !== null) {
      clearTimeout(this.pushTimer);
      this.pushTimer = null;
    }
    const send = (): void => {
      this.pushTimer = null;
      for (const [tabId, state] of this.registry.states) {
        if (state.kind === 'history') {
          this.pushTo(tabId);
        }
      }
      // The chrome's History toolbar counts what "Clear History" would delete; a change may make that stale.
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) {
          window.webContents.send(IpcChannel.HistoryChanged);
        }
      }
    };
    if (immediate) {
      send();
    } else {
      this.pushTimer = setTimeout(send, PUSH_DEBOUNCE_MS);
    }
  }

  private isBrowserTabContents(webContentsId: number): boolean {
    for (const [tabId, view] of this.registry.views) {
      if (view.webContents.id === webContentsId) {
        return this.registry.states.get(tabId)?.kind === 'browser';
      }
    }
    return false;
  }

  private isHistoryView(sender: WebContents): boolean {
    return this.historyTabIdOf(sender) !== null;
  }

  /**
   * The History tab whose page sent a message.
   * @param sender The sending `webContents`.
   * @returns The tab's id, or `null` if the sender isn't a History tab's page.
   */
  private historyTabIdOf(sender: WebContents): string | null {
    for (const [tabId, view] of this.registry.views) {
      if (view.webContents === sender) {
        return this.registry.states.get(tabId)?.kind === 'history' ? tabId : null;
      }
    }
    return null;
  }
}
