// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-29

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
import { notifyAnnotationsChanged } from './annotationChanges';

const rgbFileSchema = z.object({
  r: z.number().int().min(0).max(255),
  g: z.number().int().min(0).max(255),
  b: z.number().int().min(0).max(255),
});

/**
 * Where a dropped comment's pin re-anchors on a freshly loaded document —
 * the text immediately before/after the point it was dropped at, the same
 * `TextQuoteSelector`-style idea `HighlightStore`'s own quote uses, just
 * without an "exact" middle (a comment marks a *point*, not a span). `dx`/`dy`
 * are the pixel offset from that anchor's own position to where the pin
 * should actually be drawn — the exact spot the user clicked, which rarely
 * lands precisely on a character boundary.
 */
const commentQuoteFileSchema = z.object({
  prefix: z.string(),
  suffix: z.string(),
});

const commentFileSchema = z.object({
  id: z.string().min(1),
  url: z.string().min(1),
  quote: commentQuoteFileSchema,
  dx: z.number(),
  dy: z.number(),
  text: z.string().min(1),
  colorRgb: rgbFileSchema,
  createdAt: z.number(),
});

const commentsFileSchema = z.array(commentFileSchema);

export type CommentQuote = z.infer<typeof commentQuoteFileSchema>;
export type StoredComment = z.infer<typeof commentFileSchema>;

/**
 * Persists dropped-comment pins as JSON in the app's user-data directory,
 * keyed by exact URL string — same matching rule (and limitation) as
 * `BookmarkStore`/`HighlightStore`. Loaded once at construction and kept in
 * memory thereafter; writes are debounced the same way `HighlightStore`'s
 * are, since undo-free but still bursty edit/delete activity should collapse
 * into one write rather than one per keystroke-commit.
 */
export class CommentStore {
  private comments: StoredComment[];
  private timer: ReturnType<typeof setTimeout> | null = null;

  private static readonly SAVE_DEBOUNCE_MS = 400;

  /** @param filePath Where to read/write the comments JSON file. */
  public constructor(private readonly filePath: string) {
    this.comments = this.load();
  }

  /** @returns Every saved comment for a given URL, in the order they were added. */
  public listFor(url: string): readonly StoredComment[] {
    return this.comments.filter((comment) => comment.url === url);
  }

  /** Adds a comment (a no-op if its id is already present). */
  public add(comment: StoredComment): void {
    if (this.comments.some((existing) => existing.id === comment.id)) {
      return;
    }
    this.comments = [...this.comments, comment];
    this.scheduleSave();
  }

  /** Updates a comment's text by id. A no-op if it doesn't exist. */
  public update(id: string, text: string): void {
    this.comments = this.comments.map((comment) => (comment.id === id ? { ...comment, text } : comment));
    this.scheduleSave();
  }

  /** Removes a comment by id. A no-op if it doesn't exist. */
  public remove(id: string): void {
    this.comments = this.comments.filter((comment) => comment.id !== id);
    this.scheduleSave();
  }

  private scheduleSave(): void {
    // Every change comes through here: whoever shows whether there are marks hears of it.
    notifyAnnotationsChanged();
    if (this.timer !== null) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => this.persist(), CommentStore.SAVE_DEBOUNCE_MS);
  }

  /** @returns The comments loaded from disk, or an empty list if the file is missing or corrupt. */
  private load(): StoredComment[] {
    if (!existsSync(this.filePath)) {
      return [];
    }
    try {
      const raw: unknown = JSON.parse(readFileSync(this.filePath, 'utf-8'));
      return commentsFileSchema.parse(raw);
    } catch {
      return [];
    }
  }

  /** Writes the current in-memory list to disk. */
  private persist(): void {
    this.timer = null;
    writeFileSync(this.filePath, JSON.stringify(this.comments, null, 2), 'utf-8');
  }
}
