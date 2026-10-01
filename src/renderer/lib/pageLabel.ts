// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-09-30

import type { BookmarkState } from '@shared/tab-state';
import { domainOfUrl } from '@shared/url';

/**
 * The short name a page goes by in the chrome — the same text on its tab
 * and in the address bar's idle bubble: the saved name if the page is
 * bookmarked, else its site's domain (`slack.com`). `null` for pages with
 * neither (the blank default page, the app's own pages), whose callers fall
 * back to the page title or show nothing.
 * @param url The page's current URL.
 * @param bookmarks Every saved bookmark.
 */
export function pageLabel(url: string, bookmarks: readonly BookmarkState[]): string | null {
  const savedName = bookmarks.find((bookmark) => bookmark.url === url)?.title.trim();
  return savedName || domainOfUrl(url);
}
