// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-02

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
import { pdfAnnotationsSchema, type PdfAnnotations } from '@shared/ipc-schemas';

const storeFileSchema = z.record(z.string(), pdfAnnotationsSchema);

/** What a PDF with nothing drawn on it holds — also what an unknown key returns. */
export const EMPTY_PDF_ANNOTATIONS: PdfAnnotations = { strokes: [], comments: [], highlights: [], crops: [] };

/**
 * Persists the pen strokes, comments and highlights drawn on PDFs, as JSON in
 * the app's user-data directory. Marks live only here: the PDF file itself is
 * never written to, so another viewer shows the document unmarked.
 *
 * Keyed by a hash of the file's contents (computed by `TabManager.openPdfFile`)
 * rather than its path, so marks follow the document across a rename or move
 * but never leak onto a different file. Like the other stores, writes are
 * debounced; call `flush` on quit so the last edit isn't lost.
 *
 * A process-wide singleton, initialised once from `main/index.ts` with the
 * file path, since both `TabManager` (load on open) and the IPC layer (save
 * from the page) need it and neither is constructed with it.
 */
class PdfAnnotationStore {
  private filePath: string | null = null;
  private entries: Record<string, PdfAnnotations> = {};
  private timer: ReturnType<typeof setTimeout> | null = null;

  private static readonly SAVE_DEBOUNCE_MS = 400;

  /** @param filePath Where to read/write the JSON file. Must be called before `get`/`set`. */
  public init(filePath: string): void {
    this.filePath = filePath;
    this.entries = this.load();
  }

  /** @returns The marks saved for a document, or none. */
  public get(key: string): PdfAnnotations {
    return this.entries[key] ?? EMPTY_PDF_ANNOTATIONS;
  }

  /** Replaces a document's marks. An all-empty set removes the entry, so reverting leaves nothing behind. */
  public set(key: string, annotations: PdfAnnotations): void {
    if (this.filePath === null) {
      return;
    }
    const isEmpty =
      annotations.strokes.length === 0 &&
      annotations.comments.length === 0 &&
      annotations.highlights.length === 0 &&
      annotations.crops.length === 0;
    if (isEmpty) {
      delete this.entries[key];
    } else {
      this.entries[key] = annotations;
    }
    if (this.timer !== null) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => this.flush(), PdfAnnotationStore.SAVE_DEBOUNCE_MS);
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

  /** @returns The entries loaded from disk, or none if the file is missing or corrupt. */
  private load(): Record<string, PdfAnnotations> {
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

export const pdfAnnotationStore = new PdfAnnotationStore();
