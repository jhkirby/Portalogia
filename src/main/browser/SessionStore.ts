// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-05

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { z } from 'zod';

/**
 * One tab's minimal recreatable state — enough to reopen it, not to replay
 * its navigation history or (for a terminal) its scrollback. Same idea as
 * `ClosedTab` (TabManager.ts) already uses for "reopen the last closed
 * tab," just persisted to disk across restarts instead of kept in memory
 * for the current run.
 */
const sessionTabSchema = z.object({
  kind: z.enum(['browser', 'terminal', 'pdf', 'history']),
  // Meaningless for a terminal tab — kept on every entry anyway rather
  // than splitting this into two schema variants, since restoring one is
  // already just "ignore this field."
  url: z.string(),
  workspaceId: z.string().min(1),
  active: z.boolean(),
});

const sessionWorkspaceSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  color: z.string(),
});

const sessionFileSchema = z.object({
  workspaces: z.array(sessionWorkspaceSchema),
  tabs: z.array(sessionTabSchema),
  activeWorkspaceId: z.string().min(1),
});

export type SessionSnapshot = z.infer<typeof sessionFileSchema>;

/**
 * How long to let rapid-fire state changes settle before actually writing
 * the session file. `TabManager.emitState()` fires on every title/favicon/
 * loading-flag update while a page loads, not just the structural changes
 * (new tab, closed tab, switched workspace) that make a saved session
 * actually differ — debouncing collapses a burst of those into one
 * `writeFileSync` shortly after they stop, instead of one per change.
 */
const SAVE_DEBOUNCE_MS = 400;

/**
 * Persists the current tabs/workspaces as JSON in the app's user-data
 * directory, so relaunching the app restores exactly where the user left
 * off instead of always starting from one fresh home tab. Loaded once at
 * construction, same as `BookmarkStore`; unlike `BookmarkStore`'s
 * synchronous per-mutation writes, saves here are debounced
 * (`scheduleSave`) since tab/workspace state changes far more often
 * mid-session, with an immediate `flush()` for the one moment that can't
 * wait out the debounce: the window actually closing.
 */
export class SessionStore {
  private readonly initial: SessionSnapshot | null;
  private pending: SessionSnapshot | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  /** @param filePath Where to read/write the session JSON file. */
  public constructor(private readonly filePath: string) {
    this.initial = this.load();
  }

  /**
   * @returns The session as it was when the app last closed (or was last
   *   flushed), or `null` if there's none saved yet (first launch) or the
   *   file was missing/corrupt/schema-mismatched.
   */
  public get(): SessionSnapshot | null {
    return this.initial;
  }

  /**
   * Schedules a write of the given snapshot, debounced so a burst of
   * `TabManager` state changes collapses into a single disk write shortly
   * after they settle rather than one per change.
   * @param snapshot The full session to persist once the debounce settles.
   */
  public scheduleSave(snapshot: SessionSnapshot): void {
    this.pending = snapshot;
    if (this.timer !== null) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => this.flush(), SAVE_DEBOUNCE_MS);
  }

  /**
   * Writes whatever snapshot is pending immediately, skipping the
   * debounce — call this right before the window closes, since nothing
   * will fire the deferred timer after that. A no-op if nothing's pending.
   */
  public flush(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.pending === null) {
      return;
    }
    writeFileSync(this.filePath, JSON.stringify(this.pending, null, 2), 'utf-8');
    this.pending = null;
  }

  /**
   * @returns The session loaded from disk, or `null` if the file is
   *   missing, corrupt, or schema-mismatched — callers fall back to a
   *   single fresh tab in that case, same as `BookmarkStore.load()`
   *   falling back to an empty list.
   */
  private load(): SessionSnapshot | null {
    if (!existsSync(this.filePath)) {
      return null;
    }
    try {
      const raw: unknown = JSON.parse(readFileSync(this.filePath, 'utf-8'));
      return sessionFileSchema.parse(raw);
    } catch {
      return null;
    }
  }
}
