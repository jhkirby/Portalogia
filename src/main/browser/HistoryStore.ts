// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-05

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
import { HISTORY_MAX_ENTRIES } from '@shared/constants';
import type { HistoryEntry } from '@shared/ipc-contract';

/** Shape validated on every read — a history file is untrusted input, like any other file on disk. */
const historyFileSchema = z.array(
  z.object({
    id: z.string().min(1).max(64),
    timestamp: z.number().finite(),
    // Absent in files written before PDF accesses were recorded: those are all pages.
    type: z.enum(['url', 'pdf']).default('url'),
    url: z.string().min(1).max(4096),
    status: z.number().int().min(0).max(999),
  }),
);

/**
 * Persists the browsing history as JSON in the app's user-data directory.
 * Entries are kept oldest-first (so adding is an append) and served
 * newest-first. Loaded once at construction and kept in memory; writes are
 * debounced like `CommentStore`'s, since a page load can add several visits
 * (every redirect hop is one) in quick succession. The list is capped at
 * `HISTORY_MAX_ENTRIES`, dropping the oldest.
 */
export class HistoryStore {
  private entries: HistoryEntry[];
  private timer: ReturnType<typeof setTimeout> | null = null;

  private static readonly SAVE_DEBOUNCE_MS = 800;

  /** @param filePath Where to read/write the history JSON file. */
  public constructor(private readonly filePath: string) {
    this.entries = this.load();
  }

  /** @returns Every recorded visit, newest first. */
  public listNewestFirst(): readonly HistoryEntry[] {
    return [...this.entries].reverse();
  }

  /** @returns The visit with this id, if there is one. */
  public find(id: string): HistoryEntry | undefined {
    return this.entries.find((entry) => entry.id === id);
  }

  /**
   * The most recent distinct routes of one type that pass a test, newest
   * first — each route once, at its latest visit. Walks the list from the
   * newest end without copying it, since a search bar calls this per keystroke.
   * @param type Pages or PDFs.
   * @param accepts Whether a visit counts.
   * @param max How many routes to return at most.
   */
  public distinctRecent(
    type: HistoryEntry['type'],
    accepts: (entry: HistoryEntry) => boolean,
    max: number,
  ): HistoryEntry[] {
    const seen = new Set<string>();
    const found: HistoryEntry[] = [];
    for (let index = this.entries.length - 1; index >= 0 && found.length < max; index -= 1) {
      const entry = this.entries[index];
      if (!entry || entry.type !== type || !accepts(entry)) {
        continue;
      }
      // Windows paths are case-insensitive, so two spellings of one file are one route.
      const key = type === 'pdf' ? entry.url.toLowerCase() : entry.url;
      if (!seen.has(key)) {
        seen.add(key);
        found.push(entry);
      }
    }
    return found;
  }

  /** @returns Whether a PDF at this path has ever been opened (the history has a record of it). */
  public hasPdfPath(path: string): boolean {
    const wanted = path.toLowerCase();
    return this.entries.some((entry) => entry.type === 'pdf' && entry.url.toLowerCase() === wanted);
  }

  /** Records one visit, dropping the oldest if the history is full. */
  public add(entry: HistoryEntry): void {
    this.entries.push(entry);
    if (this.entries.length > HISTORY_MAX_ENTRIES) {
      this.entries.splice(0, this.entries.length - HISTORY_MAX_ENTRIES);
    }
    this.scheduleSave();
  }

  /**
   * Deletes one visit by id.
   * @returns Whether it existed.
   */
  public remove(id: string): boolean {
    const before = this.entries.length;
    this.entries = this.entries.filter((entry) => entry.id !== id);
    if (this.entries.length === before) {
      return false;
    }
    this.scheduleSave();
    return true;
  }

  /**
   * Deletes every visit made at or after a moment — "the last N hours" is
   * everything since N hours ago.
   * @param since Milliseconds since the epoch; `null` deletes everything.
   * @returns How many visits were deleted.
   */
  public removeSince(since: number | null): number {
    const before = this.entries.length;
    this.entries = since === null ? [] : this.entries.filter((entry) => entry.timestamp < since);
    const removed = before - this.entries.length;
    if (removed > 0) {
      this.scheduleSave();
    }
    return removed;
  }

  /** Writes any pending change to disk now — call on quit so the last visits aren't lost. */
  public flush(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.persist();
    }
  }

  private scheduleSave(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => this.persist(), HistoryStore.SAVE_DEBOUNCE_MS);
  }

  /** @returns The visits loaded from disk, or an empty list if the file is missing or corrupt. */
  private load(): HistoryEntry[] {
    if (!existsSync(this.filePath)) {
      return [];
    }
    try {
      return historyFileSchema.parse(JSON.parse(readFileSync(this.filePath, 'utf-8')));
    } catch {
      return [];
    }
  }

  private persist(): void {
    this.timer = null;
    writeFileSync(this.filePath, JSON.stringify(this.entries), 'utf-8');
  }
}
