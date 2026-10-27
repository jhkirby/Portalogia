// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-27

import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import type { BookmarkUpdateResult } from '@shared/ipc-contract';
import type { BookmarkState } from '@shared/tab-state';

/** Shape validated on every read — a bookmarks file is untrusted input, like any other file on disk. */
const bookmarkFileSchema = z.array(
  z.object({
    id: z.string().min(1),
    title: z.string(),
    url: z.string().min(1),
    // Absent in files written before PDF bookmarks existed: those are all pages.
    kind: z.enum(['page', 'pdf', 'markdown']).default('page'),
    path: z.string().min(1).nullable().default(null),
  }),
);

/** Windows paths are case-insensitive, so two spellings of one file must match. */
function samePath(a: string, b: string): boolean {
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/** How two names are compared for being the same one: as the PDF sections' are, ignoring case and outer spaces. */
function nameKey(title: string): string {
  return title.trim().toLowerCase();
}

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
    this.bookmarks = [
      ...this.bookmarks,
      { id: randomUUID(), title: this.uniqueTitle(title.trim() || url), url, kind: 'page', path: null },
    ];
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

  /** @returns Every saved PDF bookmark, in the order they were added. */
  public listPdfs(): readonly BookmarkState[] {
    return this.bookmarks.filter((bookmark) => bookmark.kind === 'pdf');
  }

  /** @returns Every saved Markdown note bookmark, in the order they were added. */
  public listMarkdown(): readonly BookmarkState[] {
    return this.bookmarks.filter((bookmark) => bookmark.kind === 'markdown');
  }

  /** @returns The bookmark for the Markdown note at this path, if there is one. */
  public findMarkdown(path: string): BookmarkState | undefined {
    return this.bookmarks.find(
      (bookmark) => bookmark.kind === 'markdown' && bookmark.path && samePath(bookmark.path, path),
    );
  }

  /**
   * Bookmarks a Markdown note by its path under a name. A no-op if that file is already bookmarked.
   * @param title The name the bookmark (and the note's tab) goes by.
   * @param path The file's path on disk.
   * @returns The full bookmark list after the change.
   */
  public addMarkdown(title: string, path: string): readonly BookmarkState[] {
    if (this.findMarkdown(path)) {
      return this.bookmarks;
    }
    this.bookmarks = [
      ...this.bookmarks,
      {
        id: randomUUID(),
        title: this.uniqueTitle(title.trim() || basename(path)),
        url: pathToFileURL(path).href,
        kind: 'markdown',
        path,
      },
    ];
    this.persist();
    return this.bookmarks;
  }

  /**
   * Bookmarks a Markdown note under its file name, or removes the bookmark if it's already saved.
   * @param path The file's path on disk.
   * @returns The full bookmark list after the change.
   */
  public toggleMarkdown(path: string): readonly BookmarkState[] {
    const existing = this.findMarkdown(path);
    return existing ? this.remove(existing.id) : this.addMarkdown(basename(path), path);
  }

  /**
   * Drops the Markdown bookmarks at these paths — the files are gone or moved.
   * @param paths The paths found missing.
   * @returns Whether any bookmark was removed.
   */
  public removeMarkdownPaths(paths: readonly string[]): boolean {
    const before = this.bookmarks.length;
    this.bookmarks = this.bookmarks.filter(
      (bookmark) =>
        !(bookmark.kind === 'markdown' && bookmark.path && paths.some((path) => samePath(path, bookmark.path as string))),
    );
    if (this.bookmarks.length === before) {
      return false;
    }
    this.persist();
    return true;
  }

  /**
   * Follows a Markdown bookmark across an in-app rename, the way `renamePdf`
   * does for a PDF: the bookmark's name follows the file's too, unless the
   * user customized it.
   * @param oldPath The path before the rename.
   * @param newPath The path after it.
   */
  public renameMarkdown(oldPath: string, newPath: string): void {
    const existing = this.findMarkdown(oldPath);
    if (!existing) {
      return;
    }
    const followsFileName = existing.title === basename(oldPath);
    this.bookmarks = this.bookmarks.map((bookmark) =>
      bookmark.id === existing.id
        ? {
            ...bookmark,
            title: followsFileName ? this.uniqueTitle(basename(newPath), existing.id) : bookmark.title,
            path: newPath,
            url: pathToFileURL(newPath).href,
          }
        : bookmark,
    );
    this.persist();
  }

  /** @returns Whether a PDF at this path is already bookmarked. */
  public isPdfBookmarked(path: string): boolean {
    return this.bookmarks.some((bookmark) => bookmark.kind === 'pdf' && bookmark.path && samePath(bookmark.path, path));
  }

  /** @returns The bookmark for the PDF at this path, if there is one. */
  public findPdf(path: string): BookmarkState | undefined {
    return this.bookmarks.find(
      (bookmark) => bookmark.kind === 'pdf' && bookmark.path && samePath(bookmark.path, path),
    );
  }

  /**
   * Bookmarks a PDF by its path under a name. A no-op if that file is already bookmarked.
   * @param title The name the bookmark (and the PDF's tab) goes by.
   * @param path The file's path on disk.
   * @returns The full bookmark list after the change.
   */
  public addPdf(title: string, path: string): readonly BookmarkState[] {
    if (this.findPdf(path)) {
      return this.bookmarks;
    }
    this.bookmarks = [
      ...this.bookmarks,
      {
        id: randomUUID(),
        title: this.uniqueTitle(title.trim() || basename(path)),
        url: pathToFileURL(path).href,
        kind: 'pdf',
        path,
      },
    ];
    this.persist();
    return this.bookmarks;
  }

  /**
   * Bookmarks a PDF under its file name, or removes the bookmark if it's already saved.
   * @param path The file's path on disk.
   * @returns The full bookmark list after the change.
   */
  public togglePdf(path: string): readonly BookmarkState[] {
    const existing = this.findPdf(path);
    return existing ? this.remove(existing.id) : this.addPdf(basename(path), path);
  }

  /**
   * Drops the PDF bookmarks at these paths — the files are gone or moved, so
   * the bookmark no longer points at anything.
   * @param paths The paths found missing.
   * @returns Whether any bookmark was removed.
   */
  public removePdfPaths(paths: readonly string[]): boolean {
    const before = this.bookmarks.length;
    this.bookmarks = this.bookmarks.filter(
      (bookmark) =>
        !(bookmark.kind === 'pdf' && bookmark.path && paths.some((path) => samePath(path, bookmark.path as string))),
    );
    if (this.bookmarks.length === before) {
      return false;
    }
    this.persist();
    return true;
  }

  /**
   * Follows a PDF bookmark across an in-app rename, so renaming a file from
   * the toolbar doesn't make its own bookmark look like a moved file. The
   * bookmark's name follows too — unless it was customized, in which case the
   * name the user chose is theirs to keep.
   * @param oldPath The path before the rename.
   * @param newPath The path after it.
   */
  public renamePdf(oldPath: string, newPath: string): void {
    const existing = this.findPdf(oldPath);
    if (!existing) {
      return;
    }
    const followsFileName = existing.title === basename(oldPath);
    this.bookmarks = this.bookmarks.map((bookmark) =>
      bookmark.id === existing.id
        ? {
            ...bookmark,
            title: followsFileName ? this.uniqueTitle(basename(newPath), existing.id) : bookmark.title,
            path: newPath,
            url: pathToFileURL(newPath).href,
          }
        : bookmark,
    );
    this.persist();
  }

  /**
   * Renames a bookmark and points it somewhere else — the Bookmarks tab's
   * edit mode. No two bookmarks may share a name (ignoring case and outer
   * spaces, as the PDF sections' names) or a reference (a page's URL, a file's
   * path), so either clash refuses the whole edit — unless the field is left
   * as it was: a clash saved before names had to differ is the other field's
   * edit's to keep, not to be refused over. The reference's own form
   * (a URL a tab may load, a file of the bookmark's kind) is the caller's to
   * check first.
   * @param id The bookmark.
   * @param title Its new name.
   * @param reference Its new URL (a page) or path on disk (a PDF or note).
   * @returns Whether it was kept, or the field refused and why.
   */
  public update(id: string, title: string, reference: string): BookmarkUpdateResult {
    const existing = this.bookmarks.find((bookmark) => bookmark.id === id);
    if (!existing) {
      return { ok: false, field: 'title', message: 'That bookmark no longer exists' };
    }
    const name = title.trim();
    if (!name) {
      return { ok: false, field: 'title', message: 'A bookmark needs a name' };
    }
    const others = this.bookmarks.filter((bookmark) => bookmark.id !== id);
    const nameChanged = nameKey(name) !== nameKey(existing.title);
    if (nameChanged && others.some((bookmark) => nameKey(bookmark.title) === nameKey(name))) {
      return { ok: false, field: 'title', message: 'Another bookmark already has this name' };
    }
    const isPage = existing.kind === 'page';
    const referenceChanged = isPage ? reference !== existing.url : !samePath(reference, existing.path ?? '');
    const clashes = referenceChanged && others.some((bookmark) =>
      isPage
        ? bookmark.kind === 'page' && bookmark.url === reference
        : bookmark.path !== null && samePath(bookmark.path, reference),
    );
    if (clashes) {
      return { ok: false, field: 'reference', message: `Another bookmark already points at this ${isPage ? 'URL' : 'path'}` };
    }
    this.bookmarks = this.bookmarks.map((bookmark) =>
      bookmark.id !== id
        ? bookmark
        : isPage
          ? { ...bookmark, title: name, url: reference }
          : { ...bookmark, title: name, path: reference, url: pathToFileURL(reference).href },
    );
    this.persist();
    return { ok: true };
  }

  /** @returns The bookmark with this id, if there is one. */
  public find(id: string): BookmarkState | undefined {
    return this.bookmarks.find((bookmark) => bookmark.id === id);
  }

  /**
   * A name no other bookmark has: `title` itself, or else it numbered — "Name (2)", "Name (3)", … — the way an
   * added PDF section's "New section" is, so a bookmark saved under a taken name never repeats one.
   * @param title The name wanted.
   * @param exceptId A bookmark whose own name doesn't count (one being renamed).
   */
  private uniqueTitle(title: string, exceptId?: string): string {
    const taken = new Set(
      this.bookmarks.filter((bookmark) => bookmark.id !== exceptId).map((bookmark) => nameKey(bookmark.title)),
    );
    let unique = title;
    for (let n = 2; taken.has(nameKey(unique)); n += 1) {
      unique = `${title} (${n})`;
    }
    return unique;
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
