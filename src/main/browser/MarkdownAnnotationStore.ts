// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-29

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
import { markdownAnnotationsSchema, type MarkdownAnnotations } from '@shared/ipc-schemas';
import { notifyAnnotationsChanged } from './annotationChanges';

const storeFileSchema = z.record(z.string(), markdownAnnotationsSchema);

/** What a note with nothing drawn on it holds — also what an unknown note returns. */
export const EMPTY_MARKDOWN_ANNOTATIONS: MarkdownAnnotations = { strokes: [], comments: [], highlights: [] };

/** Windows paths are case-insensitive, so one note's marks are found under any spelling of its path. */
function keyOf(path: string): string {
  return process.platform === 'win32' ? path.toLowerCase() : path;
}

/**
 * Persists the pen strokes, comments and highlights drawn on Markdown notes,
 * as JSON in the app's user-data directory. Marks live only here: the note
 * itself is never written to for them, so another editor shows it unmarked.
 *
 * Unlike `PdfAnnotationStore` (keyed by a hash of the file's bytes, which
 * never change), a note is *edited*, so its content can't be its key — marks
 * are keyed by its path and follow it through a rename made here
 * (`move`). A highlight records the words it covered, so it can find them
 * again when the note's text has shifted around it.
 *
 * Like the other stores, writes are debounced; call `flush` on quit so the
 * last edit isn't lost. A process-wide singleton, initialised once from
 * `main/index.ts`.
 */
class MarkdownAnnotationStore {
  private filePath: string | null = null;
  private entries: Record<string, MarkdownAnnotations> = {};
  private timer: ReturnType<typeof setTimeout> | null = null;

  private static readonly SAVE_DEBOUNCE_MS = 400;

  /** @param filePath Where to read/write the JSON file. Must be called before `get`/`set`. */
  public init(filePath: string): void {
    this.filePath = filePath;
    this.entries = this.load();
  }

  /** @returns The marks saved for a note, or none. */
  public get(notePath: string): MarkdownAnnotations {
    return this.entries[keyOf(notePath)] ?? EMPTY_MARKDOWN_ANNOTATIONS;
  }

  /** Replaces a note's marks. An all-empty set removes the entry, so reverting leaves nothing behind. */
  public set(notePath: string, annotations: MarkdownAnnotations): void {
    if (this.filePath === null) {
      return;
    }
    const isEmpty =
      annotations.strokes.length === 0 && annotations.comments.length === 0 && annotations.highlights.length === 0;
    if (isEmpty) {
      delete this.entries[keyOf(notePath)];
    } else {
      this.entries[keyOf(notePath)] = annotations;
    }
    this.scheduleSave();
  }

  /** Carries a note's marks to its new path after a rename. */
  public move(oldPath: string, newPath: string): void {
    const existing = this.entries[keyOf(oldPath)];
    if (!existing || keyOf(oldPath) === keyOf(newPath)) {
      return;
    }
    delete this.entries[keyOf(oldPath)];
    this.entries[keyOf(newPath)] = existing;
    this.scheduleSave();
  }

  /** Writes any pending change to disk now. */
  public flush(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.filePath !== null) {
      writeFileSync(this.filePath, JSON.stringify(this.entries), 'utf-8');
    }
  }

  private scheduleSave(): void {
    // Every change comes through here: whoever shows whether there are marks hears of it.
    notifyAnnotationsChanged();
    if (this.timer !== null) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => this.flush(), MarkdownAnnotationStore.SAVE_DEBOUNCE_MS);
  }

  /** @returns The entries loaded from disk, or none if the file is missing or corrupt. */
  private load(): Record<string, MarkdownAnnotations> {
    if (this.filePath === null || !existsSync(this.filePath)) {
      return {};
    }
    try {
      return storeFileSchema.parse(JSON.parse(readFileSync(this.filePath, 'utf-8')));
    } catch {
      return {};
    }
  }
}

export const markdownAnnotationStore = new MarkdownAnnotationStore();
