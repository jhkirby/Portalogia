// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-04

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
import { TEXT_BOX_FONT_SIZE_MAX, TEXT_BOX_FONT_SIZE_MIN } from '@shared/constants';

/**
 * Where a text box re-anchors on a freshly loaded document — the same
 * prefix/suffix point-anchor `CommentStore` uses, plus the pixel offset from
 * that anchor to the exact spot clicked.
 */
const textBoxQuoteFileSchema = z.object({
  prefix: z.string(),
  suffix: z.string(),
});

const textBoxFileSchema = z.object({
  id: z.string().min(1),
  url: z.string().min(1),
  quote: textBoxQuoteFileSchema,
  dx: z.number(),
  dy: z.number(),
  text: z.string().min(1).max(10000),
  size: z.number().int().min(TEXT_BOX_FONT_SIZE_MIN).max(TEXT_BOX_FONT_SIZE_MAX),
  align: z.enum(['left', 'center', 'right']).default('left'),
  createdAt: z.number(),
});

export type TextBoxQuote = z.infer<typeof textBoxQuoteFileSchema>;
export type StoredTextBox = z.infer<typeof textBoxFileSchema>;
export type TextBoxPatch = Partial<Pick<StoredTextBox, 'text' | 'size' | 'align' | 'quote' | 'dx' | 'dy'>>;

/**
 * Persists browser-tab text boxes as JSON in the app's user-data directory,
 * keyed by exact URL string — same matching rule (and limitation) as
 * `CommentStore`. Colour is never stored: a box is always painted in the
 * live accent. Loaded once at construction; writes are debounced so a burst
 * of edits becomes one write.
 */
export class TextBoxStore {
  private boxes: StoredTextBox[];
  private timer: ReturnType<typeof setTimeout> | null = null;

  private static readonly SAVE_DEBOUNCE_MS = 400;

  /** @param filePath Where to read/write the text boxes JSON file. */
  public constructor(private readonly filePath: string) {
    this.boxes = this.load();
  }

  /** @returns Every saved text box for a URL, in the order they were added. */
  public listFor(url: string): readonly StoredTextBox[] {
    return this.boxes.filter((box) => box.url === url);
  }

  /** Adds a text box (a no-op if its id is already present). */
  public add(box: StoredTextBox): void {
    if (this.boxes.some((existing) => existing.id === box.id)) {
      return;
    }
    this.boxes = [...this.boxes, box];
    this.scheduleSave();
  }

  /**
   * Changes a text box by id — its words, look, or (after a drag) anchor.
   * A no-op if it doesn't exist.
   * @param id The box to change.
   * @param patch The fields that changed.
   */
  public update(id: string, patch: TextBoxPatch): void {
    this.boxes = this.boxes.map((box) => (box.id === id ? { ...box, ...patch } : box));
    this.scheduleSave();
  }

  /** Removes a text box by id. A no-op if it doesn't exist. */
  public remove(id: string): void {
    this.boxes = this.boxes.filter((box) => box.id !== id);
    this.scheduleSave();
  }

  /** Writes any pending change to disk now — call on quit so the last edit isn't lost. */
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
    this.timer = setTimeout(() => this.persist(), TextBoxStore.SAVE_DEBOUNCE_MS);
  }

  /** @returns The boxes loaded from disk, or an empty list if the file is missing or corrupt. */
  private load(): StoredTextBox[] {
    if (!existsSync(this.filePath)) {
      return [];
    }
    try {
      return z.array(textBoxFileSchema).parse(JSON.parse(readFileSync(this.filePath, 'utf-8')));
    } catch {
      return [];
    }
  }

  private persist(): void {
    this.timer = null;
    writeFileSync(this.filePath, JSON.stringify(this.boxes, null, 2), 'utf-8');
  }
}
