// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-05

import { randomUUID } from 'node:crypto';
import { ipcMain, type Session, type WebContents } from 'electron';
import { IpcChannel, type HistoryClearRange } from '@shared/ipc-contract';
import { historyDeleteRequestSchema } from '@shared/ipc-schemas';
import type { HistoryStore } from './HistoryStore';
import type { SharedTabRegistry } from './SharedTabRegistry';

/** Only these are pages a person reached; the app's own `northstar://` and `file:` pages aren't history. */
const RECORDED_URLS = ['http://*/*', 'https://*/*'];

/** Longest route kept: a URL can be arbitrarily long, and the table only has so much room. */
const MAX_URL_LENGTH = 2048;

/** How long to let a burst of visits settle before re-sending the list to open History tabs. */
const PUSH_DEBOUNCE_MS = 400;

const MS_PER_HOUR = 60 * 60 * 1000;

/**
 * Owns the browsing history's cross-process wiring — one instance shared by
 * every window's `TabManager`, since a History tab (like any tab) can move
 * between windows. It does three things:
 *
 * - **Records** every main-frame request a *browser* tab makes, with the
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
   */
  public constructor(
    private readonly registry: SharedTabRegistry,
    private readonly store: HistoryStore,
  ) {
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
   * `onBeforeRedirect` on it.
   * @param ses The session browser tabs load their pages in.
   */
  public attachTo(ses: Session): void {
    const filter = { urls: RECORDED_URLS };
    ses.webRequest.onCompleted(filter, (details) => {
      this.record(details.resourceType, details.webContentsId, details.url, details.statusCode, details.timestamp);
    });
    ses.webRequest.onBeforeRedirect(filter, (details) => {
      this.record(details.resourceType, details.webContentsId, details.url, details.statusCode, details.timestamp);
    });
  }

  /**
   * Deletes the visits within a range. Called for the toolbar's "Clear
   * History", whose request `registerTabIpc` has already validated and
   * confirmed came from the chrome rather than a page.
   * @param range The last N of a unit, or everything.
   */
  public clear(range: HistoryClearRange): void {
    if (this.store.removeSince(HistoryController.cutoffFor(range, Date.now())) > 0) {
      this.pushToAll(true);
    }
  }

  /** Sends the current list to one History tab — call once its page has loaded, since a fresh page has never been sent anything. */
  public pushTo(tabId: string): void {
    const view = this.registry.views.get(tabId);
    if (view && !view.webContents.isDestroyed() && this.registry.states.get(tabId)?.kind === 'history') {
      view.webContents.send(IpcChannel.HistoryEntries, this.store.listNewestFirst());
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
    switch (range.unit) {
      case 'all':
        return null;
      case 'hours':
        return now - range.amount * MS_PER_HOUR;
      case 'days':
        return now - range.amount * 24 * MS_PER_HOUR;
      case 'weeks':
        return now - range.amount * 7 * 24 * MS_PER_HOUR;
      case 'months': {
        const cutoff = new Date(now);
        cutoff.setMonth(cutoff.getMonth() - range.amount);
        return cutoff.getTime();
      }
    }
  }

  /** `webContentsId` is absent for a request no page made (e.g. one the main process issued itself), which is never history. */
  private record(
    resourceType: string,
    webContentsId: number | undefined,
    url: string,
    status: number,
    timestamp: number,
  ): void {
    if (resourceType !== 'mainFrame' || webContentsId === undefined || !this.isBrowserTabContents(webContentsId)) {
      return;
    }
    this.store.add({
      id: randomUUID(),
      timestamp: Math.round(timestamp),
      url: url.slice(0, MAX_URL_LENGTH),
      status,
    });
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
    for (const [tabId, view] of this.registry.views) {
      if (view.webContents === sender) {
        return this.registry.states.get(tabId)?.kind === 'history';
      }
    }
    return false;
  }
}
