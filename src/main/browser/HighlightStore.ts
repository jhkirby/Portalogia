// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-09-25

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { z } from 'zod';

const rgbFileSchema = z.object({
  r: z.number().int().min(0).max(255),
  g: z.number().int().min(0).max(255),
  b: z.number().int().min(0).max(255),
});

/**
 * A highlight's re-anchoring text — the exact text it wraps, plus a little
 * surrounding context on each side, so it can be found again in a freshly
 * loaded document (`HighlighterController.restoreFor`) without needing a
 * DOM-structure-dependent path that a page's own re-render would invalidate
 * anyway. Same idea as the W3C Web Annotation `TextQuoteSelector` — best
 * effort by construction: a highly dynamic page can still fail to match.
 */
const highlightQuoteFileSchema = z.object({
  exact: z.string().min(1),
  prefix: z.string(),
  suffix: z.string(),
});

const highlightFileSchema = z.object({
  id: z.string().min(1),
  url: z.string().min(1),
  quote: highlightQuoteFileSchema,
  colorRgb: rgbFileSchema,
  createdAt: z.number(),
});

const highlightsFileSchema = z.array(highlightFileSchema);

export type HighlightQuote = z.infer<typeof highlightQuoteFileSchema>;
export type StoredHighlight = z.infer<typeof highlightFileSchema>;

/**
 * Persists web-tab highlights as JSON in the app's user-data directory, keyed
 * by exact URL string — same matching rule (and the same limitation on a
 * page whose URL changes every load) `BookmarkStore` already has. Loaded
 * once at construction and kept in memory thereafter, like `BookmarkStore`;
 * unlike it, writes are debounced (mirroring `SessionStore`'s reasoning)
 * since a burst of highlight add/remove ops during undo/redo should collapse
 * into one write rather than one per op. Terminal-tab highlights are never
 * stored here — see `HighlighterController`'s own doc comment for why.
 */
export class HighlightStore {
  private highlights: StoredHighlight[];
  private timer: ReturnType<typeof setTimeout> | null = null;

  private static readonly SAVE_DEBOUNCE_MS = 400;

  /** @param filePath Where to read/write the highlights JSON file. */
  public constructor(private readonly filePath: string) {
    this.highlights = this.load();
  }

  /** @returns Every saved highlight for a given URL, in the order they were added. */
  public listFor(url: string): readonly StoredHighlight[] {
    return this.highlights.filter((highlight) => highlight.url === url);
  }

  /** Adds a highlight (a no-op if its id is already present). */
  public add(highlight: StoredHighlight): void {
    if (this.highlights.some((existing) => existing.id === highlight.id)) {
      return;
    }
    this.highlights = [...this.highlights, highlight];
    this.scheduleSave();
  }

  /** Removes a highlight by id. A no-op if it doesn't exist. */
  public remove(id: string): void {
    this.highlights = this.highlights.filter((highlight) => highlight.id !== id);
    this.scheduleSave();
  }

  private scheduleSave(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => this.persist(), HighlightStore.SAVE_DEBOUNCE_MS);
  }

  /** @returns The highlights loaded from disk, or an empty list if the file is missing or corrupt. */
  private load(): StoredHighlight[] {
    if (!existsSync(this.filePath)) {
      return [];
    }
    try {
      const raw: unknown = JSON.parse(readFileSync(this.filePath, 'utf-8'));
      return highlightsFileSchema.parse(raw);
    } catch {
      return [];
    }
  }

  /** Writes the current in-memory list to disk. */
  private persist(): void {
    this.timer = null;
    writeFileSync(this.filePath, JSON.stringify(this.highlights, null, 2), 'utf-8');
  }
}
