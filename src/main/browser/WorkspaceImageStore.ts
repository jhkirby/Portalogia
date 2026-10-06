// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-06

import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
import type { WorkspaceImageState } from '@shared/tab-state';

/** The kinds of tab an image can reopen. */
const imageTabSchema = z.object({
  kind: z.enum(['browser', 'terminal', 'pdf', 'markdown', 'history']),
  /** A page's address, or a PDF's or note's path; `''` for a terminal or History tab, and for a PDF or note tab with nothing open. */
  value: z.string().max(4096),
});

/** Shape validated on every read — an images file is untrusted input, like any other file on disk. */
const imagesFileSchema = z.array(
  z.object({
    id: z.string().min(1),
    name: z.string().min(1).max(200),
    color: z.string().max(32),
    icon: z.string().max(32),
    tabs: z.array(imageTabSchema).min(1).max(200),
    /** Which of `tabs` was in front when the image was saved. */
    activeIndex: z.number().int().min(0).default(0),
  }),
);

/** One tab of a saved workspace image: what it was, and the address or file it had. */
export type ImageTab = z.infer<typeof imageTabSchema>;

/** A saved workspace: its look and its tabs, in order. */
export interface WorkspaceImage {
  readonly id: string;
  readonly name: string;
  readonly color: string;
  readonly icon: string;
  readonly tabs: readonly ImageTab[];
  readonly activeIndex: number;
}

/** The most images kept: past this the oldest are dropped, so the file can't grow without bound. */
const MAX_IMAGES = 500;

/**
 * Persists saved workspace images as JSON in the app's user-data directory:
 * a workspace's name, color and icon plus its tabs in order, so the same set
 * of tabs can be opened again later as a workspace of its own. Loaded once at
 * construction and kept in memory; every change re-writes the whole file —
 * the list is small and changes rarely, the same trade `BookmarkStore` makes.
 */
export class WorkspaceImageStore {
  private images: WorkspaceImage[];

  /** @param filePath Where to read/write the images JSON file. */
  public constructor(private readonly filePath: string) {
    this.images = this.load();
  }

  /** @returns The images as the chrome lists them, in the order they were saved. */
  public listStates(): readonly WorkspaceImageState[] {
    return this.images.map(({ id, name, color, icon, tabs }) => ({ id, name, color, icon, tabCount: tabs.length }));
  }

  /** @returns The image with this id, if there is one. */
  public get(id: string): WorkspaceImage | undefined {
    return this.images.find((image) => image.id === id);
  }

  /** @returns Every image with its tabs, in the order they were saved. */
  public list(): readonly WorkspaceImage[] {
    return this.images;
  }

  /**
   * Saves a workspace as a new image. A workspace whose tabs change is a
   * different image from the one saved before, so saving never overwrites:
   * the same workspace can be saved as several images over time.
   * @param image What to save, without an id.
   */
  public save(image: Omit<WorkspaceImage, 'id'>): void {
    this.images = [...this.images, { ...image, id: randomUUID() }].slice(-MAX_IMAGES);
    this.persist();
  }

  /**
   * Renames an image. A no-op if it doesn't exist or the name is blank.
   * @param id The image.
   * @param name The new name (trimmed, and cut to the stored limit).
   */
  public rename(id: string, name: string): void {
    const trimmed = name.trim().slice(0, 200);
    if (trimmed === '' || !this.images.some((image) => image.id === id)) {
      return;
    }
    this.images = this.images.map((image) => (image.id === id ? { ...image, name: trimmed } : image));
    this.persist();
  }

  /** Deletes an image. A no-op if it doesn't exist. */
  public remove(id: string): void {
    this.images = this.images.filter((image) => image.id !== id);
    this.persist();
  }

  /** @returns The images loaded from disk, or an empty list if the file is missing or corrupt. */
  private load(): WorkspaceImage[] {
    if (!existsSync(this.filePath)) {
      return [];
    }
    try {
      return imagesFileSchema.parse(JSON.parse(readFileSync(this.filePath, 'utf-8')));
    } catch {
      // Corrupt, unreadable, or schema-mismatched: start fresh rather than crash the app over a broken file.
      return [];
    }
  }

  private persist(): void {
    writeFileSync(this.filePath, JSON.stringify(this.images, null, 2), 'utf-8');
  }
}
