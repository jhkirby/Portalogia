// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-11-21

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

/** Shape validated on every read — the file is untrusted input, like any other file on disk. */
const pickedFileSchema = z.array(z.string().min(1).max(4096));

/** The most paths kept: past this the oldest are dropped, so the file can't grow without bound. */
const MAX_PICKED = 5000;

/**
 * The pictures the user chose with the formatted editor's image dialog, so a
 * note may show them even when they're outside its vault. A note is untrusted
 * text and may only read pictures in its own folders (`readImageDataUrl`);
 * a file the user picked themselves is the one exception, and only that
 * exact file — not its folder, and not a path a note merely names.
 *
 * Kept as JSON in the app's user-data directory so a picture added today
 * still shows when the note is opened next week. Loaded once and kept in
 * memory; every addition re-writes the file (it changes only on a pick).
 */
export class PickedImageStore {
  private readonly paths: string[];

  /** @param filePath Where to read/write the list, or `null` to keep it in memory only (tests). */
  public constructor(private readonly filePath: string | null) {
    this.paths = this.load();
  }

  /** The form a path is compared in: absolute, and on Windows case-insensitive. */
  private static key(path: string): string {
    const absolute = resolve(path);
    return process.platform === 'win32' ? absolute.toLowerCase() : absolute;
  }

  private load(): string[] {
    if (this.filePath === null || !existsSync(this.filePath)) {
      return [];
    }
    try {
      const parsed = pickedFileSchema.safeParse(JSON.parse(readFileSync(this.filePath, 'utf8')));
      return parsed.success ? parsed.data.slice(-MAX_PICKED) : [];
    } catch {
      return [];
    }
  }

  /**
   * Remembers a picture the user picked.
   * @param path Its absolute path.
   */
  public add(path: string): void {
    const key = PickedImageStore.key(path);
    const existing = this.paths.indexOf(key);
    if (existing !== -1) {
      this.paths.splice(existing, 1);
    }
    this.paths.push(key);
    if (this.paths.length > MAX_PICKED) {
      this.paths.splice(0, this.paths.length - MAX_PICKED);
    }
    if (this.filePath !== null) {
      try {
        writeFileSync(this.filePath, JSON.stringify(this.paths), 'utf8');
      } catch {
        // Not being able to remember it only means the picture won't show next time; the pick itself still works.
      }
    }
  }

  /**
   * Whether the user picked exactly this file.
   * @param path An absolute path.
   */
  public has(path: string): boolean {
    return this.paths.includes(PickedImageStore.key(path));
  }
}
