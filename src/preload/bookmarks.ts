// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-27

import { contextBridge, ipcRenderer } from 'electron';
import type { BookmarkUpdateResult, PortalogiaBookmarksApi } from '@shared/ipc-contract';
import type { BookmarkState } from '@shared/tab-state';

// Channel names inlined as literals — see `terminal.ts` for why a sandboxed
// preload can't share the `IpcChannel` runtime object. `BookmarksController`
// and `TabManager` (main) send and listen on the same strings.
const BookmarksPageList = 'bookmarks-page:list';
const BookmarksPageQuery = 'bookmarks-page:query';
const BookmarksPageMode = 'bookmarks-page:mode';
const BookmarksPageUpdate = 'bookmarks-page:update';
const BookmarksPageDelete = 'bookmarks-page:delete';
const BookmarksPageOpen = 'bookmarks-page:open';
const BookmarksPageCopy = 'bookmarks-page:copy';

// The page has no zoom: stopping Ctrl+wheel here keeps Chromium's own pinch/ctrl-wheel zoom from acting on it.
window.addEventListener(
  'wheel',
  (event) => {
    if (event.ctrlKey) {
      event.preventDefault();
    }
  },
  { passive: false, capture: true },
);

/**
 * A value main pushes, kept so a listener subscribing after it arrived is
 * still handed it at once (the page's effects run after the first push can).
 * @param channel The channel main sends it on.
 */
function latestFrom<T>(channel: string): (listener: (value: T) => void) => () => void {
  let latest: { readonly value: T } | null = null;
  const listeners = new Set<(value: T) => void>();
  ipcRenderer.on(channel, (_event, value: T) => {
    latest = { value };
    listeners.forEach((listener) => listener(value));
  });
  return (listener) => {
    listeners.add(listener);
    if (latest !== null) {
      listener(latest.value);
    }
    return () => {
      listeners.delete(listener);
    };
  };
}

const api: PortalogiaBookmarksApi = {
  onBookmarks: latestFrom<readonly BookmarkState[]>(BookmarksPageList),
  onQuery: latestFrom<string>(BookmarksPageQuery),
  onMode: latestFrom<'view' | 'edit'>(BookmarksPageMode),
  update: (id, title, reference) =>
    ipcRenderer.invoke(BookmarksPageUpdate, { id, title, reference }) as Promise<BookmarkUpdateResult>,
  remove: (id) => {
    ipcRenderer.send(BookmarksPageDelete, { id });
  },
  open: (id) => {
    ipcRenderer.send(BookmarksPageOpen, { id });
  },
  copy: (id) => {
    ipcRenderer.send(BookmarksPageCopy, { id });
  },
};

contextBridge.exposeInMainWorld('portalogiaBookmarks', api satisfies PortalogiaBookmarksApi);
