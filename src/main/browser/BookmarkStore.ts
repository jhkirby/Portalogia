// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-09-12

import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
import type { BookmarkState } from '@shared/tab-state';

/** Shape validated on every read — a bookmarks file is untrusted input, like any other file on disk. */
const bookmarkFileSchema = z.array(
  z.object({
    id: z.string().min(1),
    title: z.string(),
    url: z.string().min(1),
  }),
);

/**
 * Persists bookmarks as JSON in the app's user-data directory. Loaded once
 * at construction and kept in memory thereafter; every mutation re-writes
 * the whole file synchronously — the list is small and changes rarely
 * enough that this is simpler than incremental or async persistence, and
 * keeps `TabManager` (the only caller) from having to await bookmark
 * mutations the same way it does IPC results.
 */
export class BookmarkStore {
  private bookmarks: BookmarkState[];

  /** @param filePath Where to read/write the bookmarks JSON file. */
  public constructor(private readonly filePath: string) {
    this.bookmarks = this.load();
  }

  /** @returns Every saved bookmark, in the order they were added. */
  public list(): readonly BookmarkState[] {
    return this.bookmarks;
  }

  /** @returns Whether some bookmark already points at exactly this URL. */
  public isBookmarked(url: string): boolean {
    return this.bookmarks.some((bookmark) => bookmark.url === url);
  }

  /**
   * Adds a bookmark, unless the URL is already saved.
   * @param title Page title to display; falls back to the URL if blank.
   * @param url The page's URL.
   * @returns The full bookmark list after the change.
   */
  public add(title: string, url: string): readonly BookmarkState[] {
    if (this.isBookmarked(url)) {
      return this.bookmarks;
    }
    this.bookmarks = [...this.bookmarks, { id: randomUUID(), title: title.trim() || url, url }];
    this.persist();
    return this.bookmarks;
  }

  /**
   * Removes a bookmark by id. A no-op if it doesn't exist.
   * @param id The bookmark to remove.
   * @returns The full bookmark list after the change.
   */
  public remove(id: string): readonly BookmarkState[] {
    this.bookmarks = this.bookmarks.filter((bookmark) => bookmark.id !== id);
    this.persist();
    return this.bookmarks;
  }

  /**
   * Adds a bookmark for this URL, or removes the existing one if it's
   * already saved — the single action a keyboard shortcut or toolbar
   * button toggling "is this page bookmarked?" needs.
   * @param title Page title to display if this adds a bookmark.
   * @param url The page's URL.
   * @returns The full bookmark list after the change.
   */
  public toggle(title: string, url: string): readonly BookmarkState[] {
    const existing = this.bookmarks.find((bookmark) => bookmark.url === url);
    return existing ? this.remove(existing.id) : this.add(title, url);
  }

  /** @returns The bookmarks loaded from disk, or an empty list if the file is missing or corrupt. */
  private load(): BookmarkState[] {
    if (!existsSync(this.filePath)) {
      return [];
    }
    try {
      const raw: unknown = JSON.parse(readFileSync(this.filePath, 'utf-8'));
      return bookmarkFileSchema.parse(raw);
    } catch {
      // Corrupt, unreadable, or schema-mismatched file — start fresh rather
      // than crash the app over a broken bookmarks file.
      return [];
    }
  }

  /** Writes the current in-memory list to disk. */
  private persist(): void {
    writeFileSync(this.filePath, JSON.stringify(this.bookmarks, null, 2), 'utf-8');
  }
}
