// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-06

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { z } from 'zod';

/** Shape validated on every read — a settings file is untrusted input, like any other file on disk. */
const adBlockFileSchema = z.object({
  enabled: z.boolean().default(true),
  allowedSites: z.array(z.string().min(1).max(253)).max(5000).default([]),
});

/**
 * Persists the ad blocker's settings — the global switch and the sites the
 * user turned blocking off for — as JSON in the user-data directory. Loaded
 * once and kept in memory; writes are debounced like `HistoryStore`'s, since
 * a user can flip a switch several times in a row.
 */
export class AdBlockStore {
  private enabledFlag: boolean;
  private readonly sites: Set<string>;
  private timer: ReturnType<typeof setTimeout> | null = null;

  private static readonly SAVE_DEBOUNCE_MS = 500;

  /** @param filePath Where to read/write the settings JSON file. */
  public constructor(private readonly filePath: string) {
    const loaded = this.load();
    this.enabledFlag = loaded.enabled;
    this.sites = new Set(loaded.allowedSites);
  }

  /** @returns Whether blocking is on globally. */
  public get enabled(): boolean {
    return this.enabledFlag;
  }

  /** @returns The hostnames blocking is turned off for. */
  public get allowedSites(): readonly string[] {
    return [...this.sites];
  }

  /** @returns Whether blocking is turned off for this hostname (or a parent domain of it). */
  public isSiteAllowed(host: string): boolean {
    let candidate = host.toLowerCase();
    while (candidate.includes('.')) {
      if (this.sites.has(candidate)) {
        return true;
      }
      candidate = candidate.slice(candidate.indexOf('.') + 1);
    }
    return false;
  }

  public setEnabled(enabled: boolean): void {
    this.enabledFlag = enabled;
    this.scheduleSave();
  }

  public setSiteAllowed(host: string, allowed: boolean): void {
    const normalized = host.toLowerCase();
    if (allowed) {
      this.sites.add(normalized);
    } else {
      this.sites.delete(normalized);
    }
    this.scheduleSave();
  }

  /** Writes any pending change now — call before the app quits. */
  public flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
      this.save();
    }
  }

  private scheduleSave(): void {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      this.save();
    }, AdBlockStore.SAVE_DEBOUNCE_MS);
  }

  private save(): void {
    try {
      writeFileSync(this.filePath, JSON.stringify({ enabled: this.enabledFlag, allowedSites: [...this.sites] }), 'utf8');
    } catch (error) {
      console.error('Could not save ad blocker settings', error);
    }
  }

  private load(): z.infer<typeof adBlockFileSchema> {
    const fallback = adBlockFileSchema.parse({});
    if (!existsSync(this.filePath)) {
      return fallback;
    }
    try {
      const parsed = adBlockFileSchema.safeParse(JSON.parse(readFileSync(this.filePath, 'utf8')));
      return parsed.success ? parsed.data : fallback;
    } catch {
      return fallback;
    }
  }
}
