// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-29

import { ipcMain, type WebContents } from 'electron';
import { z } from 'zod';
import type { RGB } from '@shared/color';
import type { PenPoint, PenStore, StoredPenStroke } from './PenStore';
import { getCurrentAccent } from './pageSelectionAccent';
import type { SharedTabRegistry } from './SharedTabRegistry';

// Hardcoded rather than pulled from `@shared/ipc-contract` — same reason
// `HighlighterController`/`src/preload/tabHighlighter.ts` duplicate their own
// four channel names by hand: `src/preload/tabPen.ts` lives inside a
// sandboxed preload bundle that can't share a chunk with any other preload
// entry, so these five channel names are duplicated by hand on both sides
// instead. Keep them in sync.
const PenState = 'pen:state';
const PenOp = 'pen:op';
const PenApplyOp = 'pen:apply-op';
const PenRestore = 'pen:restore';
const PenClear = 'pen:clear';

const rgbSchema = z.object({ r: z.number(), g: z.number(), b: z.number() });
const pointSchema = z.object({ x: z.number(), y: z.number() });
const reportedOpSchema = z.union([
  z.object({ kind: z.literal('add'), id: z.string().min(1), points: z.array(pointSchema).min(2), color: rgbSchema }),
  z.object({ kind: z.literal('remove'), id: z.string().min(1) }),
]);

/** A pen stroke as sent to/from a tab's own preload — the wire shape both sides agree on by convention (see the hardcoded channel names above), not a type either side imports at runtime. */
interface PenRecord {
  readonly id: string;
  readonly points: readonly PenPoint[];
  readonly color: RGB;
}

/** One undoable action: a stroke that was added, or one that was removed. Undoing either just means doing the other. */
interface PenOpRecord {
  readonly kind: 'add' | 'remove';
  readonly stroke: PenRecord;
}

interface TabPenState {
  /** Every stroke currently drawn on this tab's live document, keyed by id — resolves a bare `remove` report (preload only knows the id it's removing, not the full record) back to what undoing that removal needs to restore. */
  readonly current: Map<string, PenRecord>;
  readonly undo: PenOpRecord[];
  readonly redo: PenOpRecord[];
}

function toRecord(stored: StoredPenStroke): PenRecord {
  return { id: stored.id, points: stored.points, color: stored.colorRgb };
}

function toStored(record: PenRecord, url: string): StoredPenStroke {
  return { id: record.id, url, points: [...record.points], colorRgb: record.color, createdAt: Date.now() };
}

/**
 * Owns the pen tool's cross-process wiring for every browser tab — shared
 * across every window's `TabManager` (constructed once in `main/index.ts`,
 * mirroring `HighlighterController`) since a tab carries its drawings with it
 * if it's moved between windows. `TabManager` itself only owns the
 * per-window on/off toggle (`penActive`); this class owns what a stroke
 * actually *is*: creating it, undoing/redoing it, persisting it, and pushing
 * it down into a tab's own preload (`src/preload/tabPen.ts`), which does the
 * actual DOM work of drawing, hovering, and removing its SVG paths.
 *
 * Mirrors `HighlighterController` almost exactly — see its own class doc
 * comment for the fuller reasoning. The one real difference is what a mark
 * *is*: a highlight anchors to a text quote and re-finds it on restore; a pen
 * stroke is a freehand path with no text of its own, so it's stored (and
 * restored) as a plain list of page-coordinate points instead — see
 * `PenStore`'s own doc comment for that tradeoff. Browser-tab only, like
 * `CommentController`: a terminal's own character grid has no document
 * coordinate space for a freehand overlay to live in.
 */
export class PenController {
  private readonly tabs = new Map<string, TabPenState>();

  public constructor(
    private readonly registry: SharedTabRegistry,
    private readonly store: PenStore,
  ) {
    ipcMain.on(PenOp, (event, rawOp: unknown) => {
      const tabId = this.resolveTabId(event.sender);
      const parsed = reportedOpSchema.safeParse(rawOp);
      if (!tabId || !parsed.success) {
        return;
      }
      this.applyReportedOp(tabId, parsed.data);
    });
  }

  /**
   * Pushes the pen tool's current on/off state (and, if on, the current
   * accent color) to a tab's own preload — call on toggle, on tab
   * activation, and on every `dom-ready`. A no-op for a tab that no longer
   * exists.
   */
  public syncState(tabId: string, active: boolean): void {
    const view = this.registry.views.get(tabId);
    if (!view || view.webContents.isDestroyed()) {
      return;
    }
    view.webContents.send(PenState, { active, color: getCurrentAccent() });
  }

  /**
   * Pushes a fresh accent color to every browser tab (pen strokes are
   * browser-tab only, unlike `HighlighterController.broadcastColor`, which
   * also reaches terminal tabs) — call whenever `setAccentColor` changes it.
   * Every already-drawn stroke repaints itself to match (`tabPen.ts`'s own
   * `repaintAllStrokes`) the instant this arrives, same reasoning as
   * `HighlighterController.broadcastColor`.
   * @param isActiveForTab Whether the window currently showing a given tab
   *   has the pen tool toggled on — resolved by the caller
   *   (`main/index.ts`), which is the only place that knows which
   *   `TabManager` currently owns a given tab.
   */
  public broadcastColor(isActiveForTab: (tabId: string) => boolean): void {
    const color = getCurrentAccent();
    for (const [tabId, view] of this.registry.views) {
      if (view.webContents.isDestroyed() || this.registry.states.get(tabId)?.kind !== 'browser') {
        continue;
      }
      view.webContents.send(PenState, { active: isActiveForTab(tabId), color });
    }
  }

  /**
   * Starts tracking a fresh document's strokes — call on every `dom-ready`
   * for a browser tab, before `restoreFor`. A fresh document has none of the
   * previous one's undo/redo history or live strokes, regardless of whether
   * it's the very same URL reloaded.
   */
  public resetTab(tabId: string): void {
    this.tabs.set(tabId, { current: new Map(), undo: [], redo: [] });
  }

  /**
   * Pushes every stroke persisted for a tab's current URL down to its
   * preload to redraw — call once per `dom-ready`, right after `resetTab`.
   * Restored strokes seed `current` directly rather than going through
   * `applyReportedOp`, since they're not a new action Ctrl+Z should be able
   * to undo — they were already there before this page load.
   */
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
    const strokes = stored.map(toRecord);
    for (const stroke of strokes) {
      tabState.current.set(stroke.id, stroke);
    }
    view.webContents.send(PenRestore, { strokes });
  }

  /**
   * Removes a tab's in-memory undo/redo/current state — call when a tab
   * closes. Never touches `PenStore`: persisted strokes are keyed by URL, not
   * tab id, and outlive the tab that made them for whenever that page is
   * opened again.
   */
  /**
   * @param url A page's address.
   * @returns Whether that page has any saved pen strokes — what Revert would take off it.
   */
  public hasMarksFor(url: string): boolean {
    return this.store.listFor(url).length > 0;
  }

  public disposeTab(tabId: string): void {
    this.tabs.delete(tabId);
  }

  /**
   * Wipes every stroke on a tab's current page for good — the "revert page"
   * toolbar action's pen half (see `TabManager.revertPage` and
   * `HighlighterController.clearTab`, its highlight counterpart, for the
   * full reasoning — this mirrors it exactly). A no-op for a tab with
   * nothing drawn.
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

  /** Clears one tab's in-memory stroke state and tells its preload to remove every mark from the DOM — the shared half of `clearTab`'s own tab and every sibling it mirrors onto. */
  private wipeTabState(tabId: string): void {
    const tabState = this.tabs.get(tabId);
    if (tabState) {
      tabState.current.clear();
      tabState.undo.length = 0;
      tabState.redo.length = 0;
    }
    const view = this.registry.views.get(tabId);
    if (view && !view.webContents.isDestroyed()) {
      view.webContents.send(PenClear);
    }
  }

  /**
   * Undoes a tab's most recent stroke action (Ctrl+Z, only while the pen
   * tool is on — see `TabManager.wireSharedInputHandling`) — inverts it (an
   * add is undone by removing it, a remove by re-adding it) and moves it
   * onto the redo stack. A no-op if there's nothing to undo.
   */
  public undo(tabId: string): void {
    const tabState = this.tabs.get(tabId);
    const op = tabState?.undo.pop();
    if (!tabState || !op) {
      return;
    }
    tabState.redo.push(op);
    this.invert(tabId, tabState, op);
  }

  /** Redoes a tab's most recently undone stroke action (Ctrl+Y). A no-op if there's nothing to redo. */
  public redo(tabId: string): void {
    const tabState = this.tabs.get(tabId);
    const op = tabState?.redo.pop();
    if (!tabState || !op) {
      return;
    }
    tabState.undo.push(op);
    this.perform(tabId, tabState, op);
  }

  /** Applies an op as-is: an `add` op adds the stroke, a `remove` op removes it. What `redo` does. */
  private perform(tabId: string, tabState: TabPenState, op: PenOpRecord): void {
    const url = this.urlFor(tabId);
    if (op.kind === 'add') {
      tabState.current.set(op.stroke.id, op.stroke);
      this.sendApplyOp(tabId, { action: 'add', stroke: op.stroke });
      if (url) {
        this.store.add(toStored(op.stroke, url));
      }
    } else {
      tabState.current.delete(op.stroke.id);
      this.sendApplyOp(tabId, { action: 'remove', id: op.stroke.id });
      this.store.remove(op.stroke.id);
    }
    if (url) {
      this.syncSiblingTabs(tabId, url, op);
    }
  }

  /** Applies an op's inverse: undoing an `add` removes it, undoing a `remove` re-adds it. What `undo` does. */
  private invert(tabId: string, tabState: TabPenState, op: PenOpRecord): void {
    const url = this.urlFor(tabId);
    const inverse: PenOpRecord = { kind: op.kind === 'add' ? 'remove' : 'add', stroke: op.stroke };
    if (op.kind === 'add') {
      tabState.current.delete(op.stroke.id);
      this.sendApplyOp(tabId, { action: 'remove', id: op.stroke.id });
      this.store.remove(op.stroke.id);
    } else {
      tabState.current.set(op.stroke.id, op.stroke);
      this.sendApplyOp(tabId, { action: 'add', stroke: op.stroke });
      if (url) {
        this.store.add(toStored(op.stroke, url));
      }
    }
    if (url) {
      this.syncSiblingTabs(tabId, url, inverse);
    }
  }

  /**
   * Handles a stroke a tab's own preload just made or removed on its own (a
   * live user action — a finished drag, or a hover+click/D/Delete), as
   * opposed to an undo/redo replay. The DOM side is already done by the time
   * this fires; this only updates main's own bookkeeping: records it on the
   * undo stack, clears the redo stack, and persists it.
   */
  private applyReportedOp(
    tabId: string,
    parsed: { kind: 'add'; id: string; points: PenPoint[]; color: RGB } | { kind: 'remove'; id: string },
  ): void {
    const tabState = this.tabs.get(tabId) ?? { current: new Map<string, PenRecord>(), undo: [], redo: [] };
    this.tabs.set(tabId, tabState);

    let op: PenOpRecord;
    if (parsed.kind === 'add') {
      op = { kind: 'add', stroke: { id: parsed.id, points: parsed.points, color: parsed.color } };
    } else {
      const existing = tabState.current.get(parsed.id);
      if (!existing) {
        // Nothing on record for this id — e.g. a stale report from a
        // document that's since navigated away. Nothing to undo to.
        return;
      }
      op = { kind: 'remove', stroke: existing };
    }

    tabState.redo.length = 0;
    tabState.undo.push(op);

    const url = this.urlFor(tabId);
    if (op.kind === 'add') {
      tabState.current.set(op.stroke.id, op.stroke);
      if (url) {
        this.store.add(toStored(op.stroke, url));
      }
    } else {
      tabState.current.delete(op.stroke.id);
      this.store.remove(op.stroke.id);
    }
    if (url) {
      this.syncSiblingTabs(tabId, url, op);
    }
  }

  /**
   * Applies the same change to every *other* open tab currently showing
   * `url` — a browser tab's strokes are keyed by URL, not by tab, same
   * reasoning as `HighlighterController.syncSiblingTabs`.
   */
  private syncSiblingTabs(tabId: string, url: string, op: PenOpRecord): void {
    for (const [siblingId, state] of this.registry.states) {
      if (siblingId === tabId || state.kind !== 'browser' || state.url !== url) {
        continue;
      }
      const siblingState = this.tabs.get(siblingId);
      if (op.kind === 'add') {
        siblingState?.current.set(op.stroke.id, op.stroke);
        this.sendApplyOp(siblingId, { action: 'add', stroke: op.stroke });
      } else {
        siblingState?.current.delete(op.stroke.id);
        this.sendApplyOp(siblingId, { action: 'remove', id: op.stroke.id });
      }
    }
  }

  private urlFor(tabId: string): string | null {
    const state = this.registry.states.get(tabId);
    return state?.kind === 'browser' ? state.url : null;
  }

  private sendApplyOp(
    tabId: string,
    payload: { action: 'add'; stroke: PenRecord } | { action: 'remove'; id: string },
  ): void {
    const view = this.registry.views.get(tabId);
    if (view && !view.webContents.isDestroyed()) {
      view.webContents.send(PenApplyOp, payload);
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
