// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-29

import { ipcMain, type WebContents } from 'electron';
import { z } from 'zod';
import type { RGB } from '@shared/color';
import type { CommentQuote, CommentStore, StoredComment } from './CommentStore';
import { getCurrentAccent } from './pageSelectionAccent';
import type { SharedTabRegistry } from './SharedTabRegistry';

// Hardcoded rather than pulled from `@shared/ipc-contract` — same reason
// `src/preload/tabHighlighter.ts`/`HighlighterController` duplicate their own
// four channel names by hand: `src/preload/tabComments.ts` lives inside a
// sandboxed preload bundle that can't share a chunk with any other preload
// entry. Keep these in sync with that file's own copies.
const CommentToolState = 'comment-tool:state';
const CommentToolOp = 'comment-tool:op';
const CommentToolApplyOp = 'comment-tool:apply-op';
const CommentToolRestore = 'comment-tool:restore';
const CommentToolClear = 'comment-tool:clear';

const rgbSchema = z.object({ r: z.number(), g: z.number(), b: z.number() });
const quoteSchema = z.object({ prefix: z.string(), suffix: z.string() });
const reportedOpSchema = z.union([
  z.object({
    kind: z.literal('add'),
    id: z.string().min(1),
    quote: quoteSchema,
    dx: z.number(),
    dy: z.number(),
    text: z.string().min(1),
    color: rgbSchema,
  }),
  z.object({ kind: z.literal('update'), id: z.string().min(1), text: z.string().min(1) }),
  z.object({ kind: z.literal('remove'), id: z.string().min(1) }),
]);

/** A comment as sent to/from a tab's own preload — the wire shape both sides agree on by convention (see the hardcoded channel names above). */
interface CommentRecord {
  readonly id: string;
  readonly quote: CommentQuote;
  readonly dx: number;
  readonly dy: number;
  readonly text: string;
  readonly color: RGB;
}

interface TabCommentState {
  /** Every comment currently applied to this tab's live document, keyed by id. */
  readonly current: Map<string, CommentRecord>;
}

function toRecord(stored: StoredComment): CommentRecord {
  return { id: stored.id, quote: stored.quote, dx: stored.dx, dy: stored.dy, text: stored.text, color: stored.colorRgb };
}

function toStored(record: CommentRecord, url: string): StoredComment {
  return {
    id: record.id,
    url,
    quote: record.quote,
    dx: record.dx,
    dy: record.dy,
    text: record.text,
    colorRgb: record.color,
    createdAt: Date.now(),
  };
}

/**
 * Owns the comment tool's cross-process wiring for every browser tab —
 * shared across every window's `TabManager` (constructed once in
 * `main/index.ts`, mirroring `HighlighterController`) since a tab carries its
 * comments with it if it's moved between windows. Unlike the highlighter,
 * there's no undo/redo stack here — the feature was never asked to support
 * Ctrl+Z, only add/edit/delete, each a plain, non-invertible action of its
 * own. `TabManager` itself only owns the per-window on/off toggle
 * (`commentToolActive`) and this class owns what a comment actually *is*:
 * creating it, editing it, deleting it, persisting it, and pushing it down
 * into a tab's own preload (`src/preload/tabComments.ts`), which does the
 * actual DOM work of dropping, positioning, and re-anchoring pins.
 *
 * Never used by terminal tabs — a comment anchors to page text via a
 * `TextQuoteSelector`-style quote, which a pty's scrollback has no stable
 * version of across reloads the way a browser tab's document does.
 */
export class CommentController {
  private readonly tabs = new Map<string, TabCommentState>();

  public constructor(
    private readonly registry: SharedTabRegistry,
    private readonly store: CommentStore,
  ) {
    ipcMain.on(CommentToolOp, (event, rawOp: unknown) => {
      const tabId = this.resolveTabId(event.sender);
      const parsed = reportedOpSchema.safeParse(rawOp);
      if (!tabId || !parsed.success) {
        return;
      }
      this.applyReportedOp(tabId, parsed.data);
    });
  }

  /**
   * Pushes the comment tool's current on/off state (and, if on, the current
   * accent color new pins are drawn in) to a tab's own preload — call on
   * toggle, on tab activation, and on every `dom-ready`. A no-op for a tab
   * that no longer exists.
   */
  public syncState(tabId: string, active: boolean): void {
    const view = this.registry.views.get(tabId);
    if (!view || view.webContents.isDestroyed()) {
      return;
    }
    view.webContents.send(CommentToolState, { active, color: getCurrentAccent() });
  }

  /**
   * Pushes a fresh accent color to every browser tab (comments are
   * browser-tab only, unlike `HighlighterController.broadcastColor`, which
   * also reaches terminal tabs) — call whenever `setAccentColor` changes it.
   * Every already-dropped pin repaints itself to match
   * (`tabComments.ts`'s own `repaintAllComments`) the instant this arrives,
   * same reasoning as `HighlighterController.broadcastColor`.
   * @param isActiveForTab Whether the window currently showing a given tab
   *   has the comment tool toggled on — resolved by the caller
   *   (`main/index.ts`), which is the only place that knows which
   *   `TabManager` currently owns a given tab.
   */
  public broadcastColor(isActiveForTab: (tabId: string) => boolean): void {
    const color = getCurrentAccent();
    for (const [tabId, view] of this.registry.views) {
      if (view.webContents.isDestroyed() || this.registry.states.get(tabId)?.kind !== 'browser') {
        continue;
      }
      view.webContents.send(CommentToolState, { active: isActiveForTab(tabId), color });
    }
  }

  /** Starts tracking a fresh document's comments — call on every `dom-ready` for a browser tab, before `restoreFor`. */
  public resetTab(tabId: string): void {
    this.tabs.set(tabId, { current: new Map() });
  }

  /** Pushes every comment persisted for a tab's current URL down to its preload to re-apply — call once per `dom-ready`, right after `resetTab`. */
  public restoreFor(tabId: string, url: string): void {
    const view = this.registry.views.get(tabId);
    const tabState = this.tabs.get(tabId);
    if (!view || !tabState || view.webContents.isDestroyed()) {
      return;
    }
    const stored = this.store.listFor(url);
    if (stored.length === 0) {
      return;
    }
    const comments = stored.map(toRecord);
    for (const comment of comments) {
      tabState.current.set(comment.id, comment);
    }
    view.webContents.send(CommentToolRestore, { comments });
  }

  /** Removes a tab's in-memory comment state — call when a tab closes. Never touches `CommentStore`: persisted comments are keyed by URL, not tab id. */
  /**
   * @param url A page's address.
   * @returns Whether that page has any saved comments — what Revert would take off it.
   */
  public hasMarksFor(url: string): boolean {
    return this.store.listFor(url).length > 0;
  }

  public disposeTab(tabId: string): void {
    this.tabs.delete(tabId);
  }

  /**
   * Wipes every comment on a tab's current page for good — the "revert
   * page" toolbar action's comment half; see
   * `HighlighterController.clearTab`, its highlight counterpart, for the
   * full reasoning (this mirrors it exactly: deletes every persisted
   * comment for the tab's URL and mirrors the wipe onto every sibling tab
   * open to that same URL). A no-op for a tab with nothing commented.
   */
  public clearTab(tabId: string): void {
    this.wipeTabState(tabId);
    const url = this.urlFor(tabId);
    if (!url) {
      return;
    }
    for (const stored of this.store.listFor(url)) {
      this.store.remove(stored.id);
    }
    for (const [siblingId, state] of this.registry.states) {
      if (siblingId === tabId || state.kind !== 'browser' || state.url !== url) {
        continue;
      }
      this.wipeTabState(siblingId);
    }
  }

  /** Clears one tab's in-memory comment state and tells its preload to remove every pin from the DOM — the shared half of `clearTab`'s own tab and every sibling it mirrors onto. */
  private wipeTabState(tabId: string): void {
    this.tabs.get(tabId)?.current.clear();
    const view = this.registry.views.get(tabId);
    if (view && !view.webContents.isDestroyed()) {
      view.webContents.send(CommentToolClear);
    }
  }

  /**
   * Handles a comment a tab's own preload just added, edited, or deleted on
   * its own — the DOM side is already done by the time this fires; this only
   * updates main's own bookkeeping (persists it, and mirrors it onto every
   * other tab open to the same URL).
   */
  private applyReportedOp(
    tabId: string,
    parsed:
      | { kind: 'add'; id: string; quote: CommentQuote; dx: number; dy: number; text: string; color: RGB }
      | { kind: 'update'; id: string; text: string }
      | { kind: 'remove'; id: string },
  ): void {
    const tabState = this.tabs.get(tabId) ?? { current: new Map<string, CommentRecord>() };
    this.tabs.set(tabId, tabState);
    const url = this.urlFor(tabId);

    if (parsed.kind === 'add') {
      const record: CommentRecord = {
        id: parsed.id,
        quote: parsed.quote,
        dx: parsed.dx,
        dy: parsed.dy,
        text: parsed.text,
        color: parsed.color,
      };
      tabState.current.set(record.id, record);
      if (url) {
        this.store.add(toStored(record, url));
        this.syncSiblingTabs(tabId, url, { action: 'add', comment: record });
      }
      return;
    }

    if (parsed.kind === 'update') {
      const existing = tabState.current.get(parsed.id);
      if (!existing) {
        return;
      }
      tabState.current.set(parsed.id, { ...existing, text: parsed.text });
      this.store.update(parsed.id, parsed.text);
      if (url) {
        this.syncSiblingTabs(tabId, url, { action: 'update', id: parsed.id, text: parsed.text });
      }
      return;
    }

    tabState.current.delete(parsed.id);
    this.store.remove(parsed.id);
    if (url) {
      this.syncSiblingTabs(tabId, url, { action: 'remove', id: parsed.id });
    }
  }

  /**
   * Applies the same change to every *other* open tab currently showing
   * `url` — a comment is keyed by URL, not by tab, so two tabs open to the
   * same page must stay in step immediately, same reasoning as
   * `HighlighterController.syncSiblingTabs`.
   */
  private syncSiblingTabs(
    tabId: string,
    url: string,
    payload:
      | { action: 'add'; comment: CommentRecord }
      | { action: 'update'; id: string; text: string }
      | { action: 'remove'; id: string },
  ): void {
    for (const [siblingId, state] of this.registry.states) {
      if (siblingId === tabId || state.kind !== 'browser' || state.url !== url) {
        continue;
      }
      const siblingState = this.tabs.get(siblingId);
      if (payload.action === 'add') {
        siblingState?.current.set(payload.comment.id, payload.comment);
      } else if (payload.action === 'update') {
        const existing = siblingState?.current.get(payload.id);
        if (existing) {
          siblingState!.current.set(payload.id, { ...existing, text: payload.text });
        }
      } else {
        siblingState?.current.delete(payload.id);
      }
      this.sendApplyOp(siblingId, payload);
    }
  }

  private urlFor(tabId: string): string | null {
    const state = this.registry.states.get(tabId);
    return state?.kind === 'browser' ? state.url : null;
  }

  private sendApplyOp(
    tabId: string,
    payload:
      | { action: 'add'; comment: CommentRecord }
      | { action: 'update'; id: string; text: string }
      | { action: 'remove'; id: string },
  ): void {
    const view = this.registry.views.get(tabId);
    if (view && !view.webContents.isDestroyed()) {
      view.webContents.send(CommentToolApplyOp, payload);
    }
  }

  /** Finds which tab id owns a given `webContents` — see `HighlighterController.resolveTabId`, the same pattern for the same reason. */
  private resolveTabId(sender: WebContents): string | undefined {
    for (const [tabId, view] of this.registry.views) {
      if (view.webContents === sender) {
        return tabId;
      }
    }
    return undefined;
  }
}
