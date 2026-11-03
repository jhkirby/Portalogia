// Project: Portalogia
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
 * One point on a freehand stroke, in page-document coordinates
 * (`event.pageX`/`pageY` at the moment it was drawn — relative to the top of
 * the document, not the viewport, so a stroke scrolls with the page the same
 * way a highlight does). Unlike a highlight's text-quote anchor
 * (`HighlightQuote`), there's no re-anchoring on restore: a freehand mark has
 * no text of its own to search for, so it's simply redrawn at the same
 * coordinates it was drawn at. Best-effort by construction, same spirit as a
 * highlight's own quote-based restore — a page whose layout has shifted
 * since the stroke was made can leave it looking misplaced, accepted rather
 * than solved.
 */
const penPointFileSchema = z.object({ x: z.number(), y: z.number() });

const penStrokeFileSchema = z.object({
  id: z.string().min(1),
  url: z.string().min(1),
  points: z.array(penPointFileSchema).min(2),
  colorRgb: rgbFileSchema,
  createdAt: z.number(),
});

const penStrokesFileSchema = z.array(penStrokeFileSchema);

export type PenPoint = z.infer<typeof penPointFileSchema>;
export type StoredPenStroke = z.infer<typeof penStrokeFileSchema>;

/**
 * Persists web-tab pen strokes as JSON in the app's user-data directory,
 * keyed by exact URL string — same matching rule (and the same limitation on
 * a page whose URL changes every load) `HighlightStore`/`BookmarkStore`
 * already have. Mirrors `HighlightStore` exactly otherwise, including the
 * debounced write.
 */
export class PenStore {
  private strokes: StoredPenStroke[];
  private timer: ReturnType<typeof setTimeout> | null = null;

  private static readonly SAVE_DEBOUNCE_MS = 400;

  /** @param filePath Where to read/write the pen-strokes JSON file. */
  public constructor(private readonly filePath: string) {
    this.strokes = this.load();
  }

  /** @returns Every saved stroke for a given URL, in the order they were drawn. */
  public listFor(url: string): readonly StoredPenStroke[] {
    return this.strokes.filter((stroke) => stroke.url === url);
  }

  /** Adds a stroke (a no-op if its id is already present). */
  public add(stroke: StoredPenStroke): void {
    if (this.strokes.some((existing) => existing.id === stroke.id)) {
      return;
    }
    this.strokes = [...this.strokes, stroke];
    this.scheduleSave();
  }

  /** Removes a stroke by id. A no-op if it doesn't exist. */
  public remove(id: string): void {
    this.strokes = this.strokes.filter((stroke) => stroke.id !== id);
    this.scheduleSave();
  }

  private scheduleSave(): void {
    // Every change comes through here: whoever shows whether there are marks hears of it.
    notifyAnnotationsChanged();
    if (this.timer !== null) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => this.persist(), PenStore.SAVE_DEBOUNCE_MS);
  }

  /** @returns The strokes loaded from disk, or an empty list if the file is missing or corrupt. */
  private load(): StoredPenStroke[] {
    if (!existsSync(this.filePath)) {
      return [];
    }
    try {
      const raw: unknown = JSON.parse(readFileSync(this.filePath, 'utf-8'));
      return penStrokesFileSchema.parse(raw);
    } catch {
      return [];
    }
  }

  /** Writes the current in-memory list to disk. */
  private persist(): void {
    this.timer = null;
    writeFileSync(this.filePath, JSON.stringify(this.strokes, null, 2), 'utf-8');
  }
}
